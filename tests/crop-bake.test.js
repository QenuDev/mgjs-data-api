// The opt-in crop bake: `BAKE=1` renders every *crop type* wearing each of its reachable
// mutation sets to a file, and publishes a manifest of what exists.
//
// What this file asserts, and why each part is worth a test:
//
//   * the enumeration comes from the game's data, not from a list in the code — the
//     mutation categories are read from each mutation's `group`, and the crop types from
//     the plant records, so a new mutation or a new species widens the bake with no code
//     change;
//   * it bakes crops, never whole plants: one art per crop type, and it is the art the
//     game itself draws mutations on (the patch art when the plant is single-harvest, its
//     crop art otherwise);
//   * with the flag off nothing is written and a request answers exactly what it answered
//     before, which is the default path the rest of the suite exercises;
//   * a set the bake did not produce is composed on demand and persisted, not 404ed;
//   * the manifest is swapped atomically: nothing is advertised before the bake completes,
//     a failed bake leaves the previous version serving, and a reader never sees a partial
//     JSON document;
//   * a killed bake resumes instead of starting over.
//
// It runs offline. `tests/fixtures/sprites/` holds the packed atlas with the real frame
// geometry for all 69 crop arts plus every mutation frame, and `tests/fixtures/bake/` holds
// the mutation table and the plant records both captured from game version 1192 by the
// `capture.mjs` beside them. The pixels are flat blocks because the properties under test
// are geometric and structural, never chromatic.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, beforeEach, describe, it } from "node:test";
import express from "express";
import sharp from "sharp";

// `config` and the logger read the environment when they load, so the source modules are
// imported dynamically below, after this line and after the fetch stub.
process.env.LOG_LEVEL = "silent";

// ─── Offline game ─────────────────────────────────────────────────────────────
//
// The composer reaches the game through `fetch` (version, manifest, atlas JSON, atlas
// image) and the bake reaches it again through `gameDataService` for the plant records and
// the mutation table. Serving both through their existing seams keeps the code under test
// untouched.
const GAME_ORIGIN = "https://magicgarden.gg";
const FIXTURE_VERSION = "fixture-1192";
const SPRITE_FIXTURES = new URL("./fixtures/sprites/", import.meta.url);
const BAKE_FIXTURES = new URL("./fixtures/bake/", import.meta.url);
const FIXTURE_FILES = new Set(["manifest.json", "sprites-composed.json", "sprites-composed.png"]);

// The real fetch, kept for this file's own requests to the server it starts.
const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (new URL(href).origin !== GAME_ORIGIN) return realFetch(url, init);
  if (href === `${GAME_ORIGIN}/platform/v1/version`) {
    return Response.json({ version: FIXTURE_VERSION });
  }
  const name = href.split("/").pop();
  if (FIXTURE_FILES.has(name)) {
    const body = await fs.readFile(new URL(name, SPRITE_FIXTURES));
    return new Response(body, {
      status: 200,
      headers: { "content-type": name.endsWith(".json") ? "application/json" : "image/png" },
    });
  }
  // Absent from the fixture: the bundle the composer reads plant metadata out of. The
  // composer already tolerates that (empty meta, `harvestType` falls back to "Single"),
  // and the bake's own plant records come from `gameDataService` below, not from here.
  return new Response("offline", { status: 404 });
};

const { config } = await import("../src/config/index.js");
const { gameDataService } = await import("../src/services/gameData.js");
const { lookupSprite } = await import("../src/assets/sprites/sprites.js");
const { isTallPlantFor } = await import("../src/assets/sprites/mutationAnchor.js");
const { composeSpriteWithBox, resolveComposedSprite, clearComposedCache } = await import(
  "../src/assets/sprites/spriteComposer.js"
);
const { composedRouter } = await import("../src/api/routes/composed.js");
const {
  bakeCrops,
  BAKE_LAYOUT,
  canonicalSet,
  clearBakeCache,
  enumerateCropTypes,
  enumerateMutationSets,
  groupMutations,
  isBakeEnabled,
  lookupBaked,
  persistComposed,
  publishManifest,
  readPublishedManifest,
} = await import("../src/assets/sprites/cropBake.js");

// ─── The captured game data ───────────────────────────────────────────────────

const MUTATIONS = JSON.parse(await fs.readFile(new URL("mutations.json", BAKE_FIXTURES), "utf8"));
const PLANTS = JSON.parse(await fs.readFile(new URL("plants.json", BAKE_FIXTURES), "utf8"));

// The two arts a small Multiple-harvest species wears its mutations on: `plant.sprite` is
// the plant body (the whole plant, which is never baked) and `crop.sprite` is the crop.
const PINNED = {
  single: "Squash", // Single-harvest: the patch art is `plant.sprite` (124×196)
  multiple: "PricklyPear", // Multiple-harvest: the crop art is `crop.sprite` (103×109)
};

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

const artOf = (species) => {
  const rec = PLANTS[species];
  return rec.plant?.harvestType === "Single" ? rec.plant?.sprite : rec.crop?.sprite;
};

// The crop art's own dimensions, derived from the *fixture's* atlas frame — the committed
// capture — and not from any helper the production code owns. The composed picture is the
// tight union of that art and the layers drawn over it (`src/assets/sprites/cropBox.js` states
// the convention and the evidence), and the manifest states the art's own rectangle inside it.
const artSize = (artKey) => {
  const meta = lookupSprite(artKey);
  return {
    width: meta.sourceSize?.w ?? (meta.rotated ? meta.frame.h : meta.frame.w),
    height: meta.sourceSize?.h ?? (meta.rotated ? meta.frame.w : meta.frame.h),
  };
};

const boxHeader = (box) => `${box.x},${box.y},${box.width},${box.height}`;

// A mutation payload with only some of the categories: the enumeration over it is the
// product of those categories, so a set wearing a mutation outside them is a genuine miss.
const onlyGroups = (wanted) =>
  Object.fromEntries(Object.entries(MUTATIONS).filter(([, rec]) => wanted.includes(rec.group)));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEMP_DIRS = [];
async function freshRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mg-bake-"));
  TEMP_DIRS.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(TEMP_DIRS.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function countFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const entry of entries) {
    n += entry.isDirectory() ? await countFiles(path.join(dir, entry.name)) : 1;
  }
  return n;
}

async function until(predicate, { timeout = 30_000, interval = 10 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * A composer that records every art it is asked for, and can be made to pause or fail at a
 * chosen call, so the bake's behaviour around a partial run is observable.
 */
function makeComposer({ pauseAt = null, gate = null, failAt = null } = {}) {
  const calls = [];
  let n = 0;
  const compose = async (key, mutations) => {
    const index = n++;
    calls.push({ key, mutations: [...mutations] });
    if (pauseAt !== null && index === pauseAt) await gate;
    if (failAt !== null && index === failAt) throw new Error("compose exploded");
    return composeSpriteWithBox(key, mutations);
  };
  return { compose, calls, count: () => n };
}

/** The composed route, mounted the way `src/api/routes/assets.js` mounts it. */
async function getViaRoute(key, mutations, query = {}) {
  const assets = express.Router();
  assets.use("/sprites/composed", composedRouter);
  const app = express();
  app.use("/assets", assets);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/assets/sprites/composed`;
    const params = new URLSearchParams({ key, mutations: mutations.join(","), ...query });
    const res = await realFetch(`${base}?${params}`);
    return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

beforeEach(async () => {
  clearComposedCache();
  clearBakeCache();
  config.bake.enabled = false;
  config.bake.dir = null;
  gameDataService.getPlants = async () => PLANTS;
  gameDataService.getMutations = async () => MUTATIONS;
});

// ─── The enumeration ──────────────────────────────────────────────────────────

describe("the bake's enumeration comes from the game's data", () => {
  it("reads the mutation categories from the group field, never from a list", () => {
    const byGroup = groupMutations(MUTATIONS);

    assert.deepEqual([...byGroup.keys()], ["Growth", "Hydro", "Lunar"]);
    assert.deepEqual(
      [...byGroup.values()].map((list) => list.length),
      [2, 5, 4],
      "the captured table's category sizes",
    );

    const sets = enumerateMutationSets(MUTATIONS);
    assert.equal(sets.length, 90, "the product of (category size + 1)");
    assert.equal(
      [...byGroup.values()].reduce((product, list) => product * (list.length + 1), 1),
      sets.length,
    );

    // A plant wears at most one mutation per category, so no set may hold two.
    for (const set of sets) {
      for (const [group, members] of byGroup) {
        const worn = set.filter((id) => members.includes(id));
        assert.ok(worn.length <= 1, `set [${set}] wears ${worn} from ${group}`);
      }
    }

    // The bare crop is one of the reachable sets.
    assert.ok(sets.some((set) => set.length === 0), "the set wearing nothing is missing");

    // Every set is canonical — sorted and deduplicated — so a request canonicalises to the
    // same key the manifest was written under.
    for (const set of sets) {
      assert.deepEqual(set, [...new Set(set)].sort(), `set not canonical: [${set}]`);
    }

    // A mutation the data does not group cannot be enumerated: it widens the bake only
    // once the game places it in a category.
    const ungrouped = { ...MUTATIONS, Mystery: { name: "Mystery", baseChance: 0.0001 } };
    assert.equal(enumerateMutationSets(ungrouped).length, 90, "an ungrouped mutation widened the bake");
  });

  it("names a set by what it holds, not by the order it was asked for", () => {
    assert.equal(canonicalSet([]), "", "the crop wearing nothing is the empty key");
    assert.equal(canonicalSet(["Wet"]), "Wet");
    assert.equal(canonicalSet(["Wet", "Dawnlit"]), "Dawnlit+Wet");
    assert.equal(canonicalSet(["Dawnlit", "Wet", "Dawnlit"]), "Dawnlit+Wet", "not deduplicated");
    assert.equal(
      canonicalSet(["Rainbow", "Thunderstruck", "Ambershine"]),
      canonicalSet(["Ambershine", "Rainbow", "Thunderstruck"]),
      "the same set asked for in two orders is two keys",
    );
  });

  it("states the composed picture's box in exactly one place", async () => {
    const { cropComposition, cropArtSize, overlayClip } = await import("../src/assets/sprites/cropBox.js");

    // The production statement of the picture the composer builds, tied to literals: the
    // canvas is the tight union of the art and the layer rectangles, and the box is the art's
    // own rectangle inside it (`src/assets/sprites/cropBox.js` records the bundle evidence).
    //
    // No layer reaches past the art: the picture is the art, at the origin.
    assert.deepEqual(cropComposition(116, 169, []), {
      canvas: { width: 116, height: 169 },
      box: { x: 0, y: 0, width: 116, height: 169 },
    });
    // A layer 21 px above the art's top and wholly inside it horizontally: the canvas grows by
    // exactly that overhang and the art's corner moves down by it. This is the arithmetic the
    // live measurement of Clover + `Gold,Frozen,Ambercharged` produces (116x190, box y = 21).
    assert.deepEqual(
      cropComposition(116, 169, [{ left: 13, top: -21, width: 88, height: 111 }]),
      {
        canvas: { width: 116, height: 190 },
        box: { x: 0, y: 21, width: 116, height: 169 },
      },
    );
    // A layer that also reaches left: the box's x moves with it, and neither axis is -0.
    assert.deepEqual(
      cropComposition(191, 238, [{ left: -8, top: -4, width: 175, height: 123 }]),
      {
        canvas: { width: 199, height: 242 },
        box: { x: 8, y: 4, width: 191, height: 238 },
      },
    );

    // The one clip that stays: the tall-plant overlay is masked to the crop body's own
    // texture, so it is cut to the art's rectangle. Frozen's overlay is 1024x1024 and
    // PricklyPear's art is 103x109, so the kept piece is exactly the art — whether the
    // overlay hangs from the art's top or its bottom (the arithmetic for the two mutations
    // the game anchors differently).
    assert.deepEqual(overlayClip(103, 109, 1024, 1024, 0.5, false), {
      x: 0, y: 0, cropLeft: 460, cropTop: 0, width: 103, height: 109,
    });
    assert.deepEqual(overlayClip(103, 109, 1024, 1024, 0.5, true), {
      x: 0, y: 0, cropLeft: 460, cropTop: 915, width: 103, height: 109,
    });
    // An overlay smaller than the art is not cut at all.
    assert.deepEqual(overlayClip(200, 200, 50, 40, 0.5, false), {
      x: 75, y: 0, cropLeft: 0, cropTop: 0, width: 50, height: 40,
    });

    // The art's own dimensions come from the atlas frame's `sourceSize` when it is trimmed.
    assert.deepEqual(
      cropArtSize({ sourceSize: { w: 116, h: 169 }, frame: { w: 100, h: 150 } }),
      { width: 116, height: 169 },
    );
    assert.deepEqual(
      cropArtSize({ frame: { w: 100, h: 150 }, rotated: true }),
      { width: 150, height: 100 },
    );
  });

  it("derives each crop type's art from its plant record, and only arts the atlas has", async () => {
    const types = await enumerateCropTypes();

    assert.equal(types.length, 69, "the game's 69 crop types");
    assert.equal(new Set(types.map((t) => t.artKey)).size, 69, "one distinct art per crop type");

    for (const { species, artKey } of types) {
      assert.ok(lookupSprite(artKey), `${species}: the atlas has no ${artKey}`);
      assert.equal(artKey, artOf(species), `${species}: wrong art for its harvest type`);
    }

    // The whole bake is the product, and nothing else.
    assert.equal(types.length * enumerateMutationSets(MUTATIONS).length, 6210);

    // A species whose art the atlas does not have is skipped rather than baked broken.
    const absent = await enumerateCropTypes({
      plants: { Ghost: { plant: { harvestType: "Single", sprite: "sprite/plant/Ghost" } } },
    });
    assert.deepEqual(absent, []);
  });
});

// ─── The bake ─────────────────────────────────────────────────────────────────

describe("the crop bake", () => {
  it("writes one file per crop type per reachable set, and a manifest of them", async () => {
    const root = await freshRoot();
    config.bake.enabled = true;
    config.bake.dir = root;
    gameDataService.getPlants = async () => pick(PLANTS, [PINNED.single, PINNED.multiple]);

    const summary = await bakeCrops({ gameVersion: "1192" });

    assert.equal(summary.cropTypes, 2);
    assert.equal(summary.setsPerCropType, 90);
    assert.equal(summary.pictures, 180);
    assert.equal(summary.rendered, 180);
    assert.equal(summary.resumed, 0);
    assert.equal(summary.gameVersion, "1192");

    const manifest = await readPublishedManifest();
    assert.equal(manifest.format, "mg-crop-bake/2");
    assert.equal(manifest.gameVersion, "1192");
    assert.equal(manifest.pictures, 180);
    assert.deepEqual(Object.keys(manifest.crops).sort(), [PINNED.multiple, PINNED.single].sort());

    const { composedBox } = await import("../src/assets/sprites/spriteComposer.js");

    let bytesOnDisk = 0;
    for (const [species, entry] of Object.entries(manifest.crops)) {
      assert.equal(entry.art, artOf(species), `${species}: manifest names the wrong art`);
      assert.equal(Object.keys(entry.sets).length, 90, `${species}: not 90 sets`);

      for (const [slug, picture] of Object.entries(entry.sets)) {
        assert.match(
          picture.file,
          new RegExp(`^${BAKE_LAYOUT}/1192/crops/.+/.+\\.png$`),
          `${species} "${slug}" path`,
        );
        // The manifest is the record of what is on disk, geometry included: `file`, `bytes`
        // and the box the picture is in. The box is the art's own rectangle, stated by the
        // one composer that owns the convention (plan item 24), not the degenerate
        // `0,0,width,height` a picture the size of the art would have.
        assert.deepEqual(
          Object.keys(picture).sort(),
          ["box", "bytes", "file"],
          `${species} "${slug}": the manifest's shape changed`,
        );
        const art = artSize(entry.art);
        assert.equal(picture.box.width, art.width, `${species} "${slug}": box width is not the art's`);
        assert.equal(picture.box.height, art.height, `${species} "${slug}": box height is not the art's`);
        assert.ok(picture.box.x >= 0 && picture.box.y >= 0, `${species} "${slug}": box outside the picture`);
        assert.deepEqual(
          picture.box,
          await composedBox(entry.art, slug ? slug.split("+") : []),
          `${species} "${slug}": the manifest's box is not the one a composition states`,
        );

        const stat = await fs.stat(path.join(root, picture.file));
        assert.equal(stat.size, picture.bytes, `${species} "${slug}" bytes`);
        assert.ok(picture.bytes > 0);
        bytesOnDisk += stat.size;
      }
    }

    assert.equal(summary.bytes, bytesOnDisk, "the reported total is what is on disk");
    assert.equal(await countFiles(path.join(root, BAKE_LAYOUT, "1192", "crops")), 180);

    // The picture really is the union (measured on the file, not trusted from the manifest):
    // the bare crop has nothing to union, so its file is exactly the art and its box is the
    // whole picture — the one case where the old degenerate answer was also the right one.
    const art = artSize(artOf(PINNED.single));
    const bare = manifest.crops[PINNED.single].sets[""];
    const meta = await sharp(path.join(root, bare.file)).metadata();
    assert.equal(
      `${meta.width}x${meta.height}`,
      `${art.width}x${art.height}`,
      "the bare crop's picture is not the crop's own art",
    );
    assert.deepEqual(bare.box, { x: 0, y: 0, width: art.width, height: art.height });

    // A set that grows really does grow: PricklyPear's art is 103x109 and Thunderstruck's icon
    // reaches 15 px above it, so the picture is 103x124 with the art's corner at y = 15 — the
    // same overhang the live atlas gives this pair. (Before plan item 27 this pair grew for a
    // different reason: the plant records anchor PricklyPear `bottom`, so the composer drew it
    // tall and used Thunderstruck's `×2` ground decal. The game's own table states
    // `isTallPlant: false` for this art, and `tests/tall-plant-flag.test.js` asserts that. The
    // dimensions coincide, so the exact pin below is what says each layer landed where it did.)
    const tallArt = artSize(artOf(PINNED.multiple));
    const grownSlug = canonicalSet(["Thunderstruck"]);
    const grown = manifest.crops[PINNED.multiple].sets[grownSlug];
    const grownMeta = await sharp(path.join(root, grown.file)).metadata();
    assert.equal(`${grownMeta.width}x${grownMeta.height}`, `${tallArt.width}x${tallArt.height + 15}`);
    assert.ok(
      grownMeta.width >= tallArt.width && grownMeta.height >= tallArt.height,
      `PricklyPear + Thunderstruck is ${grownMeta.width}x${grownMeta.height}, smaller than its art`,
    );
    assert.deepEqual(grown.box, { x: 0, y: 15, width: tallArt.width, height: tallArt.height });
    assert.ok(
      grown.box.x + tallArt.width <= grownMeta.width && grown.box.y + tallArt.height <= grownMeta.height,
      `the box ${JSON.stringify(grown.box)} does not fit the ${grownMeta.width}x${grownMeta.height} picture`,
    );
    assert.ok(
      grownMeta.height > tallArt.height,
      "the decal no longer grows the picture, so this case proves nothing about the union",
    );

    // The bare crop and a three-mutation set are both there, and both are files.
    const heaviest = canonicalSet(["Rainbow", "Thunderstruck", "Ambershine"]);
    assert.ok(FILES_HAVE(manifest.crops[PINNED.single].sets, ["", heaviest]));
  });

  it("bakes crops, never whole plants", async () => {
    const root = await freshRoot();
    config.bake.enabled = true;
    config.bake.dir = root;
    gameDataService.getPlants = async () => pick(PLANTS, [PINNED.single, PINNED.multiple]);
    // Two categories are enough to observe which art each crop type wears.
    gameDataService.getMutations = async () => onlyGroups(["Growth", "Hydro"]);

    const spy = makeComposer();
    const summary = await bakeCrops({ gameVersion: "1192", compose: spy.compose });

    assert.equal(summary.setsPerCropType, 18);
    assert.equal(summary.pictures, 36);
    assert.equal(spy.calls.length, 36);

    // Exactly the crop types' arts were composed — one art each, and never the plant body.
    const expected = new Set([artOf(PINNED.single), artOf(PINNED.multiple)]);
    for (const { key } of spy.calls) {
      assert.ok(expected.has(key), `composed a key that is not a crop type's art: ${key}`);
    }
    assert.ok(
      !spy.calls.some(({ key }) => key === PLANTS[PINNED.multiple].plant.sprite),
      "the whole plant's art was composed",
    );
    assert.notEqual(PLANTS[PINNED.multiple].plant.sprite, artOf(PINNED.multiple));

    // One manifest entry per crop type, holding the enumeration's sets — not the product of
    // the plant's slot count, which is what makes a plant 90^slots rather than 90.
    const manifest = await readPublishedManifest();
    for (const species of [PINNED.single, PINNED.multiple]) {
      assert.equal(manifest.crops[species].art, artOf(species));
      assert.equal(Object.keys(manifest.crops[species].sets).length, 18);
    }
  });

  it("with the flag off writes nothing and answers exactly what it answered before", async () => {
    const root = await freshRoot();
    config.bake.enabled = false;
    config.bake.dir = root;

    const spy = makeComposer();
    const summary = await bakeCrops({ gameVersion: "1192", compose: spy.compose });

    assert.equal(summary.skipped, true);
    assert.equal(summary.reason, "disabled");
    assert.equal(spy.count(), 0, "a disabled bake composed something");
    assert.deepEqual(await fs.readdir(root), [], "a disabled bake wrote to disk");
    assert.equal(isBakeEnabled(), false);

    // A manifest on disk does not make the flag-off path read it: the default path is the
    // composer and nothing else.
    await fs.writeFile(
      path.join(root, "manifest.json"),
      JSON.stringify({ format: "mg-crop-bake/2", layout: BAKE_LAYOUT, gameVersion: "1192", crops: {}, pictures: 0 }),
    );
    assert.equal(await lookupBaked(artOf(PINNED.single), ["Wet"]), null);
    assert.equal(
      await persistComposed(artOf(PINNED.single), ["Wet"], { buffer: Buffer.from("x") }),
      false,
    );
    assert.deepEqual((await fs.readdir(root)).sort(), ["manifest.json"], "the flag-off path grew");

    // The route serves the composer's own bytes and its own box, and still grows nothing.
    const resolved = await resolveComposedSprite(artOf(PINNED.single), ["Wet", "Dawnlit"]);
    assert.equal(resolved.source, "composed");
    const served = await getViaRoute(artOf(PINNED.single), ["Wet", "Dawnlit"]);
    assert.equal(served.status, 200);
    assert.ok(served.buffer.equals(resolved.buffer), "the route no longer serves the composition");
    assert.equal(
      served.headers.get("x-mg-sprite-box"),
      boxHeader(resolved.box),
      "the route states a different box than the composer",
    );
    assert.deepEqual((await fs.readdir(root)).sort(), ["manifest.json"], "the route grew the disk");
  });

  it("composes and persists a set the bake did not produce, rather than 404ing", async () => {
    const root = await freshRoot();
    config.bake.enabled = true;
    config.bake.dir = root;
    gameDataService.getPlants = async () => pick(PLANTS, [PINNED.single]);
    // Only Growth and Hydro are enumerated, so a Lunar mutation is a genuine miss.
    gameDataService.getMutations = async () => onlyGroups(["Growth", "Hydro"]);

    const bake = makeComposer();
    const summary = await bakeCrops({ gameVersion: "1192", compose: bake.compose });
    assert.equal(summary.setsPerCropType, 18);
    assert.equal(summary.pictures, 18);

    const art = artOf(PINNED.single);
    assert.equal(await lookupBaked(art, ["Dawnlit"]), null, "the bake predicted a set it should not");

    // The route answers 200 from a cold composition, and keeps it.
    const first = await getViaRoute(art, ["Dawnlit"]);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("content-type"), "image/png");

    const hit = await lookupBaked(art, ["Dawnlit"]);
    assert.ok(hit, "the miss was not persisted");
    assert.deepEqual(hit.mutations, ["Dawnlit"]);
    assert.ok(await fs.stat(hit.file), "the persisted file is not on disk");
    // The manifest states the box, so the persisted picture can be placed without composing
    // it again: it is the art's own rectangle (Squash's art is 124x196) inside its union.
    assert.ok(hit.box, "the manifest states no box for the picture it just recorded");
    assert.equal(hit.box.width, artSize(art).width);
    assert.equal(hit.box.height, artSize(art).height);

    // And the manifest now records it, which is what makes the next request a file read.
    const manifest = await readPublishedManifest();
    assert.equal(
      Object.keys(manifest.crops[PINNED.single].sets).length,
      19,
      "the manifest did not gain the composed set",
    );
    assert.equal(manifest.pictures, 19);

    const resolved = await resolveComposedSprite(art, ["Dawnlit"]);
    assert.equal(resolved.source, "baked", "the persisted set is not served from disk");
    assert.ok(resolved.buffer.equals(first.buffer), "the persisted picture differs from the first answer");
    // The box is the one the manifest states, and it is the one a fresh composition would
    // state: the bake's geometry and the composer's are the same statement (`composedBox`).
    const composed = await composeSpriteWithBox(art, ["Dawnlit"]);
    assert.deepEqual(resolved.box, composed.box, "the baked path states a different box");
    assert.deepEqual(resolved.box, hit.box, "the served box is not the one the manifest records");

    const layout = await getViaRoute(art, ["Dawnlit"], { format: "layout" });
    assert.equal(layout.status, 200);
    assert.deepEqual(JSON.parse(layout.buffer.toString()).box, composed.box);

    // A baked file that has gone missing is composed again rather than 404ed.
    await fs.rm(hit.file);
    const repaired = await getViaRoute(art, ["Dawnlit"]);
    assert.equal(repaired.status, 200, "a missing baked file 404ed instead of recomposing");
    assert.ok(await fs.stat(hit.file), "the missing file was not restored");
  });

  it("advertises nothing until the bake is complete", async () => {
    const root = await freshRoot();
    config.bake.enabled = true;
    config.bake.dir = root;
    gameDataService.getPlants = async () => pick(PLANTS, [PINNED.single, PINNED.multiple]);
    gameDataService.getMutations = async () => onlyGroups(["Growth", "Hydro"]);

    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const spy = makeComposer({ pauseAt: 20, gate });
    const running = bakeCrops({ gameVersion: "1192", compose: spy.compose });

    await until(async () => (await countFiles(path.join(root, BAKE_LAYOUT, "1192", "crops"))) >= 20);

    // Half the pictures exist, and nothing advertises them: neither a manifest nor a hit.
    assert.equal(await countFiles(path.join(root, BAKE_LAYOUT, "1192", "crops")), 20);
    assert.equal(await readPublishedManifest(), null, "a half-baked version was advertised");
    assert.equal(await lookupBaked(artOf(PINNED.single), ["Wet"]), null);
    assert.equal(existsSync(path.join(root, "manifest.json")), false);

    release();
    const summary = await running;
    assert.equal(summary.pictures, 36);

    const manifest = await readPublishedManifest();
    assert.equal(manifest.pictures, 36, "the completed bake was not published");
    assert.ok(await lookupBaked(artOf(PINNED.single), ["Wet"]));
  });

  it("leaves the previous version serving when a bake fails, and resumes on the retry", async () => {
    const root = await freshRoot();
    config.bake.enabled = true;
    config.bake.dir = root;
    gameDataService.getPlants = async () => pick(PLANTS, [PINNED.single, PINNED.multiple]);
    gameDataService.getMutations = async () => onlyGroups(["Growth", "Hydro"]);

    const first = await bakeCrops({ gameVersion: "1192" });
    assert.equal(first.pictures, 36);
    const published = await readPublishedManifest();

    // A new game version whose bake dies partway through.
    const failing = makeComposer({ failAt: 20 });
    await assert.rejects(
      () => bakeCrops({ gameVersion: "1193", compose: failing.compose }),
      /compose exploded/,
    );

    const after = await readPublishedManifest();
    assert.equal(after.gameVersion, "1192", "a half-baked version replaced the published one");
    assert.equal(after.pictures, 36);
    assert.equal(after.generatedAt, published.generatedAt, "the manifest was rewritten by a failed bake");
    for (const entry of Object.values(after.crops)) {
      for (const picture of Object.values(entry.sets)) {
        assert.ok(!picture.file.startsWith("1193/"), "the manifest advertises the failed version");
      }
    }
    // The previous version still answers, and the partial run is on disk for the retry.
    assert.ok(await lookupBaked(artOf(PINNED.single), ["Wet"]));
    assert.equal(await countFiles(path.join(root, BAKE_LAYOUT, "1193", "crops")), 20);

    // The retry renders only what is missing.
    const retry = makeComposer();
    const second = await bakeCrops({ gameVersion: "1193", compose: retry.compose });

    assert.equal(second.resumed, 20, "the retry did not reuse the partial run");
    assert.equal(second.rendered, 16);
    assert.equal(retry.count(), 16, "the retry re-rendered files that were already there");
    assert.equal(second.pictures, 36);

    const republished = await readPublishedManifest();
    assert.equal(republished.gameVersion, "1193");
    assert.equal(republished.pictures, 36);
    for (const entry of Object.values(republished.crops)) {
      for (const picture of Object.values(entry.sets)) {
        assert.ok(await fs.stat(path.join(root, picture.file)), `${picture.file} is advertised but absent`);
      }
    }
    const resolved = await resolveComposedSprite(artOf(PINNED.single), ["Wet"]);
    assert.equal(resolved.source, "baked");
  });

  it("skips a re-bake whose version is already published", async () => {
    const root = await freshRoot();
    config.bake.enabled = true;
    config.bake.dir = root;
    gameDataService.getPlants = async () => pick(PLANTS, [PINNED.single]);
    gameDataService.getMutations = async () => onlyGroups(["Growth", "Hydro"]);

    await bakeCrops({ gameVersion: "1192" });
    const published = await readPublishedManifest();

    const spy = makeComposer();
    const again = await bakeCrops({ gameVersion: "1192", compose: spy.compose });

    assert.equal(again.skipped, true);
    assert.equal(again.reason, "already_baked");
    assert.equal(spy.count(), 0, "a re-run of the same version re-rendered");
    const after = await readPublishedManifest();
    assert.equal(after.generatedAt, published.generatedAt);

    // A new version does run.
    const third = await bakeCrops({ gameVersion: "1193", compose: spy.compose });
    assert.equal(third.pictures, 18);
    assert.equal((await readPublishedManifest()).gameVersion, "1193");
  });

  it("refuses a manifest whose pictures have another shape, and re-bakes instead of resuming it", async () => {
    const root = await freshRoot();
    config.bake.enabled = true;
    config.bake.dir = root;
    gameDataService.getPlants = async () => pick(PLANTS, [PINNED.single]);
    gameDataService.getMutations = async () => onlyGroups(["Growth", "Hydro"]);

    const art = artOf(PINNED.single);
    // `v1` is the clamped layout: the picture was the crop's own art and the box was the
    // degenerate `0,0,width,height`. A composer change moves the shape of every picture while
    // the game version stays put, so a v1 tree must be neither served nor resumed as v2's —
    // otherwise the old bytes would be answered under the new box.
    const stale = {
      format: "mg-crop-bake/1",
      layout: "v1", // the clamped picture shape, before the union box (plan item 24)
      gameVersion: "1192",
      generatedAt: "2020-01-01T00:00:00.000Z",
      pictures: 1,
      bytes: 1,
      crops: { [PINNED.single]: { art, sets: { "": { file: "v1/1192/crops/x/bare.png", bytes: 1 } } } },
    };
    await publishManifest(stale, { root });
    await fs.mkdir(path.join(root, "v1", "1192", "crops", "x"), { recursive: true });
    await fs.writeFile(path.join(root, stale.crops[PINNED.single].sets[""].file), Buffer.from("x"));

    // Not served: a picture baked under another shape must not answer as if it were this one.
    assert.equal(await readPublishedManifest(), null, "an old-layout manifest was accepted");
    assert.equal(await lookupBaked(art, []), null, "an old-layout picture was served");

    // Not resumed either: the whole space is rendered into this layout's own tree, even though
    // the v1 file is on disk and decodable — it is not a picture in this layout's shape.
    const spy = makeComposer();
    const summary = await bakeCrops({ gameVersion: "1192", compose: spy.compose });
    assert.equal(summary.layout, BAKE_LAYOUT);
    assert.equal(summary.rendered, 18, "the old tree's files were reused");
    assert.equal(summary.resumed, 0);
    assert.equal(spy.count(), 18);

    const manifest = await readPublishedManifest();
    assert.equal(manifest.layout, BAKE_LAYOUT);
    for (const picture of Object.values(manifest.crops[PINNED.single].sets)) {
      assert.ok(picture.file.startsWith(`${BAKE_LAYOUT}/1192/`), picture.file);
    }
    assert.ok(await lookupBaked(art, ["Wet"]), "the re-baked picture is not served");
  });

  it("publishes nothing when there is nothing to bake", async () => {
    const root = await freshRoot();
    config.bake.enabled = true;
    config.bake.dir = root;
    gameDataService.getPlants = async () => ({});

    const summary = await bakeCrops({ gameVersion: "1192" });

    assert.equal(summary.skipped, true);
    assert.equal(summary.reason, "no_crop_types");
    assert.equal(await readPublishedManifest(), null, "an empty bake was advertised");
    assert.deepEqual(await fs.readdir(root), []);
  });

  it("swaps the published manifest by rename, so a reader never sees a partial one", async () => {
    const root = await freshRoot();
    const published = path.join(root, "manifest.json");
    const filler = "x".repeat(200_000); // a payload a reader can catch mid-write

    await publishManifest({ marker: "a", filler }, { root });

    let reads = 0;
    let failure = null;
    let stop = false;
    const reader = (async () => {
      while (!stop) {
        let text;
        try {
          text = await fs.readFile(published, "utf8");
        } catch {
          continue;
        }
        try {
          const parsed = JSON.parse(text);
          assert.ok(parsed.marker === "a" || parsed.marker === "b");
          reads++;
        } catch (err) {
          failure = err;
          return;
        }
      }
    })();

    for (let i = 0; i < 120; i++) {
      await publishManifest({ marker: i % 2 ? "a" : "b", filler }, { root });
    }
    stop = true;
    await reader;

    assert.equal(failure, null, `a reader caught a partial manifest: ${failure?.message}`);
    assert.ok(reads > 0, "the reader never read the manifest");
    // The swap leaves no half-written file behind.
    const leftovers = (await fs.readdir(root)).filter((name) => name.includes(".tmp"));
    assert.deepEqual(leftovers, [], "a temp file survived the swap");
  });

  // The exhaustive sweep is the slow one: all 69 crop types over all 90 sets, offline.
  it("covers the game's whole crop space when run in full", {
    skip: process.env.MG_BAKE_FULL ? false : "slow: 6,210 compositions — set MG_BAKE_FULL=1 to run",
  }, async () => {
    const root = await freshRoot();
    config.bake.enabled = true;
    config.bake.dir = root;

    const summary = await bakeCrops({ gameVersion: "1192" });

    assert.equal(summary.cropTypes, 69);
    assert.equal(summary.setsPerCropType, 90);
    assert.equal(summary.pictures, 6210);
    assert.equal(await countFiles(path.join(root, BAKE_LAYOUT, "1192", "crops")), 6210);
    assert.equal((await readPublishedManifest()).pictures, 6210);
  });
});

// ─── The version watcher's pass ───────────────────────────────────────────────

describe("the one layer the composer still clips", () => {
  // The tall-plant overlay (`sprite/mutation-overlay/*TallPlant`) is the layer the game *does*
  // mask, to the crop body's own texture, and only for a plant the game's own display table
  // flags `isTallPlant`. A fix that removed every clamp would have drawn it unclipped,
  // over-drawing; these tests are what says the composer still cuts exactly that layer and no
  // other.
  //
  // They run on `Bamboo`, which the game's table flags tall (`isTallPlantFor`), and not on
  // PricklyPear as they used to: the plant records' `tileTransformOrigin` called PricklyPear's
  // crop art tall and the game does not, so the pair that used to exercise the clip now draws
  // no overlay at all — an assertion that cannot tell "clipped" from "not drawn" is exactly the
  // one this change would have left passing for the wrong reason.

  it("clips the overlay to the crop body's own texture, so the overlay's frame is never the picture", async () => {
    assert.equal(isTallPlantFor("sprite/plant/Bamboo"), true, "the game does not flag Bamboo tall");
    const overlay = lookupSprite("sprite/mutation-overlay/FrozenTallPlant");
    assert.ok(overlay, "the fixture has no Frozen tall-plant overlay to clip");
    assert.deepEqual(overlay.sourceSize, { w: 1024, h: 1024 });

    const art = artSize("sprite/plant/Bamboo"); // 281x1280
    const composed = await composeSpriteWithBox("sprite/plant/Bamboo", ["Frozen"]);
    const meta = await sharp(composed.buffer).metadata();

    // Frozen hangs its 1024-wide, 1024-tall overlay from the art's top and 371 px to the left
    // of a 281 px art (`overlayClip(281, 1280, 1024, 1024, 0.5, false).cropLeft` is 371), so an
    // unclipped overlay would put the picture at 1024 px wide at least. The picture is 318x1368
    // — the art plus the icon's own reach — so the overlay's frame is not in it: that width is
    // the witness this test is for, and removing the clip fails it.
    assert.ok(
      meta.width < overlay.sourceSize.w,
      `the overlay's own 1024 px frame set the picture's width (${meta.width}): it was not clipped`,
    );
    assert.equal(`${meta.width}x${meta.height}`, "318x1368");
    assert.deepEqual(composed.box, { x: 13, y: 0, width: art.width, height: art.height });
  });

  it("keeps clipping the overlay while a decal is still allowed to grow the picture", async () => {
    // Thunderstruck also states an overlay, and its ground decal (the tall icon) reaches past
    // the same art: the decal grows the canvas — no clamp touches it — and the overlay still
    // cannot, which is the one asymmetry the clip exists for.
    const art = artSize("sprite/plant/Bamboo");
    const composed = await composeSpriteWithBox("sprite/plant/Bamboo", ["Thunderstruck"]);
    const meta = await sharp(composed.buffer).metadata();

    assert.equal(`${meta.width}x${meta.height}`, "378x1363");
    assert.deepEqual(composed.box, { x: 43, y: 0, width: art.width, height: art.height });
    assert.ok(meta.height > art.height, "the decal no longer grows the picture, so nothing is proved");
    assert.ok(meta.width < 1024, `the overlay's own frame set the picture's width (${meta.width})`);

    const overlay = lookupSprite("sprite/mutation-overlay/ThunderstruckTallPlant");
    assert.ok(overlay, "the fixture has no Thunderstruck tall-plant overlay to clip");
    assert.ok(
      meta.width < overlay.sourceSize.w || meta.height < overlay.sourceSize.h,
      "the overlay's own frame set the picture: it was not clipped to the art",
    );
  });
});

describe("the bake joins the version watcher's pass", () => {
  const spriteSyncPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "services",
    "spriteSync.js",
  );

  it("re-bakes a new version at the end of the atlas pass, after the version is saved", () => {
    const source = readFileSync(spriteSyncPath, "utf8");

    const bakeModule = /from\s+"\.\.\/assets\/sprites\/cropBake\.js"/;
    assert.match(source, bakeModule, "spriteSync does not import the bake module");
    assert.match(source, /bakeCrops\s*\(/, "spriteSync never calls bakeCrops");

    // The bake must sit after the atlas export and its `saveVersion`, so it runs on the art
    // that pass produced, and outside the branch that skipped the export.
    const pass = source.slice(source.indexOf("await exportSpritesToDisk"));
    const saveAt = pass.indexOf("await saveVersion(currentVersion)");
    const bakeAt = pass.indexOf("bakeCrops(");
    assert.ok(saveAt > 0, "the atlas pass no longer saves the version it exported");
    assert.ok(bakeAt > saveAt, "the bake is not after the export and its saveVersion");
    assert.match(pass.slice(bakeAt, bakeAt + 400), /gameVersion:\s*currentVersion/);
  });
});

/** `sets` holds every named slug, so a missing or misnamed key is one failed assertion. */
function FILES_HAVE(sets, slugs) {
  return slugs.every((slug) => sets[slug] && typeof sets[slug].file === "string");
}
