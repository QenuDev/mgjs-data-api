// src/assets/sprites/cropBake.js
//
// The opt-in crop bake (docs/mgjs-community-api-plan.md §3.1, §6 work items 4 and 5).
//
// `BAKE=1` renders every *crop type* wearing each of its reachable mutation sets to a
// file, and publishes a manifest of what exists. Off by default: with the flag off this
// module never touches the disk, and a request composites the frames the sprite export
// already wrote.
//
// Three properties are the whole point, and each one is a mistake the code could make:
//
//   * **Crops, never plants.** A crop type is one art — the patch art when the plant is
//     single-harvest, its crop art otherwise (the same rule `tests/fixtures/sprites/
//     capture.mjs` uses to freeze the dimensions). A plant picture is the pot, the
//     platform, the body, its crops and the celestial layers, so its space is 90^slots
//     rather than 90. Nothing here ever composes a plant.
//   * **The enumeration comes from the data.** The mutation categories are read from each
//     mutation's own `group` field and the sets are the product of (category size + 1),
//     so a new mutation in a new version widens the bake with no code change. The crop
//     types come from the plant records, filtered to the arts the atlas can actually
//     compose.
//   * **The manifest is the record of what is on disk.** It is written inside the version
//     directory first, then swapped into place with a `rename` — the only write to the
//     published path — so a half-baked version is never advertised and the previous one
//     keeps serving until the swap.
//
// A set the bake did not produce is composed on demand by `resolveComposedSprite` and
// persisted under the same naming scheme, which is what makes a gap one slow request
// rather than a 404.
//
// ## No geometry in the manifest, deliberately
//
// The manifest names each picture's file and its byte count, and states **no box**. The box
// convention is under correction — the game draws a crop's mutation art into the union of the
// art and its layers, not clipped to the crop's own frame (`./cropBox.js` records the
// evidence, plan item 24 owns the fix) — and a box written here under the current, clamped
// composer would assert the degenerate `0,0,width,height` for every one of the pictures. So
// the box is left out rather than frozen wrong, a request's box comes from the composer that
// owns the convention, and item 24 adds the union box plus the art's rectangle inside it in
// one place.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";
import { gameDataService } from "../../services/gameData.js";
import { loadStoredVersion } from "../../core/game/versionStorage.js";
import { initSprites, lookupSprite } from "./sprites.js";

/** The manifest's own shape version, so a consumer can refuse one it does not know. */
export const BAKE_FORMAT = "mg-crop-bake/1";

/**
 * The shape of the *pictures*, as a path segment: `<root>/<layout>/<game-version>/crops/…`.
 *
 * Bump this whenever a baked picture's geometry or the manifest's shape changes, and bump
 * `BAKE_FORMAT` with it. The tree is namespaced by it so a tree baked under an older shape is
 * never *reused and never served*: `readPublishedManifest` refuses a manifest whose layout is
 * not this one, which makes the host compose — correct pictures — until the re-bake publishes,
 * and makes the re-bake render everything instead of resuming an old tree's files.
 *
 * This is what keeps the box convention a one-edit change. The game version alone is not
 * enough: a change to the composer (plan item 24 corrects the box from the clamped crop frame
 * to the union of the art and its layers) changes every picture while the game version stays
 * put, and reusing those files would serve the old geometry under the new boxes.
 */
export const BAKE_LAYOUT = "v1";

/** True when the operator asked for a bake (`BAKE=1`). */
export function isBakeEnabled() {
  return config.bake.enabled === true;
}

/**
 * Where baked pictures live: `BAKE_DIR`, or `baked/` beside the exported sprites so one
 * volume holds everything an operator has to persist.
 */
export function bakeRoot() {
  return config.bake.dir
    ? path.resolve(config.bake.dir)
    : path.join(path.resolve(config.sprites.exportDir), "baked");
}

// ─── The enumeration ──────────────────────────────────────────────────────────

/**
 * The canonical key of a mutation set: deduplicated and sorted, so `Wet,Dawnlit` and
 * `Dawnlit,Wet` are one set. The empty string is the crop wearing nothing.
 */
export function canonicalSet(mutationIds) {
  return [...new Set((mutationIds ?? []).map(String))].sort().join("+");
}

/**
 * The game's mutation categories, read from each mutation's `group` field.
 *
 * A mutation the data does not group is left out rather than guessed into one: the product
 * below would otherwise invent a category, and a set wearing it is composed on demand.
 */
export function groupMutations(mutations) {
  const groups = new Map();
  for (const [id, record] of Object.entries(mutations ?? {})) {
    const group = record?.group;
    if (typeof group !== "string" || group.length === 0) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(id);
  }
  for (const members of groups.values()) members.sort();
  return groups;
}

/**
 * Every set a crop can wear: one choice per category, including "none". A plant wears at
 * most one mutation from each category, so no set holds two from the same one.
 *
 * Each set comes back canonical — sorted and deduplicated — so what the enumeration emits
 * is already the key the manifest is written under. (The composer sorts again by its own
 * order before drawing; the order here is a name for the set, not a render instruction.)
 */
export function enumerateMutationSets(mutations) {
  let sets = [[]];
  for (const members of groupMutations(mutations).values()) {
    const next = [];
    for (const set of sets) {
      next.push(set);
      for (const id of members) next.push([...set, id].sort());
    }
    sets = next;
  }
  return sets;
}

/**
 * The crop types: one art per species, and it is the art the game draws that species'
 * mutations on — the patch art when the plant is single-harvest, its crop art otherwise.
 *
 * A species whose art the atlas does not have is skipped: baking it would write a picture
 * the composer cannot produce. `plants` is injectable so a test can enumerate a subset
 * without the game.
 */
export async function enumerateCropTypes({ plants } = {}) {
  const records = plants ?? (await gameDataService.getPlants());
  await initSprites();

  const types = [];
  for (const [species, record] of Object.entries(records ?? {})) {
    const artKey =
      record?.plant?.harvestType === "Single" ? record?.plant?.sprite : record?.crop?.sprite;
    if (!artKey) continue;
    if (!lookupSprite(artKey)) continue;
    types.push({ species, artKey });
  }
  return types;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

/** A filesystem-safe path segment. Species names are alphanumeric; this is the guard. */
function safeSegment(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, "_") || "unnamed";
}

/**
 * The path of one picture, relative to the bake root, POSIX-separated.
 *
 * `bare.png` is the crop wearing nothing; a set is its canonical ids joined with `_`. The
 * file name is opaque — a consumer resolves a URL out of the manifest, it never constructs
 * one from the set.
 */
function relativePicture(version, species, canonical) {
  const file = canonical ? `${safeSegment(canonical.split("+").join("_"))}.png` : "bare.png";
  return [BAKE_LAYOUT, String(version), "crops", safeSegment(species), file].join("/");
}

function picturePath(root, relative) {
  return path.join(root, ...relative.split("/"));
}

// ─── The manifest ─────────────────────────────────────────────────────────────

// Published manifests, cached by inode: a swap writes a new file and renames it into
// place, so the inode changes exactly when the content may have. Without this the composed
// route would parse a ~1 MB document on every request.
let manifestCache = { file: null, ino: null, size: -1, mtimeMs: -1, value: null, byArt: null };

export function clearBakeCache() {
  manifestCache = { file: null, ino: null, size: -1, mtimeMs: -1, value: null, byArt: null };
}

/**
 * The published manifest, or null when there is none.
 *
 * Null too when the one on disk does not parse, or when it was baked under a different
 * `BAKE_LAYOUT`: a torn document is worse than nothing, and a tree whose pictures have the
 * old shape must never be served (nor resumed) as if it were this one's.
 */
export async function readPublishedManifest({ root } = {}) {
  const dir = root ? path.resolve(root) : bakeRoot();
  const file = path.join(dir, "manifest.json");

  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    manifestCache = { file, ino: null, size: -1, mtimeMs: -1, value: null, byArt: null };
    return null;
  }

  if (
    manifestCache.file === file &&
    manifestCache.ino === stat.ino &&
    manifestCache.size === stat.size &&
    manifestCache.mtimeMs === stat.mtimeMs
  ) {
    return manifestCache.value;
  }

  let value = null;
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (parsed?.layout === BAKE_LAYOUT) {
      value = parsed;
    } else {
      logger.warn(
        { file, layout: parsed?.layout ?? null, wanted: BAKE_LAYOUT },
        "Bake manifest is for another picture layout, refusing it",
      );
    }
  } catch (err) {
    logger.error({ error: err?.message || String(err), file }, "Bake manifest is unreadable");
  }

  const byArt = new Map();
  for (const [species, entry] of Object.entries(value?.crops ?? {})) {
    if (entry?.art) byArt.set(entry.art, { ...entry, species });
  }

  manifestCache = { file, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, value, byArt };
  return value;
}

/**
 * The atomic swap: write the document to a temp file in the destination directory, then
 * `rename` it over the published path. Nothing else ever writes that path, so a reader
 * sees either the whole previous manifest or the whole new one.
 */
export async function publishManifest(manifest, { root } = {}) {
  const dir = root ? path.resolve(root) : bakeRoot();
  await fs.mkdir(dir, { recursive: true });

  const published = path.join(dir, "manifest.json");
  const temp = path.join(dir, `.manifest.json.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temp, JSON.stringify(manifest) + "\n");
  await fs.rename(temp, published);
  return published;
}

// ─── Serving the bake ─────────────────────────────────────────────────────────

/**
 * The baked file for a crop art wearing a set, or null.
 *
 * Null when the bake is off, when there is no manifest, when the art is not a crop type
 * this bake enumerated, when the set was not produced, or when the file the manifest names
 * is missing — every one of which leaves the caller to compose it, which is what keeps
 * correctness independent of the bake.
 *
 * No box: the manifest states no geometry (see the header), so the caller takes the box from
 * the composer that owns the convention.
 */
export async function lookupBaked(baseKey, mutationIds = []) {
  if (!isBakeEnabled()) return null;

  const manifest = await readPublishedManifest();
  if (!manifest?.crops) return null;

  const entry = manifestCache.byArt?.get(baseKey);
  if (!entry) return null;

  const canonical = canonicalSet(mutationIds);
  const picture = entry.sets?.[canonical];
  if (!picture?.file) return null;

  const root = bakeRoot();
  const file = picturePath(root, picture.file);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size === 0) return null;

  return {
    file,
    bytes: stat.size,
    mutations: canonical ? canonical.split("+") : [],
    species: entry.species,
    art: entry.art,
    gameVersion: manifest.gameVersion,
  };
}

// Serialises the manifest's read-modify-write, one on-demand picture at a time.
let persistQueue = Promise.resolve();

/**
 * Persist a picture the bake did not produce, under the same naming scheme, and add it to
 * the published manifest — the plan's "a miss is a cold request rather than a 404".
 *
 * Returns false, writing nothing, when the bake is off, when the art is not a crop type
 * this bake enumerated (there is no species name to record, and naming one would be
 * inventing a game value), or when the manifest is for a different game version than the
 * atlas this picture was composed from (mixing versions in one tree would make the
 * manifest's `gameVersion` a lie).
 *
 * The read-modify-write of the manifest is serialised in-process: two requests that miss at
 * the same moment must not each publish a manifest that lacks the other's picture.
 */
export function persistComposed(baseKey, mutationIds = [], composed) {
  persistQueue = persistQueue.then(
    () => persistComposedNow(baseKey, mutationIds, composed),
    () => persistComposedNow(baseKey, mutationIds, composed),
  );
  return persistQueue;
}

async function persistComposedNow(baseKey, mutationIds, composed) {
  if (!isBakeEnabled()) return false;
  if (!composed?.buffer) return false;

  const manifest = await readPublishedManifest();
  if (!manifest?.crops) return false;

  const entry = manifestCache.byArt?.get(baseKey);
  if (!entry?.species) return false;

  const stored = await loadStoredVersion();
  if (stored && String(stored) !== String(manifest.gameVersion)) return false;

  const canonical = canonicalSet(mutationIds);
  const root = bakeRoot();
  const relative = relativePicture(manifest.gameVersion, entry.species, canonical);
  const dest = picturePath(root, relative);

  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, composed.buffer);

  entry.sets[canonical] = { file: relative, bytes: composed.buffer.length };
  manifest.crops[entry.species] = { art: entry.art, sets: entry.sets };
  manifest.pictures = countPictures(manifest);
  manifest.bytes = countBytes(manifest);

  await publishManifest(manifest);
  return true;
}

function countPictures(manifest) {
  let n = 0;
  for (const entry of Object.values(manifest.crops ?? {})) n += Object.keys(entry.sets ?? {}).length;
  return n;
}

function countBytes(manifest) {
  let n = 0;
  for (const entry of Object.values(manifest.crops ?? {})) {
    for (const picture of Object.values(entry.sets ?? {})) n += picture?.bytes ?? 0;
  }
  return n;
}

// ─── The bake ─────────────────────────────────────────────────────────────────

/**
 * A picture that is already on disk: its byte count, or null when the file is not a picture
 * after all.
 *
 * Only decodability and size are checked, because that is all the manifest records — no
 * geometry, so nothing here has to know the box convention. A file that does not decode (a
 * write the process did not finish) is not a picture, which is what makes a resumed bake heal
 * a torn file instead of advertising it.
 */
async function existingPicture(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size === 0) return null;
    const meta = await sharp(file).metadata();
    if (!meta.width || !meta.height) return null;
    return { bytes: stat.size };
  } catch {
    return null;
  }
}

/**
 * Bake every crop type over every reachable set for one game version, then publish.
 *
 * Flag-gated: with `BAKE=1` unset this returns `{ skipped: true, reason: "disabled" }`
 * without reading, writing or composing anything. It is resumable — a run killed partway
 * leaves its pictures in `<root>/<layout>/<version>/` and the retry reuses every one that
 * decodes —
 * and it publishes only after the last picture is on disk.
 *
 * `compose` is injectable; the default is the real composer, imported lazily so this module
 * and the composer do not form a load-time cycle.
 */
export async function bakeCrops({
  gameVersion,
  compose = null,
  force = false,
  root = null,
  log = logger,
} = {}) {
  if (!isBakeEnabled()) return { skipped: true, reason: "disabled" };

  const version = String(gameVersion ?? "").trim();
  if (!version) throw new Error("bakeCrops needs the game version its files belong to");

  const dir = root ? path.resolve(root) : bakeRoot();
  const composeFn = compose ?? (await import("./spriteComposer.js")).composeSpriteWithBox;

  const published = await readPublishedManifest({ root: dir });
  if (!force && published?.gameVersion === version && Object.keys(published.crops ?? {}).length > 0) {
    return {
      skipped: true,
      reason: "already_baked",
      gameVersion: version,
      pictures: published.pictures ?? countPictures(published),
      root: dir,
    };
  }

  const cropTypes = await enumerateCropTypes();
  if (cropTypes.length === 0) {
    log.warn("Crop bake: the plant data names no crop type the atlas can compose, baking nothing");
    return { skipped: true, reason: "no_crop_types" };
  }

  const mutations = await gameDataService.getMutations();
  const sets = enumerateMutationSets(mutations);
  const groups = groupMutations(mutations);
  if (groups.size === 0) {
    // The bake would write the bare crop once per type and nothing else. That is worth
    // saying out loud: it is what a mutation table the extractor could no longer read
    // looks like, and every mutated set would then be a cold request.
    log.warn({ gameVersion: version }, "Crop bake: no mutation group in the table, baking bare crops only");
  }

  const manifest = {
    format: BAKE_FORMAT,
    layout: BAKE_LAYOUT,
    gameVersion: version,
    generatedAt: null, // set once the pictures exist, immediately before the swap
    mutationGroups: Object.fromEntries(groups),
    setsPerCropType: sets.length,
    cropTypes: cropTypes.length,
    pictures: 0,
    bytes: 0,
    crops: {},
  };

  const startedAt = Date.now();
  let rendered = 0;
  let resumed = 0;

  for (const { species, artKey } of cropTypes) {
    const entry = { art: artKey, sets: {} };

    for (const set of sets) {
      const canonical = canonicalSet(set);
      const relative = relativePicture(version, species, canonical);
      const dest = picturePath(dir, relative);

      const existing = await existingPicture(dest);
      let bytes;

      if (existing) {
        bytes = existing.bytes;
        resumed++;
      } else {
        const composed = await composeFn(artKey, set);
        if (!composed?.buffer) {
          throw new Error(`The composer produced nothing for ${artKey} [${canonical || "bare"}]`);
        }
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, composed.buffer);
        bytes = composed.buffer.length;
        rendered++;
      }

      // `file` and `bytes` only: no geometry (see the header — the box convention is under
      // correction, and item 24 adds it here in one place).
      entry.sets[canonical] = { file: relative, bytes };
      manifest.pictures++;
      manifest.bytes += bytes;

      if (manifest.pictures % 250 === 0) {
        log.info(
          {
            progress: manifest.pictures,
            total: cropTypes.length * sets.length,
            rendered,
            resumed,
            elapsedMs: Date.now() - startedAt,
          },
          "Crop bake progress",
        );
      }
    }

    manifest.crops[species] = entry;
  }

  // The record of this version, written inside its own directory, then the swap. A crash
  // between the two leaves the previous manifest published and this run resumable.
  manifest.generatedAt = new Date().toISOString();
  await writeVersionManifest(dir, version, manifest);
  await publishManifest(manifest, { root: dir });

  const summary = {
    gameVersion: version,
    layout: BAKE_LAYOUT,
    root: dir,
    dir: path.join(dir, BAKE_LAYOUT, version),
    cropTypes: cropTypes.length,
    setsPerCropType: sets.length,
    pictures: manifest.pictures,
    rendered,
    resumed,
    bytes: manifest.bytes,
    elapsedMs: Date.now() - startedAt,
    manifestFile: path.join(dir, "manifest.json"),
  };

  log.info(
    {
      gameVersion: version,
      cropTypes: summary.cropTypes,
      setsPerCropType: summary.setsPerCropType,
      pictures: summary.pictures,
      rendered: summary.rendered,
      resumed: summary.resumed,
      bytes: summary.bytes,
      elapsedMs: summary.elapsedMs,
    },
    "Crop bake complete",
  );

  return summary;
}

async function writeVersionManifest(root, version, manifest) {
  const versionDir = path.join(root, BAKE_LAYOUT, String(version));
  await fs.mkdir(versionDir, { recursive: true });
  const temp = path.join(versionDir, ".manifest.json.tmp");
  await fs.writeFile(temp, JSON.stringify(manifest) + "\n");
  await fs.rename(temp, path.join(versionDir, "manifest.json"));
}
