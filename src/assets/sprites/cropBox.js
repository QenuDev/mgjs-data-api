// src/assets/sprites/cropBox.js
//
// The single place that states what a composed crop's picture is: its box, and therefore
// the canvas the mutation layers are drawn into.
//
// ## What this file states today, and why it is wrong
//
// Today it states: the canvas is exactly the crop's own art (after `extractSprite` restores
// the trim), the art sits at the origin, and any layer that reaches past the frame is
// *clipped* to it — `{x: 0, y: 0, width, height}`.
//
// **That is the clamped convention, and the game does not do it.** Read from the game's own
// bundle (`.logs/crop-clip-research.md` and `.logs/finding-composed-box.md`; capture of
// version 1176, read 2026-09-16 — the API serves 1192, so this is the best evidence we have
// rather than a proof for 1192):
//
//   * Every mutation sprite is added to the crop's `CropVisual` container with `addChild`,
//     unmasked, unanchored, unfitted. A sweep of `setMask` / `.mask=` / `MaskData` /
//     `filterArea` / `boundsArea` over all 122 bundle files finds three mutation-related
//     sites, and the only two that exist are gated on `isTallPlant`: they clip the
//     *tall-plant overlay* art (`sprite/mutation-overlay/*TallPlant`) to the crop body's own
//     texture. Clover is `isTallPlant: false`, so nothing clips it.
//   * Independently, the game's own plant-icon renderer fits the **union** —
//     `container.getBounds()`, crop ∪ mutation art — into its canvas.
//   * For a Clover wearing `Frozen,Thunderstruck` the union is 116×206 against the crop's own
//     116×169, and 218 opaque pixels of it lie above the crop's art frame. Measured with the
//     union computed from the unclipped layer rectangles over the reachable set space:
//     **393 of 540 (species, set) pairs over six species — 36 of Squash's 90 — come out a
//     different size**, so this is not a corner case.
//
// The faithful convention is therefore the opposite: canvas = the tight **union** of the crop
// art and its layers, and `X-MG-Sprite-Box` = the **art's** rectangle inside that picture. The
// tall-plant overlay clip above is real and must survive a correction — a fix that removes
// every clip would be as wrong as one that clips everything. Plan item 3 chose the clamped
// box without proving the game clips, and its "0 of 6,210 came back a different size" asserts
// the clipping behaviour as the success condition; item 24 owns the correction to the
// composer, the endpoint's box and the `?format=layout` body.
//
// ## What this file is for until item 24 lands
//
// `cropBox()` is the one statement of the box the composer uses for its canvas, and
// `cropArtSize()` is the one derivation of the art's own dimensions from an atlas frame. The
// opt-in bake deliberately **records no box at all** (`./cropBake.js`), because a manifest
// written under the clamped convention would assert `0,0,width,height` for every one of its
// 6,210 pictures — the degenerate value the wrong half of item 3 produces — and item 24 has to
// add the union box and the art's rectangle in one place. So the bake's manifest names each
// picture's file and byte count and says nothing about geometry, and a request's box comes
// from the composer, which owns the convention.
//
// `cropBox()` is the tripwire: when item 24 replaces it, this file and the bake's tests are
// where the change is expected to show up.

/** The box of a composed crop whose art is `width`×`height`, in picture pixels. */
export function cropBox(width, height) {
  return { x: 0, y: 0, width, height };
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
