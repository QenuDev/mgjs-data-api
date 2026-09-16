// tests/helpers/composed-atlas.js
//
// The committed offline atlas behind one `fetch` seam, for a test file that has to compose a
// picture rather than only read a table.
//
// `tests/sprites-composed-box.test.js` keeps its own copy of this seam and its header explains
// why the fixture is flat blocks at the frame's real geometry; this helper is the same setup,
// shared by the files whose subject is the *tables* a composition reads (the tall-plant flag,
// the scale cap) rather than the box convention.
//
// Two things are stubbed, and both are how the offline suite already runs:
//
//   * the game origin, so the version endpoint answers the fixture version and the atlas's
//     three files are served from `tests/fixtures/sprites/`. Everything else on that origin
//     404s, which is the state `getArtData()` and the plant bundle are already tolerated in:
//     the art tables answer their fallback copies, and this helper is what asserts those
//     copies equal the extraction of the committed chunk.
//   * `gameDataService.getPlants`, replaced with the capture the fixture and the bake table
//     were both taken from (game 1192), so a species resolution is exercised rather than an
//     empty map.
import fs from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const GAME_ORIGIN = "https://magicgarden.gg";
const FIXTURE_VERSION = "fixture-1192";
const FIXTURES = new URL("../fixtures/sprites/", import.meta.url);
const FIXTURE_FILES = new Set(["manifest.json", "sprites-composed.json", "sprites-composed.png"]);

// The real fetch, kept so a test that starts its own server can still reach it.
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
  return new Response("offline", { status: 404 });
};

export const { gameDataService } = await import("../../src/services/gameData.js");

/** The game's own plant records, captured from 1192 — the species table a composition reads. */
export const PLANTS = JSON.parse(
  await fs.readFile(new URL("../fixtures/bake/plants.json", import.meta.url), "utf8"),
);
gameDataService.getPlants = async () => PLANTS;

/** The committed atlas, as the composer receives it (one frame record per key). */
export const ATLAS = JSON.parse(await fs.readFile(new URL("sprites-composed.json", FIXTURES), "utf8"));

export const composer = await import("../../src/assets/sprites/spriteComposer.js");
export const mutationAnchor = await import("../../src/assets/sprites/mutationAnchor.js");
export const { lookupSprite } = await import("../../src/assets/sprites/sprites.js");
export const { extractArtTables } = await import("../../src/core/game/art/index.js");
export const { ATLAS_FIXTURE_DIR, artChunks, newestArtFixtureVersion } = await import("./art-fixtures.js");

/**
 * Every frame of the game's committed **1192 atlas**, keyed the way the composer is asked.
 *
 * The composition fixture above is a cut of this atlas holding only the arts a composition
 * reaches; this is the whole thing, and it is what a claim about "a path the atlas has" is
 * witnessed against — the same witness `tests/art-tables.test.js` uses for the table's own keys.
 */
export const GAME_ATLAS_FRAMES = (() => {
  const frames = {};
  for (const name of readdirSync(ATLAS_FIXTURE_DIR)) {
    if (!name.startsWith("sprites-")) continue;
    const pack = JSON.parse(readFileSync(path.join(ATLAS_FIXTURE_DIR, name), "utf8"));
    Object.assign(frames, pack.frames);
  }
  return frames;
})();

/** The newest committed cut of the game's drawing controller, and the tables it yields. */
export const ART_VERSION = newestArtFixtureVersion();
export const EXTRACTED = extractArtTables({
  chunks: artChunks(ART_VERSION),
  gameVersion: ART_VERSION,
}).tables;

/** The picture a (art, set) pair composes into, or null when the art is not in the atlas. */
export async function pictureOf(key, mutations = []) {
  const composed = await composer.composeSpriteWithBox(key, mutations);
  if (!composed) return null;
  const meta = await sharp(composed.buffer).metadata();
  return { width: meta.width, height: meta.height, box: composed.box, bytes: composed.buffer };
}

/**
 * The tall set the composer used to build, recomputed from the same records it built it from:
 * every species whose plant block says `tileTransformOrigin: "bottom"`, by the last segment of
 * its plant art. Exported so a test can measure the two readings against each other rather
 * than assert a number somebody wrote down.
 */
export function heuristicTallNames(plants = PLANTS) {
  const names = new Set();
  for (const record of Object.values(plants ?? {})) {
    const sprite = record?.plant?.sprite;
    if (record?.plant?.tileTransformOrigin !== "bottom" || typeof sprite !== "string") continue;
    const name = sprite.split("/").pop().replace(/\?.*$/, "").replace(/\.png$/i, "");
    if (name) names.add(name);
  }
  return names;
}

/** Whether that heuristic calls an art tall, keyed the way it was keyed: by the last segment. */
export function heuristicIsTall(artKey, names = heuristicTallNames()) {
  return names.has(artKey.split("/").pop());
}
