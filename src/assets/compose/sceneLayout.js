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
//     (`1 + (size − 50)/50 × (maxSizeMultiplier − 1)`), a `plant`'s slot number to its place on the
//     plant, the tilt a crop's `startTime` gives it, the shift its `plantTransform` pivot needs, and
//     the depth the game stacks a crop and a tile at. All of that is the renderer's own arithmetic and
//     it lives in one file, `cropPlacement.js`, with each number quoted from the bundle: the package is
//     handed a place and lays a frame out on it, and *which* place a slot gets is not a question a
//     recipe can answer. The split is the game's own (`PlantBody.createCrops` reads the blueprint and
//     `PlantCrop`/`CropVisual` draw) and the same one `garden-viewer/garden.mjs:271-341` makes;
//   * **the flattening** — the package answers a *recipe* (a crop's picture, a plant's parts), and a
//     rasteriser wants a painted list: every layer in picture coordinates, in the game's own order.
//     Inside an item that order is the package's (`plant.ts:1-30` states the ladder); between items it
//     is the world's, `cropPlacement.js`'s `worldDepthKey`, so a tile lower on the screen is painted
//     after — and so in front of — one behind it, whatever order the spec listed them in.
//
// ## The box convention, and which one this is
//
// Each item's box **is** the union of what that item actually draws: this API's convention
// (`src/assets/sprites/cropBox.js` states it for the single-picture path, and the plan's item 24
// keeps it). It is deliberately not `@mg.js/art`'s own species-wide box — `cropComposition`'s `reach`
// array unions every mutation the tables state, worn or not (`crop.ts:261-263`), so a clover's recipe
// box is 213×306 where the tight union is 116×169. The package's placement *inside* those boxes is
// what is shared, and a test asserts that agreement where the two conventions coincide.

import { boxOf, iconArt, REFERENCE_TILE_PX } from "@mg.js/art";

import { initSprites } from "../sprites/sprites.js";
import {
  artTables,
  cropMultiplier,
  cropRecipe,
  decorArtPath,
  drawnFrame,
  plantArt,
  plantRecords,
  plantPicture,
  portraitFrame,
  spriteFrames,
  toolArtName,
} from "./artBridge.js";
import { assertWithinCanvas, ComposeSpecError, ICON_ITEM_TYPES, normalizeSpec, SPEC_VERSION } from "./spec.js";
import { scatterPlaces } from "./sceneScatter.js";
import { materialKindOf } from "./materials.js";
import { growthOf } from "./growth.js";
import { chargedToolArtName, crystalScale, decorOffset, eggScale } from "./tileObjects.js";
import {
  CROP_LAYER,
  iconPlace,
  placedInPatch,
  placedOnPlant,
  PLANT_LAYER,
  PLANT_MIDDLE,
  sizeScale,
  slotOffsetAt,
  slotSpecies,
  worldDepthKey,
} from "./cropPlacement.js";

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

/**
 * The game's own icon square, in the reference tile's pixels.
 *
 * It is the literal the game's icon builder is called with (`ji(…, 256)`) and the frame the texture it
 * generates carries (`new Rectangle(0, 0, 256, 256)`), so an icon is composed at exactly one tile's
 * size — which is why an `icon` item's `at` places it the way any other item's does.
 */
export const ICON_BOX_PX = 256;

/** The field an icon item's art is named in, for an error that has to say which one was empty. */
const ICON_ID_FIELDS = Object.freeze({
  Seed: "species",
  Produce: "species",
  Plant: "species",
  Tool: "toolId",
  Egg: "eggId",
  Decor: "decorId",
  // A pet is named by its species too, even though its icon is baked rather than drawn from a sprite:
  // the bake is addressed by the species, which is why the field is stated rather than left out.
  Pet: "species",
});

/** The id field of one item type, or `id` for a type the game's own enum does not name. */
function iconIdField(itemType) {
  return ICON_ID_FIELDS[itemType] ?? "id";
}

/** The pot every potted plant stands in, as the game's atlas names it. */
const POT_NAME = "PlanterPot";

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
  const [recipe, multiplier, records] = await Promise.all([
    cropRecipe(item.species, item.mutations),
    cropMultiplier(item.species),
    plantRecords(),
  ]);
  if (recipe === null) return null;

  // The size it reached times how far it has grown: a bare crop is the same picture a crop on a plant
  // is, laid out on its own, and the growth is its own species' harvest type's (`growth.js`).
  const scale = sizeScale(item.size, multiplier) * growthOf(item, records[item.species]?.plant?.harvestType);
  const picture = pictureOf(recipe, scale);
  if (picture === null) return null;

  const at = placedPoint(item);
  // `Rainbow` and `Gold` are materials, not washes (`materials.js`): the whole surface is replaced, so the
  // overlay filter the recipe states — if any — is dropped, which is the game's own rule (`Cn` takes a
  // colour overlay only while there is no material).
  const material = materialKindOf(item.mutations);
  const layers = picture.layers.map((layer) => ({
    ...layer,
    left: layer.left + at.x,
    top: layer.top + at.y,
    turn: layer.kind === "art" || layer.kind === "mutation" ? at.rotation : (layer.turn ?? 0),
    // The point the crop stands on: the turn happens about it, in the layout's own arithmetic and in
    // the rasteriser, so it travels with the layer.
    pivot: at,
    materialKind: layer.kind === "art" ? material : null,
    washes: material === null ? [...(layer.washes ?? [])] : [],
  }));

  return laidItem(item, {
    box: boxOf(layers.map(drawnBox)),
    layers,
    sprites: [...new Set(layers.map((layer) => layer.sprite).filter(Boolean))],
  });
}

/**
 * One art standing on a tile: the sprite one of the game's own sprite-name tables states, drawn at
 * the scale the kind's own rule gives, with the **art's own anchor** on the tile's middle.
 *
 * This is the whole picture an egg, a crystal or a decoration has. The game builds each of them the
 * same way — one sprite from a name, no anchor and no pivot stated, so the frame's own anchor is the
 * point that lands on the tile and the art scales about it — which is why they share this function
 * and differ only in their sprite and their scale. `tileObjects.js` quotes the three rules.
 *
 * `offsetPixels` is the decoration's own: the game moves a hanging decoration half a tile and feeds
 * the same y to its depth key, so it is added to the place rather than kept apart from it.
 */
async function tileObjectArt(item, { path, scale = 1, offsetPixels = null }) {
  // The sprite index has to be loaded before a frame can be resolved, the same way `plantArt` loads it
  // before `plantPicture` asks for a species' art.
  await initSprites();
  const frame = drawnFrame(path);
  if (frame === null) return null;

  const point = placedPoint(item);
  const offset = offsetPixels ?? { x: 0, y: 0 };
  // The art's anchor is the point the game pins to the tile, so the rectangle's corner is the anchor
  // less the art's own size — the same arithmetic `pictureOf` does for a crop, with one layer.
  const width = frame.box.width * scale;
  const height = frame.box.height * scale;
  const layer = {
    sprite: path,
    left: point.x + offset.x - frame.box.anchorX * width,
    top: point.y + offset.y - frame.box.anchorY * height,
    width,
    height,
  };
  return laidItem(item, {
    box: boxOf([layerBox(layer)]),
    layers: [layer],
    sprites: [path],
    // The depth the world stack gives this kind is the kind's own (`objectLayer`), and the decoration's
    // offset moves its place in that stack half a tile; `paintedOrder` reads this.
    depthOffsetYPixels: offset.y,
  });
}

/**
 * An `egg` item: the art its `eggId` names, at the size its window says it has reached.
 *
 * The art is the game's own hop, not a name built here: an egg's tile object holds the egg
 * blueprint's sprite, and that sprite is the sprite-name table's `Pet` entry for the id
 * (`installWorldSystems-2I5vu80Q.js`'s `Ht[eggId].sprite`, `tileObjects.js`).
 */
async function layOutEgg(item) {
  const tables = await artTables();
  const path = tables?.spriteNames?.Pet?.[item.eggId] ?? null;
  if (path === null) {
    return { error: `items: ${item.id}: the game's sprite-name table states no egg art for ${item.eggId}` };
  }
  const laid = await tileObjectArt(item, { path, scale: eggScale(item) });
  if (laid === null) return { error: `items: ${item.id}: the atlas holds no frame for ${path}` };
  return laid;
}

/**
 * A `crystal` item: the art its type names, at the size its charge says.
 *
 * The type names the sprite through the game's own table, which spells the crystal after the item it
 * is drawn as (`Hunger` is `sprite/item/HungerCrystal`, `XP` is `XPCrystal`), and the charge is the
 * save's `remainingActiveSeconds`.
 */
async function layOutCrystal(item) {
  const tables = await artTables();
  const path = tables?.spriteNames?.Item?.[`${item.crystalType}Crystal`] ?? null;
  if (path === null) {
    return { error: `items: ${item.id}: the game's sprite-name table states no crystal art for ${item.crystalType}` };
  }
  const laid = await tileObjectArt(item, { path, scale: crystalScale(item.remainingSeconds) });
  if (laid === null) return { error: `items: ${item.id}: the atlas holds no frame for ${path}` };
  return laid;
}

/**
 * A `decor` item: the art its `decorId` names, at the art's own size, where the game puts it.
 *
 * The id is looked up in the sprite-name table's `Decor` category, which is the table the game's own decor
 * definitions resolve to (`kn[decorId].art`, either the path itself or its `artboardName` in that category).
 * Eight of the game's decorations are Rive artboards, and that category is keyed by the **artboard's** name,
 * which is not the id (`StoneBirdbath` → `StoneBirdBath`) — so the lookup falls back to the artboard spelling
 * (`artBridge.js`'s `decorArtPath`, the same reconciliation `decorTransformer.js` and `/data/pets` use).
 *
 * A decoration that resolves under neither spelling is refused by name: drawing one from a name built here
 * would be a picture of some other decoration.
 */
async function layOutDecor(item) {
  const path = await decorArtPath(item.decorId);
  if (path === null) {
    return {
      error:
        `items: ${item.id}: the game's sprite-name table states no decor art under the id ${item.decorId}, ` +
        `nor under its artboard's own spelling`,
    };
  }
  // The offset table stays keyed by the **id**: the game's own hanging set names six ids, and the artboard
  // spelling must not travel into this lookup.
  const laid = await tileObjectArt(item, { path, offsetPixels: decorOffset(item.decorId, item.rotation) });
  if (laid === null) return { error: `items: ${item.id}: the atlas holds no frame for ${path}` };
  return laid;
}

/**
 * An `icon` item: one inventory entry, drawn the way the game's own icon builder draws it.
 *
 * The rule is the game's and this function only applies it (`@mg.js/art`'s `iconArt` answers which
 * sprite and which share, out of the extraction's own `icon-fill` table, and
 * `.logs/render/bundle-icon-fit.md` quotes the builder):
 *
 *   * the picture is the game's **256-pixel icon square** — the builder's `(0, 0, 256, 256)` frame;
 *   * the entry's art is **contained** in it at `scale = (256 x fill) / max(width, height)`, in the
 *     art's own logical pixels, which is the builder's own `targetSize / max(width, height, 1)`;
 *   * it is **centred on both axes**, `256 / 2` from each edge — the anchor term cancels, because the
 *     builder's own translation is `256/2 - (0.5 - anchor) x scaledSize`, so any anchor lands centred.
 *
 * The sprite per item type is the game's own hop rather than a name built here (`iconArt` states
 * each): a seed is the species' seed art, a produce the species' crop art — which the sprite-name
 * table keeps under `Plant` — and a tool, an egg and a decoration the table's own entry for the id
 * the entry carries. A **tool** also has the game's item table to answer with, and it is read first:
 * an item id is not always the name of its art (`HungerShard` is drawn from `HungerCrystalShard`), and
 * that table is where the game states the hop. The two kinds that are not one sprite are refused by
 * name: a plant's icon is an assembled picture and a pet's is a portrait baked from Rive.
 */
async function layOutIcon(item) {
  const [records, tables, frames] = await Promise.all([plantRecords(), artTables(), spriteFrames()]);
  // `tables` is the game's own `/data/art`, which is where every icon's sprite name is read from.
  const art = iconArt(
    {
      itemType: item.itemType,
      species: item.species,
      toolId: item.toolId,
      eggId: item.eggId,
      decorId: item.decorId,
    },
    { plants: records, spriteNames: tables?.spriteNames ?? {}, frames, fills: tables?.iconFills },
  );
  // The two kinds that are not one art are answered first, before any art is resolved: a plant's icon is
  // an assembled picture, which `kind: "plant"` already draws.
  if (art.kind === "picture") {
    return {
      error:
        `items: ${item.id}: a Plant icon is the plant's own assembled picture rather than one sprite; ` +
        `state kind "plant" with potted: true for it`,
    };
  }
  // A produce entry that wears mutations is not one sprite: the game draws the species' crop composed
  // with them, which is the picture `cropRecipe` answers. So the whole picture is contained in the icon
  // square by the same rule, layer for layer, rather than one art. A spec is held to this **before** any
  // art is resolved, so a bad request is answered with the reason rather than with an atlas problem.
  if (item.mutations.length > 0) {
    if (item.itemType !== "Produce") {
      return {
        error:
          `items: ${item.id}: a ${item.itemType} icon is one art in the game's own builder, which composes ` +
          `mutations for a Produce entry only; ${item.mutations.length} mutation(s) were stated`,
      };
    }
    const recipe = await cropRecipe(item.species, item.mutations);
    if (recipe === null) {
      return { error: `items: ${item.id}: ${item.species} has no composed picture the tables and the atlas both state` };
    }
    const picture = pictureOf(recipe, 1);
    if (picture === null) return { error: `items: ${item.id}: no picture could be composed for ${item.species}` };
    const point = tileOrigin(item.at);
    const iconLeft = point.x - ICON_BOX_PX / 2;
    const iconTop = point.y - ICON_BOX_PX / 2;
    const fit = (ICON_BOX_PX * art.fill) / Math.max(picture.box.width, picture.box.height, 1);
    // The picture's own box is measured about the art's **anchor**, which is the origin of the space its
    // layers are in — so its `left`/`top` are usually negative, and the shift that centres it is the
    // square's middle less the box's *middle*, not less half its size (`pictureOf` states the box; the
    // anchor is the origin). The first cut of this used half the size, and every mutated produce icon sat
    // an art's reach up and to the left of where it belongs.
    const shiftX = ICON_BOX_PX / 2 - (picture.box.left + picture.box.width / 2) * fit;
    const shiftY = ICON_BOX_PX / 2 - (picture.box.top + picture.box.height / 2) * fit;
    const layers = picture.layers.map((layer) => ({
      ...layer,
      left: iconLeft + shiftX + layer.left * fit,
      top: iconTop + shiftY + layer.top * fit,
      width: layer.width * fit,
      height: layer.height * fit,
    }));
    const composed = laidItem(item, {
      box: boxOf(layers.map((layer) => layerBox(layer))),
      layers,
      sprites: [...new Set(layers.map((layer) => layer.sprite).filter(Boolean))],
    });
    return {
      ...composed,
      icon: { left: iconLeft, top: iconTop, width: ICON_BOX_PX, height: ICON_BOX_PX },
    };
  }

  // A pet's icon is its portrait, baked from Rive by the game and exported to disk by this API: one art,
  // in the same 256-pixel square, at the same share — only the frame comes from the export's own sidecar
  // rather than from the atlas (`artBridge.js`'s `portraitFrame`, and `atlasPixels.js`'s `spritePng`,
  // which already falls back to those PNGs for the pixels).
  let sprite = art.sprite;
  let frame;
  if (art.kind === "baked") {
    const portrait = await portraitFrame(item.species);
    if (portrait === null) {
      return {
        error:
          `items: ${item.id}: no portrait of ${item.species} has been exported from Rive, so this API has ` +
          `no picture of it; the export writes one per pet under \`sprite/pet/<name>\``,
      };
    }
    sprite = portrait.key;
    frame = portrait;
  } else if (item.itemType === "Tool" && item.charged === true) {
    // A charged tool is drawn as the crystal it holds rather than from the shard's own name: the game maps
    // the shard back to a crystal and draws *that* (`tileObjects.js` quotes `hn` and `pn`), so this is a
    // table read on the name the entry carries, and a shard the game does not name is refused.
    const artName = chargedToolArtName(item.toolId);
    if (artName === null) {
      return {
        error:
          `items: ${item.id}: ${item.toolId} is a charged tool, and the game's own shard-to-crystal switch ` +
          `names no crystal for it, so this API has no art to draw`,
      };
    }
    const path = tables?.spriteNames?.Item?.[artName] ?? null;
    if (path === null) {
      return { error: `items: ${item.id}: the game's sprite-name table states no art for ${artName}` };
    }
    sprite = path;
    frame = drawnFrame(path);
    if (frame === null) return { error: `items: ${item.id}: the atlas holds no frame for ${path}` };
  } else {
    // A tool's art is the one the game's own item table states for it, and the id is not always that art's
    // name: the three pet-effect shards are `HungerShard`, `XPShard` and `StrengthShard`, and the items table
    // draws them with `sprite/item/HungerCrystalShard`, `XPCrystalShard` and `StrengthCrystalShard` — an extra
    // `Crystal` the id does not carry, which is why looking the id up by name refuses them. The hop is the
    // table's own (`sprite: T.Item.<name>` in the game's item records), so it is read rather than built.
    // A charged shard is the crystal it holds instead (the branch above); a tool with no record, or a record
    // that states no sprite, keeps the name lookup's answer.
    const stated = item.itemType === "Tool" ? await toolArtName(item.toolId) : null;
    const path = stated ?? art.sprite;
    if (path === null) {
      return { error: `items: ${item.id}: the game's tables state no art for ${item.itemType} ${item[iconIdField(item.itemType)]}` };
    }
    sprite = path;
    frame = drawnFrame(path);
    if (frame === null) return { error: `items: ${item.id}: the atlas holds no frame for ${path}` };
  }

  const scale = (ICON_BOX_PX * art.fill) / Math.max(frame.box.width, frame.box.height, 1);
  const width = frame.box.width * scale;
  const height = frame.box.height * scale;
  // The icon square sits on the tile the item names, exactly a reference tile across, with the art
  // centred inside it.
  const point = tileOrigin(item.at);
  const left = point.x - ICON_BOX_PX / 2;
  const top = point.y - ICON_BOX_PX / 2;
  const layer = {
    sprite,
    left: left + (ICON_BOX_PX - width) / 2,
    top: top + (ICON_BOX_PX - height) / 2,
    width,
    height,
  };
  const laid = laidItem(item, {
    box: boxOf([layerBox(layer)]),
    layers: [layer],
    sprites: [sprite],
  });
  return {
    ...laid,
    // The square the canvas is measured from, which for an icon is the game's own icon box rather than
    // the art inside it: `box` stays the tight union of what the item draws.
    icon: { left, top, width: ICON_BOX_PX, height: ICON_BOX_PX },
  };
}

/** A `plant` item: the package's recipe for the plant, its pot and the crops in its slots. */
async function layOutPlant(item) {

  const [art, records] = await Promise.all([plantArt(item.species), plantRecords()]);
  if (art === null) return null;

  const record = records[item.species] ?? {};
  // A single-harvest species is a **patch**: it has no body, and its crops are the plant. One crop
  // per slot, and a species that states no `slotCapacity` holds exactly one — the game's own ceiling,
  // the number its patch UI counts (`Ks(filled, capacity)`), and the same one the `patch` kind
  // refuses on. Two ubes on a tile is a picture the game never draws, so it is refused rather than
  // drawn.
  const single = record?.plant?.harvestType === "Single";
  const capacity = integerOrNull(record?.plant?.slotCapacity) ?? 1;
  if (single && item.crops.length > capacity) {
    throw new ComposeSpecError(
      "COMPOSE_PLANT_OVER_CAPACITY",
      `items: ${item.species} holds at most ${capacity} crops on a tile, and this plant states ` +
        `${item.crops.length}; ${item.species} states ` +
        `${record?.plant?.slotCapacity === undefined ? "no slotCapacity, so a tile of it holds one crop" : `a slotCapacity of ${capacity}`}`,
      { limit: "slotCapacity", saw: item.crops.length },
    );
  }

  // Where a single-harvest plant's sprigs stand: the one the spec states, or the game's own scatter
  // for the sprigs that state none — the reading a `patch` makes, and the generator the game lays a
  // cluster out with when nothing places it (`sceneScatter.js`).
  const places = single ? scatterPatch(item) : [];

  const artBySpecies = { [item.species]: art };
  const sceneCrops = [];
  const cropPictures = [];
  for (let index = 0; index < item.crops.length; index += 1) {
    const crop = item.crops[index];
    // A multi-harvest plant's crop is placed by the slot its own `slotId` names, and the game draws
    // none for a slot its blueprint does not place (`s && r.push(...)`) — a smaller picture rather
    // than a wrong one, which is what this API refuses.
    const offset = single ? null : slotOffsetAt(record, crop.slot);
    if (!single && offset === null) {
      return {
        error:
          `${item.id}: ${item.species} states no slot offset for slot ${crop.slot}, so the game ` +
          `draws no crop there (the blueprint holds ${record?.plant?.slotOffsets?.length ?? 0} slots)`,
      };
    }
    // A slot may state the species it draws as (the game's own `speciesOverride`): the stormcaps on a
    // ThunderCelestial are a species of their own, with their own art and their own curve.
    const cropSpecies = single ? item.species : slotSpecies(item.species, offset);
    if (artBySpecies[cropSpecies] === undefined) artBySpecies[cropSpecies] = await plantArt(cropSpecies);
    const cropArt = artBySpecies[cropSpecies];
    if (cropArt === null || cropArt === undefined) {
      return { error: `${item.id}: ${cropSpecies} has no picture the tables and the atlas both state` };
    }
    // The crop's own species' record, with the frame the atlas draws its art at: the multiplier and
    // the `plantTransform` are the species the crop is *drawn as*, while the tilt flag is the
    // plant's (`cropPlacement.js` states each of those readings).
    const speciesRecord = {
      ...(records[cropSpecies] ?? {}),
      crop: { ...(records[cropSpecies]?.crop ?? {}), frame: cropArt.crop.frame },
    };
    const placement = single
      ? placedInPatch({
          crop,
          place: item.potted
            ? pottedIconPlace(crop, index, item.crops.length)
            : places[index],
          speciesRecord,
        })
      : placedOnPlant({ crop, offset, plantRecord: record, cropSpecies, speciesRecord });
    const recipe = await cropRecipe(cropSpecies, crop.mutations);
    if (recipe === null) return null;
    const picture = pictureOf(recipe, placement.scale);
    if (picture === null) return null;
    sceneCrops.push({
      species: cropSpecies,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      scale: placement.scale,
      depth: placement.depth,
      // The composition `plantPicture` carries through and hangs off the crop's own frame, in the
      // shape it states: a box and the layers inside it, in the crop art's own pixels. `index` is the
      // composer's own key back to this crop — the package sorts the layers by `depth`, so the layer
      // order is not the stated order.
      composition: { index, layers: picture.layers, box: picture.box },
    });
    cropPictures.push({
      slot: crop.slot,
      species: cropSpecies,
      scale: placement.scale,
      depth: placement.depth,
      picture,
      recipe,
      at: { x: placement.x, y: placement.y },
      rotation: placement.rotation,
      // A crop's own mutations, for `cropLayersOf`: `Rainbow` and `Gold` are materials, and each crop in a
      // pot wears its own.
      material: materialKindOf(crop.mutations),
    });
  }

  const pot = item.potted ? await potFrame() : null;
  const scene = { species: item.species, mature: item.matured === true, weather: null, crops: sceneCrops };
  let recipe = plantPicture(scene, artBySpecies, pot);
  // A single-harvest species is a **patch**: it has no body of its own, so `plantPicture` draws its
  // crops and nothing else — and one with no crops in it has nothing to draw at all, which the
  // package refuses with `null`. The game does not: a tile of that art is drawn whether or not a
  // crop is standing on it (a seed packet, a menu icon, an empty tile), so the species' own art is
  // drawn once, at the point the plant stands on.
  if (recipe === null && sceneCrops.length === 0) recipe = barePlantRecipe(item.species, art);
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
      materialKind: layer.kind === "art" ? materialKindOf(item.mutations) : null,
      washes: materialKindOf(item.mutations) === null ? [...(layer.washes ?? [])] : [],
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
  const box = boxOf(layers.map(drawnBox));

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
      anchorX: layer.anchorX,
      anchorY: layer.anchorY,
      turn: layer.turn ?? 0,
      washes: [],
      material: false,
      nested: null,
    };
    if (layer.kind !== "crop" || layer.composition === null || layer.composition === undefined) return one;
    const composition = layer.composition;
    // `pictureOf` puts the composition's art **anchor at the origin**, so its layers live in anchor space:
    // they hang off the point the crop stands on — the crop layer's own anchor — and not off the top-left
    // corner of its frame. This used to read `composition.anchor`, a field nothing sets, so it added zero
    // and every composed crop was drawn one anchor offset up and to the left of its own place: 237 px,
    // nearly a whole tile, on a clover at scale 3 (`anchorY` is 0.935 of the art's height). The sprig's
    // frame was right; its picture was not, and the reported box repeated the mistake, so the two agreed
    // with each other while both sat outside the tile.
    const at = {
      x: one.left + (layer.anchorX ?? 0) * layer.width,
      y: one.top + (layer.anchorY ?? 0) * layer.height,
    };
    const material = cropAt[layer.composition.index]?.material ?? null;
    const drawn = {
      ...one,
      // The point the crop stands on: a turned crop is rotated about it — in `drawnBox` for the canvas
      // union, and in the rasteriser when it draws — so it travels with the layer (`one.turn` is the
      // crop's own rotation, which `plant.ts`'s `cropLayer` put there from `crop.rotation`).
      pivot: at,
      nested: composition.layers.map((inner) => ({
        kind: inner.kind,
        sprite: inner.sprite,
        left: at.x + inner.left,
        top: at.y + inner.top,
        width: inner.width,
        height: inner.height,
        materialKind: inner.kind === "art" ? material : null,
        washes: material === null ? [...(inner.washes ?? [])] : [],
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
function laidItem(item, { box, layers, sprites, descriptors = [], depthOffsetYPixels = 0 }) {
  return {
    id: item.id,
    kind: item.kind,
    species: item.species,
    at: reportedAt(item),
    box,
    layers,
    sprites,
    // Where the thing stands for the purpose of the world stack, which only a hanging decoration moves:
    // the game's own `depthOffsetYPixels` (`cropPlacement.js`'s `worldDepthKey` reads it).
    depthOffsetYPixels,
    crops: descriptors.map((crop) => ({
      slot: crop.slot,
      // The species the crop is drawn as, which is the item's own unless the slot overrides it (the
      // game's `speciesOverride`: ThunderCelestial's stormcaps are drawn as a species of their own).
      species: crop.species ?? null,
      place: placeOfCrop(crop),
      depth: crop.depth,
      scale: crop.scale,
      box: boxOf(crop.layers.map(layerBox)),
    })),
  };
}

/**
 * A crop's place as the layout reports it: the point the crop's art **anchor** is drawn at, in tile
 * fractions, and the degrees it is turned by.
 *
 * That is the place `plantPicture` laid the frame out on (`plant.ts`'s `cropLayer` puts the frame's
 * anchor at `centre + place × 256`), so it already carries the two things the game adds to a slot
 * offset: the plant body's own middle, which the package adds, and the crop's pivot shift, which
 * `cropPlacement.js` computed before handing the place over. A caller checking where a crop stands
 * down to the pixel has `scene` for the frame's own rectangle and this for the point it hangs from.
 */
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
/**
 * The species' own art, drawn once at the point the item stands on — for a scene the package refuses to lay
 * out because it holds no crop at all.
 *
 * A single-harvest species has no body of its own: `plantPicture` draws its crops and nothing else, and a tile
 * of one with no crop standing on it is `null` from the package. The game draws the art anyway — a tile whose
 * cluster has been harvested down to nothing is still that plant — so the art is drawn here, at the same
 * anchor, which is why the recipe is not re-derived.
 */
function barePlantRecipe(species, art) {
  const { frame } = art.plant;
  const left = -frame.anchorX * frame.width;
  const top = -frame.anchorY * frame.height;
  return {
    species,
    box: { left, top, width: frame.width, height: frame.height },
    layers: [
      {
        kind: "plant",
        sprite: art.plant.sprite,
        left,
        top,
        width: frame.width,
        height: frame.height,
        anchorX: frame.anchorX,
        anchorY: frame.anchorY,
        turn: 0,
        composition: null,
      },
    ],
  };
}

async function layOutPatch(item) {
  const [art] = await Promise.all([plantArt(item.species)]);
  if (art === null) return null;

  const record = (await plantRecords())[item.species] ?? {};
  assertPatchSpecies(record, item);

  const places = scatterPatch(item);
  const origin = placedPoint(item);

  const sceneCrops = [];
  const cropAt = [];
  for (let index = 0; index < item.crops.length; index += 1) {
    const crop = item.crops[index];
    const place = places[index];
    // Where the sprig stands, how large it is drawn and where it sits in the stack: the game's own
    // `zIndex` on a patch, which is its y place, so a sprig lower in the tile is drawn over one
    // higher up (`cropPlacement.js`).
    const { scale, depth } = placedInPatch({ crop, place, speciesRecord: record });
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
      species: item.species,
      scale,
      depth,
      at: { x: place.x, y: place.y },
      rotation: place.rotation,
      flipped: crop.flipped,
      material: materialKindOf(crop.mutations),
    });
  }

  const scene = { species: item.species, mature: true, weather: null, crops: sceneCrops };
  // A cluster with no sprigs left is the plant alone, which is what the game draws on that tile: the package
  // has nothing to lay out and answers `null`, so the species' own art is drawn instead (`barePlantRecipe`).
  const recipe =
    plantPicture(scene, { [item.species]: art }, null) ??
    (sceneCrops.length === 0 ? barePlantRecipe(item.species, art) : null);
  if (recipe === null) return null;

  const { layers, crops: cropBoxes } = cropLayersOf(recipe, origin, cropAt);
  return laidItem(item, {
    box: boxOf(layers.map(drawnBox)),
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
 * Whether a spec's place **states a point**: the normaliser fills an absent one with three nulls, and
 * a crop that states no point is exactly the crop the game's scatter — or the pot's middle — is for.
 */
function claimsPlace(at) {
  return at !== null && at !== undefined && typeof at.x === "number" && typeof at.y === "number";
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
  const generated = scatterPlaces(item.crops.length, {
    seed: item.id,
    seeded: item.crops.map((crop) => (claimsPlace(crop.at) ? { x: crop.at.x, y: crop.at.y } : null)),
  });
  return item.crops.map((crop, index) =>
    claimsPlace(crop.at)
      ? { x: crop.at.x, y: crop.at.y, rotation: crop.at.rotation ?? 0 }
      : generated[index],
  );
}

/**
 * Where one crop of a **potted** single-harvest plant stands: its **own** place, squeezed towards the
 * middle of the pot and fanned out by its index.
 *
 * This is the game's icon layout and nothing else: `PlantBody.createCrops` takes the `vi` branch for a
 * single-harvest plant whose save states a place — `vi(e, t, n)` with `e` the crop's own `x`/`y`/
 * `rotation` — and the branch is the *plant's* (`isolateRendering`, which is the pot), not the crop's.
 * A crop that states no place is the pot's middle, which is the one reading the game makes of a slot
 * whose `x` it cannot see (`else e.slots[0] ? r.push({index: 0, offset: {x: 0, y: 0, rotation: 0}})`) —
 * the scatter a patch falls back to is for a tile, and a pot is not a tile.
 */
function pottedIconPlace(crop, index, count) {
  const place = claimsPlace(crop.at)
    ? { x: crop.at.x, y: crop.at.y, rotation: crop.at.rotation ?? 0 }
    : PLANT_MIDDLE;
  return iconPlace({ place, index, count });
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
  const nested = layer.nested ?? [];
  if (nested.length === 0) {
    return { left: layer.left, top: layer.top, width: layer.width, height: layer.height };
  }
  return boxOf(nested.map(layerBox));
}

/**
 * The axis-aligned rectangle a rectangle **occupies** after a clockwise turn about a pivot.
 *
 * Screen axes, y down, degrees clockwise — the game's own frame: it places a crop with
 * `i.position.set(n.xPixels, n.yPixels); i.angle = n.rotationDegrees` (`resources-D_3Zwcn-.js`), and
 * Pixi's `angle` turns clockwise on a y-down canvas, which is also what `sharp.rotate` does.
 */
function rotatedBox(box, pivot, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    [box.left, box.top],
    [box.left + box.width, box.top],
    [box.left, box.top + box.height],
    [box.left + box.width, box.top + box.height],
  ].map(([x, y]) => {
    const dx = x - pivot.x;
    const dy = y - pivot.y;
    return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  });
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/**
 * A layer's box **as drawn**: a crop that states a turn is rotated about the point it stands on, so the
 * rectangle it occupies is the rotated one, and the canvas union has to see that or a turned sprig is
 * clipped at the edge. `layerBox` stays the picture's own rectangle — which is what the layout *reports*
 * per crop (`crops[].box`, the art at the published scale, the thing a caller checks the art against)
 * and what the rasteriser is handed to draw; this is only what the union is measured with.
 */
function drawnBox(layer) {
  const box = layerBox(layer);
  if (layer.pivot === null || layer.pivot === undefined || !layer.turn) return box;
  return rotatedBox(box, layer.pivot, layer.turn);
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
          : item.kind === "egg"
            ? await layOutEgg(item)
            : item.kind === "crystal"
              ? await layOutCrystal(item)
              : item.kind === "decor"
                ? await layOutDecor(item)
                : item.kind === "icon"
                  ? await layOutIcon(item)
                  : await layOutCrop(item);
    // A path may refuse an item with a reason of its own — a species with no picture, a slot the
    // blueprint does not place — which is a 400 with the reason rather than a picture missing a crop.
    if (laid !== null && laid.error !== undefined) return { error: laid.error };
    if (laid === null) {
      return { error: `${item.id}: ${item.species} has no picture the tables and the atlas both state` };
    }
    items.push(laid);
  }

  // An icon's canvas is the game's icon square rather than the art inside it, so the union reads the
  // square when the item states one; every other item draws into its own tight box.
  const boxes = items.map((item) => item.icon ?? item.box);
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
    // The point a turn happens about travels with the rectangle it turns. The rasteriser reads a layer's
    // `left`/`top` in picture coordinates and turns the sprite about `pivot`, so a pivot left in scene
    // coordinates is a turn about a point that is not in the picture at all: a crop at column 8 of a
    // sheet turned about the scene's own origin 4,000 px to its left, which threw it off the canvas
    // entirely (a quarter turn painted zero pixels) or slid it down the picture, where `paintScene`'s
    // clamp hid the rest. `drawnBox` still turns about the scene pivot, because that is where the box
    // arithmetic is stated; only the copy handed to the rasteriser is moved.
    pivot:
      layer.pivot === null || layer.pivot === undefined
        ? (layer.pivot ?? null)
        : { x: layer.pivot.x - origin.x, y: layer.pivot.y - origin.y },
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
      // An icon's own square: the game's 256-pixel icon frame, which the canvas is measured from and which
      // is not the tight box of the art inside it (`layOutIcon`).
      ...(item.icon === undefined ? {} : { icon: toPicture(item.icon) }),
      // The game's own layer for this kind of thing, which is one term of the world depth key the
      // painting order comes from (`cropPlacement.js`): a tile-standing object is an
      // `OccludingObject` (3), a bare crop — a menu picture, a seed packet — the game's `mounted
      // crop` rung (2). It is not the paint order on its own: `layout.layers` is, and `items` stays
      // in the normalised (id) order so a caller has both.
      z: objectLayer(item.kind),
      // The offset the thing's own depth carries, which is the game's `depthOffsetYPixels`: half a tile
      // for a hanging decoration, nothing for everything else (`tileObjects.js`).
      depthOffsetYPixels: item.depthOffsetYPixels ?? 0,
      sprites: item.sprites,
      crops: item.crops.map((crop) => ({
        slot: crop.slot,
        // The species the crop is drawn as, which is the item's own unless the slot overrides it
        // (the game's `speciesOverride`: ThunderCelestial's stormcaps are a species of their own).
        species: crop.species ?? null,
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

  const layers = [
    ...(background === null ? [] : background.tiles),
    // The tiles are painted in the game's own world order, not the order the spec listed them in: an
    // object lower on the screen is drawn later, and so in front of one behind it
    // (`cropPlacement.js`'s `worldDepthKey`, which is `worldDepthSortKey-BXUHHrP0.js`'s `lg` fed the
    // way a garden tile's object feeds it). A caller that wants a list rather than a stack reads
    // `layout.items`, which stays in the normalised order.
    ...paintedOrder(items).flatMap((item) => item.layers),
  ].map(shift);

  return { spec, layout, layers, canvas, origin };
}

/**
 * The scene's items, in the order the game paints tiles: by the world depth key, ties broken by the
 * normalised order the items arrived in, so one spec always composes one picture.
 *
 * The key is the game's, and it is why the order here is not the spec's: `floor(depthYPixels × 1e4)`
 * is the tile's own row, the layer says what kind of thing it is, and the body's reach below the
 * tile's middle breaks a tie inside one row — so a plant drawn lower on the screen covers one behind
 * it instead of the other way round.
 *
 * `depthYPixels` is the tile's middle **moved by the thing's own depth offset**: `tileObjects.js`
 * quotes the game's `wl`, which adds `depthOffsetYPixels` to the tile's centre before the key is
 * built, and a hanging decoration is the only tile object that states one. The layer is the rung the
 * game's `Qa` gives the kind: a decoration whose `depthBehavior` is `Ground` stacks at `Base` and
 * every other tile object at `OccludingObject` — and since this API does not publish that table, a
 * decoration is taken as the latter (`tileObjects.js` states the gap).
 */
function paintedOrder(items) {
  return items
    .map((item, index) => ({
      item,
      index,
      key: worldDepthKey({
        tileCentreY: ((item.at?.row ?? 0) + 0.5) * TILE_STEP_PX + (item.depthOffsetYPixels ?? 0),
        bodyBottomPixels: item.box.top + item.box.height,
        layer: objectLayer(item.kind),
        columnX: ((item.at?.column ?? 0) + 0.5) * TILE_STEP_PX,
      }),
    }))
    .sort((left, right) => left.key - right.key || left.index - right.index)
    .map((one) => one.item);
}

/** The rung of the world stack the game draws a kind of tile object at: `Base`, or `OccludingObject`. */
function objectLayer(kind) {
  // A bare crop and an inventory icon are menu pictures rather than things standing in the world, so
  // they stack at the game's `mounted crop` rung; a tile object stacks at `OccludingObject`.
  return kind === "crop" || kind === "icon" ? CROP_LAYER : PLANT_LAYER;
}
