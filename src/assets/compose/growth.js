// src/assets/compose/growth.js
//
// How large a still-growing thing is drawn, which is the one part of a picture that is about *when* it
// is rather than what it is.
//
// A crop states a window — `startTime` to `endTime` — and the game animates it across that window
// (`quinoaAssetResolver-CVtuXws2.js`, bundle 1192):
//
//     Jr = 1e3;                                                     // the pop's own duration, in ms
//     function ti(e, t, n){ return e > t ? 1 : Math.min(Math.max((n - e) / (t - e), 0), 1) }   // `Le`
//     function Yr(e, t, n){ return n >= t ? 1 : e < t ? ti(e, t, n) * .7 : 0 }
//     function Xr(e, t){ return t > e + Jr }
//     function Zr(e, t, n){ return Xr(t, n) ? 1 : n >= t ? Qr((n - t) / Jr) : Yr(e, t, n) }
//     function Qr(e){ let t = 2*Math.PI/3; return e === 0 ? 0 : e === 1 ? 1 : 2**(-10*e)*Math.sin((e*10 - .75)*t) + 1 }
//
// so the ramp `Yr` grows to **0.7 of the way up** by the time the window ends, and the second after the
// end is a one-second pop `Qr` that carries it from there to 1 with an overshoot. A **picture** is one
// moment rather than an animation, so the tick this file answers is the ramp and the settled end of it,
// which is the reading `garden-viewer/garden.mjs` takes and states: "a crop with time left on it is 0.7
// of the way through its window, and one that has ripened is at 1".
//
// What the crop is multiplied by differs by harvest type, and that is the game's own line too —
// `PlantCrop.scaleForGrowthProgress(e) { return (plantBlueprint.harvestType === Single ? oi + (1 - oi)*e
// : e) * this.restingScale }` with `oi = .2`:
//
//   * a **multi-harvest** crop is a fruit: it grows from nothing, so its growth *is* the ramp;
//   * a **single-harvest** crop is the plant itself — what stands on a patch tile is the sprout — so it
//     starts at a fifth of its size, exactly as the game's `Ec` does.
//
// The moment is the caller's, not this API's: a spec states the window and a crop states how much of it
// is left (`remainingMs`, the field the wire carries), so the same spec composes the same picture twice
// — the cache is content-addressed and a picture that depended on this process's clock could not be.

/** How far up the game's ramp has grown something by the time its window ends: `Yr`'s own `.7`. */
export const GROWN_BY_MATURITY = 0.7;

/** Where a single-harvest crop starts: a fifth of its size, the game's own `oi` (its `Ec`). */
export const SPROUT = 0.2;

/** The pop's own duration, the bundle's `Jr` — kept beside the curve even though a still picture is not in it. */
export const POP_MS = 1e3;

/**
 * How far through a window a moment is, 0 to 1: the game's own `ti` (`Le`).
 *
 * A window that is not a window — no end, an end before its start — is taken as finished, so a thing
 * that states no times is drawn at its full size rather than at nothing.
 */
export function throughWindow(startTime, endTime, now) {
  const window = endTime - startTime;
  if (!(window > 0)) return 1;
  return Math.min(1, Math.max(0, (now - startTime) / window));
}

/**
 * The multiple a crop of this `harvestType` is drawn at because of when it is, or `1` when its moment is
 * not stated.
 *
 * A crop states its window (`startTime`, `endTime`) and how much of it is left (`remainingMs`), which is
 * the unit the wire states both in; the moment is `endTime − remainingMs`. `ready` is the wire's own
 * "ripe now" flag and wins over the arithmetic, which is how a caller that knows the crop is ready says
 * so without stating a moment at all. A crop that states no window, or a window with no moment in it, is
 * drawn ripe — there is nothing to say about when it is, and drawing it at nothing would be worse. All
 * three have to be stated: an end with no start is not a window, and reading it as a finished one would
 * draw a ripe-size fruit at 0.7 of its size.
 */
export function growthOf(crop, harvestType) {
  const single = harvestType === "Single";
  const blend = (value) => (single ? SPROUT + (1 - SPROUT) * value : value);
  if (crop?.ready === true) return 1;
  const { startTime, endTime, remainingMs } = crop ?? {};
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || !Number.isFinite(remainingMs)) return 1;
  const now = endTime - remainingMs;
  // The game's own `Yr` reads a moment at or past the end as finished, whatever the ramp says.
  if (now >= endTime) return blend(1);
  return blend(GROWN_BY_MATURITY * throughWindow(startTime, endTime, now));
}
