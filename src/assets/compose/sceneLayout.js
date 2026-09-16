// src/assets/compose/sceneLayout.js
//
// A scene spec in, one canvas and every item's box out.
//
// ## Where the layout comes from
//
// `@mg.js/art`, and nowhere else. This file is arithmetic over the rectangles the package's own
// functions answer — `cropComposition()` for one crop's picture, `plantPicture()` for a plant with
// its pot and the crops standing on it, `boxOf()`/`extentOf()` for a union — plus the spec's own
// tile positions and padding. It re-implements none of the placement math: where a mutation lands on
// a crop, where a crop sits on a plant and where a plant's pot goes are all the package's answers
// (`crop.ts`, `placement.ts`, `plant.ts`), read here as `left/top/width/height`.
//
// The three things it does add are the things the plan gives to the API, and none of them is a game
// value:
//
//   * **the scene's own coordinates** — a content union plus `padding`, and a tile grid whose step
//     is stated once (`TILE_STEP_PX`, with why);
//   * **the spec's conversions** — a crop's wire `size` through the game's own curve
//     (`1 + (size − 50)/50 × (maxSizeMultiplier − 1)`, `garden-viewer/garden.mjs:77-81`), and a
//     `plant`'s slot number to its place on the plant, from the published `slotOffsets`;
//   * **the flattening** — the package answers a *recipe* (a crop's picture, a plant's parts), and a
//     rasteriser wants a painted list: every layer in picture coordinates, in the package's own
//     order, which is the game's (`plant.ts:1-30` states the ladder).
//
// ## The box convention, and which one this is
//
// Each item's box **is** the union of what that item actually draws: this API's convention
// (`src/assets/sprites/cropBox.js` states it for the single-picture path, and the plan's item 24
// keeps it). It is deliberately not `@mg.js/art`'s own species-wide box — `cropComposition`'s `reach`
// array unions every mutation the tables state, worn or not (`crop.ts:261-263`), so a clover's recipe
// box is 213×306 where the tight union is 116×169. The package's placement *inside* those boxes is
// what is shared, and a test asserts that agreement where the two conventions coincide.

import { boxOf, REFERENCE_TILE_PX } from "@mg.js/art";

import { initSprites } from "../sprites/sprites.js";
import {
  artTables,
  cropMultiplier,
  cropRecipe,
  drawnFrame,
  plantArt,
  plantRecords,
  plantPicture,
} from "./artBridge.js";
import { assertWithinCanvas, normalizeSpec, SPEC_VERSION } from "./spec.js";

/**
 * The pixels one tile is worth on the scene's own grid.
 *
 * The game states this where it places a crop rather than in a table: a plant's `slotOffsets` are
 * fractions **of a tile**, and the game's own crop pivot is stated in the crop art's pixels, so the
 * two are put in the same unit by this factor (`garden-viewer/garden.mjs` states the same 256, which
 * is also the tile the mutation scaling is measured against). It is a reading of the game rather
 * than a choice — `REFERENCE_TILE_PX` is `@mg.js/art`'s own statement of it, and
 * `tests/compose-layout.test.js` pins it there — and it is a number no request can move.
 */
export const TILE_STEP_PX = REFERENCE_TILE_PX;

/** The pot every potted plant stands in, as the game's atlas names it. */
const POT_NAME = "PlanterPot";

/** A crop's drawn scale from the size the wire carries, through the game's own curve. */
function sizeScale(size, maxSizeMultiplier) {
  if (size === null) return 1;
  return 1 + ((size - 50) / 50) * (maxSizeMultiplier - 1);
}

/** One tile position in the scene's own coordinates. */
function tileOrigin(at) {
  return { x: (at?.column ?? 0) * TILE_STEP_PX, y: (at?.row ?? 0) * TILE_STEP_PX };
}

/** A scene-space rectangle, from a picture-space box and the point the picture is pinned by. */
function atPoint(box, point) {
  return { left: box.left + point.x, top: box.top + point.y, width: box.width, height: box.height };
}

/**
 * One crop recipe as a picture: its layers in **absolute art pixels** with the art's anchor at the
 * origin, scaled by the size the wire stated.
 * a picture has to be placed by the point the crop *stands* on, which is the anchor its frame names.
 * So the art's own anchor becomes the origin, the frame's own rectangle becomes the art layer's, and
 * every mutation layer moves by the same amount. `box` is the union of all of them: the tight
 * per-request union, this API's convention.
 */
function pictureOf(recipe, scale) {
  const art = recipe.layers.find((layer) => layer.kind === "art");
  if (art === undefined) return null;
  const frame = drawnFrame(art.sprite);
  if (frame === null) return null;
  const atX = -frame.box.anchorX * frame.box.width * scale;
  const atY = -frame.box.anchorY * frame.box.height * scale;

  const layers = recipe.layers.map((layer) => {
    if (layer.kind === "art") {
      return {
        ...layer,
        sprite: art.sprite,
        left: atX,
        top: atY,
        width: frame.box.width * scale,
        height: frame.box.height * scale,
      };
    }
    return {
      ...layer,
      left: atX + (layer.left - art.left) * scale,
      top: atY + (layer.top - art.top) * scale,
      width: layer.width * scale,
      height: layer.height * scale,
    };
  });

  const box = boxOf(
    layers.map((layer) => ({ left: layer.left, top: layer.top, width: layer.width, height: layer.height })),
  );
  return { recipe, layers, box, anchor: { x: atX, y: atY }, frame };
}

/**
 * A `crop` item: the package's recipe for that species and mutation set, placed on its tile.
 *
 * The picture's corner is placed so that the **art's own anchor** lands on the tile's origin — the
 * point the crop stands on — which is the point the package laid every layer out against. The tile's
 * origin is `column × step, row × step`, so it does not depend on how large any item's art is.
 */
async function layOutCrop(item) {
  const [recipe, multiplier] = await Promise.all([
    cropRecipe(item.species, item.mutations),
    cropMultiplier(item.species),
  ]);
  if (recipe === null) return null;

  const scale = sizeScale(item.size, multiplier);
  const picture = pictureOf(recipe, scale);
  if (picture === null) return null;

  // The picture's corner is the tile origin moved by whatever the recipe reaches before its art's
  // anchor — a mutation's icon above the art, a decal under it — so the art lands on the tile. The
  // recipe is in the art's own coordinates, where the art's anchor is the origin, so the picture is
  // placed by that anchor and not by its corner: the corner is `origin + box`.
  const tile = tileOrigin(item.at);
  const at = { x: tile.x - picture.anchor.x, y: tile.y - picture.anchor.y };
  const layers = picture.layers.map((layer) => ({ ...layer, left: layer.left + at.x, top: layer.top + at.y }));

  return {
    id: item.id,
    kind: "crop",
    species: item.species,
    at: item.at,
    scale,
    box: boxOf(layers.map((layer) => ({ left: layer.left, top: layer.top, width: layer.width, height: layer.height }))),
    layers,
    sprites: [...new Set(layers.map((layer) => layer.sprite).filter(Boolean))],
    crops: [],
  };
}

/** A `plant` item: the package's recipe for the plant, its pot and the crops in its slots. */
async function layOutPlant(item) {
  const [art, records] = await Promise.all([plantArt(item.species), plantRecords()]);
  if (art === null) return null;

  const record = records[item.species] ?? {};
  const offsets = Array.isArray(record?.plant?.slotOffsets) ? record.plant.slotOffsets : [];
  const multiplier = await cropMultiplier(item.species);

  const sceneCrops = [];
  const cropPictures = [];
  for (const crop of item.crops) {
    const recipe = await cropRecipe(item.species, crop.mutations);
    if (recipe === null) return null;
    const picture = pictureOf(recipe, sizeScale(crop.size, multiplier));
    if (picture === null) return null;
    const at = offsets.length === 0 ? { x: 0, y: 0, rotation: 0 } : offsets[crop.slot % offsets.length] ?? {};
    sceneCrops.push({
      species: item.species,
      x: typeof at.x === "number" ? at.x : 0,
      y: typeof at.y === "number" ? at.y : 0,
      rotation: typeof at.rotation === "number" ? at.rotation : 0,
      scale: sizeScale(crop.size, multiplier),
      depth: 2 + crop.slot,
      // The composition `plantPicture` carries through and hangs off the crop's own frame, in the
      // shape it states: a box and the layers inside it, in the crop art's own pixels.
      composition: { layers: picture.layers, box: picture.box },
    });
    cropPictures.push({ slot: crop.slot, scale: sizeScale(crop.size, multiplier), picture, recipe, at });
  }

  const pot = item.potted ? await potFrame() : null;
  const scene = { species: item.species, mature: item.matured === true, weather: null, crops: sceneCrops };
  let recipe = plantPicture(scene, { [item.species]: art }, pot);
  // A single-harvest species is a **patch**: it has no body of its own, so `plantPicture` draws its
  // crops and nothing else — and a patch with no crops in it has nothing to draw at all, which the
  // package refuses with `null`. The game does not: a patch is a tile of that art whether or not a
  // crop is standing on it (a seed packet, a menu icon, an empty tile), so the species' own art is
  // drawn once, at the point the plant stands on. That is the same art `plantPicture` would draw for
  // a crop of this species, at the same anchor, which is why the recipe is not re-derived here.
  if (recipe === null && sceneCrops.length === 0) {
    recipe = {
      species: item.species,
      box: {
        left: -art.plant.frame.anchorX * art.plant.frame.width,
        top: -art.plant.frame.anchorY * art.plant.frame.height,
        width: art.plant.frame.width,
        height: art.plant.frame.height,
      },
      layers: [
        {
          kind: "plant",
          sprite: art.plant.sprite,
          left: -art.plant.frame.anchorX * art.plant.frame.width,
          top: -art.plant.frame.anchorY * art.plant.frame.height,
          width: art.plant.frame.width,
          height: art.plant.frame.height,
          anchorX: art.plant.frame.anchorX,
          anchorY: art.plant.frame.anchorY,
          turn: 0,
          composition: null,
        },
      ],
    };
  }
  if (recipe === null) return null;

  // The package laid every part out with the plant's own anchor as its origin, so the tile's origin
  // is where that anchor lands: the plant stands on the tile it names.
  const origin = tileOrigin(item.at);
  /** Which crop each nested picture belongs to, in the order the package placed them. */
  const cropOfLayer = new Map();
  let cropIndex = 0;
  const placed = recipe.layers.map((layer) => {
    const one = {
      kind: layer.kind,
      sprite: layer.sprite,
      left: origin.x + layer.left,
      top: origin.y + layer.top,
      width: layer.width,
      height: layer.height,
      turn: layer.turn ?? 0,
      washes: [],
      material: false,
      nested: null,
    };
    if (layer.kind !== "crop" || layer.composition === null || layer.composition === undefined) return one;
    // A crop's picture hangs off the frame `plantPicture` placed it on: the picture's corner is that
    // frame's corner moved by the composition's own anchor, and every layer inside it moves with it.
    const composition = layer.composition;
    const corner = { x: one.left + (composition.anchor?.x ?? 0), y: one.top + (composition.anchor?.y ?? 0) };
    const drawn = {
      ...one,
      nested: composition.layers.map((inner) => ({
        kind: inner.kind,
        sprite: inner.sprite,
        left: corner.x + inner.left,
        top: corner.y + inner.top,
        width: inner.width,
        height: inner.height,
        washes: [...(inner.washes ?? [])],
        material: inner.material === true,
        nested: null,
      })),
    };
    cropOfLayer.set(drawn, cropPictures[cropIndex]);
    cropIndex += 1;
    return drawn;
  });

  // A plant's own mutations are its *body's* mutations: the package's crop recipe applied to the
  // species' plant art, re-anchored so the art's own anchor is the point the plant stands on. That is
  // the same recipe `cropComposition` answers for this species, and the same arithmetic
  // `cropComposition` itself uses (`crop.ts`'s `artLayer` is the art at the origin, which is why the
  // shift below is only the art's own anchor).
  let layers = placed;
  if (item.mutations.length > 0) {
    const body = await cropRecipe(item.species, item.mutations);
    if (body === null) return null;
    const picture = pictureOf(body, 1);
    if (picture === null) return null;
    const index = placed.findIndex((layer) => layer.kind === "plant");
    const bodyLayers = picture.layers.map((layer) => ({
      kind: layer.kind,
      sprite: layer.sprite,
      left: origin.x + layer.left,
      top: origin.y + layer.top,
      width: layer.width,
      height: layer.height,
      turn: 0,
      washes: [...(layer.washes ?? [])],
      material: layer.material === true,
      nested: null,
    }));
    layers =
      index < 0
        ? [...placed, ...bodyLayers]
        : [...placed.slice(0, index), ...bodyLayers, ...placed.slice(index + 1)];
  }

  // The crop boxes are the pictures the layers above hang on each crop's own frame.
  const cropLayers = layers
    .filter((layer) => layer.nested !== null)
    .map((layer) => ({ ...cropOfLayer.get(layer), layers: layer.nested }))
    .filter((crop) => crop.slot !== undefined);

  // The item's own box is the union of what it draws: the plant's parts, and each crop's own picture
  // rather than the frame it stands on — a mutation's art reaches past that frame, and a box that
  // stopped at it would clip the picture it is supposed to hold.
  const box = boxOf(layers.map(layerBox));

  return {
    id: item.id,
    kind: "plant",
    species: item.species,
    at: item.at,
    box,
    layers,
    sprites: [
      ...new Set(
        layers
          .flatMap((layer) => [layer.sprite, ...(layer.nested ?? []).map((inner) => inner.sprite)])
          .filter(Boolean),
      ),
    ],
    crops: cropLayers.map((crop) => ({
      slot: crop.slot,
      scale: crop.scale,
      box: boxOf(crop.layers.map(layerBox)),
    })),
  };
}

/** The rectangle a painted layer covers, its nested picture included. */
function layerBox(layer) {
  if (layer.nested === null || layer.nested.length === 0) {
    return { left: layer.left, top: layer.top, width: layer.width, height: layer.height };
  }
  return boxOf(layer.nested.map(layerBox));
}

/** The pot's frame, from the game's own sprite-name table. */
async function potFrame() {
  const tables = await artTables();
  const path = tables?.spriteNames?.Item?.[POT_NAME] ?? tables?.spriteNames?.Plant?.[POT_NAME] ?? null;
  if (path === null) return null;
  const frame = drawnFrame(path);
  return frame === null ? null : { sprite: path, frame: frame.box };
}

/** The tile block a background states, as one layer per tile in the game's own art. */
async function layOutBackground(block) {
  // The sprite index, loaded before anything asks it for a frame: a background is laid out *before*
  // the items, so it is the first caller of `drawnFrame()` on a cold process and cannot rely on a
  // crop having loaded the index first. `initSprites()` is idempotent.
  await initSprites();
  const tables = await artTables();
  const path = tables?.spriteNames?.Tile?.[block.ground] ?? `tile/${block.ground}`;
  const frame = drawnFrame(path);
  if (frame === null) return null;
  const tiles = [];
  for (let row = 0; row < block.rows; row += 1) {
    for (let column = 0; column < block.columns; column += 1) {
      tiles.push({
        sprite: path,
        left: column * TILE_STEP_PX,
        top: row * TILE_STEP_PX,
        width: frame.box.width,
        height: frame.box.height,
        turn: 0,
        washes: [],
        material: false,
        nested: null,
      });
    }
  }
  return { block, path, tiles };
}

/**
 * A whole scene: every item's box, the canvas, and the painted layers the rasteriser draws.
 *
 * Returns `{ error }` for a spec this endpoint cannot draw (an unknown species, an art the atlas does
 * not hold) and throws a `ComposeSpecError` for one the limits refuse — the canvas bound can only be
 * known once the scene has been measured, so it is checked here rather than at parse time.
 */
export async function layOutScene(rawSpec) {
  const spec = normalizeSpec(rawSpec);

  const background = spec.background === null ? null : await layOutBackground(spec.background);
  if (spec.background !== null && background === null) {
    return { error: `background: the atlas holds no tile named ${spec.background.ground}` };
  }

  const items = [];
  for (const item of spec.items) {
    const laid = item.kind === "plant" ? await layOutPlant(item) : await layOutCrop(item);
    if (laid === null) {
      return { error: `${item.id}: ${item.species} has no picture the tables and the atlas both state` };
    }
    items.push(laid);
  }

  const boxes = items.map((item) => item.box);
  if (background !== null) boxes.push(...background.tiles.map((tile) => ({ left: tile.left, top: tile.top, width: tile.width, height: tile.height })));

  const content = boxOf(boxes);
  const padding = spec.canvas.padding;
  const canvas = {
    width: Math.max(1, Math.ceil(content.width) + padding * 2),
    height: Math.max(1, Math.ceil(content.height) + padding * 2),
  };
  assertWithinCanvas(canvas);

  // The picture's corner in the scene's own coordinates: the content's corner, moved out by the
  // padding. Every layer below is a scene coordinate; the rasteriser subtracts this one.
  const origin = { x: content.left - padding, y: content.top - padding };
  const toPicture = (box) => ({
    x: Math.round(box.left - origin.x),
    y: Math.round(box.top - origin.y),
    width: Math.max(1, Math.round(box.width)),
    height: Math.max(1, Math.round(box.height)),
  });

  /**
   * The same rectangle in the scene's own coordinates, where `column × step, row × step` is the tile
   * a thing names. It is the frame the grid arithmetic is stated in, so a caller can check where its
   * item landed against the tile it asked for without knowing the picture's own corner.
   */
  const toScene = (box) => ({
    x: Math.round(box.left),
    y: Math.round(box.top),
    width: Math.max(1, Math.round(box.width)),
    height: Math.max(1, Math.round(box.height)),
  });

  const shift = (layer) => ({
    ...layer,
    left: layer.left - origin.x,
    top: layer.top - origin.y,
    nested:
      layer.nested === null || layer.nested === undefined
        ? null
        : layer.nested.map((inner) => ({ ...inner, left: inner.left - origin.x, top: inner.top - origin.y })),
  });

  const layout = {
    spec: SPEC_VERSION,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      // Where the scene's own origin (column 0, row 0) sits in the picture, so a caller can turn a box
      // back into a tile and a tile back into a box.
      origin: { x: Math.round(-origin.x), y: Math.round(-origin.y) },
      grid: {
        step: TILE_STEP_PX,
        columns: spec.background === null ? null : spec.background.columns,
        rows: spec.background === null ? null : spec.background.rows,
      },
      fit: spec.canvas.fit,
      padding,
    },
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      species: item.species,
      box: toPicture(item.box),
      scene: toScene(item.box),
      z: item.kind === "plant" ? 0 : 2,
      sprites: item.sprites,
      crops: item.crops.map((crop) => ({
        slot: crop.slot,
        scale: Number(crop.scale.toFixed(6)),
        box: toPicture(crop.box),
        scene: toScene(crop.box),
      })),
    })),
    background:
      background === null
        ? null
        : {
            ground: background.block.ground,
            columns: background.block.columns,
            rows: background.block.rows,
            sprite: background.path,
          },
  };

  const layers = [...(background === null ? [] : background.tiles), ...items.flatMap((item) => item.layers)].map(shift);

  return { spec, layout, layers, canvas, origin };
}
