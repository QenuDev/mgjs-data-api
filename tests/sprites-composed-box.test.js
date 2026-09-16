// A composed crop is the tight union of the crop's art and its layers, and it says where the
// art is inside that picture.
//
// The endpoint used to size its canvas to the crop's own art and cut every layer that reached
// past it, then state the degenerate box `0,0,width,height`. The game does not do that: each
// mutation sprite is added to the crop's container unmasked and unfitted, so its art lands
// where the placement math puts it (`src/assets/sprites/cropBox.js` records the bundle
// evidence and the measurements). This file asserts the corrected contract:
//
//   * the picture is the **tight union** of the crop's own art and the rectangles of the
//     layers actually drawn into it — `cropComposition()` is the one statement of that;
//   * `X-MG-Sprite-Box` is the **art's own rectangle inside that picture**: the art's own
//     width and height, at a corner that is `0,0` exactly when nothing reaches past the art;
//   * a picture that grew really holds the art that made it grow: the rows above the art's
//     frame are drawn, not empty (they were impossible to hold before — that is the whole
//     point of the change).
//
// It runs offline. `tests/fixtures/sprites/` holds one packed PNG and its atlas JSON with
// the real frame geometry — every composable crop art plus every mutation icon, overlay
// and tall decal a mutation set can reach — captured from game version 1192 by
// `tests/fixtures/sprites/capture.mjs`. The pixels in it are flat blocks, because the
// property under test is geometric: the picture's size comes from a frame's dimensions and
// trim, never from the colour of its pixels. Real pixels would make the fixture 5.0 MB;
// flat ones make it 113 KB.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { describe, it } from "node:test";
import express from "express";
import sharp from "sharp";

// ─── Offline atlas ────────────────────────────────────────────────────────────
//
// The composer reaches the game through `fetch` (version, manifest, atlas JSON, atlas
// image). Serving the fixture through that one seam keeps the code under test untouched.
const GAME_ORIGIN = "https://magicgarden.gg";
const FIXTURE_VERSION = "fixture-1192";
const FIXTURES = new URL("./fixtures/sprites/", import.meta.url);
const FIXTURE_FILES = new Set(["manifest.json", "sprites-composed.json", "sprites-composed.png"]);

// The real fetch, kept for the endpoint test below: the stub must not swallow this file's
// own requests to the server it starts.
const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (new URL(href).origin !== GAME_ORIGIN) return realFetch(url, init);
  if (href === `${GAME_ORIGIN}/platform/v1/version`) {
    return Response.json({ version: FIXTURE_VERSION });
  }
  const name = href.split("/").pop();
  if (FIXTURE_FILES.has(name)) {
    const body = await fs.readFile(new URL(name, FIXTURES));
    return new Response(body, {
      status: 200,
      headers: { "content-type": name.endsWith(".json") ? "application/json" : "image/png" },
    });
  }
  // Everything else on the game origin — the bundle the plant metadata is extracted from
  // — is absent, which is the same state the composer already tolerates (`getPlantMeta`
  // returns empty maps and `harvestType` falls back to "Single"). The picture's size does
  // not depend on that metadata; only which icon is drawn and where do. So offline the
  // three tall species use their flat decal rather than the x2 tall one, and the mutation
  // ends up in a place the live atlas would not put it. The assertions below are about
  // size and the box, and they still fail for 64 of the 69 species against the pre-fix
  // code, so the fixture discriminates.
  return new Response("offline", { status: 404 });
};

// Imported dynamically, not statically: `composeSpriteWithBox` is what this commit adds,
// and a static import makes the pre-fix tree fail with a link error instead of the
// dimension mismatch this file exists to report.
const { gameDataService } = await import("../src/services/gameData.js");
const { composeSprite, composeSpriteWithBox } = await import("../src/assets/sprites/spriteComposer.js");
const { composedRouter } = await import("../src/api/routes/composed.js");

// ─── The plant records ────────────────────────────────────────────────────────
//
// The composer asks `gameDataService.getPlants()` which species an art belongs to — the game
// keys its mutation anchors by species and reads them with the part the art is (plan item 25)
// — and the bundle it would read them from is absent offline. `tests/fixtures/bake/plants.json`
// is the same capture this suite's atlas came from (game 1192, `tests/fixtures/README.md`), so
// serving it through that one seam is what makes the offline run exercise the real species
// resolution instead of an empty map.
const PLANTS = JSON.parse(
  await fs.readFile(new URL("./fixtures/bake/plants.json", import.meta.url), "utf8"),
);
gameDataService.getPlants = async () => PLANTS;

// ─── The table ────────────────────────────────────────────────────────────────
//
// species -> [atlas key, the crop's own art width, the crop's own art height]
//
// The key is the art the composer composes for that species: the patch art when the plant
// is single-harvest (the game draws mutations on the patch), its crop art otherwise. The
// dimensions are `sourceSize` of that frame — what the game itself draws — captured from
// game version 1192. Regenerate with tests/fixtures/sprites/capture.mjs, which prints this
// table.
const CROP_ART = {
  Carrot: ["sprite/plant/BabyCarrot", 191, 238],
  Cabbage: ["sprite/plant/Cabbage", 252, 222],
  Strawberry: ["sprite/plant/Strawberry", 132, 146],
  Aloe: ["sprite/plant/Aloe", 380, 344],
  Beet: ["sprite/plant/BabyBeet", 188, 258],
  Daisy: ["sprite/plant/Daisy", 143, 243],
  PurpleDaisy: ["sprite/plant/DaisyPurple", 150, 263],
  Clover: ["sprite/plant/CloverThreeLeaf", 116, 169],
  FourLeafClover: ["sprite/plant/CloverFourLeaf", 129, 214],
  Rose: ["sprite/plant/RoseRed", 178, 388],
  FavaBean: ["sprite/plant/FavaBean", 65, 141],
  Delphinium: ["sprite/plant/Delphinium", 218, 398],
  Snowdrop: ["sprite/plant/Snowdrop", 161, 258],
  SnowdropDouble: ["sprite/plant/SnowdropDouble", 224, 285],
  Blueberry: ["sprite/plant/Blueberry", 94, 102],
  Apple: ["sprite/plant/Apple", 242, 252],
  OrangeTulip: ["sprite/plant/Tulip", 256, 256],
  Tomato: ["sprite/plant/Tomato", 184, 164],
  Daffodil: ["sprite/plant/Daffodil", 256, 256],
  Corn: ["sprite/plant/Corn", 255, 237],
  Watermelon: ["sprite/plant/Watermelon", 426, 384],
  Echeveria: ["sprite/plant/Echeveria", 308, 316],
  Pumpkin: ["sprite/plant/Pumpkin", 410, 383],
  Cattail: ["sprite/plant/Cattail", 198, 648],
  VariegatedCattail: ["sprite/plant/VariegatedCattail", 190, 676],
  Pear: ["sprite/plant/Pear", 258, 270],
  Gentian: ["sprite/plant/Gentian", 284, 444],
  Lavender: ["sprite/plant/Lavender", 176, 344],
  Coconut: ["sprite/plant/Coconut", 168, 180],
  PineTree: ["sprite/plant/PineTree", 488, 979],
  Banana: ["sprite/plant/Banana", 248, 246],
  Leek: ["sprite/plant/BabyLeek", 474, 422],
  Lily: ["sprite/plant/Lily", 249, 353],
  Saffron: ["sprite/plant/Saffron", 200, 392],
  Cardoon: ["sprite/plant/Cardoon", 354, 432],
  Camellia: ["sprite/plant/Camellia", 165, 147],
  Squash: ["sprite/plant/Squash", 124, 196],
  Peach: ["sprite/plant/Peach", 226, 238],
  BurrosTail: ["sprite/plant/BurrosTail", 126, 200],
  Persimmon: ["sprite/plant/Persimmon", 184, 164],
  Mushroom: ["sprite/plant/Mushroom", 312, 284],
  Cactus: ["sprite/plant/Cactus", 446, 1280],
  Bamboo: ["sprite/plant/Bamboo", 281, 1280],
  Eggplant: ["sprite/plant/Eggplant", 114, 210],
  PricklyPear: ["sprite/plant/PricklyPear", 103, 109],
  VioletCort: ["sprite/plant/VioletCort", 276, 280],
  Chrysanthemum: ["sprite/plant/Chrysanthemum", 132, 105],
  Date: ["sprite/plant/Date", 88, 142],
  Grape: ["sprite/plant/Grape", 172, 244],
  Poinsettia: ["sprite/plant/Poinsettia", 217, 214],
  Habanero: ["sprite/plant/HabaneroPepper", 110, 158],
  Pepper: ["sprite/plant/Pepper", 102, 190],
  Ube: ["sprite/plant/BabyUbe", 196, 560],
  Milkcap: ["sprite/plant/Milkcap", 284, 308],
  Lemon: ["sprite/plant/Lemon", 152, 202],
  PassionFruit: ["sprite/plant/PassionFruit", 146, 192],
  DragonFruit: ["sprite/plant/DragonFruit", 198, 248],
  Cacao: ["sprite/plant/Cacao", 126, 207],
  Lychee: ["sprite/plant/Lychee", 94, 114],
  Sunflower: ["sprite/plant/Sunflower", 256, 256],
  Marigold: ["sprite/plant/MarigoldCrop", 181, 169],
  Dawnbreaker: ["sprite/plant/BabyDawnbreaker", 230, 337],
  Emberbloom: ["sprite/plant/Emberbloom", 228, 580],
  Embercrown: ["sprite/plant/Embercrown", 278, 582],
  Starweaver: ["sprite/plant/Starweaver", 309, 309],
  ThunderCelestial: ["sprite/plant/ThunderCelestialFruit", 140, 269],
  ThunderCelestialShroomPlant: ["sprite/plant/ThunderCelestialShroom", 208, 225],
  DawnCelestial: ["sprite/plant/DawnCelestialCrop", 205, 205],
  MoonCelestial: ["sprite/plant/MoonCelestialCrop", 208, 206],
};

// The game groups mutations in three categories and a plant wears at most one of each, so
// this is the heaviest legal set there is: a colour, a hydro icon and a lunar icon.
const HEAVIEST_SET = ["Rainbow", "Thunderstruck", "Ambershine"];

// Every single mutation, including the two that carry no icon and so only ever tint.
const SINGLE_MUTATIONS = [
  "Gold", "Rainbow", "Wet", "Chilled", "Frozen", "Thunderstruck", "Thundercharged",
  "Ambershine", "Dawnlit", "Dawncharged", "Ambercharged",
];

const GROWTH = [null, "Gold", "Rainbow"];
const HYDRO = [null, "Chilled", "Frozen", "Thundercharged", "Thunderstruck", "Wet"];
const LUNAR = [null, "Ambercharged", "Ambershine", "Dawncharged", "Dawnlit"];
const REACHABLE_SETS = [];
for (const g of GROWTH) for (const h of HYDRO) for (const l of LUNAR) {
  REACHABLE_SETS.push([g, h, l].filter(Boolean));
}

const dims = async (buffer) => {
  const meta = await sharp(buffer).metadata();
  return `${meta.width}x${meta.height}`;
};

/**
 * Compose one species and report the first thing that is wrong, or null.
 *
 * What is asserted is the convention and its self-consistency, never a size pinned against
 * the art: the picture may be bigger than the art (that is the fix), but the box must always
 * be the art's own rectangle, it must lie inside the picture, and a box that moves the art off
 * the origin must sit in a picture that is actually bigger.
 */
async function check(species, [artKey, width, height], mutations) {
  const composed = await composeSpriteWithBox(artKey, mutations);
  if (!composed) return `${species} (${artKey}) [${mutations.join("+") || "bare"}] composed nothing`;

  const box = composed.box;
  const label = `${species} (${artKey}) [${mutations.join("+") || "bare"}]`;
  if (!box) return `${label} stated no box`;
  if (box.width !== width || box.height !== height) {
    return `${label} stated box ${JSON.stringify(box)}, whose width/height must be the art's ${width}x${height}`;
  }
  if (box.x < 0 || box.y < 0) return `${label} stated box ${JSON.stringify(box)} outside the picture`;

  const got = await dims(composed.buffer);
  const [pictureW, pictureH] = got.split("x").map(Number);
  if (box.x + width > pictureW || box.y + height > pictureH) {
    return `${label} stated box ${JSON.stringify(box)} for a ${got} picture: the art does not fit`;
  }
  if ((box.x > 0 && pictureW === width) || (box.y > 0 && pictureH === height)) {
    return `${label} states the art at ${box.x},${box.y} in a ${got} picture, which is only the art`;
  }
  return null;
}

describe("a composed crop is the union of its art and its layers", () => {
  it("holds for every composable species, against the committed table", async () => {
    const wrong = [];
    for (const [species, row] of Object.entries(CROP_ART)) {
      const failure = await check(species, row, HEAVIEST_SET);
      if (failure) wrong.push(failure);
    }
    assert.deepEqual(wrong, [], `${wrong.length} of ${Object.keys(CROP_ART).length} species wrong:\n${wrong.join("\n")}`);
  });

  it("holds under every single mutation", async () => {
    const wrong = [];
    for (const [species, row] of Object.entries(CROP_ART)) {
      for (const mutation of SINGLE_MUTATIONS) {
        const failure = await check(species, row, [mutation]);
        if (failure) wrong.push(failure);
      }
    }
    assert.deepEqual(wrong, [], `${wrong.length} of ${Object.keys(CROP_ART).length * SINGLE_MUTATIONS.length} (species, mutation) pairs wrong:\n${wrong.join("\n")}`);
  });

  it("holds across the whole reachable set space", {
    skip: process.env.MG_COMPOSED_FULL
      ? false
      : "slow: 6,210 compositions, ~6 min — set MG_COMPOSED_FULL=1 to run the exhaustive sweep",
  }, async () => {
    const wrong = [];
    for (const [species, row] of Object.entries(CROP_ART)) {
      for (const mutations of REACHABLE_SETS) {
        const failure = await check(species, row, mutations);
        if (failure) wrong.push(failure);
      }
    }
    assert.deepEqual(wrong, [], `${wrong.length} of ${Object.keys(CROP_ART).length * REACHABLE_SETS.length} (species, set) pairs wrong:\n${wrong.join("\n")}`);
  });

  it("states a box that is not degenerate for the pictures that grew", async () => {
    // The clamped convention returned `0,0,width,height` for **every** response — even for the
    // pictures whose union is bigger than the art — so the header carried no information at
    // all. The counts below are measured, not guessed: over the live atlas and plant records
    // of game 1192 the union is bigger than the art for 4,818 of the 6,210 (crop art,
    // reachable set) pictures and 3,780 of them push the art's corner off the origin; the
    // clamped composer answered 0 and 0 on both counts. On this smaller sweep (69 arts × 6
    // sets = 414 pictures, against the committed atlas and the captured plant records) the two
    // counters are 188 and 150, and they moved twice. Plan item 25 keyed the mutation anchors by
    // species rather than by the art key's last segment, which puts more mutations inside their
    // art and fewer outside it: 202 pictures grew before that fix and 189 after it. Plan item 27
    // keys `isTall` by the game's own display table instead of the plant records'
    // `tileTransformOrigin`, which draws Delphinium flat — its six sets lose the `×2` tall decal
    // and the `zIndex = -1` band, so 189 → 188 grew and 155 → 150 put the art's corner off the
    // origin. Both counts are the *same* measured pin as before, re-measured; the arithmetic of
    // the move is Delphinium's six sets and nothing else (asserted in
    // `tests/tall-plant-flag.test.js`).
    const sets = [[], ["Wet"], ["Frozen"], ["Ambercharged"], ["Dawnlit"], HEAVIEST_SET];
    let offOrigin = 0;
    let grew = 0;
    for (const [species, row] of Object.entries(CROP_ART)) {
      for (const mutations of sets) {
        const composed = await composeSpriteWithBox(row[0], mutations);
        assert.ok(composed, `${species} [${mutations.join("+") || "bare"}] composed nothing`);
        const [, width, height] = row;
        const picture = await dims(composed.buffer);
        if (picture !== `${width}x${height}`) grew++;
        if (composed.box.x > 0 || composed.box.y > 0) offOrigin++;
      }
    }
    assert.equal(grew, 188, "the number of pictures bigger than their art changed — is the canvas clamped again, or did the anchors move?");
    assert.equal(offOrigin, 150, "the number of pictures stating an art rectangle off the origin changed");
  });

  it("pins the union box and the art's rectangle for CloverThreeLeaf", async () => {
    const [artKey, width, height] = CROP_ART.Clover; // 116x169
    assert.equal(`${width}x${height}`, "116x169");

    // `Frozen,Thunderstruck` is **not a set a garden can hold**: both are `group: "Hydro"`,
    // and a plant wears at most one mutation per group, so the bake never produces it. It is
    // still the pair the correction was measured against, so it is pinned, labelled.
    //
    // The arithmetic, in picture pixels (the art's own frame is 116x169, anchor
    // (0.491379, 0.934911)):
    //   * species key: the composer resolves the art through the plant records, so
    //     `sprite/plant/CloverThreeLeaf` is the species `Clover` and the game's
    //     `anchors.Clover.y = 0.30` applies (plan item 25; `src/assets/sprites/mutationAnchor.js`).
    //     targetX = 0.491379, targetY = 0.30;
    //   * scale = 0.5 * min(1.5, 116/256) = 0.2265625;
    //   * Thunderstruck (363x565) -> 82x128 at x = round(116*0.491379 - 82/2) = 16,
    //     y = round(169*0.934911 + (0.3 - 0.934911)*169 - 128*0.512472) = -15;
    //   * Frozen (290x232) -> 66x53 at (24, 26).
    // Thunderstruck reaches 15 px above the art and Frozen does not reach past its top, so the
    // tight union is 116x184 with the art's rectangle at y = 15 — the number the pre-fix
    // composer could not state, because its fallback put Thunderstruck at y = +2 instead.
    // The viewer answers 116x206 for the same crop because its box is species-wide by design
    // (`@mg.js/art` unions every mutation its tables state, worn or not); its union over the
    // *worn* pair is the same 116x184. Different conventions, neither a bug.
    const union = await composeSpriteWithBox(artKey, ["Frozen", "Thunderstruck"]);
    assert.equal(await dims(union.buffer), "116x184");
    assert.deepEqual(union.box, { x: 0, y: 15, width: 116, height: 169 });

    // Reachable pairs, and the reachable pair of the same art that unions to the same box.
    // `Rainbow,Thunderstruck,Ambershine` is one mutation per group; Thunderstruck is the one
    // that reaches past the art (y = -15) and Ambershine sits inside it at (24, 48), so this
    // pair states the same 116x184 the unreachable one does.
    const reachable = await composeSpriteWithBox(artKey, ["Rainbow", "Thunderstruck", "Ambershine"]);
    assert.equal(await dims(reachable.buffer), "116x184");
    assert.deepEqual(reachable.box, { x: 0, y: 15, width: 116, height: 169 });

    // `Gold,Frozen,Ambercharged` is reachable (Growth + Hydro + Lunar) and reaches further:
    // Ambercharged (389x488 -> 88x111 here) lands at x = round(116*0.491379 - 88*(0.501285))
    // = 13 and y = round(158.0 - 107.3 - 111*0.795082) = -38, so the union is 116 x (169 + 38).
    const grown = await composeSpriteWithBox(artKey, ["Gold", "Frozen", "Ambercharged"]);
    assert.equal(await dims(grown.buffer), "116x207");
    assert.deepEqual(grown.box, { x: 0, y: 38, width: 116, height: 169 });
  });

  it("holds the art a mutation draws past the crop's frame", async () => {
    // The clamped canvas threw these pixels away: they sit outside the art's frame, so no
    // picture sized to that frame could hold them. Two claims are asserted, and they are
    // different ones:
    //
    //   * the picture is the union — bigger than the art exactly where a layer reached past
    //     it, and the box is the art's own rectangle inside it (the numbers below);
    //   * the strip the union added is not blank, for the pairs where the layer that grew it
    //     is really drawn there. That is checked as "some opaque pixel", never as a count: the
    //     count is a property of the fixture's flat blocks rather than of the union.
    //
    // A pair can genuinely leave the strip the union added transparent: a mutation's frame
    // carries its own padding (`spriteSourceSize` sits inside `sourceSize`), so a piece that
    // reaches a couple of pixels past the art may reach only with padding. That is a property
    // of the art, not of the union, which is why the pixel claim below is asked only where it
    // holds and the geometry is asked everywhere.
    const holds = async (artKey, mutations, expected, box, { painted = false } = {}) => {
      const composed = await composeSpriteWithBox(artKey, mutations);
      assert.equal(await dims(composed.buffer), expected, `${artKey} [${mutations.join("+")}]`);
      assert.deepEqual(composed.box, box, `${artKey} [${mutations.join("+")}]`);

      if (!painted) return;
      const { data, info } = await sharp(composed.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let overhang = 0;
      for (let y = 0; y < box.y; y++) {
        for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * info.channels + 3] > 0) overhang++;
      }
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < box.x; x++) if (data[(y * info.width + x) * info.channels + 3] > 0) overhang++;
      }
      assert.ok(overhang > 0, `${artKey} [${mutations.join("+")}] grew but draws nothing outside the art's frame`);
    };

    // Dawnlit reaches 8 px to the left of BabyCarrot's 191x238 art, and nothing reaches above
    // it: the species is `Carrot`, whose plant art this is (`BabyCarrot` is
    // `plants.Carrot.plant.sprite`), so the game's per-part anchor `anchors.Carrot.y.plant = 0.6`
    // puts the mutation *inside* the art vertically. The pre-fix composer keyed the anchors by
    // the art key's last segment, never matched `Carrot`, fell back to the 0.4 default and
    // reached 50 px above instead — that wrong picture was this test's own expectation before
    // plan item 25 (see the commit body).
    await holds("sprite/plant/BabyCarrot", ["Dawnlit"], "199x238", { x: 8, y: 0, width: 191, height: 238 });
    // Ambercharged reaches 2 px above the same art now. Nothing is asserted about those 2 rows'
    // pixels, because the icon's own art carries transparent padding (`spriteSourceSize.y = 20`
    // of a 488 px frame) and a 2 px strip falls inside it: that is a property of the frame, not
    // of the union — which is why the pixel claim below is made only where it holds.
    await holds("sprite/plant/BabyCarrot", ["Ambercharged"], "191x240", { x: 0, y: 2, width: 191, height: 238 });
    // The control, and the strongest one the game's table offers: `sprite/plant/Sunflower` is
    // the species `Sunflower`, so the art key's last segment and the species coincide and every
    // keying of these anchors reads the same row. Its picture must not move at all — and it is
    // the pair whose overhang is largest, so it is also where "the strip is drawn" is asked.
    await holds(
      "sprite/plant/Sunflower",
      ["Ambercharged"],
      "256x322",
      { x: 0, y: 66, width: 256, height: 256 },
      { painted: true },
    );
  });

  it("draws the bare crop at its own size, with nothing to union", async () => {
    // With no layer to union, the tight union is the art itself, so the box must be the whole
    // picture — the one case where the old degenerate answer was also the right one.
    for (const [species, [artKey, width, height]] of Object.entries(CROP_ART)) {
      const bare = await composeSpriteWithBox(artKey, []);
      assert.equal(await dims(bare.buffer), `${width}x${height}`, `${species} bare`);
      assert.deepEqual(bare.box, { x: 0, y: 0, width, height }, `${species} bare box`);
    }
  });

  it("still draws the crop, so the box is not an empty promise", async () => {
    const [artKey, width, height] = CROP_ART.Clover;
    const bare = await composeSprite(artKey, []);
    const { data, info } = await sharp(bare).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 3; i < data.length; i += info.channels) if (data[i] > 0) opaque++;
    assert.ok(opaque > 0, "the composed picture is fully transparent — the crop was not drawn");

    const wet = await composeSprite(artKey, ["Wet"]);
    assert.notEqual(wet.equals(bare), true, "a mutation changed nothing at all");
    // Wet's decal is inside Clover's art, so this picture is the art — and the box says so.
    const composed = await composeSpriteWithBox(artKey, ["Wet"]);
    assert.equal(await dims(wet), `${width}x${height}`);
    assert.deepEqual(composed.box, { x: 0, y: 0, width, height });
  });

  it("states the same box on the endpoint, as a header and as JSON", async () => {
    // A pair whose picture is bigger than the art, so the header is the real rectangle rather
    // than the degenerate one: BabyCarrot + Ambercharged is 191x240 with the art at y = 2
    // (plan item 25 — it was 191x288 with the art at y = 50 while the anchors were keyed by
    // the art key's last segment).
    const [artKey, width, height] = CROP_ART.Carrot;
    const expectedPicture = "191x240";
    const expectedBox = { x: 0, y: 2, width, height };
    // The same nesting the server uses (`src/api/server.js` mounts the assets router at
    // `/assets`, `src/api/routes/assets.js` mounts this one at `/sprites/composed`), with
    // only this route mounted.
    const assets = express.Router();
    assets.use("/sprites/composed", composedRouter);
    const app = express();
    app.use("/assets", assets);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${server.address().port}/assets/sprites/composed`;
      const query = `key=${encodeURIComponent(artKey)}&mutations=Ambercharged`;

      const png = await fetch(`${base}?${query}`);
      assert.equal(png.status, 200);
      assert.equal(png.headers.get("content-type"), "image/png");
      assert.equal(png.headers.get("x-mg-sprite-box"), `0,2,${width},${height}`);
      assert.equal(await dims(Buffer.from(await png.arrayBuffer())), expectedPicture);

      const layout = await fetch(`${base}?${query}&format=layout`);
      assert.equal(layout.status, 200);
      assert.match(layout.headers.get("content-type"), /application\/json/);
      assert.equal(layout.headers.get("x-mg-sprite-box"), `0,2,${width},${height}`);
      const body = await layout.json();
      assert.deepEqual(body.box, expectedBox);
      assert.equal(body.key, artKey);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("404s a key the atlas does not have", async () => {
    assert.equal(await composeSpriteWithBox("sprite/plant/DefinitelyNotASpecies", ["Wet"]), null);
  });
});
