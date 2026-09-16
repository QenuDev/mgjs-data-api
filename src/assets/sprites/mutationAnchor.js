// src/assets/sprites/mutationAnchor.js
//
// Where a mutation's art is centred on a crop's art, and how much that species scales it.
//
// ## Why this is keyed by species, and by part
//
// The game states these overrides in `Uo` of `LayoutMotionController-CwhDlPns.js`, keyed by
// **plant species** — `Clover: {y: .3}`, `Carrot: {y: {plant: .6, crop: .42}}`,
// `Snowdrop: {x: .3, y: .23, scale: .5}` — and its placement function reads them with the
// species it is drawing and the **part** the art is (`Ho(c, n)`, where `n` is `'plant'` for a
// single-harvest species' patch art and `'crop'` otherwise). This module is that table and
// those two readings, and nothing else.
//
// The composer used to key the same numbers by the *atlas key's last segment*: `Clover`
// resolves for `sprite/plant/CloverThreeLeaf` only by luck, and `BabyCarrot` — the patch art
// of the species `Carrot` — never resolved at all, so a Carrot's mutations landed at the
// game's 0.4 vertical default instead of the 0.6 the table states for the plant part. That is
// plan item 25; the measured before/after is in the commit body.
//
// ## Provenance
//
// Every number read here is the game's own declaration, byte for byte, and it is read from the
// fork's own extraction when that is available:
//
//   * `MUTATION_ANCHORS` / `GAME_SCALE_CAP` below are the **fallback**, used when the bundle is
//     unreachable (the whole test suite, an offline boot). They are the same record
//     `src/core/game/art/extract.js` reads out of the drawing controller and publishes at
//     `/data/art` — `tables.anchors` and `tables.scale.cap` — which is the record
//     `@mg.js/art` publishes in `data/<version>.json` and the one the `garden-viewer` reads.
//   * `loadMutationTables()` prefers that extraction, so a new game version moves these
//     numbers by re-extracting rather than by editing this file. `tests/mutation-anchor.test.js`
//     asserts the fallback and the extraction are *equal*, so the offline path cannot drift
//     from the published one in silence.
//   * `x` falls back to the art's own anchor, `scale` to 1, and `y` to the game's
//     `PLACEMENT_ANCHOR_Y = 0.4` unless the art is a single-harvest patch taller than 1.5×
//     its width, in which case it falls back to the art's own anchor. The game's `Go` states
//     all three: `l=o`, `f=r===H.Single&&d?s:.4`, `g=Ho(c?.scale,n)??1`.
//
// ## What is deliberately not here
//
// The two other lookups the game's placement function makes at the same site are keyed
// differently, and neither is a species:
//
//   * the **size cap** is one number the game declares once (`Wo = .75`, read from the 1176
//     bundle and stated as `tables.scale.cap` in `@mg.js/art`), applied to the art's smaller
//     side — **divided by the frame's `sourcePixelRatio`** — over the 256-px reference tile for
//     every mutation of every species: no key at all. `tileScaleFor()` is that reading, and its
//     doc states why the divisor is not optional and what writing the cap without it moved.
//   * the **tall/narrow display flags** are keyed by the **full sprite path**
//     (`mo[artPath].isTallPlant`, and `sprite/plant/<Name>` throughout), not by species and
//     not by the last segment — that table is `DISPLAY_FLAGS` below, read by
//     `isTallPlantFor()`, and the composer reads it rather than deriving a tall set from the
//     plant records' `tileTransformOrigin`, which is a different question that happened to
//     agree for most arts (see `tests/tall-plant-flag.test.js` for the census and the two
//     directions it disagreed in). `isNarrowDisplay` is published and read by no placement.

/** The game's own default vertical anchor, `PLACEMENT_ANCHOR_Y` in `@mg.js/art`: `f = .4`. */
export const PLACEMENT_ANCHOR_Y = 0.4;

/**
 * How much taller than wide an art has to be for the game to call it a tall patch.
 *
 * The game's own placement function states it once, `a > i * 1.5`, and it picks which
 * vertical fallback a single-harvest species gets.
 */
export const TALL_ART_ASPECT = 1.5;

/** The tile the game sizes a mutation against, the game's own `h / 256`. */
export const REFERENCE_TILE_PX = 256;

/**
 * The game's cap on that ratio, `const Wo = .75` in the drawing controller.
 *
 * The fallback for `tables.scale.cap`, and the number the fork's extraction publishes. It is
 * **applied**, by `tileScaleFor()`: see that function for the space it is applied in, which is
 * the part of plan item 26 the item-25 lane had not measured.
 */
export const GAME_SCALE_CAP = 0.75;

/** The game's per-species mutation anchors, `Uo` (1176) / `Tn` (1192), as the fallback copy. */
export const MUTATION_ANCHORS = {
  Banana:         { x: 0.6, y: 0.68 },
  Beet:           { y: 0.65 },
  BurrosTail:     { y: 0.2 },
  Cardoon:        { y: 0.8 },
  Carrot:         { x: { crop: 0.5 }, y: { plant: 0.6, crop: 0.42 } },
  Clover:         { y: 0.3 },
  Daisy:          { y: 0.21 },
  Dawnbreaker:    { y: { plant: 0.25, crop: 0.13 } },
  Eggplant:       { x: 0.57 },
  FavaBean:       { y: 0.25 },
  FourLeafClover: { y: 0.3 },
  Leek:           { y: { plant: 0.55 }, scale: { plant: 0.7 } },
  Milkcap:        { y: 0.3 },
  Pepper:         { x: 0.6 },
  PurpleDaisy:    { y: 0.21 },
  Rose:           { y: 0.16 },
  Saffron:        { x: 0.52, y: 0.22 },
  Snowdrop:       { x: 0.3, y: 0.23, scale: 0.5 },
  SnowdropDouble: { x: 0.27, y: 0.21, scale: 0.5 },
  Starweaver:     { y: 0.5 },
  Sunflower:      { y: 0.5 },
  Ube:            { y: 0.5 },
};

/**
 * The game's `isTallPlant` / `isNarrowDisplay` table, keyed the way the game keys it: by the
 * **art's full sprite path** (`mo[spritePath]`, and `sprite/plant/<Name>` for all 109 rows).
 *
 * The fallback copy of what `getArtData()` reads out of the drawing controller and `/data/art`
 * publishes as `tables.displayFlags`; `loadDisplayFlags()` prefers the extraction and
 * `tests/tall-plant-flag.test.js` asserts the two are equal, entry for entry, so this copy can
 * only ever be a stale one and never a different answer.
 *
 * This is the flag the game's own placement function reads (`l = mo[o].isTallPlant`, then the
 * tall decal, the `zIndex = -1` band and the `qo = 2` scale), so it decides which icon a
 * mutation draws *and* whether the tall overlay is drawn and clipped. It is **not** the plant
 * records' `tileTransformOrigin`, which is a different question: comparing the two over the
 * arts either reading calls tall, 8 are tall by that heuristic and not by this table, and 8
 * are tall here and not there.
 */
export const DISPLAY_FLAGS = {
  "sprite/plant/Aloe": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Apple": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/BabyBeet": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/BabyCarrot": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/BabyDawnbreaker": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/BabyUbe": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Bamboo": { isTallPlant: true, isNarrowDisplay: false },
  "sprite/plant/Banana": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Beet": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Blueberry": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/BurrosTail": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/BushyTree": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Cabbage": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/CabbagePlant": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Cacao": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Cactus": { isTallPlant: true, isNarrowDisplay: false },
  "sprite/plant/Camellia": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Cardoon": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/Carrot": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Cattail": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/Chrysanthemum": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/CloverFourLeaf": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/CloverThreeLeaf": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Coconut": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Corn": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Daffodil": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Daisy": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/DaisyPurple": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/Date": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/DatePalm": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/DawnCelestialCrop": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/DawnCelestialPlant": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/DawnCelestialPlantActive": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/DawnCelestialPlatform": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/DawnCelestialPlatformTopmostLayer": { isTallPlant: true, isNarrowDisplay: false },
  "sprite/plant/Dawnbreaker": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Delphinium": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/DirtPatch": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/DragonFruit": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/DragonFruitTree": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Echeveria": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Eggplant": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Emberbloom": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/EmberbloomCrop": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Embercrown": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/EmbercrownCrop": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/FavaBean": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/FlowerBush": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Gentian": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/Grape": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/HabaneroPepper": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Hedge": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Lavender": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/LeafyTree": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/BabyLeek": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/Leek": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/Lemon": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Lily": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Lychee": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/MarigoldCrop": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/MarigoldPlant": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/MoonCelestialCrop": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/MoonCelestialPlant": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/MoonCelestialPlantActive": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/MoonCelestialPlatform": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/Milkcap": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Mushroom": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/PalmTree": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/PalmTreeTop": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/PassionFruit": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Peach": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Pear": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Pepper": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Persimmon": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/PineTree": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Poinsettia": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/PricklyPear": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/PricklyPearPlant": { isTallPlant: true, isNarrowDisplay: false },
  "sprite/plant/Pumpkin": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/RoseRed": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/Saffron": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/Shrub": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/ShrubBush": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Snowdrop": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/SnowdropDouble": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/SproutFlower": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/SproutFruit": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/SproutVegetable": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/SproutVine": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Squash": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Starweaver": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/StarweaverPlant": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/StarweaverPlatform": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/StemFlower": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Strawberry": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Sunflower": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/ThunderCelestialFruit": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/ThunderCelestialPlant": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/ThunderCelestialPlantActive": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/ThunderCelestialPlatform": { isTallPlant: true, isNarrowDisplay: true },
  "sprite/plant/ThunderCelestialShroom": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Tomato": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Tree": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/Trellis": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Tulip": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Ube": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/VariegatedCattail": { isTallPlant: false, isNarrowDisplay: true },
  "sprite/plant/VioletCort": { isTallPlant: false, isNarrowDisplay: false },
  "sprite/plant/Watermelon": { isTallPlant: false, isNarrowDisplay: false },
};

/**
 * Which species an atlas key belongs to, and which of its two arts the key is.
 *
 * `plant` is the patch art a single-harvest species' mutations are drawn on, `crop` the
 * harvested art everything else wears them on. The game reads the same two fields to pick the
 * art (`o = n==='plant' && a.plant.harvestType===H.Single ? a.plant.sprite : a.crop.sprite`),
 * so the key itself does not have to be decoded, spelled or guessed at.
 */
export function artIndex(plants) {
  const byArt = new Map();
  for (const [species, record] of Object.entries(plants ?? {})) {
    const plant = record?.plant?.sprite;
    const crop = record?.crop?.sprite;
    // The crop first, so a species whose two parts are the same art (Clover, Snowdrop) resolves
    // as its plant. Nothing in the game's table reads differently for those species today, and
    // the plant is the art a garden draws them as — which is the reading the game's own
    // `partOf` states for a species whose plant and crop agree.
    if (typeof crop === "string" && crop) byArt.set(crop, { species, part: "crop" });
    if (typeof plant === "string" && plant) byArt.set(plant, { species, part: "plant" });
  }
  return byArt;
}

/**
 * The anchor table and the scale cap, from the extraction when it can be reached.
 *
 * `getArtData()` reads them out of the drawing controller of the bundle the rest of the API is
 * already serving, which is the same pass `/data/art` publishes, so a game version that moves
 * an anchor moves it here too. The read is memoized for the life of the process: the extraction
 * is a function of the bundle, which does not change under it.
 *
 * A rejection — no bundle, no network, the offline suite — answers `FALLBACK_MUTATION_TABLES`
 * rather than throwing. That is not a silent failure: the two are asserted *equal* in
 * `tests/mutation-anchor.test.js`, so the fallback can only ever be a stale copy of what the
 * extraction says, never a different answer.
 */
let tablesPromise = null;

export function loadMutationTables() {
  if (tablesPromise === null) {
    tablesPromise = import("../../core/game/art/index.js")
      .then((art) => art.getArtData())
      .then((tables) => {
        if (
          !tables?.anchors ||
          typeof tables.scale?.cap !== "number" ||
          typeof tables.scale?.referenceTilePx !== "number"
        ) {
          return FALLBACK_MUTATION_TABLES;
        }
        return {
          anchors: tables.anchors,
          scaleCap: tables.scale.cap,
          referenceTilePx: tables.scale.referenceTilePx,
        };
      })
      .catch(() => FALLBACK_MUTATION_TABLES);
  }
  return tablesPromise;
}

/**
 * Put a fresh extraction in place of the memoized one, and answer the previous memo.
 *
 * Exported for a test that has to drive the *extraction* path rather than the fallback one,
 * which is the only way to assert that a placement follows a table this file does not hold.
 * Nothing in `src/` calls it.
 */
export function setMutationTablesForTest(tables) {
  const previous = tablesPromise;
  tablesPromise = Promise.resolve(tables);
  return previous;
}

/** The tables a placement reads, in the shape `loadMutationTables()` answers. */
export const FALLBACK_MUTATION_TABLES = {
  anchors: MUTATION_ANCHORS,
  scaleCap: GAME_SCALE_CAP,
  referenceTilePx: REFERENCE_TILE_PX,
};

/**
 * The game's own size factor for a mutation on an art: `Go`'s `Math.min(Wo, h / 256)`.
 *
 * The game states it over the art's **drawn** size and divides the frame's own pixels first:
 *
 *     function Go(e,t,n){ … let h=Math.min(i,a)/e.sourcePixelRatio,
 *       … return { offset:m, scaleFactor: Math.min(Wo, h/256) * g } }
 *
 * (`tests/fixtures/art/bundle-1192/`, and `docs/mgjs-art-sources.md` §7.3 with the 1176 cut).
 * This composer works in the atlas's own pixels — every layer is drawn at its frame's
 * `sourceSize` — so the divisor is the frame's own `sourcePixelRatio`, the game's own default
 * when a frame states none being 1 (`i.prototype.sourcePixelRatio=1`, `worldAssets-*.js:2-3`).
 *
 * **This is where plan item 26 was wrong, and why.** The composer used to write the factor as
 * `0.5 * Math.min(1.5, h/256)`, which is the game's number only while the frame is 2x:
 * `0.5 * min(1.5, x) = min(0.75, x/2)`. So the `1/2` and the `1.5` were a 2x frame's ratio and
 * cap baked into two constants, and the 33 of the 109 plant frames the 1192 atlas exports
 * without a `sourcePixelRatio` — a 1x frame, from `sprite/plant/StemFlower` to every
 * `…Platform` — were drawn with their mutations at half the size the game draws them. The 69
 * arts the bake enumerates are all 2x, so applying the game's `.75` *without* the divisor moves
 * 37 of them and makes every one of those diverge from the game; with it, none of the 69 moves
 * and the 33 are corrected.
 *
 * `cap` and the tile come from the extraction (`tables.scale.cap`, `tables.scale.referenceTilePx`);
 * the caller multiplies by the species' own `scale` (`Go`'s `g`) and by the tall decal's `qo = 2`.
 */
export function tileScaleFor(artWidth, artHeight, sourcePixelRatio, tables = FALLBACK_MUTATION_TABLES) {
  const pixelRatio = typeof sourcePixelRatio === "number" && sourcePixelRatio > 0 ? sourcePixelRatio : 1;
  const cap = tables?.scaleCap ?? GAME_SCALE_CAP;
  const tile = tables?.referenceTilePx ?? REFERENCE_TILE_PX;
  return Math.min(cap, Math.min(artWidth, artHeight) / pixelRatio / tile);
}

/**
 * The display flags, from the same extraction `loadMutationTables()` prefers.
 *
 * One read per process and the same fallback rule: a bundle that cannot be reached answers
 * `DISPLAY_FLAGS`, which `tests/tall-plant-flag.test.js` asserts equal to the extraction's own
 * `displayFlags`, so the offline suite answers what the live one would.
 */
let flagsPromise = null;

export function loadDisplayFlags() {
  if (flagsPromise === null) {
    flagsPromise = import("../../core/game/art/index.js")
      .then((art) => art.getArtData())
      .then((tables) => (tables?.displayFlags ? tables.displayFlags : DISPLAY_FLAGS))
      .catch(() => DISPLAY_FLAGS);
  }
  return flagsPromise;
}

/** Put a fresh flag table in place of the memoized one, and answer the previous memo. */
export function setDisplayFlagsForTest(flags) {
  const previous = flagsPromise;
  flagsPromise = Promise.resolve(flags);
  return previous;
}

/** The display flags a lookup reads when the caller holds no extraction. */
export const FALLBACK_DISPLAY_FLAGS = DISPLAY_FLAGS;

/**
 * Whether the game draws an art tall: `mo[artPath].isTallPlant`, and nothing else.
 *
 * The key is the art's **full sprite path**, which is what the game indexes its table by, so a
 * path the table does not state answers `false` — every path the atlas has is in the table (109
 * rows, all `sprite/plant/...`), and the game itself indexes it with a path rather than a
 * species or a last segment. Both flags are published; only this one is read by a placement.
 */
export function isTallPlantFor(artKey, flags = FALLBACK_DISPLAY_FLAGS) {
  return flags?.[artKey]?.isTallPlant === true;
}

/** One field of a stated anchor, for one part: a number is the number, an object is indexed. */
function pick(stated, field, part) {
  const value = stated?.[field];
  if (typeof value === "number") return value;
  const perPart = value?.[part];
  return typeof perPart === "number" ? perPart : undefined;
}

/**
 * The point of a species' art a mutation centres on, and the multiplier that species states.
 *
 * `part` is `plant` or `crop` and only matters to the three species that state a value per
 * part (`Carrot`, `Dawnbreaker`, `Leek`). The fallbacks are the game's own, and a species
 * with no row in the table gets all of them — including the `0.4` vertical default, which is
 * a value the game states rather than one chosen here. `scale` is the species' own multiplier
 * and not the 256-px ratio it multiplies; that ratio and its cap are the caller's.
 *
 * `tables` is what `loadMutationTables()` answers, or `FALLBACK_MUTATION_TABLES` when it could
 * not be reached; the table is an argument rather than a module global for the same reason
 * `@mg.js/art` passes its own — so that a caller holding a newer extraction can place with it.
 */
export function mutationAnchorFor(
  species,
  part,
  artWidth,
  artHeight,
  anchorX,
  anchorY,
  harvestType,
  tables = FALLBACK_MUTATION_TABLES,
  singleType = "Single",
) {
  const stated = tables.anchors?.[species];

  const x = pick(stated, "x", part) ?? anchorX;

  const tall = artHeight > artWidth * TALL_ART_ASPECT;
  const fallbackY = harvestType === singleType && tall ? anchorY : PLACEMENT_ANCHOR_Y;
  const y = pick(stated, "y", part) ?? fallbackY;

  const scale = pick(stated, "scale", part) ?? 1;

  return { x, y, scale };
}
