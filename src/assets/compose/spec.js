// src/assets/compose/spec.js
//
// The scene spec: what `POST /compose` accepts, what the contract declares about it, and the one
// place that says a spec is malformed or over a limit.
//
// ## Why the numbers here are not pixels
//
// The spec names things the way the game does (plan §3.2): a species, a tile column and row, a
// mutation by name, a crop's own `size` on the game's 50-to-100 band. Nothing in it is a pixel
// coordinate, because a caller cannot know the reference tile, `slotOffsets`, `baseTileScale`,
// the size curve, the pot anchors, the rotation or the z-order ladder — all of which are the
// game's own numbers and all of which the API owns. `padding` is the one length, and it is a
// length *around* the content rather than a place in it.
//
// ## The limits
//
// The same numbers the contract declares (`x-mg-contract.compose` in `src/docs/openapi.yaml`,
// re-served live by `/schema.json`): a maximum item count, a maximum canvas, and a maximum
// pixel count. A spec over one is **refused with a named error**, never truncated: truncating a
// scene would silently return a wrong picture, which is the one failure this whole design
// exists to prevent.
//
// `SPEC_VERSION` is the version of *this* shape. A caller that sends a version this instance
// does not implement is refused by name, the same way a caller refuses an API contract it does
// not know.
//
// ## Why spec 2, and what it adds
//
// A patch tile is a **cluster**: fifteen crops on one tile for Clover, each with its own size, its
// own drawn scale and its own place inside the tile. Spec 1 could only say "on this tile", so all
// fifteen landed on one point. Spec 2 adds the two things the cluster needs and changes nothing
// else:
//
//   * an optional in-tile place on an item's `at` — `x` and `y` as **fractions of a tile**, and
//     `rotation` in degrees, which is the unit the save states them in (`crop.x`, `crop.y`,
//     `crop.rotation`: the renderer multiplies the fractions by the 256-pixel tile and sets
//     `container.angle` from the degrees). Absent means `0`, the tile's middle, which is where
//     spec 1 drew everything;
//   * `kind: "patch"` — one entry per sprig in `crops`, each with its own size and mutations, and a
//     sprig's place from the game's own scatter when the sprig does not state one.
//
// Spec 1 stays accepted and behaves exactly as it did: the new fields are optional and their
// defaults are what spec 1 meant, so the two versions normalise to the same value.

/** The spec shapes this instance implements, newest first. The first is the one an answer echoes. */
export const SUPPORTED_SPEC_VERSIONS = Object.freeze([2, 1]);

/** The spec shape this instance implements, declared in the contract and echoed in every answer. */
export const SPEC_VERSION = SUPPORTED_SPEC_VERSIONS[0];

/**
 * The limits, as one record. The contract document declares the same numbers, and
 * `tests/compose-contract.test.js` reads both and asserts they agree — a limit that moves in the
 * code and not in the document would refuse a client that the contract told it was fine.
 */
export const COMPOSE_LIMITS = Object.freeze({
  maxItems: 256,
  maxCanvas: Object.freeze({ width: 4096, height: 4096 }),
  maxPixels: 16777216,
});

/** The canvas padding's own bound, in the game's pixels. */
const MAX_PADDING = 256;

/** The band the game carries a crop's own `size` on. */
const CROP_SIZE_MIN = 50;
const CROP_SIZE_MAX = 100;

/**
 * The kinds a spec may state: the three that carry a species, the three a garden tile can hold
 * instead of one, and the one that draws an inventory icon.
 *
 * `patch` is a tile that holds a **cluster** of the species' own crops rather than one art: the
 * game draws a `harvestType: "Single"` species that way (its plant art *is* what stands on the
 * tile, and each crop on it is a sprig at its own place), and `crops` on a `plant` item has always
 * meant the same thing to the composer. The two are kept apart because they take different fields:
 * a `plant` has a pot, a maturity and a body of its own, a patch has neither.
 *
 * `egg`, `crystal` and `decor` are the rest of a garden tile's vocabulary, and none of them has a
 * species: an egg tile states an `eggId` and the window it hatches on, a crystal tile states a
 * `crystalType` and the charge it holds, a decoration states a `decorId`. All three are one sprite
 * in a frame, drawn at the game's own scale, which is the whole of their picture — there is no
 * placement to state and none is invented here.
 *
 * `icon` is the one kind that is not on a garden tile at all: it draws one inventory entry the way
 * the game's own icon builder does — the entry's art contained in the game's 256-pixel icon square
 * at the share that kind of entry fills (`ICON_FILL`), centred on both axes. It states an
 * `itemType`, which is the game's own item-type literal, and the id that type's art is named by.
 */
export const SUPPORTED_ITEM_KINDS = Object.freeze(["plant", "patch", "crop", "egg", "crystal", "decor", "icon"]);

/**
 * The item types an `icon` item may state: the game's own item-type enum, which is what an inventory
 * entry carries and what the game's icon builder switches on (`@mg.js/art`'s `IconType`, read from
 * the extraction's `icon-fill-table` evidence).
 *
 * The two that are not one sprite are named here rather than left out, because a spec that asks for
 * one is refused by name with the reason — a plant's icon is an assembled picture and a pet's is a
 * portrait baked from Rive — instead of drawing nothing.
 */
export const ICON_ITEM_TYPES = Object.freeze(["Seed", "Produce", "Plant", "Tool", "Egg", "Decor", "Pet"]);

/** The id field each item type's art is named by, as the game's own icon builder reads it. */
const ICON_ID_FIELDS = Object.freeze({
  Seed: "species",
  Produce: "species",
  Plant: "species",
  Tool: "toolId",
  Egg: "eggId",
  Decor: "decorId",
  // A pet is named by its species too, even though its icon is baked rather than drawn from a sprite:
  // the bake is addressed by the species, which is why the field is stated rather than left out.
  Pet: "species",
});

/**
 * A spec this instance refuses, with the reason named.
 *
 * `code` is what a client branches on (`COMPOSE_SPEC_INVALID`, `COMPOSE_LIMIT_EXCEEDED`,
 * `COMPOSE_SPEC_VERSION_UNSUPPORTED`, and the two a `patch` can raise —
 * `COMPOSE_PATCH_NOT_A_PATCH`, `COMPOSE_PATCH_OVER_CAPACITY`); `limit` and `saw` name the bound and
 * what the spec stated, so a caller can fix it without re-reading this file.
 */
export class ComposeSpecError extends Error {
  constructor(code, message, { limit = null, saw = null, status = 400 } = {}) {
    super(message);
    this.name = "ComposeSpecError";
    this.code = code;
    this.status = status;
    this.limit = limit;
    this.saw = saw;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.limit === null ? {} : { limit: this.limit }),
        ...(this.saw === null ? {} : { saw: this.saw }),
      },
    };
  }
}

const invalid = (message, extra) => new ComposeSpecError("COMPOSE_SPEC_INVALID", message, extra);
const overLimit = (message, extra) => new ComposeSpecError("COMPOSE_LIMIT_EXCEEDED", message, extra);

/** Whether a value is a plain object, which is the only shape a spec's blocks may have. */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite integer, or `null` — `0` is a number and must not be read as absent. */
function integerOf(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

/** A string that is not empty, trimmed, or `null`. */
function nameOf(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The mutation names a spec states, in the game's own spelling and with duplicates gone.
 *
 * Order is **not** kept: the game's own draw order is the table's (`mutationArt[].order`), which
 * the recipe applies, and a spec that lists `["Frozen", "Wet"]` or `["Wet", "Frozen"]` asks for
 * the same picture — so the list is sorted here, once, and the content key follows from it.
 */
function mutationsOf(value, where) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${where}: mutations must be an array of names`);
  const names = [];
  for (const entry of value) {
    const name = nameOf(entry);
    if (name === null) throw invalid(`${where}: a mutation name must be a non-empty string`);
    if (!names.includes(name)) names.push(name);
  }
  return names.sort();
}

/** Native `Array.prototype.sort` is lexicographic; that is deliberate, it is only a canonical order. */
function sortedUnique(values) {
  return [...new Set(values)].sort();
}

/**
 * `at` — the tile a thing occupies, and (spec 2) where inside it.
 *
 * `x` and `y` are **fractions of a tile** and `rotation` is degrees, which is the unit the game's
 * own save states a crop's place in. The schema calls them optional unbounded numbers and the
 * renderer supplies the units — `x * 256` pixels, `container.angle` degrees — and it compares them
 * field by field, so they are persisted instance data rather than something recomputed. A caller
 * that states none asks for `0`, the tile's middle, which is what the composer drew before spec 2.
 */
function positionOf(value, where) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw invalid(`${where}: at must be an object with column and row`);
  const column = integerOf(value.column);
  const row = integerOf(value.row);
  if (column === null || row === null) throw invalid(`${where}: at.column and at.row must be integers`);
  if (column < 0 || row < 0) throw invalid(`${where}: at.column and at.row must not be negative`);
  return { column, row, ...placeOf(value, `${where}.at`) };
}

/**
 * The in-tile place a spec states: `x`/`y` as tile fractions, `rotation` in degrees, `null` for
 * absent.
 *
 * A place is a *number*, not a pixel count: the API multiplies it by the 256-pixel reference tile
 * (`sceneLayout.js`). Nothing here is bounded, because the game's own schema is not — a place
 * outside the tile is a caller's own choice and the scene's canvas union already accounts for it;
 * the game's scatter, which is what a caller that states nothing gets, stays inside the tile.
 */
function placeOf(value, where) {
  // A place can be absent — on a crop that does not state one, and on a spec that was normalised
  // before (where the absent place is three nulls).
  if (value === undefined || value === null) return { x: null, y: null, rotation: null };
  const parse = (key) => {
    const stated = value[key];
    // A normalized spec states `null` for a place it was not given, and every path that lays a scene
    // out normalizes first (`layOutScene`), so `null` and absent have to mean the same thing.
    if (stated === undefined || stated === null) return null;
    const parsed = numberOrNull(stated);
    if (parsed === null) throw invalid(`${where}: ${key} must be a finite number`);
    return parsed;
  };
  return { x: parse("x"), y: parse("y"), rotation: parse("rotation") };
}

/** A finite number, or `null` — `0` is a number and must not be read as absent. */
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The id a tile object states — an `eggId`, a `crystalType`, a `decorId` — as the game's own tables
 * spell it. Required, because an absent one names no art: there is no default egg.
 */
function idOf(value, where) {
  const name = nameOf(value);
  if (name === null) throw invalid(`${where} must be a non-empty string`);
  return name;
}

/**
 * How much of its own window a thing has left, which is the pair of fields the wire carries for a
 * crop and for an egg alike.
 *
 * The window is `startTime` to `endTime`, and the moment a picture is drawn at is
 * `endTime − remainingMs` — so the API needs no clock of its own and the same spec composes the same
 * picture twice. `ready: true` asks for the ripe picture whatever the window says. Absent times are
 * `null` rather than `0`: a thing that states no window is drawn full-size (`growth.js`), and reading
 * an absent `startTime` as the epoch would draw it at nothing.
 */
function windowOf(raw) {
  return {
    startTime: integerOf(raw.startTime),
    endTime: integerOf(raw.endTime),
    remainingMs: integerOf(raw.remainingMs),
    ready: booleanOf(raw.ready, null),
  };
}

/**
 * A duration in seconds that is not negative — the charge a crystal holds.
 *
 * `0` is a real answer (a spent crystal) and is not read as absent, which is the same rule the
 * integers above follow.
 */
function secondsOf(value, where) {
  if (value === undefined || value === null) return null;
  const seconds = numberOrNull(value);
  if (seconds === null) throw invalid(`${where} must be a finite number of seconds`);
  if (seconds < 0) throw invalid(`${where} must not be negative`);
  return seconds;
}

/**
 * A crop's own `size`, exactly as the wire carries it.
 *
 * The value is the game's own integer on its 50-to-100 band; the API converts it with the game's
 * own curve against the species' `maxSizeMultiplier`. A spec that states no size asks for the
 * ripe picture, which is the crop art's own frame (`scale: 1`).
 */
function sizeOf(value, where) {
  if (value === undefined || value === null) return null;
  const size = integerOf(value);
  if (size === null) throw invalid(`${where}: size must be an integer`);
  if (size < CROP_SIZE_MIN || size > CROP_SIZE_MAX) {
    throw invalid(`${where}: size ${size} is outside the game's ${CROP_SIZE_MIN}-${CROP_SIZE_MAX} band`);
  }
  return size;
}

/** A boolean the spec states, or the caller's own default. */
function booleanOf(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/** One `items[]` entry, normalised. */
function itemOf(raw, index, seenIds) {
  const where = `items[${index}]`;
  if (!isRecord(raw)) throw invalid(`${where}: an item must be an object`);
  const id = nameOf(raw.id);
  if (id === null) throw invalid(`${where}: id must be a non-empty string`);
  if (seenIds.has(id)) throw invalid(`${where}: id ${JSON.stringify(id)} is used twice`);
  seenIds.add(id);

  const kind = nameOf(raw.kind) ?? "crop";
  if (!SUPPORTED_ITEM_KINDS.includes(kind)) {
    throw invalid(
      `${where}: kind ${JSON.stringify(kind)} is not one of ${SUPPORTED_ITEM_KINDS.join(", ")}`,
    );
  }
  const at = positionOf(raw.at, where);
  const size = sizeOf(raw.size, where);

  // An inventory entry: one art in the game's icon square, named by the id its item type carries.
  if (kind === "icon") {
    const itemType = idOf(raw.itemType, `${where}.itemType`);
    if (!ICON_ITEM_TYPES.includes(itemType)) {
      throw invalid(
        `${where}: itemType ${JSON.stringify(itemType)} is not one of the game's inventory kinds ` +
          `(${ICON_ITEM_TYPES.join(", ")})`,
      );
    }
    const field = ICON_ID_FIELDS[itemType];
    const named = idOf(raw[field], `${where}.${field}`);
    // A produce entry carries the mutations the crop it is was picked with, and the game draws the
    // composed crop rather than the plain art for one; a seed's icon is the seed art either way. A **charged
    // tool** — a shard in the bag — is drawn as the crystal it holds rather than from its own name, which is
    // the game's own predicate (`itemType: "Tool"` and the entry states `remainingActiveSeconds`).
    return {
      id,
      kind,
      itemType,
      at,
      [field]: named,
      mutations: mutationsOf(raw.mutations, where),
      charged: booleanOf(raw.charged, false),
    };
  }

  // The three kinds a garden tile can hold instead of a species. None of them has one, and each states
  // the id the game's own sprite-name table is keyed by, so nothing about the art is guessed from a name
  // built here: a `decor` states a `decorId`, an `egg` an `eggId`, a `crystal` the type the item is named
  // by (`Hunger` for `sprite/item/HungerCrystal`).
  if (kind === "egg") {
    return { id, kind, eggId: idOf(raw.eggId, `${where}.eggId`), at, ...windowOf(raw) };
  }
  if (kind === "crystal") {
    return {
      id,
      kind,
      crystalType: idOf(raw.crystalType, `${where}.crystalType`),
      at,
      // The charge the crystal holds, which is what the game draws it at: one shard is four hours and a
      // crystal is three of them, and the save states the rest of it as `remainingActiveSeconds`.
      remainingSeconds: secondsOf(raw.remainingSeconds, `${where}.remainingSeconds`),
    };
  }
  if (kind === "decor") {
    return {
      id,
      kind,
      decorId: idOf(raw.decorId, `${where}.decorId`),
      at,
      // A decoration stacks by its own depth offset, which the game derives from the id and this rotation
      // (`fr(decorId, rotation).y`, `cropPlacement.js`). Degrees, and `0` is what a tile that states none
      // stands at.
      rotation: numberOrNull(raw.rotation) ?? 0,
    };
  }

  const species = nameOf(raw.species);
  if (species === null) throw invalid(`${where}: species must be a non-empty string`);

  if (kind === "crop") {
    return {
      id,
      kind,
      species,
      at,
      size,
      mutations: mutationsOf(raw.mutations, where),
      flipped: booleanOf(raw.flipped, false),
      ...windowOf(raw),
    };
  }

  // Both remaining kinds carry crops: a `plant`'s stand in its slots, a `patch`'s are the sprigs of
  // the cluster. Each crop states its own size and mutations, and a place when it has one.
  if (raw.crops !== undefined && !Array.isArray(raw.crops)) {
    throw invalid(`${where}: crops must be an array`);
  }

  const cropEntries = (raw.crops ?? []).map((crop, cropIndex) => cropOf(crop, `${where}.crops[${cropIndex}]`, cropIndex));

  if (kind === "patch") {
    // A patch with no sprigs is not refused: a cluster that has been harvested down to nothing is the plant
    // itself, which is what the game draws on that tile, and `layOutPatch` already draws the plant's own art
    // (`plantArt`) under the sprigs whether there are any or not. Refusing it made an empty tile a hole no
    // caller could fill.
    return {
      id,
      kind,
      species,
      at,
      // A patch's mutations are the sprigs' own; it has no body for a mutation of its own to land on.
      mutations: [],
      crops: cropEntries,
    };
  }

  return {
    id,
    kind,
    species,
    at,
    potted: booleanOf(raw.potted, false),
    matured: booleanOf(raw.matured, false),
    mutations: mutationsOf(raw.mutations, where),
    crops: cropEntries,
  };
}

/**
 * One entry of an item's `crops[]`, normalised.
 *
 * `slot` is a `plant`'s field: it names the place the species' own `slotOffsets` table gives it, and
 * a crop that states none is the next one. A `patch`'s sprigs are not placed by a slot table — the
 * game places them by the save's per-crop `x`/`y`/`rotation` — so a sprig may still state a slot (it
 * is the index in the game's own crop list) but nothing places it by one.
 *
 * `at` is read for both kinds, because the game places a crop by its own save in both: a patch's
 * sprig stands where the save put it, and a single-harvest plant drawn as an **icon** (`potted`)
 * squeezes that same place towards the plant's middle. A multi-harvest plant ignores it — its crops
 * are placed by slot — so the field is read and unused, never an error.
 */
function cropOf(crop, where, cropIndex) {
  if (!isRecord(crop)) throw invalid(`${where}: a crop must be an object`);
  const slot = integerOf(crop.slot);
  if (crop.slot !== undefined && (slot === null || slot < 0)) {
    throw invalid(`${where}: slot must be a non-negative integer`);
  }
  return {
    slot: slot ?? cropIndex,
    size: sizeOf(crop.size, where),
    mutations: mutationsOf(crop.mutations, where),
    flipped: booleanOf(crop.flipped, false),
    // When the crop was planted, which is two of the game's own readings at once: the turn a species
    // that sets `rotateSlotOffsetsRandomly` gives each of its crops (`35 − startTime % 70` degrees off
    // the slot's own angle, so two tomatoes on one vine sit at different angles), and the start of the
    // window its growth is measured across. Absent is read as `0` for the turn, the same way the game's
    // own client reads a slot whose time it cannot see.
    ...windowOf(crop),
    // A place inside the tile, when the crop states one; three nulls mean "let the composer place
    // me", which for a patch is the game's own scatter and for a potted plant the middle of the pot.
    at: placeOf(crop.at, where),
  };
}

/** The canvas block: how the picture is fitted, and the length around its content. */
function canvasOf(raw) {
  if (raw === undefined || raw === null) return { fit: "content", padding: 0 };
  if (!isRecord(raw)) throw invalid("canvas: must be an object");
  const fit = nameOf(raw.fit) ?? "content";
  if (fit !== "content") {
    throw invalid(`canvas: fit ${JSON.stringify(fit)} is not supported; only "content" is`);
  }
  const padding = integerOf(raw.padding) ?? 0;
  if (padding < 0 || padding > MAX_PADDING) {
    throw invalid(`canvas: padding ${padding} is outside 0-${MAX_PADDING}`);
  }
  return { fit, padding };
}

/**
 * The background block: tile art the game itself draws, laid out on the tile grid.
 *
 * `ground` is a tile's own name in the game's atlas (`Dirt_A`, `Grass_C`, …). It is a name the
 * game publishes rather than a rule this API invents: the specific art for a family (which of
 * `Dirt_A`/`_B`/`_C`) is a variant the atlas states, so a caller that means "dirt" names the
 * variant it wants, exactly as the atlas spells it.
 */
function backgroundOf(raw) {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) throw invalid("background: must be an object");
  const kind = nameOf(raw.kind) ?? "tiles";
  if (kind !== "tiles") throw invalid(`background: kind ${JSON.stringify(kind)} is not supported; only "tiles" is`);
  const ground = nameOf(raw.ground);
  if (ground === null) throw invalid("background: ground must be a tile name (Dirt_A, Grass_C, …)");
  const columns = integerOf(raw.columns);
  const rows = integerOf(raw.rows);
  if (columns === null || columns < 1) throw invalid("background: columns must be a positive integer");
  if (rows === null || rows < 1) throw invalid("background: rows must be a positive integer");
  return { kind, ground, columns, rows };
}

/**
 * A spec, normalised: every default filled in, every list deduplicated and in a canonical order,
 * every name trimmed. Two specs that ask for the same scene normalise to the same value, which is
 * what makes the content key indifferent to item order and whitespace.
 *
 * Throws a `ComposeSpecError` — never returns a truncated or partially read spec.
 */
export function normalizeSpec(raw) {
  if (!isRecord(raw)) throw invalid("a scene spec must be a JSON object");

  const spec = integerOf(raw.spec);
  if (spec === null) throw invalid("spec: the spec version is required and must be an integer");
  if (!SUPPORTED_SPEC_VERSIONS.includes(spec)) {
    throw new ComposeSpecError(
      "COMPOSE_SPEC_VERSION_UNSUPPORTED",
      `spec ${spec} is not supported; this instance implements spec ${SUPPORTED_SPEC_VERSIONS.join(", ")}`,
      { limit: SPEC_VERSION, saw: spec },
    );
  }

  const canvas = canvasOf(raw.canvas);
  const background = backgroundOf(raw.background);

  if (!Array.isArray(raw.items)) throw invalid("items: must be an array");
  if (raw.items.length === 0) throw invalid("items: a scene needs at least one item");

  const seenIds = new Set();
  const items = raw.items.map((item, index) => itemOf(item, index, seenIds));
  items.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  if (items.length > COMPOSE_LIMITS.maxItems) {
    throw overLimit(`items: ${items.length} items is over the limit of ${COMPOSE_LIMITS.maxItems}`, {
      limit: "maxItems",
      saw: items.length,
    });
  }

  // A background's own tile count is bounded by the same item limit: it is the same per-tile cost,
  // and a limit a caller cannot see the effect of is not a limit.
  if (background !== null && background.columns * background.rows > COMPOSE_LIMITS.maxItems) {
    throw overLimit(
      `background: ${background.columns}x${background.rows} tiles is over the limit of ${COMPOSE_LIMITS.maxItems}`,
      { limit: "maxItems", saw: background.columns * background.rows },
    );
  }

  return {
    spec,
    canvas,
    background,
    items,
    // Kept for the layout's own reporting: the species a spec names, in a canonical order. The three
    // kinds that carry no species — an egg, a crystal and a decoration — are named by their own ids
    // instead, which the items above carry, so nothing here is padded with a species they do not have.
    species: sortedUnique(items.map((item) => item.species).filter((name) => typeof name === "string")),
  };
}

/**
 * The canvas and output bound, applied once the layout has measured the scene.
 *
 * The layout cannot know a picture is too big until it has measured it, so this is a second,
 * named refusal rather than a clamp. `padding` is already inside the measured box.
 */
export function assertWithinCanvas(box) {
  const { width, height } = box;
  if (width > COMPOSE_LIMITS.maxCanvas.width || height > COMPOSE_LIMITS.maxCanvas.height) {
    throw overLimit(
      `canvas: ${width}x${height} is over the limit of ` +
        `${COMPOSE_LIMITS.maxCanvas.width}x${COMPOSE_LIMITS.maxCanvas.height}`,
      { limit: "maxCanvas", saw: { width, height } },
    );
  }
  if (width * height > COMPOSE_LIMITS.maxPixels) {
    throw overLimit(
      `canvas: ${width}x${height} is ${width * height} pixels, over the limit of ${COMPOSE_LIMITS.maxPixels}`,
      { limit: "maxPixels", saw: width * height },
    );
  }
  return box;
}
