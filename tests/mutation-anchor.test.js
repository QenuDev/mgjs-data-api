// The per-species mutation anchors, keyed the way the game keys them.
//
// Plan item 25 is a keying defect: the composer read the game's per-species anchor table with
// the *atlas key's last segment* as the key (`CloverThreeLeaf`) where the table is keyed by
// species (`Clover`), so the override never applied and the vertical placement fell back to
// the game's 0.4 default. `src/assets/sprites/mutationAnchor.js` holds the table and the two
// readings (by species, by part); this file is what says they are the game's.
//
// Three kinds of claim, and they are different ones:
//
//   * **the module's fallback table is the game's extraction.** The composer reads the anchors
//     out of `src/core/game/art`'s extraction when it can reach the bundle and falls back to
//     `MUTATION_ANCHORS` when it cannot (the offline suite), so the two are compared here,
//     entry for entry, against the extraction of the *committed* game chunk under
//     `tests/fixtures/art/bundle-1176/`. A digit that drifts in either one fails this test.
//   * **the resolution is by species and by part.** `tests/fixtures/bake/plants.json` is the
//     game's own plant records, captured from 1192: every art the bake enumerates resolves to
//     its species, the arts whose last segment spells a different name resolve to the right
//     one, and `Carrot`'s per-part row is read with the part the art is.
//   * **the fallbacks are the game's own.** `x` falls back to the art's anchor, `scale` to 1,
//     and `y` to 0.4 — except for a single-harvest patch taller than 1.5× its width, which
//     hangs from its own anchor. A species the table does not state is the subject of the
//     last case, because that is the rule item 25 must keep rather than invent.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { describe, it } from "node:test";

import { extractArtTables } from "../src/core/game/art/index.js";
import { artChunks, newestArtFixtureVersion } from "./helpers/art-fixtures.js";
import {
  FALLBACK_MUTATION_TABLES,
  GAME_SCALE_CAP,
  MUTATION_ANCHORS,
  PLACEMENT_ANCHOR_Y,
  REFERENCE_TILE_PX,
  TALL_ART_ASPECT,
  artIndex,
  loadMutationTables,
  mutationAnchorFor,
  setMutationTablesForTest,
} from "../src/assets/sprites/mutationAnchor.js";

const PLANTS = JSON.parse(
  await fs.readFile(new URL("./fixtures/bake/plants.json", import.meta.url), "utf8"),
);

/**
 * The game's anchors as the fork's own extractor reads them out of the committed chunk.
 *
 * `tests/fixtures/art/bundle-<version>/` is a verbatim cut of the drawing controller, so this
 * is the game's own declaration rather than a copy of it — the newest cut is the game the API
 * serves. The same pass is what `/data/art` publishes and what `loadMutationTables()` prefers.
 */
const ART_VERSION = newestArtFixtureVersion();
const EXTRACTED = extractArtTables({ chunks: artChunks(ART_VERSION), gameVersion: ART_VERSION }).tables;

/**
 * The atlas key the bake composes for a species: its patch art when Single, its crop otherwise.
 */
const artOf = (record) =>
  record.plant?.harvestType === "Single" ? record.plant?.sprite : record.crop?.sprite;

describe("the mutation anchor table is the game's own", () => {
  it("holds exactly what the fork's extractor reads out of the game's own chunk", () => {
    assert.deepEqual(MUTATION_ANCHORS, EXTRACTED.anchors);
    assert.equal(Object.keys(MUTATION_ANCHORS).length, 22, "the game states 22 species");
    // The extraction is not empty and is not the fallback by construction: 22 species, and the
    // two per-part rows the reader has to index are both there.
    assert.equal(Object.keys(EXTRACTED.anchors).length, 22);
    assert.deepEqual(EXTRACTED.anchors.Carrot, { x: { crop: 0.5 }, y: { plant: 0.6, crop: 0.42 } });
    assert.deepEqual(EXTRACTED.anchors.Leek, { y: { plant: 0.55 }, scale: { plant: 0.7 } });
  });

  it("prefers the extraction, and answers the fallback when the bundle is out of reach", async () => {
    // The composer asks for whichever table is reachable and always gets a usable one: offline
    // (this process) the memo rejects and the fallback stands, and the two are equal, so the
    // offline path cannot place a mutation anywhere the extracted one would not.
    const offline = await loadMutationTables();
    assert.deepEqual(offline, FALLBACK_MUTATION_TABLES, "the offline answer is the fallback exactly");

    // The injection point the composer uses is exercised with the real extraction, and a
    // placement follows it: a species the fallback states no row for and the injected table
    // does must move.
    const previous = setMutationTablesForTest({
      anchors: { ...EXTRACTED.anchors, PricklyPear: { y: 0.66 } },
      scaleCap: EXTRACTED.scale.cap,
    });
    try {
      assert.deepEqual(await loadMutationTables(), {
        anchors: { ...EXTRACTED.anchors, PricklyPear: { y: 0.66 } },
        scaleCap: 0.75,
      });
      assert.equal(
        mutationAnchorFor("PricklyPear", "crop", 103, 109, 0.5, 0.5, "Single", await loadMutationTables()).y,
        0.66,
        "a placement follows the table it is handed",
      );
    } finally {
      setMutationTablesForTest(FALLBACK_MUTATION_TABLES);
      assert.equal(previous instanceof Promise || previous === null, true);
    }
  });

  it("holds the game's own constants rather than copies of them", () => {
    // The numbers the game's placement function states once. `GAME_SCALE_CAP` is the game's
    // `.75` and `REFERENCE_TILE_PX` its `256`: the composer *applies* both, through
    // `tileScaleFor()` (`tests/scale-cap.test.js`), against the art's smaller side divided by
    // its frame's `sourcePixelRatio` — which is the reading this assertion is the constants of.
    assert.equal(PLACEMENT_ANCHOR_Y, 0.4);
    assert.equal(TALL_ART_ASPECT, 1.5);
    assert.equal(REFERENCE_TILE_PX, 256);
    assert.equal(GAME_SCALE_CAP, 0.75);
  });
});

describe("an art key resolves to its species, not to its own spelling", () => {
  const index = artIndex(PLANTS);

  it("resolves every art the bake enumerates", () => {
    const unresolved = [];
    for (const [species, record] of Object.entries(PLANTS)) {
      const art = artOf(record);
      const found = index.get(art);
      if (found?.species !== species) unresolved.push(`${species} (${art}) -> ${JSON.stringify(found)}`);
    }
    assert.deepEqual(unresolved, [], `${unresolved.length} arts do not resolve to their own species`);
  });

  it("resolves the arts whose last segment spells a different name", () => {
    // The whole defect in one table: each of these keys the game's table by a species name that
    // is not the art's own last segment. Six of them (`Beet`, `PurpleDaisy`, `Rose`,
    // `FourLeafClover`, `Leek`, `Ube`) read no row at all before this fix and fell back to the
    // game's 0.4 default; the rest read a row that was not theirs.
    const differing = {
      "sprite/plant/BabyCarrot": { species: "Carrot", part: "plant" },
      "sprite/plant/BabyBeet": { species: "Beet", part: "plant" },
      "sprite/plant/DaisyPurple": { species: "PurpleDaisy", part: "plant" },
      "sprite/plant/CloverThreeLeaf": { species: "Clover", part: "plant" },
      "sprite/plant/CloverFourLeaf": { species: "FourLeafClover", part: "plant" },
      "sprite/plant/RoseRed": { species: "Rose", part: "plant" },
      "sprite/plant/BabyLeek": { species: "Leek", part: "plant" },
      "sprite/plant/BabyUbe": { species: "Ube", part: "plant" },
      "sprite/plant/BabyDawnbreaker": { species: "Dawnbreaker", part: "plant" },
    };
    const got = {};
    for (const key of Object.keys(differing)) got[key] = index.get(key);
    assert.deepEqual(got, differing);
    for (const [key, want] of Object.entries(differing)) {
      assert.notEqual(key.split("/").pop(), want.species, `${key} no longer differs from its species name`);
    }
    // All but one of these is a species whose two parts are the same art and which is therefore
    // read as its plant; `Carrot` is the one whose parts differ, and its crop art resolves as
    // its crop. The arts that resolve as `crop` are the multi-harvest species' crop arts.
    assert.equal(index.get("sprite/plant/HabaneroPepper").part, "crop");
    assert.equal(index.get("sprite/plant/DawnCelestialCrop").part, "crop");
  });

  it("says which of a species' two arts a key is, the way the game picks the art", () => {
    // Clover's plant and crop are the same art, so it resolves as its plant (the art a garden
    // draws it as, and the part the game hands its placement); Carrot's two arts differ and its
    // crop art resolves as `crop`.
    assert.deepEqual(index.get("sprite/plant/CloverThreeLeaf"), { species: "Clover", part: "plant" });
    assert.deepEqual(index.get("sprite/plant/Carrot"), { species: "Carrot", part: "crop" });
    // A key no plant record states is not in the index at all: the composer keeps its
    // last-segment reading for those (`sprite/tallplant/...` aliases, pets).
    assert.equal(index.get("sprite/tallplant/Cactus"), undefined);
    assert.equal(index.get("sprite/pet/Dog"), undefined);
  });
});

describe("the anchor a species states, read with the part the art is", () => {
  const speciesOf = (art) => artIndex(PLANTS).get(art) ?? { species: art.split("/").pop(), part: "crop" };

  it("reads Carrot's per-part row with the part, so the patch art gets 0.6 and the crop 0.42", () => {
    const plant = speciesOf("sprite/plant/BabyCarrot");
    const crop = speciesOf("sprite/plant/Carrot");
    assert.deepEqual(plant, { species: "Carrot", part: "plant" });
    assert.deepEqual(crop, { species: "Carrot", part: "crop" });

    // 191x238 is the patch art's own size; its anchor is (0.424084, 0.756303).
    const patch = mutationAnchorFor(plant.species, plant.part, 191, 238, 0.424084, 0.756303, "Single");
    assert.deepEqual(patch, { x: 0.424084, y: 0.6, scale: 1 }, "the plant part's own stated y");
    const harvested = mutationAnchorFor(crop.species, crop.part, 191, 238, 0.424084, 0.756303, "Single");
    assert.deepEqual(harvested, { x: 0.5, y: 0.42, scale: 1 }, "the crop part's own stated x and y");
    // `x` is stated for the crop part only, and the plant part falls back to the art's anchor.
    assert.equal(mutationAnchorFor("Carrot", "plant", 191, 238, 0.424084, 0.756303, "Single").x, 0.424084);
    assert.equal(mutationAnchorFor("Carrot", "crop", 191, 238, 0.424084, 0.756303, "Single").x, 0.5);  });

  it("reads a flat row for either part", () => {
    for (const part of ["plant", "crop"]) {
      assert.deepEqual(
        mutationAnchorFor("Clover", part, 116, 169, 0.491379, 0.934911, "Single"),
        { x: 0.491379, y: 0.3, scale: 1 },
        `Clover's stated y applies to the ${part} part`,
      );
    }
  });

  it("applies a species' own scale, and only that species'", () => {
    assert.equal(mutationAnchorFor("Snowdrop", "crop", 161, 258, 0.5, 0.5, "Single").scale, 0.5);
    assert.equal(mutationAnchorFor("SnowdropDouble", "crop", 224, 285, 0.5, 0.5, "Single").scale, 0.5);
    assert.equal(mutationAnchorFor("Leek", "plant", 474, 422, 0.5, 0.5, "Single").scale, 0.7);
    // Leek's row states the scale for the plant part only; the crop part gets the game's 1.
    assert.equal(mutationAnchorFor("Leek", "crop", 300, 300, 0.5, 0.5, "Single").scale, 1);
    assert.equal(mutationAnchorFor("Clover", "crop", 116, 169, 0.5, 0.5, "Single").scale, 1);
  });

  it("keeps the game's 0.4 default for a species the table does not state", () => {
    // PricklyPear has no row (it is not one of the 22). Its patch art is 103x109 — not taller
    // than 1.5× its width — so the fallback is the game's own 0.4, and `x` is the art's anchor.
    assert.deepEqual(
      mutationAnchorFor("PricklyPear", "crop", 103, 109, 0.5, 0.5, "Single"),
      { x: 0.5, y: 0.4, scale: 1 },
    );
  });

  it("hangs a tall single-harvest patch from its own anchor instead", () => {
    // The game's `f = r===H.Single && d ? s : .4`. `sprite/plant/Cattail` is 198x648 and
    // `Cattail` states no row, so the fallback is the only thing that can place it.
    const tall = mutationAnchorFor("Cattail", "crop", 198, 648, 0.5, 0.87, "Single");
    assert.equal(tall.y, 0.87, "a single-harvest patch taller than 1.5x its width uses its own anchor");
    // The same art on a multiple-harvest species is the game's 0.4, and so is the same art a
    // single-harvest one when it is not tall.
    assert.equal(mutationAnchorFor("Cattail", "crop", 198, 648, 0.5, 0.87, "Multiple").y, 0.4);
    assert.equal(mutationAnchorFor("Cattail", "crop", 648, 198, 0.5, 0.87, "Single").y, 0.4);
    assert.equal(TALL_ART_ASPECT, 1.5);
  });
});
