// Which arts the game draws tall, and what that flag decides.
//
// Plan item 27 is a keying defect. The game keys `isTallPlant` by the **art's full sprite path**
// — `mo[o].isTallPlant` in the placement function, and `sprite/plant/<Name>` for all 109 rows —
// and the composer derived it instead from the plant records' `tileTransformOrigin`, keyed by
// the **last segment** of a species' plant art. Those are two different questions, and they
// were answered differently for 16 of the 23 arts either reading calls tall:
//
//   * 8 arts are tall by the plant records and **not** by the table (`Delphinium`, `Tree`,
//     `PalmTree`, `Hedge`, `LeafyTree`, `DatePalm`, `StemFlower`, `MarigoldPlant`) — the column
//     `tileTransformOrigin` states is where a plant's art is anchored, not how it is drawn;
//   * 8 arts are tall by the table and **not** by the heuristic (`…PlantActive` for the three
//     celestial species, and the four `…Platform` arts plus `DawnCelestialPlatformTopmostLayer`)
//     — a sprite whose leaf is not a species' plant art, which is exactly what the game's own
//     key does not care about.
//
// The flag is upstream of the box convention: it decides which icon a mutation draws (`Puddle`
// / `…Ground` instead of the mutation's own art), whether that icon is drawn at the game's `×2`
// tall boost and in the `zIndex = -1` band, and whether the tall overlay is drawn at all — and
// only that overlay is clipped (`src/assets/sprites/cropBox.js`). So a wrong flag is a wrong
// picture in three ways at once, which is why this file asserts both the table and a picture.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ATLAS, EXTRACTED, GAME_ATLAS_FRAMES, heuristicIsTall, heuristicTallNames, mutationAnchor,
  pictureOf,
} from "./helpers/composed-atlas.js";

const { DISPLAY_FLAGS, FALLBACK_DISPLAY_FLAGS, isTallPlantFor, loadDisplayFlags } = mutationAnchor;

/**
 * The paths the atlas has and the game's table states, which is what a lookup is asked about.
 *
 * `tests/art-tables.test.js` asserts the table's keys are all atlas frames; this file asserts the
 * same from the composer's side, because a path the atlas does not have is a path no composition
 * ever asks about.
 */
const PLANT_ATLAS_PATHS = Object.keys(ATLAS.frames).filter((key) => key.startsWith("sprite/plant/"));
// Read lazily: this file is the assertion that the table exists at all, so it must be able to
// report "there is no table" as a failed test rather than as a file that will not load.
const flagPaths = () => Object.keys(DISPLAY_FLAGS ?? {});

/** The two directions the two readings disagree in, as sets of paths. */
function disagreements() {
  const names = heuristicTallNames();
  const heuristicOnly = [];
  const tableOnly = [];
  for (const path of flagPaths()) {
    const table = isTallPlantFor(path, DISPLAY_FLAGS);
    const heuristic = heuristicIsTall(path, names);
    if (heuristic && !table) heuristicOnly.push(path);
    if (table && !heuristic) tableOnly.push(path);
  }
  return { heuristicOnly: heuristicOnly.sort(), tableOnly: tableOnly.sort() };
}

describe("the tall-plant flag is the game's own table, keyed by the art's full path", () => {
  it("holds exactly what the fork's extractor reads out of the game's own chunk", async () => {
    assert.deepEqual(DISPLAY_FLAGS, EXTRACTED.displayFlags);
    assert.equal(flagPaths().length, 109, "the game states 109 rows");
    assert.deepEqual(
      flagPaths().filter((path) => !path.startsWith("sprite/plant/")),
      [],
      "a row is keyed by something other than a plant sprite path",
    );
    for (const path of flagPaths()) {
      assert.equal(typeof DISPLAY_FLAGS[path].isTallPlant, "boolean", `${path}: isTallPlant`);
      assert.equal(typeof DISPLAY_FLAGS[path].isNarrowDisplay, "boolean", `${path}: isNarrowDisplay`);
    }
    assert.equal(flagPaths().filter((path) => DISPLAY_FLAGS[path].isTallPlant).length, 15);
  });

  it("prefers the extraction, and answers the fallback when the bundle is out of reach", async () => {
    // The composer asks whichever table is reachable and always gets a usable one: offline (this
    // process) the extraction is out of reach and the fallback stands, and the two are equal, so
    // the offline path cannot draw an art tall that the live one draws flat.
    assert.deepEqual(await loadDisplayFlags(), FALLBACK_DISPLAY_FLAGS, "the offline answer is the fallback exactly");
    assert.deepEqual(await loadDisplayFlags(), EXTRACTED.displayFlags);
  });

  it("keys by the path, so the arts the two readings disagreed about follow the table", async () => {
    const { heuristicOnly, tableOnly } = disagreements();

    // Measured, not written down: the same census the commit body reports, asserted as sets so a
    // game version that moves one of these rows fails here instead of drawing the wrong picture.
    assert.deepEqual(heuristicOnly, [
      "sprite/plant/DatePalm",
      "sprite/plant/Delphinium",
      "sprite/plant/Hedge",
      "sprite/plant/LeafyTree",
      "sprite/plant/MarigoldPlant",
      "sprite/plant/PalmTree",
      "sprite/plant/StemFlower",
      "sprite/plant/Tree",
    ]);
    assert.deepEqual(tableOnly, [
      "sprite/plant/DawnCelestialPlantActive",
      "sprite/plant/DawnCelestialPlatform",
      "sprite/plant/DawnCelestialPlatformTopmostLayer",
      "sprite/plant/MoonCelestialPlantActive",
      "sprite/plant/MoonCelestialPlatform",
      "sprite/plant/StarweaverPlatform",
      "sprite/plant/ThunderCelestialPlantActive",
      "sprite/plant/ThunderCelestialPlatform",
    ]);

    // Every path either reading calls tall is a frame the game's own 1192 atlas has, so each of
    // the 16 is an art a caller can ask for by key and get a picture of. (The composition
    // fixture is a cut of that atlas and holds none of the eight `tableOnly` rows.)
    for (const path of [...heuristicOnly, ...tableOnly]) {
      assert.ok(GAME_ATLAS_FRAMES[path], `${path} is not a frame the game's atlas has`);
    }
  });

  it("keeps PricklyPear's two arts apart, which is what the brief got wrong", () => {
    // The species is `Multiple`, so the art the bake composes is its **crop** art, and the game
    // says that one is *not* tall while the plant art is: the flag follows the art, never the
    // species. `PricklyPearPlatform` is a name neither the table nor the atlas of 1192 has — the
    // platform arts that exist are the celestial ones and Starweaver's (asserted above).
    assert.equal(isTallPlantFor("sprite/plant/PricklyPear"), false);
    assert.equal(isTallPlantFor("sprite/plant/PricklyPearPlant"), true);
    assert.equal(DISPLAY_FLAGS["sprite/plant/PricklyPear"].isTallPlant, false);
    assert.equal(DISPLAY_FLAGS["sprite/plant/PricklyPearPlant"].isTallPlant, true);
    assert.equal(flagPaths().includes("sprite/plant/PricklyPearPlatform"), false);
    assert.equal(PLANT_ATLAS_PATHS.includes("sprite/plant/PricklyPearPlatform"), false);
  });

  it("draws the picture the table states for an art the heuristic called tall", async () => {
    // `Delphinium` is the one art of the 69 the bake enumerates whose flag moves: the plant
    // records anchor it `bottom`, the game's table states `isTallPlant: false`.
    //
    // Tall (before this change) the composer drew `Frozen`'s `×2` boosted icon, its
    // `FrozenTallPlant` overlay and the `zIndex = -1` band, which pushed the picture to
    // **247x465 with the art at (14,0)**. Flat (the table's answer) it draws the mutation's own
    // icon in front of the art: **218x413 with the art at (0,0)**, which is the art's own width
    // and the art plus the 15 px the icon reaches below it.
    const art = { width: 218, height: 398 };
    const flat = await pictureOf("sprite/plant/Delphinium", ["Frozen"]);
    assert.equal(`${flat.width}x${flat.height}`, "218x413");
    assert.deepEqual(flat.box, { x: 0, y: 0, ...art });

    // Thunderstruck is the sharper case: tall it swaps in the ground decal
    // (`sprite/mutation/ThunderstruckGround`) and the overlay, and the picture was 293x461 with
    // the art at (37,0); flat it is the mutation's own icon, 218x478 with the art at (0,0).
    const flatStorm = await pictureOf("sprite/plant/Delphinium", ["Thunderstruck"]);
    assert.equal(`${flatStorm.width}x${flatStorm.height}`, "218x478");
    assert.deepEqual(flatStorm.box, { x: 0, y: 0, ...art });

    // The bare art is the same picture either way, which is what says the two above moved
    // because of the flag and not because a placement changed with it.
    const bare = await pictureOf("sprite/plant/Delphinium", []);
    assert.equal(`${bare.width}x${bare.height}`, "218x398");
  });

  it("still draws an art the table flags tall as tall", async () => {
    // Bamboo is tall by both readings, so it is the control: this asserts the flat answer above
    // is the flag moving and not the tall path being lost. Its `Frozen` overlay is 1024x1024 and
    // is clipped to the art, so the overlay's own frame cannot be what sizes the picture.
    assert.equal(isTallPlantFor("sprite/plant/Bamboo"), true);
    const composed = await pictureOf("sprite/plant/Bamboo", ["Frozen"]);
    // Measured: the tall overlay and the `×2` boosted icon reach outside a 281x1280 art, which
    // is what a flat reading of the same art does not do (asserted for Delphinium above).
    assert.deepEqual(composed.box, { x: 13, y: 0, width: 281, height: 1280 });
    assert.equal(`${composed.width}x${composed.height}`, "318x1368");
  });
});

describe("the flag is upstream of the box, so it moves whole pictures", () => {
  /**
   * The reachable set space the bake enumerates: one art per species — the patch art when the
   * plant is single-harvest, the crop art otherwise — against every set of one mutation per
   * group. `tests/crop-bake.test.js` owns the enumeration itself; this is the same space.
   */
  async function reachableArts() {
    const { enumerateCropTypes } = await import("../src/assets/sprites/cropBake.js");
    return enumerateCropTypes();
  }

  it("moves Delphinium's pictures and no other art's, over the reachable space", async () => {
    const names = heuristicTallNames();
    const types = await reachableArts();
    assert.equal(types.length, 69, "the reachable set space changed size");

    const moved = [];
    for (const { species, artKey } of types) {
      const before = heuristicIsTall(artKey, names);
      const now = isTallPlantFor(artKey, DISPLAY_FLAGS);
      if (before !== now) moved.push(`${species} (${artKey}): ${before} -> ${now}`);
    }

    // One art, and it is the one whose picture is asserted above. The census is what says the
    // other 68 arts' pictures are byte-for-byte what they were, so item 27's blast radius over
    // the reachable (art, set) space is this species' sets and nothing else.
    assert.deepEqual(moved, ["Delphinium (sprite/plant/Delphinium): true -> false"]);
  });
});
