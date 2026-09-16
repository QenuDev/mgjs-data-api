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
import { assertWithinCanvas, ComposeSpecError, normalizeSpec, SPEC_VERSION } from "./spec.js";
import { scatterPlaces } from "./sceneScatter.js";

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

/**
 * One tile position in the scene's own coordinates: where on the scene the tile an item names is.
 *
 * It is the tile's **centre**, not its top-left corner, and that is the game's own convention rather
 * than a choice made here. Three places in the game's own chunks say so, and they agree in both the
 * 1176 capture this repo's fixture comes from and the 1192 one it serves:
 *
 *   * a tile's outline is drawn as `e.roundRect(-128, -128, 256, 256, 16)` — a 256x256 rectangle
 *     centred on the local origin, so the origin of the space a tile is drawn in is its middle;
 *   * anything pinned to a tile is positioned `position.set(i * 256 + 256 / 2, a * 256 + 256 / 2)`
 *     (the hover marker and the route marker), which is the tile's centre in world pixels;
 *   * `getFallbackOriginWorldPosition` converts a dirt tile the same way, `(n.x + .5) * 256`.
 *
 * This function used to return `column * TILE_STEP_PX, row * TILE_STEP_PX` — the corner — which put
 * every item exactly half a tile up and to the left of the tile it named, and nothing caught it
 * because the layout test asserted the same rule the code used. Measured on a five-by-four dirt
 * background before the fix: a sunflower at column 1 had its box at x=175, which is `1 * 256 - 167/2`
 * with a centre anchor — the art's centre on the tile's left edge — where the tile's centre is 384.
 */
function tileOrigin(at) {
  const column = (at?.column ?? 0) + 0.5;
  const row = (at?.row ?? 0) + 0.5;
  return { x: column * TILE_STEP_PX, y: row * TILE_STEP_PX };
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
  return { recipe, layers, box, frame };
}

/**
 * The point inside a tile an item's art anchor lands on: the tile's middle, moved by the place the
 * item states.
 *
 * A place is **tile fractions** (`x`, `y`) and **degrees** (`rotation`), which is the unit the
 * game's own save states a crop's place in, and the tile is the reference tile the whole layout is
 * measured in (`TILE_STEP_PX`). Absent is `0` — the tile's middle — which is what the composer drew
 * before spec 2 and what a spec-1 caller still gets.
 *
 * This is the one place the two units meet, and both factors are the game's: `x * 256` is the
 * renderer's own `e.x * 256`, and the tile's middle is `tileOrigin`'s.
 */
function placedPoint(item) {
  const tile = tileOrigin(item.at);
  return {
    x: tile.x + (item.at?.x ?? 0) * TILE_STEP_PX,
    y: tile.y + (item.at?.y ?? 0) * TILE_STEP_PX,
    rotation: item.at?.rotation ?? 0,
  };
}

/**
 * A `crop` item: the package's recipe for that species and mutation set, placed on its tile.
 *
 * The picture's corner is placed so that the **art's own anchor** lands on the point the item
 * stands on — the tile's middle, moved by any place the spec states — which is the point the
 * package laid every layer out against. This used to subtract `picture.anchor` first, and that
 * field is the art's *top-left* in this space rather than its anchor, so what landed on the tile
 * was the picture's bounding-box corner. It was invisible while the tile origin was the tile's own
 * corner (both readings put the clover inside its tile, one of them by accident) and it stopped
 * being invisible the moment the origin moved to the tile's middle, which is where the game puts it.
 *
 * The item's place also **turns** the picture, about each layer's own anchor — the art's for the
 * art's layer, the crop's for every layer of its composed picture. The box stays the axis-aligned
 * union of the rectangles, which is the convention this file has always had (`plantPicture`'s crop
 * `turn` is carried the same way).
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

  const at = placedPoint(item);
  const layers = picture.layers.map((layer) => ({
    ...layer,
    left: layer.left + at.x,
    top: layer.top + at.y,
    turn: layer.kind === "art" || layer.kind === "mutation" ? at.rotation : (layer.turn ?? 0),
  }));

  return laidItem(item, {
    box: boxOf(layers.map((layer) => ({ left: layer.left, top: layer.top, width: layer.width, height: layer.height }))),
    layers,
    sprites: [...new Set(layers.map((layer) => layer.sprite).filter(Boolean))],
  });
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
  const patch = record?.plant?.harvestType === "Single";
  for (let index = 0; index < item.crops.length; index += 1) {
    const crop = item.crops[index];
    const recipe = await cropRecipe(item.species, crop.mutations);
    if (recipe === null) return null;
    const picture = pictureOf(recipe, sizeScale(crop.size, multiplier));
    if (picture === null) return null;
    const at = offsets.length === 0 ? { x: 0, y: 0, rotation: 0 } : offsets[crop.slot % offsets.length] ?? {};
    const x = typeof at.x === "number" ? at.x : 0;
    const y = typeof at.y === "number" ? at.y : 0;
    // The game's own crop `zIndex` without the band the crops share: a patch stacks by its y place,
    // a plant by its slot id (`plant.ts`'s `PlantCrop.depth` states both).
    const depth = patch ? Math.round((y + 1) * 10) : 2 + crop.slot;
    sceneCrops.push({
      species: item.species,
      x,
      y,
      rotation: typeof at.rotation === "number" ? at.rotation : 0,
      scale: sizeScale(crop.size, multiplier),
      depth,
      // The composition `plantPicture` carries through and hangs off the crop's own frame, in the
      // shape it states: a box and the layers inside it, in the crop art's own pixels. `index` is the
      // composer's own key back to this crop — the package sorts the layers by `depth`, so the layer
      // order is not the stated order.
      composition: { index, layers: picture.layers, box: picture.box },
    });
    cropPictures.push({
      slot: crop.slot,
      scale: sizeScale(crop.size, multiplier),
      depth,
      picture,
      recipe,
      at: { x, y },
    });
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

  // The package laid every part out with the plant's own anchor as its origin, so the tile's middle
  // is where that anchor lands: the plant stands on the middle of the tile it names (a plant's own
  // place, when it states one, moves that point exactly as it moves a crop's).
  const origin = placedPoint(item);
  const { layers: placed, crops: cropLayers } = cropLayersOf(recipe, origin, cropPictures);

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

  // The item's own box is the union of what it draws: the plant's parts, and each crop's own picture
  // rather than the frame it stands on — a mutation's art reaches past that frame, and a box that
  // stopped at it would clip the picture it is supposed to hold.
  const box = boxOf(layers.map(layerBox));

  return laidItem(item, {
    box,
    layers,
    sprites: [
      ...new Set(
        layers
          .flatMap((layer) => [layer.sprite, ...(layer.nested ?? []).map((inner) => inner.sprite)])
          .filter(Boolean),
      ),
    ],
    descriptors: cropLayers,
  });
}

/**
 * The item's own `at`, as the layout reports it: the tile, and the place inside it when there is one.
 *
 * The place is echoed in the same unit the spec stated it in (tile fractions and degrees) and only
 * when the spec stated one, so a spec-1 request's layout has exactly the shape it had before spec 2
 * and a spec-2 caller can still check where its item landed without knowing a pixel.
 */
function reportedAt(item) {
  if (item.at === null) return null;
  const { column, row, x, y, rotation } = item.at;
  return {
    column,
    row,
    ...(x === null || x === undefined ? {} : { x }),
    ...(y === null || y === undefined ? {} : { y }),
    ...(rotation === null || rotation === undefined ? {} : { rotation }),
  };
}

/**
 * The crop layers a `plantPicture` recipe carries, moved onto the scene's own origin.
 *
 * A crop's picture hangs off the frame `plantPicture` placed it on: the picture's corner is that
 * frame's corner moved by the composition's own anchor, and every layer inside it moves with it.
 *
 * Which descriptor a layer belongs to is read off `composition.index`, the key the caller put on the
 * composition it handed over, rather than off the layer's position: `plantPicture` sorts its crop
 * layers by `depth` (`plant.ts`), so the nth layer is not the nth crop the caller stated — and for a
 * patch that depth is the sprig's own y place, which is exactly the thing being reported.
 */
function cropLayersOf(recipe, origin, cropAt) {
  const layers = recipe.layers.map((layer) => {
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
    // Which crop a layer is comes off the composition the caller handed over rather than off the
    // layer's position in the returned list: `plantPicture` sorts its crop layers by `depth`, so the
    // nth layer is not the nth crop the caller stated.
    drawn.cropAt = cropAt[layer.composition.index] ?? null;
    return drawn;
  });

  // The crop boxes are the pictures the layers above hang on each crop's own frame, in the order the
  // package drew them — which is the package's own depth order, so the reported crops are the stack.
  const crops = layers
    .filter((layer) => layer.nested !== null)
    .map((layer) => {
      const crop = layer.cropAt ?? null;
      return crop === null ? null : { ...crop, layers: layer.nested };
    })
    .filter((crop) => crop !== null && crop.slot !== undefined);

  return { layers, crops };
}

/**
 * The result item every layout path answers, whichever kind it drew.
 *
 * `kind` is the kind the spec stated — a `patch` and a `plant` are drawn by different paths and the
 * layout says which one ran, so a caller can tell a cluster from a body without re-reading its spec.
 *
 * Each crop carries the place the package gave it and the depth it stacks at (the game's own crop
 * `zIndex` less the band the crops share), so a caller can check a cluster sprig by sprig without
 * decoding the picture: `place` says where it stands in the tile, `depth` says its turn in the stack.
 * The crop order is the draw order, because the package hands its layers back sorted by that depth.
 */
function laidItem(item, { box, layers, sprites, descriptors = [] }) {
  return {
    id: item.id,
    kind: item.kind,
    species: item.species,
    at: reportedAt(item),
    box,
    layers,
    sprites,
    crops: descriptors.map((crop) => ({
      slot: crop.slot,
      place: placeOfCrop(crop),
      depth: crop.depth,
      scale: crop.scale,
      box: boxOf(crop.layers.map(layerBox)),
    })),
  };
}

/** A crop's place as the layout reports it: the in-tile fields the spec or the scatter stated. */
function placeOfCrop(crop) {
  const place = { x: crop.at.x, y: crop.at.y };
  const rotation = crop.at.rotation ?? crop.rotation;
  if (typeof rotation === "number") place.rotation = rotation;
  return place;
}

/**
 * A `patch` item: the species' own art and the cluster of sprigs standing on the tile.
 *
 * This is the game's own branch, not a second reading of it:
 *
 *   * the species must be a patch — `harvestType: "Single"` **and** a `slotCapacity`, which is the
 *     `patch-capacity` ceiling the game's own UI shows (`Ks(r, n)` slots filled of `n`). A species
 *     with a `baseTileScale` and no slot counts is a one-art plant, and a cluster of it would be a
 *     picture the game never draws;
 *   * `crops.length` over `slotCapacity` is refused by name rather than truncated, the way the
 *     game's own `patchFull` refuses it;
 *   * a sprig's place is the one the spec states, or the game's own scatter seeded from the item's
 *     id when the sprig states none (`sceneScatter.js`);
 *   * `plantPicture` draws a `Single`-harvest crop from the species' **plant** art (rule 3), which
 *     for a patch is the art of the cluster itself, so the sprigs are handed over as crops of the
 *     patch's own species with the patch's own art;
 *   * each sprig stacks by its y place (`Math.round((y + 1) * 10)`), which is the depth the package
 *     sorts its crop layers by.
 *
 * The sprigs' sizes come from the caller and are never generated: `size` is the game's own 50-to-100
 * band and the curve that turns it into a drawn scale is the species' `maxSizeMultiplier`.
 */
async function layOutPatch(item) {
  const [art] = await Promise.all([plantArt(item.species)]);
  if (art === null) return null;

  const record = (await plantRecords())[item.species] ?? {};
  assertPatchSpecies(record, item);

  const multiplier = await cropMultiplier(item.species);
  const places = scatterPatch(item);
  const origin = placedPoint(item);

  const sceneCrops = [];
  const cropAt = [];
  for (let index = 0; index < item.crops.length; index += 1) {
    const crop = item.crops[index];
    const place = places[index];
    const scale = sizeScale(crop.size, multiplier);
    // The game's own crop `zIndex` on a patch: the layer stacks by its y place, so a sprig lower in
    // the tile is drawn over one higher up (`resources-D_3Zwcn-.js`'s `createCrops`).
    const depth = Math.round((place.y + 1) * 10);
    const recipe = await cropRecipe(item.species, crop.mutations);
    if (recipe === null) return null;
    const picture = pictureOf(recipe, scale);
    if (picture === null) return null;
    sceneCrops.push({
      species: item.species,
      x: place.x,
      y: place.y,
      rotation: place.rotation,
      scale,
      depth,
      composition: { index, layers: picture.layers, box: picture.box },
    });
    cropAt.push({
      slot: crop.slot,
      scale,
      depth,
      at: { x: place.x, y: place.y },
      rotation: place.rotation,
      flipped: crop.flipped,
    });
  }

  const scene = { species: item.species, mature: true, weather: null, crops: sceneCrops };
  const recipe = plantPicture(scene, { [item.species]: art }, null);
  if (recipe === null) return null;

  const { layers, crops: cropBoxes } = cropLayersOf(recipe, origin, cropAt);
  return laidItem(item, {
    box: boxOf(layers.map(layerBox)),
    layers,
    sprites: [
      ...new Set(
        layers
          .flatMap((layer) => [layer.sprite, ...(layer.nested ?? []).map((inner) => inner.sprite)])
          .filter(Boolean),
      ),
    ],
    descriptors: cropBoxes,
  });
}

/**
 * Refuse a `patch` whose species is not a patch, or one over the species' own `slotCapacity`.
 *
 * Both are named refusals rather than a truncation or a silently smaller cluster: a patch of a
 * one-art species and a patch of eighteen sprigs on a fifteen-slot tile are both pictures the game
 * never draws, and returning one would be exactly the wrong-picture failure the limits exist for.
 */
function assertPatchSpecies(record, item) {
  const plant = record?.plant ?? {};
  const capacity = integerOrNull(plant.slotCapacity);
  if (plant.harvestType !== "Single" || capacity === null) {
    throw new ComposeSpecError(
      "COMPOSE_PATCH_NOT_A_PATCH",
      `items: ${item.species} is not a patch this API can draw: a patch species states ` +
        `harvestType "Single" and a slotCapacity (${item.species} states ` +
        `${plant.harvestType === undefined ? "no harvestType" : JSON.stringify(plant.harvestType)}` +
        `${capacity === null ? " and no slotCapacity" : ""}). State kind "plant" for a species with a body`,
      { limit: "patch", saw: item.species },
    );
  }
  if (item.crops.length > capacity) {
    throw new ComposeSpecError(
      "COMPOSE_PATCH_OVER_CAPACITY",
      `items: ${item.species} holds at most ${capacity} crops, and this patch states ${item.crops.length}; ` +
        `the game refuses the same way (patchFull) rather than dropping sprigs`,
      { limit: "slotCapacity", saw: item.crops.length },
    );
  }
}

/**
 * The place of every sprig: the one the spec states, or the game's own scatter for the ones that
 * state none.
 *
 * The scatter is seeded from the item's id, so the same spec composes the same picture twice — the
 * cache is content-addressed, and a scene that reshuffled itself per request would be a bug rather
 * than a feature.
 */
function scatterPatch(item) {
  // A place is *stated* only when it states a point: the normaliser fills an absent one with three
  // nulls, and a sprig that states no point is exactly the sprig the game's scatter is for.
  const claims = (at) => at !== null && at !== undefined && typeof at.x === "number" && typeof at.y === "number";
  const generated = scatterPlaces(item.crops.length, {
    seed: item.id,
    seeded: item.crops.map((crop) => (claims(crop.at) ? { x: crop.at.x, y: crop.at.y } : null)),
  });
  return item.crops.map((crop, index) =>
    claims(crop.at)
      ? { x: crop.at.x, y: crop.at.y, rotation: crop.at.rotation ?? 0 }
      : generated[index],
  );
}

/**
 * An item's `at` with the place keys it did not state left out.
 *
 * The normaliser fills an absent place with three nulls so the layout arithmetic has one shape to read;
 * a caller that stated no place gets back exactly the `{ column, row }` it sent, which is also the
 * shape a spec-1 requester read before spec 2 existed.
 */
function stripNullPlace(at) {
  if (at === null || at === undefined) return null;
  const { column, row } = at;
  const place = {};
  if (typeof at.x === "number") place.x = at.x;
  if (typeof at.y === "number") place.y = at.y;
  if (typeof at.rotation === "number") place.rotation = at.rotation;
  return { column, row, ...place };
}

/** A finite integer, or `null` — `0` is a value and must not be read as absent. */
function integerOrNull(value) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
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
    const laid =
      item.kind === "patch"
        ? await layOutPatch(item)
        : item.kind === "plant"
          ? await layOutPlant(item)
          : await layOutCrop(item);
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
   * The same rectangle in the scene's own coordinates, where `(column + .5) × step, (row + .5) × step`
   * is the middle of the tile a thing names. It is the frame the grid arithmetic is stated in, so a
   * caller can check where its item landed against the tile it asked for without knowing the
   * picture's own corner.
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
      at: stripNullPlace(item.at),
      box: toPicture(item.box),
      scene: toScene(item.box),
      // A tile-standing thing — a plant's body, a patch's cluster — is drawn before the bare crops
      // (menu pictures, seed packets) a spec puts in the same scene. Inside one item the sprigs stack
      // by the `depth` below, which is the game's own crop `zIndex`.
      z: item.kind === "crop" ? 2 : 0,
      sprites: item.sprites,
      crops: item.crops.map((crop) => ({
        slot: crop.slot,
        place: crop.place,
        depth: crop.depth,
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
