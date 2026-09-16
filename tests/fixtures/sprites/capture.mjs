// Capture the offline sprite fixtures used by tests/sprites-composed-box.test.js.
//
//   node tests/fixtures/sprites/capture.mjs
//
// Needs the live game (magicgarden.gg) for the atlas *metadata*: every frame's rect,
// trim, sourceSize and anchor, plus whether it is stored rotated. It does not download
// the atlas pixels. Each captured frame is written as a flat opaque block at the frame's
// real stored size, because the property the fixture exists to test is geometric — a
// composed picture's dimensions — and dimensions come from the metadata, never from the
// pixels. Real pixels would make this atlas 5.0 MB; flat ones make it ~30 KB.
import fs from "node:fs/promises";
import sharp from "sharp";
import { gameDataService } from "../../../src/services/gameData.js";
import { initSprites, lookupSprite } from "../../../src/assets/sprites/sprites.js";

// Mirrors MUTATION_CONFIG's frames; kept as literals here so the capture does not depend
// on the composer it is capturing fixtures for.
const MUTATION_KEYS = [
  "sprite/mutation/Wet", "sprite/mutation/Puddle", "sprite/mutation-overlay/WetTallPlant",
  "sprite/mutation/Chilled", "sprite/mutation-overlay/ChilledTallPlant",
  "sprite/mutation/Frozen", "sprite/mutation-overlay/FrozenTallPlant",
  "sprite/mutation/Thunderstruck", "sprite/mutation/ThunderstruckGround", "sprite/mutation-overlay/ThunderstruckTallPlant",
  "sprite/mutation/Thundercharged", "sprite/mutation/ThunderchargedGround", "sprite/mutation-overlay/ThunderchargedTallPlant",
  "sprite/mutation/Dawnlit",
  "sprite/mutation/Amberlit",
  "sprite/mutation/Dawncharged",
  "sprite/mutation/Ambercharged",
];

const OUT = new URL("./", import.meta.url);
const MAX_W = 2048;

const plants = await gameDataService.getPlants();
await initSprites();

const species = [];
for (const [name, rec] of Object.entries(plants)) {
  const patched = rec.plant?.harvestType === "Single";
  const artKey = patched ? rec.plant?.sprite : rec.crop?.sprite;
  if (!artKey || !lookupSprite(artKey)) continue;
  species.push({ species: name, artKey });
}

const keys = [...new Set([...species.map((s) => s.artKey), ...MUTATION_KEYS])];
const frames = {};
const blocks = [];

for (const key of keys) {
  const meta = lookupSprite(key);
  if (!meta) { console.warn(`absent from the live atlas: ${key}`); continue; }
  // The stored block is (h, w) when the frame is rotated; the composer rotates it back.
  const w = meta.rotated ? meta.frame.h : meta.frame.w;
  const h = meta.rotated ? meta.frame.w : meta.frame.h;
  // A flat block per frame, tinted by key so a dumped picture is still readable.
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const buffer = await sharp({
    create: {
      width: Math.max(1, w),
      height: Math.max(1, h),
      channels: 4,
      background: { r: 40 + (hash % 180), g: 40 + ((hash >> 8) % 180), b: 40 + ((hash >> 16) % 180), alpha: 1 },
    },
  }).png({ compressionLevel: 9 }).toBuffer();
  blocks.push({ key, meta, w, h, buffer });
}

// Shelf-pack, tallest first.
blocks.sort((a, b) => b.h - a.h);
let x = 0, y = 0, rowH = 0;
for (const b of blocks) {
  if (x + b.w > MAX_W) { x = 0; y += rowH; rowH = 0; }
  b.px = x; b.py = y;
  x += b.w; rowH = Math.max(rowH, b.h);
}
const packW = Math.max(1, ...blocks.map((b) => b.px + b.w));
const packH = y + rowH;

const png = await sharp({
  create: { width: packW, height: packH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite(blocks.map((b) => ({ input: b.buffer, left: b.px, top: b.py })))
  .png({ compressionLevel: 9 })
  .toBuffer();

for (const b of blocks) {
  frames[b.key] = {
    frame: { x: b.px, y: b.py, w: b.meta.frame.w, h: b.meta.frame.h },
    rotated: !!b.meta.rotated,
    trimmed: !!b.meta.trimmed,
    spriteSourceSize: b.meta.spriteSourceSize ?? null,
    sourceSize: b.meta.sourceSize ?? null,
    anchor: b.meta.anchor ?? null,
  };
}

const manifest = {
  bundles: [{
    name: "default",
    assets: [{ alias: ["atlases/sprites-composed.json"], src: [{ src: "sprites-composed.json", resolution: 2 }], data: { tags: {} } }],
  }],
};
const atlas = {
  frames,
  animations: {},
  animationFps: 24,
  meta: { image: "sprites-composed.png", size: { w: packW, h: packH }, scale: 1 },
};

await fs.writeFile(new URL("manifest.json", OUT), JSON.stringify(manifest, null, 1) + "\n");
await fs.writeFile(new URL("sprites-composed.json", OUT), JSON.stringify(atlas, null, 1) + "\n");
await fs.writeFile(new URL("sprites-composed.png", OUT), png);

const rows = species.map(({ species: name, artKey }) => {
  const m = lookupSprite(artKey);
  const w = m.sourceSize?.w ?? (m.rotated ? m.frame.h : m.frame.w);
  const h = m.sourceSize?.h ?? (m.rotated ? m.frame.w : m.frame.h);
  return `  ${/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)}: [${JSON.stringify(artKey)}, ${w}, ${h}],`;
});
console.log(`captured ${blocks.length} frames (${species.length} species arts + ${blocks.length - species.length} mutation frames)`);
console.log(`atlas ${packW}x${packH}, png ${png.length} bytes`);
console.log("\n// expected-crop-art table for tests/sprites-composed-box.test.js:\n" + rows.join("\n"));
