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

/** The spec shape this instance implements, declared in the contract and echoed in every answer. */
export const SPEC_VERSION = 1;

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

/** The kinds a spec may state. `decor`, `egg` and `crystal` are the tile vocabulary's rest and are not drawn yet. */
export const SUPPORTED_ITEM_KINDS = Object.freeze(["plant", "crop"]);

/**
 * A spec this instance refuses, with the reason named.
 *
 * `code` is what a client branches on (`COMPOSE_SPEC_INVALID`, `COMPOSE_LIMIT_EXCEEDED`,
 * `COMPOSE_SPEC_VERSION_UNSUPPORTED`); `limit` and `saw` name the bound and what the spec
 * stated, so a caller can fix it without re-reading this file.
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

/** `at` — the tile a thing occupies, or `null` for content flow. */
function positionOf(value, where) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw invalid(`${where}: at must be an object with column and row`);
  const column = integerOf(value.column);
  const row = integerOf(value.row);
  if (column === null || row === null) throw invalid(`${where}: at.column and at.row must be integers`);
  if (column < 0 || row < 0) throw invalid(`${where}: at.column and at.row must not be negative`);
  return { column, row };
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
  const species = nameOf(raw.species);
  if (species === null) throw invalid(`${where}: species must be a non-empty string`);

  const at = positionOf(raw.at, where);
  const size = sizeOf(raw.size, where);

  if (kind === "crop") {
    return {
      id,
      kind,
      species,
      at,
      size,
      mutations: mutationsOf(raw.mutations, where),
      // A crop that is still growing states its window, and the API applies the growth the way the
      // game animates it. `ready: true` asks for the ripe picture whatever the window says.
      startTime: integerOf(raw.startTime),
      endTime: integerOf(raw.endTime),
      ready: booleanOf(raw.ready, null),
    };
  }

  // A plant: its own mutations are the ones its body wears; each crop in its slots carries its own.
  if (raw.crops !== undefined && !Array.isArray(raw.crops)) {
    throw invalid(`${where}: crops must be an array`);
  }
  const crops = (raw.crops ?? []).map((crop, slotIndex) => {
    if (!isRecord(crop)) throw invalid(`${where}.crops[${slotIndex}]: a crop must be an object`);
    const slot = integerOf(crop.slot);
    if (crop.slot !== undefined && (slot === null || slot < 0)) {
      throw invalid(`${where}.crops[${slotIndex}]: slot must be a non-negative integer`);
    }
    return {
      slot: slot ?? slotIndex,
      size: sizeOf(crop.size, `${where}.crops[${slotIndex}]`),
      mutations: mutationsOf(crop.mutations, `${where}.crops[${slotIndex}]`),
    };
  });

  return {
    id,
    kind,
    species,
    at,
    potted: booleanOf(raw.potted, false),
    matured: booleanOf(raw.matured, false),
    mutations: mutationsOf(raw.mutations, where),
    crops,
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
  if (spec !== SPEC_VERSION) {
    throw new ComposeSpecError(
      "COMPOSE_SPEC_VERSION_UNSUPPORTED",
      `spec ${spec} is not supported; this instance implements spec ${SPEC_VERSION}`,
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
    // Kept for the layout's own reporting: the species a spec names, in a canonical order.
    species: sortedUnique([...items.map((item) => item.species)]),
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
