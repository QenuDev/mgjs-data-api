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
// `@mg.js/art`'s recipe states a crop's wash as `rgba(r, g, b, a)` — the game's own filter colour and its
// opacity, in the order the game mixes it (`crop.ts`'s `washes`). How it mixes is the game's shader, and
// this file runs the shader's own two lines rather than an approximation of them (`resources-D_3Zwcn-.js`,
// the `ColorOverlayFilter` fragment shader, present there as both GLSL and WGSL):
//
//     vec4 c = texture(uTexture, vTextureCoord);
//     finalColor = vec4(mix(c.rgb, uColor * c.a, uAlpha), c.a);
//
// Read exactly: the overlay colour is **multiplied by the sprite's own alpha** before the mix, so a
// semi-transparent edge darkens toward the colour rather than merely blending with it, and the sprite's
// alpha comes back unchanged. This used to run a CSS `color`-style luminosity blend —
// `setLum(blend, lum(base)) * a + base * (1 - a)`, the `spriteComposer.js` bake path's arithmetic — which
// meant every mutation in a composed scene was tinted by the wrong formula. The mutation *colours* were
// never in question: they come off the recipe, which read the game's `colorOverlay` table.

import sharp from "sharp";
import { spritePng } from "./atlasPixels.js";

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
 * One sprite's pixels with the game's overlay filter mixed in, in place of its own colour.
 *
 * The washes are applied in the order the recipe states, each one onto the result of the last, which is
 * the order the game mixes the group it washes last (`crop.ts`'s `washesOf`) — and the arithmetic is the
 * shader's own `mix(c.rgb, uColor * c.a, uAlpha)`, with the sprite's alpha returned unchanged.
 */
export async function washedPng(buffer, washes) {
  const parsed = washes.map(parseWash).filter(Boolean);
  if (parsed.length === 0) return buffer;
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const { colour, alpha } of parsed) {
    for (let i = 0; i < info.width * info.height; i += 1) {
      const offset = i * info.channels;
      const pixelAlpha = data[offset + 3] / 255;
      if (pixelAlpha === 0) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = data[offset + channel] / 255;
        const overlay = colour[channel] * pixelAlpha;
        const value = base * (1 - alpha) + overlay * alpha;
        data[offset + channel] = Math.max(0, Math.min(255, Math.round(value * 255)));
      }
      // The fourth channel is the sprite's own alpha, and the shader hands it back untouched.
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
  const visible = operations.filter((operation) => {
    const box = turnedBox(operation);
    return box.left + box.width > 0 && box.top + box.height > 0 && box.left < width && box.top < height;
  });
  await Promise.all(
    visible.map(async (operation) => {
      const image = await sizedPng(operation.sprite, operation.width, operation.height);
      const washed = image === null ? null : await washedPng(image, operation.washes);
      operation.input = washed;
      operation.placed = await turnedPlacement(operation, washed);
    }),
  );
  const ops = visible
    .filter((operation) => operation.placed !== null)
    .map((operation) => ({
      input: operation.placed.input,
      left: Math.max(0, Math.round(operation.placed.left)),
      top: Math.max(0, Math.round(operation.placed.top)),
    }));

  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(ops)
    .png()
    .toBuffer();
}

/**
 * The turned sprite, and where its canvas goes.
 *
 * The game places a crop with `i.position.set(n.xPixels, n.yPixels); i.angle = n.rotationDegrees`, i.e.
 * the crop's **container** is turned about the point the crop stands on, and the art turns with it. A
 * layer here is a sprite in a rectangle, so the turn is a rotation of that sprite about the same pivot:
 * `sharp.rotate` turns the image about its own centre (clockwise for a positive angle, the same direction
 * Pixi's `angle` turns on a y-down canvas), and the centre is then placed where the turn puts it.
 */
async function turnedPlacement(operation, washed) {
  if (washed === null) return null;
  const { turn, pivot } = operation;
  if (!turn || pivot === null || pivot === undefined) {
    return { input: washed, left: operation.left, top: operation.top };
  }
  const rotated = await sharp(washed)
    .rotate(turn, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const meta = await sharp(rotated).metadata();
  const radians = (turn * Math.PI) / 180;
  const centre = { x: operation.left + operation.width / 2, y: operation.top + operation.height / 2 };
  const dx = centre.x - pivot.x;
  const dy = centre.y - pivot.y;
  return {
    input: rotated,
    left: pivot.x + dx * Math.cos(radians) - dy * Math.sin(radians) - meta.width / 2,
    top: pivot.y + dx * Math.sin(radians) + dy * Math.cos(radians) - meta.height / 2,
  };
}

/** The rectangle a turned operation covers, for the cheap off-canvas test before any pixels are read. */
function turnedBox(operation) {
  const { turn, pivot } = operation;
  if (!turn || pivot === null || pivot === undefined) {
    return { left: operation.left, top: operation.top, width: operation.width, height: operation.height };
  }
  const radians = (turn * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const half = { x: operation.width / 2, y: operation.height / 2 };
  const centre = { x: operation.left + half.x, y: operation.top + half.y };
  const dx = centre.x - pivot.x;
  const dy = centre.y - pivot.y;
  const turned = { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  // A rotated rectangle's axis-aligned box: the half-extents of |w cos| + |h sin|, |w sin| + |h cos|.
  const width = Math.abs(operation.width * cos) + Math.abs(operation.height * sin);
  const height = Math.abs(operation.width * sin) + Math.abs(operation.height * cos);
  return { left: turned.x - width / 2, top: turned.y - height / 2, width, height };
}

/** Flatten a layer and its nested picture into one list of draw operations, in draw order.
 *
 * A layer that carries a nested picture is a crop's **frame** — the rectangle its picture hangs on, and
 * not a thing to draw. Pushing the frame's own sprite as well put every sprig of every patch, and every
 * crop in a pot, onto the canvas twice: the same art at the same rectangle, so each anti-aliased edge
 * composited twice into a grey fringe, and the picture layer's mutation colour was diluted by an unwashed
 * copy of the same art underneath it. `kind: "crop"` has no nested picture, which is why bare crops looked
 * clean while patch sprigs did not.
 *
 * A crop's **turn** and the point it stands on belong to the frame and are inherited by every layer of the
 * picture: turning each of them about the same pivot is the same as turning the picture, which is what the
 * game does to the whole container.
 */
function collect(layer, operations, inherited = null) {
  const turn = layer.turn ? { turn: layer.turn, pivot: layer.pivot ?? null } : inherited;
  const nested = layer.nested ?? [];
  if (nested.length === 0) {
    operations.push({
      sprite: layer.sprite,
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      washes: layer.material === true ? [] : (layer.washes ?? []),
      turn: turn?.turn ?? 0,
      pivot: turn?.pivot ?? null,
      input: null,
      placed: null,
    });
  }
  for (const inner of nested) collect(inner, operations, turn);
}
