// src/assets/sprites/spriteComposer.js
import fs from "node:fs/promises";
import sharp from "sharp";
import { initSprites, lookupSprite, lookupSpriteByAliases } from "./sprites.js";
import { decodeKTX2, isKTX2 } from "../ktx2Decoder.js";
import { gameDataService } from "../../services/gameData.js";
import { getRiveFrames, clearRiveFramesCache, riveSpritePath } from "./riveFrames.js";
import { cropComposition, cropArtSize, overlayClip } from "./cropBox.js";
import { isBakeEnabled, lookupBaked, persistComposed } from "./cropBake.js";
import {
  artIndex, isTallPlantFor, loadDisplayFlags, loadMutationTables, mutationAnchorFor,
  tileScaleFor,
} from "./mutationAnchor.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MUTATION_ORDER = [
  "Gold", "Rainbow", "Wet", "Chilled", "Frozen", "Thunderstruck", "Thundercharged",
  "Ambershine", "Dawnlit", "Dawncharged", "Ambercharged",
];

const MUTATION_COLORS = {
  Gold:         { r: 235, g: 200, b:   0, a: 0.70 },
  Wet:          { r:  50, g: 180, b: 200, a: 0.25 },
  Chilled:      { r: 100, g: 160, b: 210, a: 0.45 },
  Frozen:       { r: 100, g: 130, b: 220, a: 0.50 },
  Thunderstruck:{ r:  16, g: 141, b: 163, a: 0.40 },
  Thundercharged:{ r:  60, g: 200, b: 165, a: 0.45 },
  Dawnlit:      { r: 209, g:  70, b: 231, a: 0.50 },
  Ambershine:   { r: 190, g: 100, b:  40, a: 0.50 },
  Dawncharged:  { r: 140, g:  80, b: 200, a: 0.50 },
  Ambercharged: { r: 170, g:  60, b:  25, a: 0.50 },
};

// Mutation sprite config — matches game bundle's `cd` object exactly.
// iconKey: sprite/mutation/<X> placed at target position
// tallIconKey: overrides iconKey for tall plants (z=-1, behind plant)
// overlayKey: sprite/mutation-overlay/<X> masked to plant silhouette (tall only)
// overlayFromBottom: overlay anchors at plant bottom instead of top
const MUTATION_CONFIG = {
  Wet:          { iconKey: "sprite/mutation/Wet",          tallIconKey: "sprite/mutation/Puddle",              overlayKey: "sprite/mutation-overlay/WetTallPlant" },
  Chilled:      { iconKey: "sprite/mutation/Chilled",                                                          overlayKey: "sprite/mutation-overlay/ChilledTallPlant" },
  Frozen:       { iconKey: "sprite/mutation/Frozen",                                                           overlayKey: "sprite/mutation-overlay/FrozenTallPlant" },
  Thunderstruck:{ iconKey: "sprite/mutation/Thunderstruck", tallIconKey: "sprite/mutation/ThunderstruckGround", overlayKey: "sprite/mutation-overlay/ThunderstruckTallPlant", overlayFromBottom: true },
  Thundercharged:{ iconKey: "sprite/mutation/Thundercharged", tallIconKey: "sprite/mutation/ThunderchargedGround", overlayKey: "sprite/mutation-overlay/ThunderchargedTallPlant", overlayFromBottom: true },
  Dawnlit:      { iconKey: "sprite/mutation/Dawnlit" },
  Ambershine:   { iconKey: "sprite/mutation/Amberlit" },
  Dawncharged:  { iconKey: "sprite/mutation/Dawncharged" },
  Ambercharged: { iconKey: "sprite/mutation/Ambercharged" },
};

// Floating mutations drawn in front of plant (z=10) — matches game's Qd set
const FLOATING_MUTATIONS = new Set(["Dawnlit", "Ambershine", "Dawncharged", "Ambercharged"]);
const WARM_MUTATIONS      = new Set(["Ambershine", "Dawnlit", "Dawncharged", "Ambercharged"]);
const WATER_ICE_MUTATIONS = new Set(["Wet", "Chilled", "Frozen", "Thunderstruck", "Thundercharged"]);

// The per-species mutation anchors, the 256-px reference tile, the 0.75 cap they are taken
// against, the divisor the cap is taken against the art's *drawn* size with, and the 1.5
// aspect test the game's own placement function states, all live in `./mutationAnchor.js`,
// keyed by **species** and by the part the art is — the atlas key's last segment is only a
// species' name by luck (`CloverThreeLeaf`), and keying by it is what plan item 25 fixes.
// `tileScaleFor()` is the game's `Go` scale factor and `TALL_ICON_SCALE_BOOST` is its `qo = 2`
// tall decal multiplier; there is no third constant, which is what plan item 26 removed (the
// `0.5` that used to sit here was a 2x frame's `1/sourcePixelRatio` written down).
const TALL_ICON_SCALE_BOOST = 2; // qo=2 in game bundle

// Rainbow gradient stops
const RAINBOW_STOPS = (() => {
  const hex = (s) => ({ r: parseInt(s.slice(1,3),16), g: parseInt(s.slice(3,5),16), b: parseInt(s.slice(5,7),16) });
  return [
    { pos: 0.0, ...hex("#FF1744") },
    { pos: 0.2, ...hex("#FF9100") },
    { pos: 0.4, ...hex("#FFEA00") },
    { pos: 0.6, ...hex("#00E676") },
    { pos: 0.8, ...hex("#2979FF") },
    { pos: 1.0, ...hex("#D500F9") },
  ];
})();

// ─── Plant meta cache ─────────────────────────────────────────────────────────

// Lazy-loaded from plant data. Keyed by the sprite filename (last path segment, no ext).
// harvestTypeMap: species → "Single" | "Multiple" (from plant.harvestType)
// artIndex: atlas key → { species, part } for that species' plant and crop art, which is what
// says whose mutation anchors apply to a composed art (`./mutationAnchor.js`).
//
// The tall-plant flag is **not** here: the game keys `isTallPlant` by the art's full sprite
// path, and `isTallPlantFor()` reads that table (`./mutationAnchor.js`). This block used to
// build a tall set from the plant records' `tileTransformOrigin`, which answers a different
// question and disagreed with the game's table for 16 of the 23 arts either reading calls tall.
let plantMetaCache = null;

async function getPlantMeta() {
  if (plantMetaCache) return plantMetaCache;
  const meta = { harvestTypeMap: new Map(), artIndex: new Map() };
  try {
    const plants = await gameDataService.getPlants();
    for (const [species, data] of Object.entries(plants)) {
      if (data.plant?.harvestType) {
        meta.harvestTypeMap.set(species, data.plant.harvestType);
      }
    }
    meta.artIndex = artIndex(plants);
  } catch {
    // leave sets/maps empty on error
  }
  plantMetaCache = meta;
  return meta;
}

// ─── Caches ───────────────────────────────────────────────────────────────────

// url → { sharpInput, sharpOptions }
const atlasCache = new Map();

// cacheKey → { buffer, box }
const composedCache = new Map();
const COMPOSED_CACHE_MAX = 500;

// ─── Atlas helpers ────────────────────────────────────────────────────────────

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function getAtlasBuffer(url) {
  if (atlasCache.has(url)) return atlasCache.get(url);
  const raw = await downloadBuffer(url);
  let entry;
  if (isKTX2(url)) {
    const decoded = await decodeKTX2(raw);
    entry = { sharpInput: decoded.rgba, sharpOptions: { raw: { width: decoded.width, height: decoded.height, channels: 4 } } };
  } else {
    entry = { sharpInput: raw, sharpOptions: undefined };
  }
  atlasCache.set(url, entry);
  return entry;
}

// ─── Sprite extraction ────────────────────────────────────────────────────────

/**
 * Extract a sprite from its atlas and restore trim padding.
 * Returns { buffer, width, height, anchor, isTall } or null.
 */
async function extractSprite(meta) {
  if (!meta || !meta.url || !meta.frame) return null;

  const { frame, rotated, trimmed, spriteSourceSize, sourceSize, anchor, url } = meta;

  let atlasEntry;
  try {
    atlasEntry = await getAtlasBuffer(url);
  } catch {
    return null;
  }

  const cropW = rotated ? frame.h : frame.w;
  const cropH = rotated ? frame.w : frame.h;

  let piece = sharp(atlasEntry.sharpInput, atlasEntry.sharpOptions).extract({
    left: frame.x, top: frame.y, width: cropW, height: cropH,
  });
  if (rotated) piece = piece.rotate(270);

  let buffer;
  if (trimmed && sourceSize?.w && sourceSize?.h && spriteSourceSize?.x != null) {
    const trimBuf = await piece.png().toBuffer();
    buffer = await sharp({
      create: { width: sourceSize.w, height: sourceSize.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: trimBuf, left: spriteSourceSize.x, top: spriteSourceSize.y }]).png().toBuffer();
  } else {
    buffer = await piece.png().toBuffer();
  }

  // The art's own dimensions, derived in the one place that states them (`./cropBox.js`).
  const { width: w, height: h } = cropArtSize({ sourceSize, frame, rotated });

  return {
    buffer,
    width: w,
    height: h,
    anchor: anchor ?? { x: 0.5, y: 0.5 },
    isTall: isTallPlantFor(meta.key, await loadDisplayFlags()),
    key: meta.key,
  };
}

/**
 * Charge un sprite exporté depuis Rive, en imitant le retour d'extractSprite.
 */
async function extractRiveSprite(key) {
  const frames = await getRiveFrames();
  const meta = frames[key];
  if (!meta) return null;

  let buffer;
  try {
    buffer = await fs.readFile(riveSpritePath(meta));
  } catch {
    return null;
  }

  return {
    buffer,
    width: meta.sourceSize?.w ?? 0,
    height: meta.sourceSize?.h ?? 0,
    anchor: meta.anchor ?? { x: 0.5, y: 1 },
    isTall: false, // les pets ne sont jamais "tall" (cf. doc-sprite.md §11)
    key,
  };
}

async function extractByKey(key) {
  const meta = lookupSprite(key);
  if (meta) return extractSprite(meta);

  // Repli disque pour les sprites qui ont quitté l'atlas (pets en Rive).
  return extractRiveSprite(key);
}

// ─── Mutation normalization ───────────────────────────────────────────────────

function sortMutations(ids) {
  const unique = [...new Set(ids)];
  unique.sort((a, b) => {
    const ia = MUTATION_ORDER.indexOf(a);
    const ib = MUTATION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return unique;
}

function buildColorList(sorted) {
  if (sorted.includes("Gold")) return ["Gold"];
  if (sorted.includes("Rainbow")) return ["Rainbow"];
  const hasWarm = sorted.some((m) => WARM_MUTATIONS.has(m));
  if (hasWarm) return sorted.filter((m) => !WATER_ICE_MUTATIONS.has(m));
  return sorted;
}

function buildOverlayList(sorted) {
  return sorted.filter((m) => MUTATION_CONFIG[m]?.overlayKey);
}

function buildIconList(sorted) {
  return sorted.filter((m) => m !== "Gold" && m !== "Rainbow" && MUTATION_CONFIG[m]?.iconKey);
}

// ─── Gradient + HSL helpers ───────────────────────────────────────────────────

function lerpColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i], s1 = stops[i + 1];
    if (t >= s0.pos && t <= s1.pos) {
      const u = (t - s0.pos) / (s1.pos - s0.pos);
      return {
        r: s0.r + (s1.r - s0.r) * u,
        g: s0.g + (s1.g - s0.g) * u,
        b: s0.b + (s1.b - s0.b) * u,
      };
    }
  }
  return stops[stops.length - 1];
}

// CSS "color" blend mode — matches the game's od filter shader exactly.
// All values in [0, 1].
function getLum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

function clipColor(r, g, b) {
  const l = getLum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) {
    const f = l / (l - n);
    r = l + (r - l) * f;
    g = l + (g - l) * f;
    b = l + (b - l) * f;
  }
  if (x > 1) {
    const f = (1 - l) / (x - l);
    r = l + (r - l) * f;
    g = l + (g - l) * f;
    b = l + (b - l) * f;
  }
  return { r, g, b };
}

function setLum(r, g, b, lum) {
  const d = lum - getLum(r, g, b);
  return clipColor(r + d, g + d, b + d);
}

// blendColor(base, blend, opacity) from the game shader:
//   setLuminosity(blend, getLuminosity(base)) * opacity + base * (1 - opacity)
function blendColorHSL(bR, bG, bB, fR, fG, fB, opacity) {
  const { r, g, b } = setLum(fR, fG, fB, getLum(bR, bG, bB));
  return {
    r: r * opacity + bR * (1 - opacity),
    g: g * opacity + bG * (1 - opacity),
    b: b * opacity + bB * (1 - opacity),
  };
}

// ─── Layer builders ───────────────────────────────────────────────────────────

// baseRaw: raw RGBA buffer (already decoded via sharp .raw())
async function buildSolidTintLayer(baseRaw, w, h, mutation) {
  const col = MUTATION_COLORS[mutation];
  if (!col) return null;

  const out = Buffer.allocUnsafe(w * h * 4);

  for (let i = 0; i < w * h; i++) {
    const baseAlpha = baseRaw[i * 4 + 3] / 255;
    out[i * 4]     = col.r;
    out[i * 4 + 1] = col.g;
    out[i * 4 + 2] = col.b;
    out[i * 4 + 3] = Math.round(col.a * baseAlpha * 255);
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function buildRainbowLayer(baseRaw, w, h, isTall) {
  // ColorGradientFilter stores (inputAngle - 90) then does radians() in the shader.
  // UV coords use Y-UP (OpenGL convention): y=0 at bottom, y=1 at top.
  // Projection: t = clamp(cpx * cos(rad) - cpy * sin(rad) + 0.5, 0, 1)
  // where cpx = px/w - 0.5 (centered), cpy = (1 - py/h) - 0.5 (Y-flipped, centered)
  const inputAngle  = isTall ? 0 : 130;
  const storedDeg   = inputAngle - 90;            // matches Zu setter: e - Yu (Yu=90)
  const rad         = storedDeg * (Math.PI / 180);
  const cosA        = Math.cos(rad);
  const sinA        = Math.sin(rad);

  const out = Buffer.allocUnsafe(w * h * 4);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i     = (py * w + px) * 4;
      const baseA = baseRaw[i + 3] / 255;

      if (baseA === 0) {
        out[i] = out[i+1] = out[i+2] = out[i+3] = 0;
        continue;
      }

      // Y-UP UV (OpenGL): y=0 at bottom → invert py
      const cpx = px / w - 0.5;
      const cpy = (1 - py / h) - 0.5;

      // projectLinearPosition equivalent (shader: result.x after rotate2d)
      const t = Math.min(1, Math.max(0, cpx * cosA - cpy * sinA + 0.5));

      // Gradient color
      const grad = lerpColor(RAINBOW_STOPS, t);
      const fR   = grad.r / 255;
      const fG   = grad.g / 255;
      const fB   = grad.b / 255;

      // Original sprite color (straight alpha)
      const bR = baseRaw[i]     / 255;
      const bG = baseRaw[i + 1] / 255;
      const bB = baseRaw[i + 2] / 255;

      // HSL "color" blend — game shader: blendColor(back.rgb, front.rgb, front.a)
      const { r, g, b } = blendColorHSL(bR, bG, bB, fR, fG, fB, baseA);

      out[i]     = Math.max(0, Math.min(255, Math.round(r * 255)));
      out[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      out[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      out[i + 3] = baseRaw[i + 3];
    }
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function buildOverlayLayer(baseBuf, baseW, baseH, baseAnchor, overlayKey, overlayFromBottom) {
  const meta = lookupSprite(overlayKey);
  if (!meta) return null;
  const overlaySprite = await extractSprite(meta);
  if (!overlaySprite) return null;

  const { buffer: overlayBuf, width: ow, height: oh } = overlaySprite;

  // The one clip the game applies to a mutation's art: the tall-plant overlay is masked to
  // the crop body's own texture, so it is cut to the art's own rectangle and never grows the
  // picture. `./cropBox.js` states that arithmetic (`overlayClip`) and the bundle evidence
  // for it — and it is the *only* clip left in this file.
  const clip = overlayClip(baseW, baseH, ow, oh, baseAnchor.x, overlayFromBottom);
  if (!clip) return null;

  const { cropLeft, cropTop, x: canvasX, y: canvasY, width: visibleW, height: visibleH } = clip;

  const clippedOverlay = (cropLeft > 0 || cropTop > 0 || visibleW < ow || visibleH < oh)
    ? await sharp(overlayBuf).extract({ left: cropLeft, top: cropTop, width: visibleW, height: visibleH }).png().toBuffer()
    : overlayBuf;

  // Place overlay on a transparent canvas, then mask to base silhouette
  const onBase = await sharp({
    create: { width: baseW, height: baseH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: clippedOverlay, left: canvasX, top: canvasY }]).png().toBuffer();

  return sharp(onBase)
    .composite([{ input: baseBuf, blend: "dest-in" }])
    .png().toBuffer();
}

// ─── Composition geometry ─────────────────────────────────────────────────────

/**
 * Where a sprite is drawn and how big it is, from the atlas metadata alone.
 *
 * Dimensions come from `cropArtSize` (the one derivation of an art's own size), the anchor
 * and the pixel ratio from the frame, and `isTall` from the game's own display table keyed by
 * this art's full sprite path (`isTallPlantFor` in `./mutationAnchor.js`). A key the atlas does
 * not have falls back to the Rive frames (pets), whose metadata carries the same fields.
 *
 * Returns null when the key is in neither, which is the one case a caller must skip.
 */
async function spriteGeometry(key) {
  const meta = lookupSprite(key);
  if (meta?.url && meta.frame) {
    const { width, height } = cropArtSize(meta);
    return {
      key,
      width,
      height,
      anchor: meta.anchor ?? { x: 0.5, y: 0.5 },
      isTall: isTallPlantFor(key, await loadDisplayFlags()),
      // The game's own divisor for this frame (`Go`'s `e.sourcePixelRatio`), defaulting to the
      // game's own 1 for a frame that states none (`i.prototype.sourcePixelRatio=1`).
      pixelRatio: meta.sourcePixelRatio ?? 1,
    };
  }

  const frames = await getRiveFrames();
  const rive = frames?.[key];
  if (!rive) return null;
  return {
    key,
    width: rive.sourceSize?.w ?? 0,
    height: rive.sourceSize?.h ?? 0,
    anchor: rive.anchor ?? { x: 0.5, y: 1 },
    isTall: false, // les pets ne sont jamais "tall" (cf. doc-sprite.md §11)
    pixelRatio: 1, // les frames Rive sont exportées à la taille où le jeu les dessine
  };
}

/**
 * The icon position for a crop, from the bundle's own placement math (the port §3.3 of the
 * plan keeps honest): the icon is scaled by the crop's smaller dimension — divided by the
 * frame's own `sourcePixelRatio` — against the 256-px reference tile and the game's own `.75`
 * cap, then placed on the crop's anchor moved to the mutation's target point.
 *
 * The target point, the species' own scale and the cap arithmetic come from
 * `./mutationAnchor.js` (`mutationAnchorFor`, `tileScaleFor`), which holds the game's
 * per-species table and reads it with the species and the part this art is — the reading
 * `planComposition` resolves through the plant records, never from the art key.
 *
 * `pixelRatio` is the **base art's** frame ratio, because that is the frame the game's `Go`
 * divides; each layer is still drawn at its own frame's `sourceSize`, which is what makes the
 * picture a render at the atlas's resolution rather than at the game's 1x one.
 */
function iconRect(iconSprite, baseW, baseH, baseAnchor, species, part, isTall, pixelRatio, harvestType = "Single", tables) {
  const { width: iconW, height: iconH, anchor: iconAnchor } = iconSprite;
  const anchorX = baseAnchor.x;
  const anchorY = baseAnchor.y;

  const { x: targetX, y: targetY, scale } = mutationAnchorFor(
    species, part, baseW, baseH, anchorX, anchorY, harvestType, tables,
  );

  const basePosX  = baseW * anchorX;
  const basePosY  = baseH * anchorY;
  const offsetX   = (targetX - anchorX) * baseW;
  const offsetY   = (targetY - anchorY) * baseH;

  // The game's own size factor, `min(Wo, (smaller side / sourcePixelRatio) / 256)`, with the cap
  // and the tile read from the extraction — `./mutationAnchor.js` states why the divisor is not
  // optional and what writing the factor without it moved.
  const iconScale = tileScaleFor(baseW, baseH, pixelRatio, tables) * scale
    * (isTall ? TALL_ICON_SCALE_BOOST : 1);

  const drawW = Math.max(1, Math.round(iconW * iconScale));
  const drawH = Math.max(1, Math.round(iconH * iconScale));
  const drawX = Math.round(basePosX + offsetX - drawW * (iconAnchor?.x ?? 0.5));
  const drawY = Math.round(basePosY + offsetY - drawH * (iconAnchor?.y ?? 0.5));

  return { drawW, drawH, drawX, drawY };
}

/**
 * Where every layer of a composition is drawn, and therefore the picture's box.
 *
 * Metadata only — no atlas pixels, no sharp — so the bake can ask for the box of a picture it
 * already has on disk without rendering it, and the renderer below draws exactly the plan.
 *
 * The layers that can move the canvas are the icons, with the rectangle the game's placement
 * math gives them before any cut. The tall-plant overlays cannot: they are clipped to the
 * art's own rectangle (`overlayClip` in `./cropBox.js`), and the base sprite and its tint
 * layers are exactly the art. `cropComposition` unions the rectangles and states both the
 * canvas and the art's own rectangle inside it.
 *
 * Returns null when the base key is in neither the atlas nor the Rive frames.
 */
async function planComposition(baseKey, sorted) {
  const base = await spriteGeometry(baseKey);
  if (!base) return null;

  // Whose anchors apply to this art, from the plant records and not from the key's spelling:
  // the game keys its mutation table by species and reads it with the part the art is, so an
  // art that is some species' plant or crop art is resolved through that species
  // (`./mutationAnchor.js`). A key no plant record states — a `sprite/tallplant/…` alias, a
  // pet — keeps the old last-segment reading and the `crop` part.
  const { harvestTypeMap, artIndex: artSpecies } = await getPlantMeta();
  // The game's own anchor table, from the extraction at `/data/art` when it can be reached
  // (`./mutationAnchor.js`), read in parallel with the plant records it is keyed by.
  const anchorTables = await loadMutationTables();
  const stated = artSpecies.get(baseKey);
  const species = stated?.species ?? (baseKey.split("/").pop() ?? "");
  const part = stated?.part ?? "crop";
  const harvestType = harvestTypeMap.get(species) ?? "Single";

  const colorList   = buildColorList(sorted);
  const overlayList = base.isTall ? buildOverlayList(sorted) : [];

  const icons = [];
  for (const mutation of buildIconList(sorted)) {
    const cfg = MUTATION_CONFIG[mutation];
    const key = (base.isTall && cfg.tallIconKey) ? cfg.tallIconKey : cfg.iconKey;
    const icon = await spriteGeometry(key);
    if (!icon) continue; // Ignore a missing icon asset — do not 404 (doc-sprite.md §13).

    let zIndex = 2;
    if (FLOATING_MUTATIONS.has(mutation)) zIndex = 10;
    else if (base.isTall) zIndex = -1;

    icons.push({ mutation, zIndex, key, ...iconRect(icon, base.width, base.height, base.anchor, species, part, base.isTall, base.pixelRatio, harvestType, anchorTables) });
  }

  // The canvas and the box a caller places the picture by are the same decision, so both come
  // from `cropComposition()` (`./cropBox.js`), the one place that states the union convention.
  const { canvas, box } = cropComposition(
    base.width,
    base.height,
    icons.map((i) => ({ left: i.drawX, top: i.drawY, width: i.drawW, height: i.drawH })),
  );

  return { ...base, species, part, harvestType, colorList, overlayList, icons, canvas, box };
}

/**
 * The box `composeSpriteWithBox` states for a pair, without composing it.
 *
 * Exported for the bake, which records each picture's box in its manifest: a picture it
 * resumes from disk must carry the box a fresh composition would state, and the geometry
 * needs no pixels, so resuming stays a metadata question rather than a re-render.
 *
 * Returns null when the base key does not exist.
 */
export async function composedBox(baseKey, mutationIds = []) {
  await initSprites();
  const plan = await planComposition(baseKey, sortMutations(mutationIds.map(String)));
  return plan ? plan.box : null;
}

// ─── Main composition ─────────────────────────────────────────────────────────

export function clearComposedCache() {
  composedCache.clear();
  atlasCache.clear();
  plantMetaCache = null;
  clearRiveFramesCache();
}

/**
 * Compose a base sprite with mutations and return the picture's PNG Buffer.
 *
 * The buffer-only entry point: `/assets/sprites/composed` serves the picture itself, and
 * a caller that wants only the picture should not have to unwrap one. Callers that need
 * to place the picture ask `composeSpriteWithBox`.
 *
 * Returns null if the base sprite key does not exist.
 */
export async function composeSprite(baseKey, mutationIds = []) {
  const composed = await composeSpriteWithBox(baseKey, mutationIds);
  return composed ? composed.buffer : null;
}

/**
 * The same composition, with the box it is in.
 *
 * Returns `{ buffer, box }`: a PNG whose canvas is the tight **union** of the crop's own art
 * and every layer drawn over it, and `box = { x, y, width, height }` saying where the art's
 * own rectangle sits inside that picture, in picture pixels. A mutation whose art reaches
 * past the crop's frame grows the picture instead of being cut to it; `x`/`y` are that art's
 * corner and are no longer always 0.
 *
 * Both come from `planComposition()` → `cropComposition()` (`./cropBox.js`), the one place
 * that states the convention and the evidence for it. Read it before changing either.
 *
 * Returns null if the base sprite key does not exist.
 */
export async function composeSpriteWithBox(baseKey, mutationIds = []) {
  await initSprites();

  const sorted     = sortMutations(mutationIds.map(String));
  const cacheKey   = `${baseKey}|${sorted.join(",")}`;

  if (composedCache.has(cacheKey)) return composedCache.get(cacheKey);

  // ── The plan: where every layer goes, and the picture's box (no pixels) ──
  const plan = await planComposition(baseKey, sorted);
  if (!plan) return null;

  const {
    width: baseW, height: baseH, anchor: baseAnchor, isTall,
    colorList, overlayList, icons: plannedIcons,
  } = plan;

  const canvasW = plan.canvas.width;
  const canvasH = plan.canvas.height;

  // Where the crop's own art sits inside the picture, in picture pixels. Every other
  // layer is placed against it.
  const box = plan.box;
  const baseLeft = box.x;
  const baseTop  = box.y;

  // ── The pixels the plan names ────────────────────────────────────────────
  const baseSpriteInfo = await extractByKey(baseKey);
  if (!baseSpriteInfo) return null;
  const baseBuf = baseSpriteInfo.buffer;

  // Decode base raw once (reused by all color layer builders)
  const baseRaw = await sharp(baseBuf).ensureAlpha().raw().toBuffer();

  const resolvedIcons = await Promise.all(
    plannedIcons.map(async (icon) => {
      // Ignore a missing icon asset — do not 404 (doc-sprite.md §13). The rectangle stays in
      // the plan either way, so the box never depends on whether a download succeeded.
      const sprite = await extractByKey(icon.key);
      if (!sprite) return null;
      return { zIndex: icon.zIndex, iconBuf: sprite.buffer, drawW: icon.drawW, drawH: icon.drawH, drawX: icon.drawX, drawY: icon.drawY };
    }),
  );
  const icons = resolvedIcons.filter(Boolean);

  // Helper: composite a batch of ops onto the current canvas
  async function composite(canvas, ops) {
    if (!ops.length) return canvas;
    return sharp(canvas).composite(ops).png().toBuffer();
  }

  // Helper: resize an icon buffer
  async function resizeIcon(buf, w, h) {
    return sharp(buf).resize(Math.max(1, w), Math.max(1, h), { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  }

  // Helper: build composite ops for a group of icons, at the position the plan gives them.
  //
  // No cut: the canvas is the union of these very rectangles (`cropComposition`), so every
  // icon is inside the picture by construction and a piece that were not would make sharp
  // fail loudly ("Image to composite must have same dimensions or smaller") rather than be
  // silently clipped. The only clip the composer applies to a layer is the tall-plant
  // overlay's, in `buildOverlayLayer`.
  async function iconOps(group, xOff, yOff) {
    return Promise.all(
      group.map(async (icon) => {
        const input = await resizeIcon(icon.iconBuf, icon.drawW, icon.drawH);
        return { input, left: Math.round(xOff + icon.drawX), top: Math.round(yOff + icon.drawY) };
      }),
    );
  }

  // 1. Start with a transparent canvas the size of the union: it expands to fit the layers,
  // and the box above says where the crop's own art sits inside it.
  let canvas = await sharp({
    create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();

  // 2. z = -1: icons behind base (tall plants) — batch composite
  const behindIcons = icons.filter((i) => i.zIndex === -1);
  if (behindIcons.length > 0) {
    canvas = await composite(canvas, await iconOps(behindIcons, baseLeft, baseTop));
  }

  // 3. Base sprite
  canvas = await composite(canvas, [{ input: baseBuf, left: baseLeft, top: baseTop }]);

  // 4. Color layers (built in parallel, composited sequentially — each blends onto prior result)
  const colorLayers = await Promise.all(
    colorList.map((mutation) =>
      mutation === "Rainbow"
        ? buildRainbowLayer(baseRaw, baseW, baseH, isTall)
        : buildSolidTintLayer(baseRaw, baseW, baseH, mutation),
    ),
  );
  for (const layer of colorLayers) {
    if (layer) canvas = await composite(canvas, [{ input: layer, left: baseLeft, top: baseTop }]);
  }

  // 5. z = 2: standard icons (above color layers) — batch composite
  const standardIcons = icons.filter((i) => i.zIndex === 2);
  if (standardIcons.length > 0) {
    canvas = await composite(canvas, await iconOps(standardIcons, baseLeft, baseTop));
  }

  // 6. Tall-plant overlays (masked to plant silhouette, sequential — each may interact)
  for (const mutation of overlayList) {
    const cfg = MUTATION_CONFIG[mutation];
    const overlayLayer = await buildOverlayLayer(baseBuf, baseW, baseH, baseAnchor, cfg.overlayKey, cfg.overlayFromBottom ?? false);
    if (overlayLayer) canvas = await composite(canvas, [{ input: overlayLayer, left: baseLeft, top: baseTop }]);
  }

  // 7. z = 10: floating icons (Dawnlit, Ambershine, …) — batch composite
  const floatingIcons = icons.filter((i) => i.zIndex === 10);
  if (floatingIcons.length > 0) {
    canvas = await composite(canvas, await iconOps(floatingIcons, baseLeft, baseTop));
  }

  // ── Cache and return ─────────────────────────────────────────────────────
  const composed = { buffer: canvas, box };
  if (composedCache.size >= COMPOSED_CACHE_MAX) {
    composedCache.delete(composedCache.keys().next().value);
  }
  composedCache.set(cacheKey, composed);

  return composed;
}

/**
 * A crop wearing mutations, preferring the opt-in bake and composing when it misses.
 *
 * This is the one entry point a request uses, and it is what makes the bake an optimisation
 * rather than a dependency:
 *
 *   - `BAKE=1` and the set was baked → the picture is one file read, `source: "baked"`;
 *   - `BAKE=1` and the set was not, or the file the manifest names is gone → compose, keep
 *     the result under the bake's own naming scheme and add it to the manifest, so the next
 *     request is a file read (`source: "composed"`);
 *   - `BAKE=1` unset → nothing above runs. `isBakeEnabled()` is a sync config read, so the
 *     flag-off path is the composer and nothing else, byte for byte what it always was.
 *
 * The box comes from the manifest when the bake states it (it has since `BAKE_LAYOUT` v2, the
 * layout that introduced the union box), so a hit is one file read and no composition at all;
 * an entry without one — a manifest from a tree that predates the box, which its layout is
 * refused for — falls back to the composer's own box for that pair. A miss is composed once,
 * kept under the bake's own naming scheme and added to the manifest.
 *
 * Returns null when the base key is not in the atlas, exactly like `composeSpriteWithBox`.
 */
export async function resolveComposedSprite(baseKey, mutationIds = []) {
  if (isBakeEnabled()) {
    const baked = await lookupBaked(baseKey, mutationIds);
    if (baked) {
      const box = baked.box ?? (await composeSpriteWithBox(baseKey, mutationIds))?.box;
      if (box) {
        return { buffer: await fs.readFile(baked.file), box, source: "baked" };
      }
    }
  }

  const composed = await composeSpriteWithBox(baseKey, mutationIds);
  if (!composed) return null;

  if (isBakeEnabled()) await persistComposed(baseKey, mutationIds, composed);

  return { ...composed, source: "composed" };
}
