// src/assets/compose/materials.js
//
// The two mutation **materials**: Rainbow and Gold.
//
// In the game's mutation table both are literally empty — `{Rainbow: {}, Gold: {}, Wet: {colorOverlay: …}}`
// — so they are not washes and never were. They are shaders, in `quinoaAssetResolver-CVtuXws2.js`, and the
// game picks one by name:
//
//     var q = { None: 0, Inherit: 3, Rainbow: 2, Gold: 1 }, vn = { Crop: 40, TallPlant: -90 };
//     function yn(e) { if (e.includes(`Rainbow`)) return `Rainbow`; if (e.includes(`Gold`)) return `Gold`; }
//
// and, because a material is a whole surface treatment rather than a colour, it **suppresses** the colour
// overlay: `Cn`'s loop only takes `e.colorOverlay` while `r === xe.None`, i.e. while there is no material.
// So a crop wearing Rainbow is not washed *and* rainbow; it is rainbow.
//
// ## Rainbow
//
//     materialColor = apply_rainbow_material(baseRGB, vMaterialCoord, vMaterialData, 1.0, 1.0, 0.0, 1.0);
//
// `vMaterialData` is `(cos(angle), sin(angle))` with `angle = vn.Crop = 40` degrees (`-90` for a tall
// plant), and the call passes `aspect = 1`, `squish = 1`, `flipX = 0`, `materialAlpha = 1`. With those the
// shader's body reduces to
//
//     float t = clamp(dot(axis, materialCoord - 0.5) + 0.5, 0.0, 1.0);
//     half3 rainbow = surface_rainbow_set_luminosity(surface_rainbow_color(t), surface_material_luma(baseColor));
//     return mix(baseColor, rainbow, make_half(materialAlpha));            // == rainbow, alpha 1
//
// i.e. the art's colour is **replaced** by a six-stop gradient sampled along a 40-degree axis, at the
// art's own luminosity — the game's luminosity, `dot(colour, (0.3, 0.59, 0.11))`, which is not the CSS
// weighting the overlay filter's `setLum` would have used.
//
// ## Gold
//
//     materialColor = apply_gold_material(baseRGB, vMaterialCoord, uTime);
//
// and the shader says of that time: *"Negative time requests the stable material used by baked
// thumbnails."* A composed scene **is** a baked picture, so this API asks for `timeSeconds = -1` and takes
// the stable branch. The travelling glint (`fract(timeSeconds / 3.0)`, a 1.5-second sweep with an equally
// long quiet interval) is deliberately not implemented: there is no still picture that is more the game's
// for having a sweep frozen at an arbitrary phase, and nothing in this API's surface could ask for one.
//
// `materialCoord` is the fragment's coordinate inside the sprite's own quad, 0..1 across it, which for a
// layer drawn from one frame is `((x + 0.5) / width, (y + 0.5) / height)`.

import sharp from "sharp";

/** The game's own luminosity for a material: `surface_material_luma`, `dot(color, (0.3, 0.59, 0.11))`. */
const LUMA = [0.3, 0.59, 0.11];

const luma = (colour) => LUMA[0] * colour[0] + LUMA[1] * colour[1] + LUMA[2] * colour[2];

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

const mix = (from, to, weight) => from.map((channel, index) => channel + (to[index] - channel) * weight);

/** GLSL's `smoothstep(e0, e1, x)`. */
function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** The six stops of the game's original Rainbow filter, in the order the mix chain applies them. */
const RAINBOW_STOPS = [
  [1.0, 0.09, 0.267],
  [1.0, 0.569, 0.0],
  [1.0, 0.918, 0.0],
  [0.0, 0.902, 0.463],
  [0.161, 0.475, 1.0],
  [0.835, 0.0, 0.976],
];

/** `surface_rainbow_color(t)`: the branchless mix chain the comment there asks callers to keep. */
function rainbowColour(t) {
  const segment = clamp(t) * 5;
  let colour = RAINBOW_STOPS[0];
  for (let index = 1; index < RAINBOW_STOPS.length; index += 1) {
    colour = mix(colour, RAINBOW_STOPS[index], clamp(segment - (index - 1)));
  }
  return colour;
}

/** `surface_rainbow_clip_color`: keep a colour inside [0, 1] after the luminosity shift, the way it does. */
function clipColour(colour) {
  const luminosity = luma(colour);
  const minimum = Math.min(...colour);
  const maximum = Math.max(...colour);
  let out = colour;
  if (minimum < 0) out = out.map((channel) => luminosity + ((channel - luminosity) * luminosity) / (luminosity - minimum));
  if (maximum > 1) out = out.map((channel) => luminosity + ((channel - luminosity) * (1 - luminosity)) / (maximum - luminosity));
  return out;
}

/** `surface_rainbow_set_luminosity(colour, target)`: the gradient at the art's own luminosity. */
function setLuminosity(colour, target) {
  const delta = target - luma(colour);
  return clipColour(colour.map((channel) => channel + delta));
}

const GOLD = {
  shadow: [0.54, 0.34, 0.003],
  rich: [0.98, 0.69, 0.008],
  yellow: [1.0, 0.86, 0.055],
  reflected: [1.0, 0.92, 0.26],
  glint: [1.0, 0.97, 0.68],
};

/**
 * `apply_gold_material(baseColor, materialCoord, timeSeconds)` at the stable (negative-time) branch: gold
 * by the authored luminance's tone, a static softbox and dark horizon for chrome contrast, and the ink
 * protection that keeps genuine near-black line work black.
 */
function goldColour(base, coord) {
  const sourceLuma = luma(base);
  // "Treat authored luminance as surface detail, not final brightness."
  const detailTone = clamp(0.52 + (sourceLuma - 0.5) * 0.4, 0.34, 0.74);
  let gold = mix(GOLD.shadow, GOLD.rich, smoothstep(0.34, 0.55, detailTone));
  gold = mix(gold, GOLD.yellow, smoothstep(0.51, 0.74, detailTone));

  const reflectionAxis = (coord[0] - 0.5) * -0.57 + (coord[1] - 0.5) * 0.82;
  const softbox = 1 - smoothstep(0.08, 0.28, Math.abs(reflectionAxis + 0.14));
  const darkHorizon = 1 - smoothstep(0.04, 0.27, Math.abs(reflectionAxis - 0.13));
  gold = gold.map((channel) => channel * (0.98 + 0.06 * softbox));
  gold = gold.map((channel) => channel * (1.0 - 0.045 * darkHorizon));
  gold = mix(gold, GOLD.reflected, softbox * 0.22);

  // "Protect only genuine near-black ink."
  const inkProtection = 1 - smoothstep(0.025, 0.09, sourceLuma);
  return mix(gold, base, inkProtection * 0.94);
}

/** The material the game's own name rule picks for a mutation set, or `null` when there is none. */
export function materialKindOf(mutations) {
  if (mutations.some((name) => String(name).includes("Rainbow"))) return "Rainbow";
  if (mutations.some((name) => String(name).includes("Gold"))) return "Gold";
  return null;
}

/** The axis the rainbow gradient runs along: `vn.Crop` 40 degrees, `vn.TallPlant` -90. */
export const RAINBOW_ANGLE_DEGREES = { Crop: 40, TallPlant: -90 };

/**
 * One sprite's pixels through a mutation material, in place of its own colour.
 *
 * `kind` is `"Rainbow"` or `"Gold"`; the sprite's own alpha comes back unchanged, as both shaders leave it.
 * The sprite is straight-alpha (the atlas frames are), and the material works on the un-premultiplied
 * colour its shaders compute (`baseRGB = outColor.rgb / max(outColor.a, 0.001)`), which is the same thing.
 */
export async function materialPng(buffer, kind, { angleDegrees = RAINBOW_ANGLE_DEGREES.Crop } = {}) {
  if (kind !== "Rainbow" && kind !== "Gold") return buffer;
  const radians = (angleDegrees * Math.PI) / 180;
  const axis = [Math.cos(radians), Math.sin(radians)];
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 3] === 0) continue;
      const base = [data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255];
      const coord = [(x + 0.5) / info.width, (y + 0.5) / info.height];
      const colour =
        kind === "Rainbow"
          ? setLuminosity(
              rainbowColour(
                clamp(axis[0] * (coord[0] - 0.5) + axis[1] * (coord[1] - 0.5) + 0.5),
              ),
              luma(base),
            )
          : goldColour(base, coord);
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = Math.max(0, Math.min(255, Math.round(colour[channel] * 255)));
      }
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer();
}
