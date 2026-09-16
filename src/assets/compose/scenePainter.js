// src/assets/compose/scenePainter.js
//
// The rasteriser: rectangles in, one PNG out.
//
// ## What it draws, and what it does not decide
//
// Every rectangle and every sprite path comes from `sceneLayout.js`, which got them from
// `@mg.js/art`. This file decides nothing about placement, size or order: it scales a sprite to the
// rectangle it was handed, draws it there, and moves on. The one thing it owns is the *pixel* work —
// a missing sprite is skipped (the single-picture composer has always done that, `doc-sprite.md`
// §13), a sprite is drawn at the frame's own ratio so a 2x atlas lands in the 1x rectangle the
// package stated, and a wash mixes the game's own colour into the art's pixels instead of covering
// it.
//
// ## The wash
//
// `@mg.js/art`'s recipe states a crop's wash as `rgba(r, g, b, a)` — the game's own filter colour, in
// the order the game mixes it (`crop.ts`'s `washes`). How it mixes is the game's shader and the
// single-picture composer's pixel loop: `setLuminosity(blend, luminosity(base)) * alpha + base *
// (1 − alpha)`, the CSS `color` blend. That loop is `.logs`-documented in `spriteComposer.js`'s
// `blendColorHSL`, and the arithmetic is repeated here because a scene draws from a different source
// (a PNG per layer rather than one decoded base) — one filter, one formula, and the same numbers.
// The mutation *colours* are not repeated: they come off the recipe, which read them from the game's
// table, so a mutation the game moves moves here too.

import sharp from "sharp";
import { spritePng } from "./atlasPixels.js";

/** The reference white the CSS `color` blend measures luminosity against. */
const LUMINANCE = { r: 0.2126, g: 0.7152, b: 0.0722 };

const luminance = (r, g, b) => LUMINANCE.r * r + LUMINANCE.g * g + LUMINANCE.b * b;

/** Keep a colour inside [0, 1] after the luminosity shift, the way the shader's `clipColor` does. */
function clipped(r, g, b) {
  const l = luminance(r, g, b);
  const low = Math.min(r, g, b);
  const high = Math.max(r, g, b);
  let out = [r, g, b];
  if (low < 0) {
    const f = l / (l - low);
    out = [l + (out[0] - l) * f, l + (out[1] - l) * f, l + (out[2] - l) * f];
  }
  if (high > 1) {
    const f = (1 - l) / (high - l);
    out = [l + (out[0] - l) * f, l + (out[1] - l) * f, l + (out[2] - l) * f];
  }
  return out;
}

/** One colour, at the luminosity of another: the shader's `setLum`. */
function withLuminosity(colour, target) {
  const l = luminance(colour[0], colour[1], colour[2]);
  const d = target - l;
  return clipped(colour[0] + d, colour[1] + d, colour[2] + d);
}

/** A wash as its three numbers and its opacity, from `rgba(r, g, b, a)`. */
function parseWash(wash) {
  const parts = String(wash).match(/[0-9.]+/g);
  if (parts === null || parts.length < 3) return null;
  const [r, g, b] = parts.map(Number);
  const a = parts.length > 3 ? Number(parts[3]) : 1;
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return { colour: [r / 255, g / 255, b / 255], alpha: a };
}

/**
 * One sprite's pixels with the game's washes mixed in, in place of its own colour.
 *
 * The washes are applied in the order the recipe states, each one onto the result of the last, which
 * is the order the game mixes the group it washes last (`crop.ts`'s `washesOf`).
 */
export async function washedPng(buffer, washes) {
  const parsed = washes.map(parseWash).filter(Boolean);
  if (parsed.length === 0) return buffer;
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const { colour, alpha } of parsed) {
    for (let i = 0; i < info.width * info.height; i += 1) {
      const offset = i * info.channels;
      const a = data[offset + 3] / 255;
      if (a === 0) continue;
      const base = [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255];
      const blended = withLuminosity(colour, luminance(base[0], base[1], base[2]));
      for (let channel = 0; channel < 3; channel += 1) {
        const value = blended[channel] * alpha + base[channel] * (1 - alpha);
        data[offset + channel] = Math.max(0, Math.min(255, Math.round(value * 255)));
      }
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer();
}

/** A sprite drawn at one size, memoised: a scene repeats the same art on many tiles. */
const sized = new Map();

async function sizedPng(sprite, width, height) {
  const key = `${sprite}|${width}x${height}`;
  if (sized.has(key)) return sized.get(key);
  const source = await spritePng(sprite);
  const scaled =
    source === null
      ? null
      : await sharp(source)
          .resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), {
            fit: "fill",
            kernel: "lanczos3",
          })
          .png()
          .toBuffer();
  sized.set(key, scaled);
  return scaled;
}

/** Drop the rasteriser's own caches, for a test that changed the atlas underneath. */
export function clearScenePainterCache() {
  sized.clear();
}

/** Every layer of a scene, drawn in order onto one transparent canvas.
 *
 * `layers` are in picture coordinates, which is what `sceneLayout.js` hands over; a layer with a
 * `nested` list is a crop's own picture, drawn inside the same canvas at the rectangle its own
 * layers already state. Negative coordinates are dropped rather than moved: the canvas is the union
 * of these very rectangles, so nothing is outside it by construction.
 */
export async function paintScene({ width, height, layers }) {
  const operations = [];
  for (const layer of layers) collect(layer, operations);
  const visible = operations.filter(
    (operation) =>
      operation.left + operation.width > 0 &&
      operation.top + operation.height > 0 &&
      operation.left < width &&
      operation.top < height,
  );
  await Promise.all(
    visible.map(async (operation) => {
      const image = await sizedPng(operation.sprite, operation.width, operation.height);
      operation.input = image === null ? null : await washedPng(image, operation.washes);
    }),
  );
  const ops = visible
    .filter((operation) => operation.input !== null)
    .map((operation) => ({
      input: operation.input,
      left: Math.max(0, Math.round(operation.left)),
      top: Math.max(0, Math.round(operation.top)),
    }));

  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(ops)
    .png()
    .toBuffer();
}

/** Flatten a layer and its nested picture into one list of draw operations, in draw order. */
function collect(layer, operations) {
  operations.push({
    sprite: layer.sprite,
    left: layer.left,
    top: layer.top,
    width: layer.width,
    height: layer.height,
    washes: layer.material === true ? [] : (layer.washes ?? []),
    input: null,
  });
  for (const inner of layer.nested ?? []) collect(inner, operations);
}
