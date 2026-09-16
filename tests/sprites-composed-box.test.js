// A composed crop is the crop's own box, and it says so.
//
// The endpoint used to size its canvas to the union of every layer's bounding box, so a
// caller that asked for a crop wearing a mutation got a picture bigger than the crop and
// no way to know where the crop was inside it. This file asserts the fixed contract: the
// picture's dimensions are the crop's own art, for every species the composer can compose,
// against the table below, and the box is stated.
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
const { composeSprite, composeSpriteWithBox } = await import("../src/assets/sprites/spriteComposer.js");
const { composedRouter } = await import("../src/api/routes/composed.js");

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

/** Compose one species and report the first thing that is wrong, or null. */
async function check(species, [artKey, width, height], mutations) {
  const composed = await composeSpriteWithBox(artKey, mutations);
  if (!composed) return `${species} (${artKey}) [${mutations.join("+") || "bare"}] composed nothing`;
  const got = await dims(composed.buffer);
  if (got !== `${width}x${height}`) {
    return `${species} (${artKey}) [${mutations.join("+") || "bare"}] composed ${got}, the crop's own art is ${width}x${height}`;
  }
  const box = composed.box;
  if (!box || box.x !== 0 || box.y !== 0 || box.width !== width || box.height !== height) {
    return `${species} (${artKey}) [${mutations.join("+") || "bare"}] stated box ${JSON.stringify(box)}, expected {x:0,y:0,width:${width},height:${height}}`;
  }
  return null;
}

describe("a composed crop is the crop's own box", () => {
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

  it("still draws the crop, so the box is not an empty promise", async () => {
    const [artKey, width, height] = CROP_ART.Clover;
    const bare = await composeSprite(artKey, []);
    const { data, info } = await sharp(bare).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = 3; i < data.length; i += info.channels) if (data[i] > 0) opaque++;
    assert.ok(opaque > 0, "the composed picture is fully transparent — the crop was not drawn");

    const wet = await composeSprite(artKey, ["Wet"]);
    assert.notEqual(wet.equals(bare), true, "a mutation changed nothing at all");
    assert.equal(await dims(wet), `${width}x${height}`);
  });

  it("states the same box on the endpoint, as a header and as JSON", async () => {
    const [artKey, width, height] = CROP_ART.Clover;
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
      const query = `key=${encodeURIComponent(artKey)}&mutations=Wet,Dawnlit`;

      const png = await fetch(`${base}?${query}`);
      assert.equal(png.status, 200);
      assert.equal(png.headers.get("content-type"), "image/png");
      assert.equal(png.headers.get("x-mg-sprite-box"), `0,0,${width},${height}`);
      assert.equal(await dims(Buffer.from(await png.arrayBuffer())), `${width}x${height}`);

      const layout = await fetch(`${base}?${query}&format=layout`);
      assert.equal(layout.status, 200);
      assert.match(layout.headers.get("content-type"), /application\/json/);
      assert.equal(layout.headers.get("x-mg-sprite-box"), `0,0,${width},${height}`);
      const body = await layout.json();
      assert.deepEqual(body.box, { x: 0, y: 0, width, height });
      assert.equal(body.key, artKey);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("404s a key the atlas does not have", async () => {
    assert.equal(await composeSpriteWithBox("sprite/plant/DefinitelyNotASpecies", ["Wet"]), null);
  });
});
