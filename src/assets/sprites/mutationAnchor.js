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
//     side over the 256-px reference tile for every mutation of every species — no key at
//     all. `GAME_SCALE_CAP` records it; the composer still caps at `1.5`, which is the same
//     number for any art whose smaller side is at most 384 px and larger above it (no species
//     in the 1192 atlas is that big), and the commit body reports what applying the game's
//     number would move rather than folding a second behaviour change into this one.
//   * the **tall/narrow display flags** are keyed by the **full sprite path**
//     (`mo[artPath].isTallPlant`, and `sprite/plant/<Name>` throughout), not by species and
//     not by the last segment, and `isNarrowDisplay` is read by no placement at all. The
//     composer derives its tall set from the plant records' `tileTransformOrigin` instead,
//     which is a different question answered the same way for most sprites; see the commit
//     body for the species where the two disagree.

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
 * The fallback for `tables.scale.cap`, and the number the fork's extraction publishes.
 * Recorded, not applied: see the module header. The composer's own cap is `1.5`, which is the
 * same number for any art whose smaller side is at most 384 px — all 69 species the 1192 atlas
 * holds — and larger above it, and the commit body reports what applying the game's would move.
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
        if (!tables?.anchors || typeof tables.scale?.cap !== "number") {
          return FALLBACK_MUTATION_TABLES;
        }
        return { anchors: tables.anchors, scaleCap: tables.scale.cap };
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
export const FALLBACK_MUTATION_TABLES = { anchors: MUTATION_ANCHORS, scaleCap: GAME_SCALE_CAP };

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
