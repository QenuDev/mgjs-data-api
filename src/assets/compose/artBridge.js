// src/assets/compose/artBridge.js
//
// The seam between this API and `@mg.js/art`.
//
// ## What this file is, and what it is not
//
// It is an **adapter**: it hands the package the inputs the package's own functions state, and it
// asks the package for the answer. It is not a second implementation of any layout, and it writes
// no game value down. Every number in a scene layout is one of:
//
//   * a value `@mg.js/art` computed — `frameBox`, `boxOf`, `extentOf`, `cropComposition`,
//     `mutationAnchor`, `mutationPlacement`, `mutationStack`, `plantPicture`;
//   * a value the game publishes that the package takes as an argument — a species' art path and
//     harvest type, a mutation's icon and tint, a display flag, the scale cap (`/data/art`), or a
//     plant's `slotOffsets`, `baseTileScale`, `maxSizeMultiplier` and `plantTransform`
//     (`/data/plants`, which is the game's own plant table);
//   * a value the spec stated (`size`, `at.column`, `at.row`, `padding`).
//
// A species whose art the atlas does not hold is **refused** rather than skipped: a scene that
// silently omits an item is a wrong picture, and that is the failure the plan's limits exist to
// prevent.
//
// ## The two conventions this API does not touch, and one thing it adapts around
//
// `cropComposition()`'s box is **species-wide** (it unions every mutation the tables state, worn or
// not, `crop.ts:261-263`), and `mutationPlacement()`'s scale is capped at the game's own
// `tables.scale.cap` (0.75). Both are the package's, and both differ from this API's single-picture
// path on purpose (`src/assets/sprites/cropBox.js` states that one, and the plan forbids a test
// asserting the two agree). This file reads the package's answer as it stands.
//
// The one thing it adapts around is the frame ratio. `@mg.js/art` draws every part at
// `sourceSize / sourcePixelRatio` (`frameBox`), which is the size the game composes in: the live 2x
// atlas states Clover's crop as 116×169 at a ratio of 2, and the viewer draws it 58×84.5. This
// API's single-picture path (`cropArtSize`) does not divide, so it composes a 2x art into a 1x box.
// `/compose` asks the package for 1x geometry and **scales each sprite by its frame's ratio at draw
// time** (`pixelRatioOf` below), so a scene's pictures come out the same size as
// `/assets/sprites/composed` answers today while the geometry stays the package's. Fixing
// `cropArtSize` is what retires that scaling; see the report.

import {
  boxOf,
  boxOf as unionBox,
  cropComposition,
  extentOf,
  frameBox,
  mutationAnchor,
  mutationArt,
  mutationOverlayArt,
  mutationPlacement,
  mutationStack,
  plantPicture,
  resolveSprite,
  spriteName,
} from "@mg.js/art";

import { gameDataService } from "../../services/gameData.js";
import { artboardKey, getRiveFrames } from "../sprites/riveFrames.js";
import { getArtData } from "../../core/game/art/index.js";
import { initSprites, lookupSprite } from "../sprites/sprites.js";

/** A published table, as `/data/art` serves it, or the bundled fallback when there is no bundle. */
let tablesCache = null;

/** The plants table: the game's own records, which is where `slotOffsets` and `baseTileScale` live. */
let plantsCache = null;

/**
 * The items table: the game's own records, which is where a tool's `sprite` is stated.
 *
 * An item id is not always the name of its art — `HungerShard` is drawn as `HungerCrystalShard` — so the
 * table that states the hop is the one to read rather than a name built out of the id.
 */
let itemsCache = null;

/** The adapter's inputs, dropped when a test (or a resync) changes the data underneath. */
export function clearArtBridgeCache() {
  tablesCache = null;
  plantsCache = null;
  itemsCache = null;
  framesCache = null;
  portraitsCache = null;
  frames.clear();
}

let framesCache = null;

/**
 * `/data/art`'s tables, which are the extraction's own and therefore the game's.
 *
 * The route's own payload is the contract (`data.art` is a declared category), so a scene layout is
 * built from the same numbers a client reads at `/data/art` rather than from a private copy.
 */
export async function artTables() {
  if (tablesCache === null) tablesCache = await getArtData();
  return tablesCache;
}

/** `/data/plants`, which is the game's plant table with its sprite paths resolved. */
export async function plantRecords() {
  if (plantsCache === null) plantsCache = await gameDataService.getPlants();
  return plantsCache;
}

/** `/data/items`, which is the game's own item table — the one that states what each item id is drawn with. */
export async function itemRecords() {
  if (itemsCache === null) itemsCache = await gameDataService.getItems();
  return itemsCache;
}

/**
 * The sprite path a decoration's art is filed under, or `null`.
 *
 * The sprite-name table's `Decor` category is keyed by the **artboard's** name, and eight of the game's
 * decorations are Rive artboards whose name is not their data id: `StoneBirdbath` against `StoneBirdBath`,
 * and `RockBirdbath`/`RockBirdBath` the same way — a disagreement `primePortraits`' own comment already notes.
 * So the id is asked for exact first, and then under `riveFrames.js`'s `artboardKey`, which is the rule
 * `/data/pets` and `decorTransformer.js` reconcile the two spellings by ("le rapprochement se fait donc sans
 * tenir compte de la casse"). The game's decor table states the same hop as `art.artboardName`, and
 * `dataTransformer.js` reads it there for `/data/decors`; this table is the one the compose path already has.
 *
 * Two keys that normalise alike are left unresolved rather than chosen between, because a decoration drawn
 * from the wrong artboard is a picture of some other decoration.
 */
export async function decorArtPath(decorId) {
  const decor = (await artTables())?.spriteNames?.Decor ?? null;
  if (decor === null || typeof decorId !== "string" || decorId === "") return null;
  const exact = decor[decorId];
  if (typeof exact === "string" && exact !== "") return exact;
  const key = artboardKey(decorId);
  if (key === "") return null;
  const matches = Object.keys(decor).filter((name) => artboardKey(name) === key);
  return matches.length === 1 ? decor[matches[0]] : null;
}

/**
 * The art one tool is drawn with, as the game's own item table states it, or `null`.
 *
 * `items[toolId].sprite`: the game states each item's art rather than deriving it from the id, and for the
 * three pet-effect shards the two disagree — `HungerShard` is drawn from `sprite/item/HungerCrystalShard`.
 * This is the *uncharged* tool's own art; a charged shard is drawn as the crystal it holds instead
 * (`tileObjects.js`'s `chargedToolArtName`, which is the game's other hop for the same id). A tool whose
 * record states nothing, or an id the table does not hold, is `null` so the caller can fall back to looking
 * the id up in the sprite-name table by name.
 */
export async function toolArtName(toolId) {
  if (typeof toolId !== "string" || toolId === "") return null;
  const stated = (await itemRecords())?.[toolId]?.sprite;
  return typeof stated === "string" && stated !== "" ? stated : null;
}

/** An atlas frame, the size the package draws it at, and the atlas rectangle its pixels come from. */
function frameEntry(key) {
  const meta = lookupSprite(key);
  if (!meta || !meta.frame) return null;
  const raw = {
    sourceSize: meta.sourceSize ?? null,
    sourcePixelRatio: typeof meta.sourcePixelRatio === "number" ? meta.sourcePixelRatio : 1,
    anchor: meta.anchor ?? null,
  };
  const box = frameBox(raw);
  if (!(box.width > 0) || !(box.height > 0)) return null;
  return {
    key,
    box,
    // The frame's own ratio, kept beside the box: the rasteriser turns the atlas's pixels into the
    // drawn size with it, and `FrameBox` itself does not carry it.
    pixelRatio: box.pixelRatio,
    // The atlas rectangle the art's pixels are cut from, and whether that cut is rotated — the
    // package states the drawn size, not where the pixels are.
    rect: {
      x: meta.frame.x ?? 0,
      y: meta.frame.y ?? 0,
      width: meta.frame.w ?? 0,
      height: meta.frame.h ?? 0,
    },
    rotated: meta.rotated === true,
    url: meta.url ?? null,
  };
}

const frames = new Map();

/**
 * One frame, memoised by path; `null` when the atlas holds none.
 *
 * Synchronous on purpose: the frame map is a `Map` and `@mg.js/art` asks it one key at a time
 * (`resolveSprite`), so a lookup cannot be a promise. The sprite index is loaded before anything
 * reads the map — `spriteFrames()` and `plantArt()` both `await initSprites()` — which is the one
 * ordering this file depends on.
 */
export function drawnFrame(key) {
  if (frames.has(key)) return frames.get(key);
  // A key the atlas does not hold may still be one this API draws: the portraits the game bakes from
  // Rive are exported to disk and keyed `sprite/pet/<name>` (`exportPetsFromRive.js`), and
  // `atlasPixels.js`'s `spritePng` already falls back to those PNGs for their pixels. This is the
  // rectangle to draw them in, and it is null until `primePortraits()` has read the sidecars.
  const entry = frameEntry(key) ?? portraitsCache?.byKey.get(key) ?? null;
  frames.set(key, entry);
  return entry;
}

/**
 * The portraits this API exported from Rive, as frames and by name.
 *
 * `sprites.js` merges the Rive entries into the sprite **catalogue** (`/assets/sprites`) but not into
 * the index `lookupSprite` searches, so a portrait has no frame in `drawnFrame`'s own terms. The
 * sidecar the export writes carries the two numbers a frame needs — `sourceSize` and `anchor` — so
 * nothing is measured or guessed here: the box is `frameBox`'s answer over them, at the ratio 1 the
 * exported PNG is at.
 *
 * `byName` is the same table keyed the way an inventory entry names a pet, which is what makes the
 * lookup a table read rather than a key built out of a name — and `byArtboard`, keyed the way the game's
 * own data spells a species, because the two do not always agree: the artboard of `RedFox` is `Red Fox`,
 * exactly as `RockBirdbath`/`RockBirdBath` disagree in the decor tables. The key is
 * `riveFrames.js`'s `artboardKey`, the same rule `/data/pets` reconciles ids with artboards by.
 */
let portraitsCache = null;

async function primePortraits() {
  if (portraitsCache !== null) return portraitsCache;
  const sidecars = await getRiveFrames().catch(() => null);
  const byKey = new Map();
  const byName = new Map();
  const byArtboard = new Map();
  for (const [key, meta] of Object.entries(sidecars ?? {})) {
    const box = frameBox({
      sourceSize: meta?.sourceSize ?? null,
      sourcePixelRatio: 1,
      anchor: meta?.anchor ?? null,
    });
    if (!(box.width > 0) || !(box.height > 0)) continue;
    const frame = { key, box, pixelRatio: box.pixelRatio, rect: null, rotated: false, url: null };
    byKey.set(key, frame);
    if (typeof meta?.name === "string" && meta.name !== "") {
      byName.set(meta.name, frame);
      // First spelling wins, the way `petTransformer.js`'s own index takes the first it is given: two
      // artboards that differ only in punctuation are one species under this rule, and the export writes
      // one file per artboard, so there is nothing to choose between them but the order.
      const normalised = artboardKey(meta.name);
      if (!byArtboard.has(normalised)) byArtboard.set(normalised, frame);
    }
  }
  portraitsCache = { byKey, byName, byArtboard };
  return portraitsCache;
}

/**
 * The portrait one pet is drawn from, or `null` when this API has not exported it.
 *
 * An inventory entry names a pet by its species, which is usually the name the export keys the portrait
 * by (`sprite/pet/<name>`, and the sidecar's own `name`) — so this is a table read, first by the name as
 * stated and then by the game's own spelling of an artboard (`artboardKey`), which is the only thing that
 * finds `RedFox` in the file the export wrote as `Red Fox`.
 */
export async function portraitFrame(name) {
  const { byName, byArtboard } = await primePortraits();
  return byName.get(name) ?? byArtboard.get(artboardKey(name)) ?? null;
}

/**
 * A `Map` of frames that resolves a key on a miss, which is the whole adapter.
 *
 * `resolveSprite(frames, path)` accepts a `Map` and asks it by key (`instanceof Map`, then `get`),
 * so an index that fills itself on demand is enough: no copy of the atlas's thousands of frames, and
 * a frame the atlas holds is never reported missing because a copy was made before a resync.
 */
class LazyFrameMap extends Map {
  get(key) {
    const found = super.get(key);
    if (found !== undefined) return found;
    if (typeof key !== "string" || !key.startsWith("sprite/")) return undefined;
    const entry = drawnFrame(key);
    const box = entry === null ? undefined : entry.box;
    this.set(key, box);
    return box;
  }
}

function frameTable() {
  if (framesCache === null) framesCache = new LazyFrameMap();
  return framesCache;
}

/** The frame map alone, in the shape `cropComposition`/`plantPicture` accept. */
export async function spriteFrames() {
  await initSprites();
  return frameTable();
}

/** A sprite path in the game's own key form, or `null` when the table does not state it. */
function pathOf(record, part, byName) {
  return spriteName(record, part, byName);
}

/**
 * The tables `@mg.js/art`'s placement functions take, built from `/data/art`.
 *
 * The package's own data file and this extraction are the same record read from the same bundle —
 * the extraction's comment says so, and `tests/compose-layout.test.js` asserts the layout agrees
 * with the package's own tables — so this is a hand-over, not a translation: the fields below are
 * the package's field names, filled from the extraction's.
 */
export async function placementTables() {
  const tables = await artTables();
  return {
    anchors: tables.anchors ?? {},
    plants: tables.plants ?? {},
    harvestTypes: tables.harvestTypes ?? {},
    displayFlags: tables.displayFlags ?? {},
    scale: tables.scale ?? { cap: 1, referenceTilePx: 256, tallDecalMultiplier: 1 },
    overMutations: tables.overMutations ?? [],
    mutationArt: tables.mutationArt ?? {},
    // Which group a mutation washes with, which is what decides the colour the game mixes into the
    // art when a crop wears two mutations of one group (`crop.ts`'s `washGroupOf`). The extraction
    // publishes it beside the art; a composition that asked a wash question without it would throw.
    mutationRecords: tables.mutationRecords ?? {},
    spriteNames: tables.spriteNames ?? {},
  };
}

/**
 * One species' art, as `plantPicture` wants it: the published records' paths, resolved to frames.
 *
 * `null` when the species states no plant art, or when the atlas holds no frame for it — the one
 * case a caller must refuse rather than skip.
 */
export async function plantArt(species) {
  await initSprites();
  const [records, tables] = await Promise.all([plantRecords(), artTables()]);
  const record = records[species];
  if (record === undefined) return null;
  const names = tables.spriteNames ?? {};
  const resolved = (record_, part, byName) => {
    const path = pathOf(record_, part, byName);
    if (path === null) return null;
    const frame = drawnFrame(path);
    // `PlantArtwork` is `{ sprite, frame }` and its `frame` is the package's own `FrameBox` — the
    // drawn size and the anchor, which is all a recipe reads.
    return frame === null ? null : { sprite: path, frame: frame.box };
  };

  const plant = resolved(record, "plant", names?.Plant);
  const crop = resolved(record, "crop", names?.Plant) ?? plant;
  if (plant === null || crop === null) return null;

  const harvestType =
    typeof record?.plant?.harvestType === "string" ? record.plant.harvestType : "";

  // The two extra arts a handful of species state. `topmostLayerSprite` is the plant's own art split
  // in two (DawnCelestial's cage); `activeState` is the art a species wears while the weather it asks
  // for is running. Both are drawn at the body's own anchor and size, which is what `plantPicture`
  // does with them, so only their frame and name are resolved here.
  const topmost =
    resolved({ sprite: record?.plant?.topmostLayerSprite }, "sprite", names?.Plant) ??
    resolved(record, "topmostLayerSprite", names?.Plant);
  const activeEntry = record?.plant?.activeState;
  const activeArt = resolved(activeEntry, "sprite", names?.Plant);
  const weather =
    typeof activeEntry?.weatherRequirement === "string" ? activeEntry.weatherRequirement : null;
  const active = activeArt === null || weather === null ? null : { ...activeArt, weather };
  const immature = resolved(record, "immatureSprite", names?.Plant);

  return {
    plant,
    crop,
    harvestType,
    immature: immature ?? null,
    active,
    topmost: topmost ?? null,
  };
}

/** The species' own crop scale curve input, straight off its `crop` record. */
export async function cropMultiplier(species) {
  const records = await plantRecords();
  const stated = records?.[species]?.crop?.maxSizeMultiplier;
  return typeof stated === "number" && Number.isFinite(stated) && stated > 0 ? stated : 1;
}

/** Whether the atlas's own display table draws this art as a tall plant. */
export async function isTallArt(path) {
  const tables = await artTables();
  return tables?.displayFlags?.[path]?.isTallPlant === true;
}

/**
 * The recipe of one crop picture: the package's own answer, layer for layer.
 *
 * `mutations` are the ones the crop wears; the names the tables do not state are ignored by the
 * package itself, which is why an unknown mutation is not an error here (the single-picture route
 * has always answered that way, and a client that misspells one should get the plain crop rather
 * than a 400).
 */
export async function cropRecipe(species, mutations) {
  const [tables, frames] = await Promise.all([placementTables(), spriteFrames()]);
  const recipe = cropComposition(species, mutations, tables, frames);
  if (recipe === null) return null;
  return { ...recipe, layers: recipe.layers.map((layer) => ({ ...layer })) };
}

/**
 * The union of a recipe's layers, as the picture's own box, in the art's own coordinate space.
 *
 * `cropComposition` states this box over every mutation in the tables (its `reach` array); asked
 * for one crop's picture, a caller wants the union of the layers it is actually drawing, which is
 * what this computes — the same arithmetic (`boxOf`) over the same rectangles, so the convention
 * (a tight per-request union) is stated in one place and not re-derived here.
 */
export function layersBox(layers) {
  return boxOf(
    layers.map((layer) => ({ left: layer.left, top: layer.top, width: layer.width, height: layer.height })),
  );
}

/** The extent of a plant recipe's layers, which is what a canvas union reads. */
export function recipeExtent(recipe) {
  return extentOf(recipe.layers);
}

export {
  mutationAnchor,
  mutationArt,
  mutationOverlayArt,
  mutationPlacement,
  mutationStack,
  plantPicture,
  resolveSprite,
  unionBox,
};
