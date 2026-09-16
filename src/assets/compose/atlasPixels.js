// src/assets/compose/atlasPixels.js
//
// One sprite's pixels, from this API's own atlas — the rasteriser's raw material.
//
// `spriteComposer.js` does the same job on its own path, privately, for one picture at a time and
// with a `sharp` pipeline built around a single base art. A scene draws hundreds of layers whose
// rectangles come from `@mg.js/art` rather than from that pipeline, so the shared part — fetch and
// decode the atlas, cut a frame out, restore its trim, fall back to the Rive frames for a sprite the
// atlas no longer holds — lives here, stated once, and both paths read it from the same place.
//
// What this does **not** do is any placement or sizing: it answers pixels at the frame's own atlas
// resolution, and the caller scales them to the size the package stated.

import fs from "node:fs/promises";
import sharp from "sharp";
import { decodeKTX2, isKTX2 } from "../ktx2Decoder.js";
import { getRiveFrames, riveSpritePath } from "../sprites/riveFrames.js";
import { lookupSprite } from "../sprites/sprites.js";

/** url → a decoded atlas sharp can read from, kept for the process. */
const atlasCache = new Map();

/** `key` → the PNG buffer, at the frame's own atlas resolution. */
const spriteCache = new Map();

/** Drop both caches, for a test (or a resync) that changed the atlas underneath. */
export function clearAtlasPixelCache() {
  atlasCache.clear();
  spriteCache.clear();
}

async function atlasEntry(url) {
  if (atlasCache.has(url)) return atlasCache.get(url);
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Atlas download failed (${response.status}) for ${url}`);
  const raw = Buffer.from(await response.arrayBuffer());
  const entry = isKTX2(url)
    ? await (async () => {
        const decoded = await decodeKTX2(raw);
        return {
          sharpInput: decoded.rgba,
          sharpOptions: { raw: { width: decoded.width, height: decoded.height, channels: 4 } },
        };
      })()
    : { sharpInput: raw, sharpOptions: undefined };
  atlasCache.set(url, entry);
  return entry;
}

/**
 * One sprite as a PNG, at the resolution its own atlas frame carries.
 *
 * Returns `null` when neither the atlas nor the Rive frames hold the key: a caller skips that layer
 * rather than failing the whole picture, which is what the single-picture composer has always done
 * for an icon it cannot fetch (`doc-sprite.md` §13).
 */
export async function spritePng(key, { rotate = false } = {}) {
  const cacheKey = rotate ? `${key}|rotate` : key;
  if (spriteCache.has(cacheKey)) return spriteCache.get(cacheKey);
  const meta = lookupSprite(key);
  const found = meta === undefined ? (await rivePng(key)) : (await atlasPng(meta, rotate));
  spriteCache.set(cacheKey, found);
  return found;
}

async function atlasPng(meta, rotate) {
  if (!meta?.url || !meta.frame) return null;
  const frame = meta.frame;
  const { rotated, trimmed, spriteSourceSize, sourceSize, url } = meta;

  let entry;
  try {
    entry = await atlasEntry(url);
  } catch {
    return null;
  }

  const cropWidth = rotated ? frame.h : frame.w;
  const cropHeight = rotated ? frame.w : frame.h;
  let piece = sharp(entry.sharpInput, entry.sharpOptions)
    .extract({ left: frame.x, top: frame.y, width: cropWidth, height: cropHeight });
  // A frame the atlas packed turned is stored a quarter-turn over; the art is not.
  if (rotated) piece = piece.rotate(270);
  // The trim padding comes back, because the art's own anchor is measured against the untrimmed
  // size — `cropArtSize` and the package's `frameBox` both state that size, not the stored rect.
  if (trimmed && sourceSize?.w && sourceSize?.h && spriteSourceSize?.x != null) {
    const trim = await piece.png().toBuffer();
    const trimWidth = rotated ? cropHeight : cropWidth;
    const trimHeight = rotated ? cropWidth : cropHeight;
    const right = Math.max(0, sourceSize.w - spriteSourceSize.x - trimWidth);
    const bottom = Math.max(0, sourceSize.h - spriteSourceSize.y - trimHeight);
    piece = sharp(trim).extend({
      left: spriteSourceSize.x,
      top: spriteSourceSize.y,
      right,
      bottom,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  if (rotate) piece = piece.rotate(90, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  return piece.png().toBuffer();
}

/** The Rive frames: the sprites the atlas no longer holds, which this API exports to disk. */
async function rivePng(key) {
  const frames = await getRiveFrames();
  const meta = frames?.[key];
  if (!meta) return null;
  try {
    return await fs.readFile(riveSpritePath(meta));
  } catch {
    return null;
  }
}
