// src/assets/sprites/cropBox.js
//
// The single place that states what a composed crop's picture is: the canvas its art and its
// mutation layers are drawn into, and the rectangle the art occupies inside that picture.
//
// ## The convention
//
//   * **canvas = the tight union** of the crop's own art and every layer actually drawn into
//     it — an icon that reaches past the crop's frame *grows the picture* instead of being
//     cut to it;
//   * **`X-MG-Sprite-Box` = the art's own rectangle inside that picture**
//     (`x, y, width, height`), `width`/`height` the crop art's own size and `x`/`y` the
//     corner the art sits at. That is what the header was always documented to mean, and
//     what a caller needs in order to place the picture on a tile.
//
// ## The evidence
//
// Read from the game's own bundle (`.logs/crop-clip-research.md` and
// `.logs/finding-composed-box.md`; capture of version 1176, read 2026-09-16 — the API serves
// 1192, so this is the best evidence we have rather than a proof for 1192):
//
//   * Every mutation sprite is added to the crop's `CropVisual` container with `addChild`,
//     unmasked, unanchored, unfitted. A sweep of `setMask` / `.mask=` / `MaskData` /
//     `filterArea` / `boundsArea` over all 122 bundle files finds three mutation-related
//     sites, and the only two that exist are gated on `isTallPlant`.
//   * Independently, the game's own plant-icon renderer fits the **union** —
//     `container.getBounds()`, crop ∪ mutation art — into its canvas.
//
// How often that matters, measured on this composer over the live atlas and plant records of
// game 1192 (2026-09-16, geometry only via `composedBox`): **4,818 of the 6,210 (crop art,
// reachable set) pictures are bigger than the crop's own art frame**, and 3,780 of them put the
// art's corner off the picture's origin. Every one of the 69 crop arts grows at least once;
// Bamboo, Cactus, Delphinium, RoseRed, Saffron, ThunderCelestialFruit and CloverFourLeaf grow
// for 87 of their 90 sets. That is exactly the "4,818 of 6,210 before it" plan item 3 quoted:
// item 3 read the set of pictures whose union is bigger than the art as the number its clamp
// had fixed, when it is the number the clamp was throwing away.
//
// Those two counts are the placement *before* plan item 25 keyed the mutation anchors by
// species, so they are the composer this block was written about rather than the one that
// ships now. The fixture-sized sweep is the one that can be re-run without the network — and
// it measures different numbers, because the fixture's arts are not the live ones: over the
// 6,210 (art, set) pairs of the committed atlas, item 25 moves 1,086 pictures and takes the
// ones whose union is bigger than the art from 3,780 to 3,918.
//
// ## The other convention, and why the two differ by design
//
// `@mg.js/art`'s composer (`garden-viewer`) unions too, but its box is **species-wide**: it
// unions the art with every mutation its tables state, worn or not, so one picture per art can
// be composed once and placed whatever the crop turns out to carry — "the consumer's own
// choice", as `mg.js/packages/art/src/crop.ts:261-263` puts it, and the reason a mutation never
// resizes a crop. For `sprite/plant/CloverThreeLeaf` that answers 116×206 whatever is worn.
//
// This composer's union is **per request**, over the layers the request actually draws — the
// tight union the correction asked for, and what the game's own `container.getBounds()` sees
// for a crop holding only the mutation sprites it was built with. The two are different
// conventions *on purpose*, and a picture from one is not supposed to equal a picture from the
// other; do not file that as a bug. Measured 2026-09-16:
//
//   * they agree where the placements agree. `Sunflower` wearing `Ambercharged` is 256×322 with
//     the art at `(0, 66)` from both composers — its art key is the game's species name, so
//     both sides read the same anchor row — and wearing `Frozen` it is 256×256 from both;
//   * they differ for `CloverThreeLeaf` wearing `Frozen,Thunderstruck`: 116×184 here against
//     116×206 there, whose box reserves room for Ambercharged as well — a box difference and
//     not a placement one. Both agree on where the worn layers land since plan item 25 keyed
//     the game's anchor table by species (`src/assets/sprites/mutationAnchor.js`); before that
//     fix this composer answered 116×169 for the pair, because `anchors.Clover.y = 0.3` was
//     read with the art key's last segment (`CloverThreeLeaf`) and never applied.
//
// ## The one clip that stays
//
// The **tall-plant overlay** layer (`sprite/mutation-overlay/*TallPlant`, drawn only when the
// crop's plant is flagged `isTallPlant`) *is* masked in the game to the crop body's own
// texture, so it cannot reach outside the art's rectangle and never grows the picture. That
// clip is a property of that one layer, not of the canvas, and `overlayClip()` below is its
// one statement — a fix that removed every clip would be exactly as wrong as one that clipped
// everything.
//
// The other layers are drawn where the game's placement math puts them, and their rectangles
// are what `cropComposition()` unions. `Math.min(canvasW, …)` / `Math.min(canvasH, …)` cuts
// like the ones this file replaced must not come back: a picture sized to the union has no
// reason to cut a layer, and a cut that is not an overlay's would silently discard art the
// game draws.

/**
 * The picture a crop composes into: the tight union of the art's own rectangle and the
 * rectangles of the layers drawn over it.
 *
 * `artWidth`×`artHeight` is the crop art's own size (`cropArtSize`), and each layer is
 * `{left, top, width, height}` in the art's own coordinate space, its top-left corner at the
 * art's origin. Layers that do not reach past the art do not move anything.
 *
 * Returns:
 *   * `canvas` — the picture's size, `{width, height}`;
 *   * `box` — the art's own rectangle inside that picture, `{x, y, width, height}`, which is
 *     what `X-MG-Sprite-Box` states and what the composer places every layer against.
 */
export function cropComposition(artWidth, artHeight, layers = []) {
  let minX = 0;
  let minY = 0;
  let maxX = artWidth;
  let maxY = artHeight;

  for (const layer of layers) {
    if (!layer) continue;
    if (layer.left < minX) minX = layer.left;
    if (layer.top < minY) minY = layer.top;
    if (layer.left + layer.width > maxX) maxX = layer.left + layer.width;
    if (layer.top + layer.height > maxY) maxY = layer.top + layer.height;
  }

  return {
    canvas: { width: maxX - minX, height: maxY - minY },
    // `-0` is not `0` to `assert.deepEqual` or to a reader; normalize the untouched axis.
    box: {
      x: minX < 0 ? -minX : 0,
      y: minY < 0 ? -minY : 0,
      width: artWidth,
      height: artHeight,
    },
  };
}

/**
 * The part of a tall-plant overlay that survives its clip to the crop body's own texture, or
 * null when nothing of it is inside.
 *
 * This is the **one** clip a mutation's art gets in the game (see the header), and it is
 * bounded by the art's own rectangle — `artWidth`/`artHeight` — never by the picture, so the
 * overlay cannot grow the canvas. The arithmetic is the game's: the overlay is placed on the
 * crop's anchor x and either the art's top or its bottom (`fromBottom`), then cut to the art.
 *
 * Returns `{x, y, cropLeft, cropTop, width, height}`: where the kept piece is placed on the
 * art `{x, y}` and the rectangle to cut out of the overlay `{cropLeft, cropTop, width,
 * height}`.
 */
export function overlayClip(artWidth, artHeight, overlayWidth, overlayHeight, anchorX, fromBottom) {
  const rawX = Math.round(artWidth * anchorX - anchorX * overlayWidth);
  const rawY = fromBottom ? artHeight - overlayHeight : 0;

  const cropLeft = rawX < 0 ? -rawX : 0;
  const cropTop = rawY < 0 ? -rawY : 0;
  const x = Math.max(0, rawX);
  const y = Math.max(0, rawY);

  const width = Math.min(overlayWidth - cropLeft, artWidth - x);
  const height = Math.min(overlayHeight - cropTop, artHeight - y);
  if (width <= 0 || height <= 0) return null;

  return { x, y, cropLeft, cropTop, width, height };
}

/**
 * A crop art's own dimensions from its atlas frame: `sourceSize` when the frame is trimmed
 * (what the game draws after the trim is restored), the stored rect otherwise.
 */
export function cropArtSize(meta) {
  return {
    width: meta?.sourceSize?.w ?? (meta?.rotated ? meta?.frame?.h : meta?.frame?.w),
    height: meta?.sourceSize?.h ?? (meta?.rotated ? meta?.frame?.w : meta?.frame?.h),
  };
}
