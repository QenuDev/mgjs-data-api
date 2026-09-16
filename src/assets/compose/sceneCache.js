// src/assets/compose/sceneCache.js
//
// The scene cache: content-addressed, served as a file, evicted least-recently-used.
//
// ## The key
//
// The SHA-256 of the **normalised** spec, serialised canonically: object keys in sorted order,
// arrays in the order the normaliser left them, JSON with no whitespace. So item order does not
// change the key (`normalizeSpec` sorts items by id) and neither does whitespace, a differently
// spelled mutation list, or a field the spec left out and the normaliser filled in. Two requests
// that ask for the same picture are the same key, which is the whole point: the second one composes
// nothing.
//
// ## The two tiers
//
//   * a `Map` of parsed layouts, so a hit answers the JSON without touching the disk;
//   * `<key>.png` and `<key>.json` under `<config.compose.dir>/<SCENE_LAYOUT>/`, so `GET
//     /compose/<key>.png` is a file read and a CDN or a client can link the result without posting the
//     spec again. The layout segment is what makes a code change invalidate the tree; see
//     `SCENE_LAYOUT`.
//
// The disk tier is what the bound is on, because it is the tier that survives a restart. A hit
// touches the entry (its `atime`, for a tree an operator inspects) and moves it to the front of the
// `Map`; a write that takes the tree over `maxEntries` unlinks the **least recently used** entry —
// the one at the back of the map — and its layout with it. The map is rebuilt from the directory at
// the first request after boot, ordered by mtime, so a restarted instance does not delete a cache it
// simply has not read yet.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "../../config/index.js";

/**
 * The shape of the pictures this cache holds, as a path segment.
 *
 * Bumped whenever the placement or the composition changes, for the reason `cropBake.js` states about
 * `BAKE_LAYOUT`: this cache is addressed by the **spec** alone, so nothing in the key moves when the
 * code that draws the picture moves, and a tree composed under an older shape would go on answering
 * with the old picture forever — on a deployed host, long after the fix shipped.
 *
 * It was needed, and the reason is worth keeping. The tile-origin fix (`tileOrigin` in
 * `sceneLayout.js`, v1 -> v2 here) moved every item half a tile, and a host with a warm cache went on
 * serving the old scene byte for byte: three separate server processes, one of them running the fixed
 * code, answered with the same 257,999 bytes, and the only way to see the fix was to empty
 * `sprites_dump/compose` by hand. A cache that cannot be invalidated by the change that invalidates it
 * is not a cache, it is a lie with a fast path.
 *
 * v2 -> v3 is spec 2 (`src/assets/compose/spec.js`): a patch composes a **cluster** where the old code
 * drew one art on the tile, so a picture of the same spec has a different shape. The key is still the
 * spec alone — an old spec and a new one can even normalise to the same content — so without this
 * segment a host with a warm tree would go on answering v2 pictures for a v2 spec, which is now the
 * wrong picture rather than an old one.
 */
export const SCENE_LAYOUT = "v3";

/**
 * The scene tree's own directory, beside the bake under the sprite export root.
 *
 * `<root>/<SCENE_LAYOUT>/`, so a tree from an older shape is never read: the files it holds are simply
 * not where this version looks. An operator who wants the disk back can delete the older segment; the
 * cache's own bound does not count it, which is stated here because it is the one thing this
 * namespacing costs.
 */
export function cacheDirectory() {
  const root = config.compose.dir ?? path.join(config.sprites.exportDir, "compose");
  return path.join(root, SCENE_LAYOUT);
}

/** A parsed layout, or `null` — the in-memory index, most recently used last. */
const index = new Map();

/** How many times a request has *composed* a picture. The test that proves a hit reads this. */
let composed = 0;

/** The compose counter, so a test can assert a second identical spec composed nothing. */
export function composeCount() {
  return composed;
}

/** Reset the in-memory index and the counter, for a test that owns the directory. */
export function resetSceneCache() {
  index.clear();
  composed = 0;
  hydrated = null;
}

/**
 * The content key: the canonical form of the normalised spec, hashed.
 *
 * Canonical means keys sorted and no whitespace; arrays keep their order, which is why the
 * normaliser sorts the ones whose order is not meaningful.
 */
export function contentKey(spec) {
  return crypto.createHash("sha256").update(canonical(spec)).digest("hex").slice(0, 40);
}

/** JSON with object keys in sorted order, so two shapes of one value hash the same. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The two files one key owns. */
function pathsOf(key) {
  const directory = cacheDirectory();
  return { png: path.join(directory, `${key}.png`), json: path.join(directory, `${key}.json`) };
}

/** Read the tree once per process, ordered least-recently-used first. */
let hydrated = null;
async function hydrate() {
  if (hydrated !== null) return hydrated;
  const directory = cacheDirectory();
  let names = [];
  try {
    names = await fs.readdir(directory);
  } catch {
    names = [];
  }
  const entries = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const key = name.slice(0, -".json".length);
    const { png, json } = pathsOf(key);
    try {
      const [pngStat, jsonStat] = await Promise.all([fs.stat(png), fs.stat(json)]);
      entries.push({ key, png, json, used: Math.max(pngStat.mtimeMs, jsonStat.mtimeMs) });
    } catch {
      // A half-written entry (a crash between the two writes) is not one.
    }
  }
  entries.sort((left, right) => left.used - right.used);
  for (const entry of entries) index.set(entry.key, entry);
  hydrated = true;
  return hydrated;
}

/** Put one key at the front, and drop the entries past the bound. */
async function touch(key) {
  const entry = index.get(key);
  if (entry === undefined) return;
  index.delete(key);
  entry.used = Date.now();
  index.set(key, entry);
  await evict();
}

/** Unlink the least recently used entries until the tree is inside its bound. */
async function evict() {
  const bound = Math.max(1, config.compose.maxEntries);
  while (index.size > bound) {
    const [oldestKey, oldest] = index.entries().next().value;
    index.delete(oldestKey);
    await Promise.all([fs.rm(oldest.png, { force: true }), fs.rm(oldest.json, { force: true })]);
  }
}

/**
 * A cached scene, or `null` — the whole of the read path.
 *
 * Returns `{ key, png, layout }`: the file, and the layout the JSON states. A key whose JSON is
 * present but whose PNG is gone is a miss rather than a 404 with a layout, because the picture is
 * what the cache is for.
 */
export async function readScene(key) {
  await hydrate();
  const entry = index.get(key);
  if (entry !== undefined) {
    try {
      const layout = JSON.parse(await fs.readFile(entry.json, "utf8"));
      const png = await fs.readFile(entry.png);
      await touch(key);
      return { key, png, layout, source: "cache" };
    } catch {
      index.delete(key);
    }
  }
  const { png: pngPath, json: jsonPath } = pathsOf(key);
  try {
    const [layoutText, png] = await Promise.all([fs.readFile(jsonPath, "utf8"), fs.readFile(pngPath)]);
    const layout = JSON.parse(layoutText);
    index.set(key, { key, png: pngPath, json: jsonPath, used: Date.now() });
    await evict();
    return { key, png, layout, source: "disk" };
  } catch {
    return null;
  }
}

/**
 * Keep one composed scene: the picture as a file, the layout beside it, the key in the index.
 *
 * The counter is here rather than in the route so that "composed once" is measured at the one place
 * that actually composes.
 */
export async function writeScene(key, png, layout) {
  composed += 1;
  const { png: pngPath, json: jsonPath } = pathsOf(key);
  await fs.mkdir(path.dirname(pngPath), { recursive: true });
  // The layout first: a crash between the two leaves a layout with no picture, which reads as a
  // miss, where the other order would leave a picture with no layout — a scene a caller could
  // fetch but not place.
  await fs.writeFile(jsonPath, JSON.stringify(layout));
  await fs.writeFile(pngPath, png);
  index.set(key, { key, png: pngPath, json: jsonPath, used: Date.now() });
  // A key written again keeps its place at the front, and the oldest files go.
  const entry = index.get(key);
  index.delete(key);
  index.set(key, entry);
  await evict();
  return { key, png, layout, source: "composed" };
}

/** The keys the tree holds, least recently used first — what the eviction test asserts on. */
export async function cachedKeys() {
  await hydrate();
  return [...index.keys()];
}

/** Where one key's picture lives, so a route can serve the file itself. */
export function scenePath(key) {
  return pathsOf(key).png;
}
