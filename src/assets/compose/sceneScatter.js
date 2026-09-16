// src/assets/compose/sceneScatter.js
//
// The game's own scatter for a patch that states no places.
//
// A patch tile holds a cluster of crops, and where each of them stands inside the tile is
// **instance data** the save carries (`crop.x`, `crop.y`, `crop.rotation`, schema'd as optional
// unbounded numbers and compared field by field by the renderer, so they are persisted rather than
// recomputed). A spec version 2 that lets a caller state them is the faithful path; this file is the
// fallback for a caller that has no save, and it is the game's own fallback rather than an even
// spread.
//
// ## Where it comes from
//
// The potted-patch merge — replanting a potted patch onto another patch — lays the incoming patch's
// slots out with this generator (`worldDepthSortKey-BXUHHrP0.js`, bundle 1192):
//
//     var Js=.7, Ys=.8, Xs=12.6, Zs=10;
//     function Qs(e){return{x:(e()-.5)*Js,y:(e()-.5)*Ys}}
//     function $s(e,t){return(e.x-t.x)**2+(e.y-t.y)**2}
//     function ec(e,t=[],n,r=Math.random){let i=[],a=[...t];
//       for(let t=0;t<e;t++){let e=Qs(r),o=-1,s=n?.[t];
//         if(s){let t=1/0;for(let e of a)t=Math.min(t,$s(s,e));o=t,e=s}
//         for(let t=0;t<Zs;t++){let t=Qs(r),n=1/0;for(let e of a)n=Math.min(n,$s(t,e));n>o&&(o=n,e=t)}
//         let c={...e,rotation:(r()-.5)*Xs};i.push(c),a.push(e)}
//       return i}
//
// The call site passes a seeded generator, so the same patch lays out the same way twice:
//
//     ec(t.slots.length, n, r, He(`potted-plant-layout`, t.id))
//
// Read exactly: `count` slots; each candidate point is `x ∈ [-0.35, +0.35]`, `y ∈ [-0.4, +0.4]`
// **tile fractions** (`Js`/`Ys` are the halved ranges, because the generator multiplies
// `(r() - .5)`); a first candidate is drawn, then up to `Zs = 10` more are tried and the one whose
// minimum squared distance to every already-placed point is largest wins; a slot that already has a
// position seeds the comparison and is only replaced by something better separated; the rotation is
// `±6.3°` (`Xs = 12.6` halved), drawn from the same stream after the point.
//
// The arithmetic below is that function's, statement for statement, with the names spelled out. It
// invents nothing: the bounds, the try count, the rotation range and the best-candidate rule are the
// game's. What this file does **not** transcribe is the game's choice of PRNG — see below.
//
// ## The seed
//
// The game seeds from the patch's own id (`He('potted-plant-layout', t.id)`), which is what makes one
// patch lay out the same way twice. This composer's items have no patch id, so the seed is the
// item's `id` — the caller's own name for the item, which the normaliser already requires to be
// unique in a spec. So a spec composes to one picture, and the same spec composes to the same
// picture, which is what a content-addressed cache needs: the key is the spec alone, and a scene
// that reshuffled itself per request would be a bug rather than a feature.
//
// The generator itself is this file's one arithmetic choice, and it is stated as a choice rather
// than as a finding: `mulberry32`, a small well-known 32-bit generator, over a string hash. The
// game's own is an Alea generator (`function Zt(...e){…}` in `BakedRoundedRect-lGFgQzh1.js`) whose
// exact stream over `('potted-plant-layout', id)` cannot be reproduced here anyway — this API has no
// patch id to seed it with, only the item's id — and copying its mash/compaction steps would put
// minified library code in this repo without making the places any more the game's. The *rule*
// (bounds, try count, rotation range, best-candidate choice) is what makes the places the game's
// shape; the stream decides which of the valid layouts comes out, and a caller that needs a
// particular one states it (`at: { x, y, rotation }` on the crop).

/** Half the tile-width band a candidate point is drawn from: `Js = .7`, halved. */
const AXIS_RANGE_HALF = 0.7 / 2;

/** Half the tile-height band: `Ys = .8`, halved. */
const DEPTH_RANGE_HALF = 0.8 / 2;

/** How many candidates are tried per slot before the best separated one is kept: `Zs = 10`. */
const CANDIDATES = 10;

/** Half the rotation band in degrees: `Xs = 12.6`, halved. */
const ROTATION_HALF = 12.6 / 2;

/** The band a scattered place falls in, as the game's own constants state it. */
export const SCATTER_BOUNDS = Object.freeze({
  x: Object.freeze([-AXIS_RANGE_HALF, AXIS_RANGE_HALF]),
  y: Object.freeze([-DEPTH_RANGE_HALF, DEPTH_RANGE_HALF]),
  rotation: Object.freeze([-ROTATION_HALF, ROTATION_HALF]),
});

/** Squared distance between two tile-fraction points: the game's `$s`. */
function squaredDistance(one, other) {
  return (one.x - other.x) ** 2 + (one.y - other.y) ** 2;
}

/**
 * A deterministic stream in `[0, 1)`, from a seed string.
 *
 * `mulberry32` over an FNV-1a hash of the seed: same seed, same stream, every process and every run.
 * That is the whole requirement a content-addressed cache puts on it.
 */
function streamFrom(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` places in one tile, each `{ x, y, rotation }` in **tile fractions** and degrees.
 *
 * `seeded[index]` is the place the caller already stated for slot `index`, or `null`/absent to let
 * the scatter choose: a stated slot is used as it stands (the caller's own point is not moved) but
 * still counts as an occupied point, so a generated slot is pushed away from it as well. A stated
 * slot's rotation is the caller's too.
 *
 * A seeded entry needs only `x` and `y`; `rotation` is taken as `0` when it is absent, which is the
 * tile's middle's own rotation and what a caller that stated a point and no angle asked for.
 *
 * The points are the game's: each candidate is drawn, then up to ten more are tried, and the one
 * whose nearest neighbour among the placed points is farthest away wins.
 */
export function scatterPlaces(count, { seed, seeded = [] } = {}) {
  const random = streamFrom(String(seed));
  const candidate = () => ({
    x: (random() - 0.5) * (AXIS_RANGE_HALF * 2),
    y: (random() - 0.5) * (DEPTH_RANGE_HALF * 2),
  });

  const placed = [];
  const places = [];
  for (let index = 0; index < count; index += 1) {
    const stated = seeded[index] ?? null;
    let point = stated === null ? candidate() : { x: stated.x, y: stated.y };
    let separation = -1;
    if (stated !== null) {
      separation = Number.POSITIVE_INFINITY;
      for (const other of placed) separation = Math.min(separation, squaredDistance(stated, other));
    }
    for (let attempt = 0; attempt < CANDIDATES; attempt += 1) {
      const tried = candidate();
      let nearest = Number.POSITIVE_INFINITY;
      for (const other of placed) nearest = Math.min(nearest, squaredDistance(tried, other));
      if (nearest > separation) {
        separation = nearest;
        point = tried;
      }
    }
    const rotation =
      stated === null ? (random() - 0.5) * ROTATION_HALF * 2 : (stated.rotation ?? 0);
    const place = { x: point.x, y: point.y, rotation };
    places.push(place);
    placed.push(point);
  }
  return places;
}
