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
// opacity, in the order the game mixes it (`crop.ts`'s `washes`). How it mixes is the game's shader, a
// Pixi colour-overlay filter (`resources-D_3Zwcn-.js`, present there as both GLSL and WGSL):
//
//     vec4 c = texture(uTexture, vTextureCoord);
//     finalColor = vec4(mix(c.rgb, uColor * c.a, uAlpha), c.a);
//
// `uColor * c.a` is what a **premultiplied** filter looks like: the shader's input is a texture uploaded
// with `alphaMode: "premultiply-alpha-on-upload"` (`lib-Bxsd013j.js`), so `c.rgb` is already the colour
// times the alpha and the overlay has to be multiplied by the same alpha to stay in that space. Written
// out for straight colour `S` and alpha `a`, the shader's output is
//
//     a·[(1 − u)·S + u·uColor]   with alpha `a`
//
// so the picture it shows is a plain mix of the art's own colour and the overlay's, with the art's alpha
// untouched. That is what this file mixes. Applying the shader's literal text to *straight* pixels instead
// — the previous reading — multiplied the overlay by the pixel's alpha a second time, so the antialiased
// edge of a mutated crop kept more of its base colour than the game's edge does: at half alpha, a red
// overlay at 0.5 landed 32 of 255 short of the game's red. This replaced a CSS `color`-style luminosity
// blend — `setLum(blend, lum(base)) * a + base * (1 - a)`, the `spriteComposer.js` bake path's arithmetic
// — which meant every mutation in a composed scene was tinted by the wrong formula. The mutation
// *colours* were never in question: they come off the recipe, which read the game's `colorOverlay` table.

import sharp from "sharp";
import { spritePng } from "./atlasPixels.js";
import { materialPng } from "./materials.js";

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
 * shader's `mix(c.rgb, uColor * c.a, uAlpha)` read in the space this buffer is in: straight alpha, where
 * the same picture is `mix(base, uColor, uAlpha)` (see "The wash" above). The sprite's alpha comes back
 * untouched, which is the shader's `, c.a)`.
 */
export async function washedPng(buffer, washes) {
  const parsed = washes.map(parseWash).filter(Boolean);
  if (parsed.length === 0) return buffer;
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const { colour, alpha } of parsed) {
    for (let i = 0; i < info.width * info.height; i += 1) {
      const offset = i * info.channels;
      if (data[offset + 3] === 0) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = data[offset + channel] / 255;
        const value = base * (1 - alpha) + colour[channel] * alpha;
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

/**
 * One sprite's pixels, sampled the way the game's own sampler samples them.
 *
 * Two things here are the game's, not this file's taste, and the second one cost a detour worth recording.
 *
 * **The interpolation is premultiplied.** Every image the game loads becomes a texture with `alphaMode:
 * "premultiply-alpha-on-upload"` (`lib-Bxsd013j.js`, the image parser), i.e. WebGL's
 * `UNPACK_PREMULTIPLY_ALPHA_WEBGL`, so the sampler that scales and turns a crop interpolates colour already
 * multiplied by alpha and a transparent pixel contributes nothing. `sharp` does that itself around `resize`
 * and `rotate` (`pipeline.cc`: `shouldPremultiplyAlpha = image.has_alpha() && (shouldResize || …)`, then
 * `premultiply()` before the transform and `unpremultiply()` after) — so this file must **not** do it
 * again. It did, briefly: premultiplying by hand and unpremultiplying after sharp had already
 * unpremultiplied divided the colour by its alpha a second time, and a leaf edge of `89,169,50` came out
 * `156,255,66` — brighter than anything in the atlas. The grey rim had become a white one, and it was this
 * file's own arithmetic, not the sampler's. Lesson: `sharp`'s `premultiplied` handling is not something to
 * reimplement on top of it.
 *
 * **The interpolator is `linear`.** `sharp`'s default upsampler is cubic (`resize.js`: "when upsampling,
 * these kernels map to `nearest`, `linear` and `cubic` interpolators") — a kernel with negative lobes,
 * which overshoots at the hard edge between the art's dark outline and the transparent pixels beside it.
 * That overshoot was the grey rim itself: measured on the clover drawn at scale 3, the outermost opaque
 * ring came out `52,147,29` where the atlas' own ring is `64,152,36`, and on a synthetic 200-valued edge a
 * `lanczos3` upscale reaches 224. The game's textures are `scaleMode: "linear"` — Pixi's `TextureStyle`
 * default, the sampler every loaded image gets — which is convex: it can never produce a colour the art did
 * not have, in either direction, and at the 0.5x this atlas is halved at it is exactly the 2×2 box average
 * a mip level is.
 *
 * One transform per pipeline: with `resize` and `rotate` in the same `sharp()` chain sharp's own
 * premultiply/unpremultiply pair leaks (measured, a 25° turn after a resize reaches 152 on an art of 73),
 * so the turn is a second call on the already-resized PNG — see `turnedPlacement`.
 *
 * `washedPng` and `materialPng` are untouched by this: they read every pixel once and mix, which is
 * arithmetic rather than interpolation.
 */
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
            kernel: "linear",
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
      // A material replaces the sprite's colour, and the layout drops the washes when one is present —
      // which is the game's own rule, a material being a whole surface rather than a colour.
      const materialised =
        image === null || operation.materialKind === null
          ? image
          : await materialPng(image, operation.materialKind);
      const washed = materialised === null ? null : await washedPng(materialised, operation.washes);
      operation.input = washed;
      operation.placed = await turnedPlacement(operation, washed);
    }),
  );
  const ops = visible
    .filter((operation) => operation.placed !== null)
    .map((operation) => ({
      input: operation.placed.input,
      // Rounded, not clamped: a turned picture's own bounding box has fractional corners, so a rectangle
      // can land half a pixel outside the canvas, and `composite` clips what hangs over the edge instead
      // of moving it. Clamping to 0 slid the whole sprite inwards by that fraction — a 1 px lie about
      // where the art is, which is the sort of thing this file exists to get right.
      left: Math.round(operation.placed.left),
      top: Math.round(operation.placed.top),
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
  // No kernel to choose and no premultiplication to do: `sharp.rotate` resamples through libvips'
  // bilinear interpolator over the premultiplied pixels sharp prepared itself, which is convex — measured
  // on a 200-valued edge, a 25° turn keeps every pixel of alpha ≥ 60 within 199..200 — so a turn here is
  // already the game's sampler, while `resize`'s default is not.
  const rotated = await sharp(washed).rotate(turn, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
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
      materialKind: layer.materialKind ?? null,
      turn: turn?.turn ?? 0,
      pivot: turn?.pivot ?? null,
      input: null,
      placed: null,
    });
  }
  for (const inner of nested) collect(inner, operations, turn);
}
