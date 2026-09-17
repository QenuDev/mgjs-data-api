// src/assets/compose/cropPlacement.js
//
// Where a crop stands on its plant, how far it is turned, how large it is drawn, and where it sits in
// the stack. This is the game's own arithmetic, on the game's own tables, and it is the one thing
// `@mg.js/art` cannot answer: the package is handed a place and lays a frame out on it
// (`plant.ts`'s `cropLayer`), while *which* place a slot gets — a slot offset, a tilt worked out from
// when the crop was planted, a pivot shift, the scatter a patch falls back to — is the renderer's
// (`resources-D_3Zwcn-.js`, bundle 1192, the `PlantBody`/`PlantCrop`/`CropVisual` classes).
//
// ## The two paths
//
// A plant states its crops' places in one of two ways, and the game treats them differently
// (`PlantBody.createCrops`):
//
//   * **Multiple** — a multi-harvest plant lists a place per slot in its blueprint's `slotOffsets`,
//     and a crop is put at the one its `slotId` names, **plus the plant body's own middle**: the
//     offsets are measured from the middle of the body's art, which is not the tile's middle unless
//     the art's anchor happens to be. Some of those plants also turn each crop by an amount worked
//     out from when it was planted. `plant.ts` adds the body's middle for us (`(0.5 − anchor) × size`,
//     which is the same `(0.5 - e.x) * r` the bundle computes), so what is stated here is the slot
//     offset itself.
//   * **Single** — a single-harvest plant states no places at all, and each of its crops carries its
//     own: a patch is a cluster of crops spread over the tile rather than one plant. A crop that
//     states nowhere stands at the plant's anchor, and the cluster a save does not place is laid out
//     by the game's own scatter (`sceneScatter.js`, which is that generator).
//
// ## The numbers, and where each comes from
//
// Everything below is quoted from the bundle rather than chosen here:
//
//   * the tilt — `di = 35`, and
//     `calculateRestingAngleDegrees(){let e = this.slotState.flipped ? -1 : 1; return
//      this.plantBlueprint.harvestType === D.Multiple && this.plantBlueprint.rotateSlotOffsetsRandomly
//        ? e * (this.slotOffset.rotation + di - this.slotState.startTime % (di * 2))
//        : e * this.slotOffset.rotation}`.
//     So the flag is the *plant's*, the angle comes out of the crop's own `startTime`, and a mirrored
//     crop turns the other way. A lone crop on a patch never tilts: the test is `Multiple`.
//   * the pivot — `CropVisual`: `if (mode === 'plant' && species.plant.harvestType === Multiple &&
//     species.crop.plantTransform) { let {offsetXPixels: e, offsetYPixels: t} = species.crop.plantTransform;
//     this.container.pivot.set(flipped ? e : -e, -t) }`, with the sprite at the container's origin and
//     the container scaled by `containerScaleForSpriteScale(e) = e / texture.sourcePixelRatio`.
//     A Pixi pivot is the art's own point that sits at the container's position, so the **frame
//     anchor** is drawn `R(rotation) × (offsetX, offsetY) × scale / ratio` away from the place, and
//     the art turns about it. That is the shift below, and it is what makes a size-100 crop attach at
//     the same point of its own art as a size-50 one: the shift is in the art's pixels and grows with
//     the crop, so the pinned point does not move.
//   * the size curve — `resolveRestingScale(species, size)` through the game's own `1 + (size − 50) /
//     50 × (maxSizeMultiplier − 1)`, and it is the **crop's own species'** multiplier (the game reads
//     `V[slot.species].crop`), which is why a slot that overrides its species is scaled by the
//     override's.
//   * the stack — `i.container.zIndex = plant.harvestType === Single ? Math.round((offset.y + 1) * 10)
//     : 2 + slotId`: a patch stacks by where each sprig stands, a plant by the slot it grew in. (These
//     are the crops *within* one tile; the tiles themselves stack by the world key below.)
//   * the icon — a plant drawn out of the garden (`isolateRendering`, which the game sets with
//     `renderPlanterPot` for a plant in a planter pot) re-lays a single-harvest plant's crops:
//     `mi=.4, hi=.15, gi=.05, _i=15; function vi(e, t, n){ if (n <= 1) return {x:0, y:gi, rotation:0};
//      let r = t * 137 % (_i * 2) - _i; return {x: e.x * mi, y: e.y * hi + gi, rotation: e.rotation + r} }`.
//     A multi-harvest plant keeps its own offsets in a pot: `vi` is only reached on the `Single` side.
//   * the species a slot draws as — `new pi({ species: r.species, ... })` where `r` is the slot's own
//     record, so a slot's `speciesOverride` (the game's own blueprint field, `ThunderCelestial`'s
//     stormcaps) is the species whose art, multiplier and `plantTransform` the crop uses, while the
//     tilt flag is still the plant's.
//
// ## The world stack, for tiles rather than crops
//
// `worldDepthSortKey-BXUHHrP0.js` is the key every world object is stacked by:
//
//     lg({depthYPixels: e, layer: t, bodyBottomYPixels: n, band: r = 0}) {
//       let i = (n ?? e) - e;
//       return (r === 1 ? 9e11 : 0) + Math.floor(e * 1e4) + t + (i <= 0 ? 0 : i / (i + 256))
//     }
//
// and a garden tile's object feeds it (`installWorldSystems-2I5vu80Q.js`):
//
//     let {y: t} = I(this.worldPosition);                 // the tile's middle, in world pixels
//     let n = this.childView?.depthOffsetYPixels ?? 0;    // 0 for a plant; decor states one
//     let i = Qa(this.tileObject, e);                     // OccludingObject (3) for a plant
//     El({tileCenterYPixels: t, depthOffsetYPixels: n, layer: i,
//         bodyBottomYPixels: this.getBodyBottomYPixels(t + n, t),   // max(t + n, t + bodyBottomLocal)
//         tileObjectSortIndex: this.worldPosition.x})               // + min(floor(x) * 1e-7, 1e-4)
//
// Down is later, so a thing standing lower on the screen is drawn in front of one behind it, and
// within one tile row it is the body that reaches lowest that wins. `worldDepthKey` below is that
// function, with the tile's own middle and the item's own box standing in for world position and body.

/** One tile, in the sprites' own pixels. The game's own `256` in every `e.x * 256` above. */
export const TILE_PIXELS = 256;

/** The angle a multi-harvest plant spreads its crops' turns over: the bundle's own `di`. */
export const ROTATION_SPREAD = 35;

/** How the game re-lays a single-harvest plant's crops out for an icon: the bundle's `mi/hi/gi/_i`. */
export const POT_ICON = { across: 0.4, down: 0.15, drop: 0.05, fan: 15, step: 137 };

/** The layer a plant's tile object stacks at, the game's own `OccludingObject`. */
export const PLANT_LAYER = 3;

/** The layer a bare crop stacks at, the game's own `mounted crop` rung (`plant.ts`'s ladder). */
export const CROP_LAYER = 2;

/** The tile a patch's sprigs stand on, and the plant's own middle: both are tile fractions. */
export const PLANT_MIDDLE = { x: 0, y: 0, rotation: 0 };

/**
 * A crop's drawn scale from the size the wire carries, through the game's own curve.
 *
 * `1 + (size − 50) / 50 × (maxSizeMultiplier − 1)`: at half size the crop is drawn at 1 and at full
 * size at the species' multiplier. `null` — a size the spec did not state — is 1, the art's own size.
 */
export function sizeScale(size, maxSizeMultiplier) {
  if (size === null || size === undefined) return 1;
  const multiplier = typeof maxSizeMultiplier === "number" && Number.isFinite(maxSizeMultiplier) ? maxSizeMultiplier : 1;
  return 1 + ((size - 50) / 50) * (multiplier - 1);
}

/**
 * The place a plant's blueprint gives a slot, by the crop's own `slotId`.
 *
 * `plant.slotOffsets[o.slotId]` — the index is the slot id, not the crop's position in the list. The
 * game skips a slot its blueprint does not place (`s && r.push(...)`), and so does this: the caller
 * is told, because a crop that is not drawn is a wrong picture rather than a smaller one.
 */
export function slotOffsetAt(plantRecord, slot) {
  const offsets = plantRecord?.plant?.slotOffsets;
  if (!Array.isArray(offsets)) return null;
  const offset = offsets[slot];
  return typeof offset === "object" && offset !== null ? offset : null;
}

/**
 * The species a slot draws as: the blueprint's own override, or the plant's species.
 *
 * `ThunderCelestial`'s first four slots are stormcaps — `speciesOverride` names the species they are
 * drawn as — and the game reads that as the crop's species outright: its art, its multiplier, and its
 * `plantTransform` are the override's (`new pi({species: r.species, ...})`).
 */
export function slotSpecies(plantSpecies, offset) {
  const override = offset?.speciesOverride;
  return typeof override === "string" && override !== "" ? override : plantSpecies;
}

/**
 * How far a crop is turned, in degrees: the slot's own angle plus the plant's tilt, mirrored if the
 * crop is.
 *
 * `e * (slotOffset.rotation + di − startTime % (di × 2))` with `di = 35` and `e = flipped ? −1 : 1`,
 * and only for a **Multiple** plant whose blueprint sets `rotateSlotOffsetsRandomly`. A crop that
 * states no `startTime` is read as `0` — the same reading the game's own client makes of a slot whose
 * time it cannot see (`Number.isFinite(startTime) ? startTime % 70 : 0`) — which is a tilt of `35`.
 */
export function turnedDegrees({ offset, plantRecord, startTime, flipped = false }) {
  const stated = typeof offset?.rotation === "number" && Number.isFinite(offset.rotation) ? offset.rotation : 0;
  const multiple = plantRecord?.plant?.harvestType === "Multiple";
  const tilt = multiple && plantRecord?.plant?.rotateSlotOffsetsRandomly === true;
  const spread = tilt ? ROTATION_SPREAD - ((Number.isFinite(startTime) ? startTime : 0) % (ROTATION_SPREAD * 2)) : 0;
  return (flipped ? -1 : 1) * (stated + spread);
}

/**
 * The place a crop's art **anchor** is drawn at, once the pivot has moved it off the slot's own point.
 *
 * A Pixi pivot is the point of the art that lands on the container's position, so with the pivot set
 * `(−offsetX, −offsetY)` (mirrored: `(+offsetX, −offsetY)`) the anchor is drawn that far away, turned
 * by the crop's own rotation and scaled with the art: `R(θ) × (offsetX, offsetY) × scale / ratio`.
 *
 * The `ratio` matters: the offsets are in the art's own pixels (a 104×206 frame at `sourcePixelRatio`
 * 2 is drawn at 57×105), so they are divided by the ratio the frame was drawn at. This is the only
 * place a crop's place depends on its scale, and it is why scaling a crop up moves it *onto* its
 * pinned point rather than away from it.
 */
export function pivotShift({ plantTransform, rotation, scale, pixelRatio, flipped = false }) {
  if (plantTransform === null || plantTransform === undefined) return { x: 0, y: 0 };
  const across = (Number.isFinite(plantTransform.offsetXPixels) ? plantTransform.offsetXPixels : 0) * (flipped ? -1 : 1);
  const down = Number.isFinite(plantTransform.offsetYPixels) ? plantTransform.offsetYPixels : 0;
  const ratio = typeof pixelRatio === "number" && Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = across * (scale / ratio);
  const y = down * (scale / ratio);
  return {
    x: (x * cos - y * sin) / TILE_PIXELS,
    y: (x * sin + y * cos) / TILE_PIXELS,
  };
}

/**
 * Where one crop stands on a multi-harvest plant: its slot's place, moved by the pivot, turned by the
 * tilt, drawn at its own species' size.
 *
 * `cropSpecies` is the species the crop draws as — the slot's override when it states one — and it is
 * read for the multiplier and the `plantTransform`, while the tilt flag is the plant's own.
 */
export function placedOnPlant({ crop, offset, plantRecord, cropSpecies, speciesRecord }) {
  const scale = sizeScale(crop.size, speciesRecord?.crop?.maxSizeMultiplier);
  const rotation = turnedDegrees({
    offset,
    plantRecord,
    startTime: crop.startTime,
    flipped: crop.flipped === true,
  });
  // The pivot is the crop species' own, and only a multi-harvest crop has one: the game gates it on
  // `harvestType === Multiple && crop.plantTransform`, and a single-harvest species states neither.
  const multiple = speciesRecord?.plant?.harvestType === "Multiple";
  const shift = multiple
    ? pivotShift({
        plantTransform: speciesRecord?.crop?.plantTransform,
        rotation,
        scale,
        pixelRatio: speciesRecord?.crop?.frame?.pixelRatio,
        flipped: crop.flipped === true,
      })
    : { x: 0, y: 0 };
  const x = (typeof offset.x === "number" ? offset.x : 0) + shift.x;
  const y = (typeof offset.y === "number" ? offset.y : 0) + shift.y;
  return {
    species: cropSpecies,
    // The place below is where the crop's **anchor** is drawn, which is the point `plantPicture` lays
    // the frame out on. The stalk the fruit hangs from is the pivot's own point, and it lands on the
    // slot's place: `anchor = place + R(θ) × (offset × scale / ratio)`.
    x,
    y,
    rotation,
    scale,
    depth: 2 + crop.slot,
  };
}

/**
 * Where one sprig of a patch stands: the place the save (or the scatter) gave it, at its own species'
 * size, stacked by how far down the tile it stands.
 *
 * `Math.round((offset.y + 1) * 10)` is the game's own `zIndex` for a patch crop, so a sprig lower in
 * the tile is drawn in front of one behind it — the same rule the world stack applies to the tiles.
 */
export function placedInPatch({ crop, place, speciesRecord }) {
  const y = typeof place.y === "number" ? place.y : 0;
  return {
    x: typeof place.x === "number" ? place.x : 0,
    y,
    rotation: typeof place.rotation === "number" ? place.rotation : 0,
    scale: sizeScale(crop.size, speciesRecord?.crop?.maxSizeMultiplier),
    depth: Math.round((y + 1) * 10),
  };
}

/**
 * The place the game's icon layout gives a sprig of a single-harvest plant: squeezed towards the
 * plant's middle, dropped just below it, and fanned out by its index.
 *
 * `vi(offset, index, count)`: a lone crop is put just below the middle and not turned, and a cluster
 * is pulled in to `0.4` across and `0.15` down, dropped `0.05`, and fanned `index × 137 % 30 − 15`
 * degrees, which is what makes a heap of them read as separate pieces in a pot.
 */
export function iconPlace({ place, index, count }) {
  if (count <= 1) return { x: 0, y: POT_ICON.drop, rotation: 0 };
  const fan = ((index * POT_ICON.step) % (POT_ICON.fan * 2)) - POT_ICON.fan;
  return {
    x: place.x * POT_ICON.across,
    y: place.y * POT_ICON.down + POT_ICON.drop,
    rotation: place.rotation + fan,
  };
}

/**
 * The key a tile's object stacks by, in the picture's own coordinates: lower on the screen is later,
 * and so drawn in front.
 *
 * `worldDepthSortKey-BXUHHrP0.js`'s `lg`, fed the way a garden tile's object feeds it: the tile's own
 * middle, the layer the object kind stacks at (`OccludingObject` for a plant), the lowest pixel the
 * thing reaches — a body that reaches lower wins inside one row — and the tile's own x as a last,
 * sub-pixel tie-break so two objects of one row are ordered the way the game orders them.
 *
 *     band (0) + floor(depthY × 1e4) + layer + (i <= 0 ? 0 : i / (i + 256)) + min(floor(x) × 1e-7, 1e-4)
 *
 * `depthY` is the tile's middle, since a plant's own `depthOffsetYPixels` is zero — only a decor
 * states one (`this.depthOffsetYPixels = fr(decorId, rotation).y`) — and `bodyBottomPixels` is the
 * lowest pixel the thing draws at, which the game takes as the body's own bottom or any crop's,
 * whichever reaches lower.
 */
export function worldDepthKey({ tileCentreY, bodyBottomPixels = null, layer = PLANT_LAYER, columnX = 0 }) {
  const depthY = tileCentreY;
  const bottom = bodyBottomPixels === null ? depthY : Math.max(bodyBottomPixels, depthY);
  const reach = bottom - depthY;
  const sortIndex = columnX <= 0 ? 0 : Math.min(Math.floor(columnX) * 1e-7, 1e-4);
  return Math.floor(depthY * 1e4) + layer + (reach <= 0 ? 0 : reach / (reach + TILE_PIXELS)) + sortIndex;
}
