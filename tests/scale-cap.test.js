// The game's own scale cap, in the space the game states it.
//
// Plan item 26 is the cap. The game declares `Wo = .75` once and sizes a mutation's art by
//
//     function Go(e,t,n){ … let h=Math.min(i,a)/e.sourcePixelRatio,
//       … return { offset:m, scaleFactor: Math.min(Wo, h/256) * g } }
//
// (`tests/fixtures/art/bundle-1192/resources-D_3Zwcn-.js`'s cut of the drawing controller;
// `docs/mgjs-art-sources.md` §7.3 quotes the 1176 one). The composer wrote that factor as
// `0.5 * Math.min(1.5, h/256)` — and the item-25 lane measured the two as "not equivalent,
// agreeing below 384 px and diverging above it, which is 37 of the 69 species". Both halves of
// that are worth stating precisely, because the conclusion the plan drew from it is wrong:
//
//   * `0.5 * min(1.5, x)` equals `min(0.75, x/2)`, so the `0.5` was a **2x frame's
//     `1/sourcePixelRatio`** written down and the `1.5` was `.75` doubled. The two expressions
//     are the same number for *every* 2x frame, and all 69 arts the bake enumerates are 2x
//     frames — which is why `Sunflower + Ambercharged` was already 256x322 with the art at
//     (0,66), the number the plan called a cross-check that "cannot hold".
//   * the threshold the lane measured is 192 **source** px (`0.75 * 256`), not 384, and it is
//     where the two *products* part company — not where the game's cap binds.
//
// So applying `.75` without the divisor would move 37 of the 69 arts — 88 of Delphinium's 90
// sets and every one of the 37 species' tall pictures — and make each of them diverge from the
// game's own placement. This file applies the cap *with* the divisor, read from the extraction
// (`tables.scale.cap` and `tables.scale.referenceTilePx`) and from the frame
// (`sourcePixelRatio`, which `sprites.js` used to drop). The before/after over the reachable
// space is in the commit body: **0 of the 6,210 pictures change**, and the 33 plant frames the
// game exports at 1x — outside the bake's 69 arts but reachable through the endpoint's `key=` —
// stop being drawn at half the size the game draws them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ATLAS, EXTRACTED, GAME_ATLAS_FRAMES, mutationAnchor, pictureOf,
} from "./helpers/composed-atlas.js";

const {
  FALLBACK_MUTATION_TABLES, GAME_SCALE_CAP, REFERENCE_TILE_PX, loadMutationTables, tileScaleFor,
} = mutationAnchor;

/** The expression this change removed, for the arts it was right about (a 2x frame). */
const removedFactor = (artWidth, artHeight) =>
  0.5 * Math.min(1.5, Math.min(artWidth, artHeight) / 256);

describe("the scale cap is the game's, and so is the size it is taken against", () => {
  it("reads the cap and the tile from the extraction rather than holding them", async () => {
    assert.equal(EXTRACTED.scale.cap, 0.75);
    assert.equal(EXTRACTED.scale.referenceTilePx, 256);
    assert.equal(GAME_SCALE_CAP, EXTRACTED.scale.cap);
    assert.equal(REFERENCE_TILE_PX, EXTRACTED.scale.referenceTilePx);

    const tables = await loadMutationTables();
    assert.equal(tables.scaleCap, EXTRACTED.scale.cap);
    assert.equal(tables.referenceTilePx, EXTRACTED.scale.referenceTilePx);
    assert.deepEqual(tables, FALLBACK_MUTATION_TABLES);
  });

  it("is the extraction's number at run time, not a constant beside it", () => {
    // A cap the extraction of a later version could state: the factor follows the table it is
    // handed, so a moved `Wo` moves the picture instead of needing this file edited.
    const withTighterCap = { ...FALLBACK_MUTATION_TABLES, scaleCap: 0.5 };
    assert.equal(tileScaleFor(512, 512, 2, FALLBACK_MUTATION_TABLES), 0.75);
    assert.equal(tileScaleFor(512, 512, 2, withTighterCap), 0.5);
  });

  it("divides the art's own pixels by its frame's pixel ratio, as `Go` does", () => {
    // The game's own numbers, computed from its own formula. A 2x frame's smaller side is half
    // the drawn one; a 1x frame's is the drawn one.
    assert.equal(tileScaleFor(256, 256, 2, FALLBACK_MUTATION_TABLES), 0.5); // Sunflower's crop art
    assert.equal(tileScaleFor(270, 437, 1, FALLBACK_MUTATION_TABLES), GAME_SCALE_CAP); // PricklyPearPlant
    // A frame that states no ratio is the game's own default of 1, not a guess.
    assert.equal(tileScaleFor(270, 437, undefined, FALLBACK_MUTATION_TABLES), GAME_SCALE_CAP);
    assert.equal(tileScaleFor(0, 0, 0, FALLBACK_MUTATION_TABLES), 0);
  });

  it("is exactly the expression it replaces for every 2x frame in the atlas", () => {
    // This is what makes the change a no-op where it should be one: every art the bake
    // enumerates is a 2x frame, and for those `min(.75, (smaller/2)/256)` and
    // `0.5 * min(1.5, smaller/256)` are the same real number, not merely close.
    const doubled = Object.entries(GAME_ATLAS_FRAMES).filter(
      ([, frame]) => frame.sourcePixelRatio === 2,
    );
    assert.ok(doubled.length > 0, "the atlas states no 2x frame");
    const drifted = [];
    for (const [path, frame] of doubled) {
      const width = frame.sourceSize.w;
      const height = frame.sourceSize.h;
      if (tileScaleFor(width, height, 2, FALLBACK_MUTATION_TABLES) !== removedFactor(width, height)) {
        drifted.push(path);
      }
    }
    assert.deepEqual(drifted, [], "a 2x frame's factor is not the one this change replaced");

    // And where the two expressions do part company: a 1x frame whose smaller side is above
    // the 192 px the lane's threshold is really at (`0.75 * 256`). The game's cap binds there
    // and the old `1.5` did not, which is the "37 of the 69" the plan measured — and the old
    // product is **half** the game's, so those 37 would have got worse, not better.
    assert.equal(tileScaleFor(270, 437, 1, FALLBACK_MUTATION_TABLES), 0.75);
    assert.equal(removedFactor(270, 437), 0.52734375);
  });

  it("draws the art of the 1x frame at the size the game draws it", async () => {
    // `PricklyPearPlant` is a frame the game exports without a `sourcePixelRatio` — a 1x frame —
    // and it is the art the game's tall table flags for PricklyPear. Its smaller side is 270 px,
    // above the 192 the two caps part company at, so this is the case the item exists for.
    //
    // Measured before this change: 0.5 * min(1.5, 270/256) = 0.52734375, so `Ambercharged`
    // (389x488) was drawn at 205x256 and the picture was **410x672 with the art at (75,235)**.
    // Now: min(.75, 270/256) = the game's cap binds, the icon is 292x366, and the picture is
    // **584x844 with the art at (162,407)** — the game's own answer for a 1x frame.
    const flat = await pictureOf("sprite/plant/PricklyPearPlant", ["Ambercharged"]);
    assert.equal(`${flat.width}x${flat.height}`, "584x844");
    assert.deepEqual(flat.box, { x: 162, y: 407, width: 270, height: 437 });

    // The same frame wearing nothing is the art either way, so the move above is the icon's
    // size and not a placement that changed with it.
    const bare = await pictureOf("sprite/plant/PricklyPearPlant", []);
    assert.equal(`${bare.width}x${bare.height}`, "270x437");
    assert.deepEqual(bare.box, { x: 0, y: 0, width: 270, height: 437 });

    // A second 1x frame, where the ratio is itself rather than the cap: `StemFlower` is 167x183
    // in the game's own atlas and states no `sourcePixelRatio`, so its factor is 167/256 =
    // 0.65234375 against the 0.326171875 the old expression gives it.
    const stem = GAME_ATLAS_FRAMES["sprite/plant/StemFlower"];
    assert.equal(stem.sourcePixelRatio, undefined);
    assert.deepEqual(stem.sourceSize, { w: 167, h: 183 });
    assert.equal(tileScaleFor(stem.sourceSize.w, stem.sourceSize.h, 1, FALLBACK_MUTATION_TABLES), 167 / 256);
    assert.equal(removedFactor(167, 183), 167 / 512);
  });

  it("leaves every 2x art's picture exactly where it was", async () => {
    // The plan's own cross-check, and the reason the plan's conclusion was wrong: with the
    // divisor applied, the cap is `.75` and Sunflower's crop art is a 2x frame, so the picture
    // is the 256x322 the shipped composer already answered — not the 256x274 that applying
    // `.75` to source pixels would have produced.
    const sunflower = await pictureOf("sprite/plant/Sunflower", ["Ambercharged"]);
    assert.equal(`${sunflower.width}x${sunflower.height}`, "256x322");
    assert.deepEqual(sunflower.box, { x: 0, y: 66, width: 256, height: 256 });

    // Delphinium is the art item 27 drew flat; its numbers are item 27's and are unchanged by
    // this commit, which is the second half of "no 2x picture moved".
    const delphinium = await pictureOf("sprite/plant/Delphinium", ["Frozen"]);
    assert.equal(`${delphinium.width}x${delphinium.height}`, "218x413");
    assert.deepEqual(delphinium.box, { x: 0, y: 0, width: 218, height: 398 });

    // Every art the composition fixture holds at 2x has its factor unchanged, and the fixture
    // is where a picture's own frame ratio comes from: a frame it holds without one is a 1x
    // frame by the game's own default.
    const held = Object.entries(ATLAS.frames);
    assert.ok(held.length > 69, "the fixture holds no mutation frames");
    assert.equal(held.length, 87, "the composition fixture's frame count changed");
    assert.equal(
      held.filter(([, frame]) => frame.sourcePixelRatio === 2).length,
      86,
      "the fixture's 2x frames changed — was it regenerated with a drifted atlas?",
    );
    assert.deepEqual(
      held.filter(([, frame]) => frame.sourcePixelRatio !== 2).map(([key]) => key),
      ["sprite/plant/PricklyPearPlant"],
      "a frame in the composition fixture states no pixel ratio",
    );
  });
});
