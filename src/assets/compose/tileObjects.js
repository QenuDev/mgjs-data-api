// src/assets/compose/tileObjects.js
//
// The three things a garden tile can hold that are neither a plant nor a crop: an **egg**, a
// **crystal** and a **decoration**. Each is one sprite in a frame, and each is drawn at a scale the
// game works out from something only the save knows — an egg from how far through its window it is,
// a crystal from the charge it holds, a decoration not at all.
//
// Nothing here is invented. Every function is the game's own line, quoted below with the chunk it
// was read from, and the rest of a tile object's picture — its art, its anchor, its place on the
// tile — is the atlas's and the sprite-name table's, read through `artBridge.js`.
//
// ## The egg
//
// `installWorldSystems-2I5vu80Q.js` (bundle 1192; `WorldScope-D0BqYJ7N.js` in 1176), the world's egg
// visual, whose whole growth rule is these two lines:
//
//     Vm = .3
//     constructor(e){ ... this.sprite = new U({ texture: H.from(this.blueprint.sprite) })
//                     this.applyGrowthScale(Vm) }
//     applyGrowthScale(e){ this.sprite.scale.set(e / this.sprite.texture.sourcePixelRatio) }
//     updateGrowth(e, t){ ... let n = Ae(this.plantedAt, this.maturedAt, e), r = Vm + (1 - Vm) * n
//                         this.applyGrowthScale(r) }
//
// `Ae` is the same ramp every growing thing in the game uses — `Yr` in
// `quinoaAssetResolver-CVtuXws2.js`, which is `ti(start, end, now) * .7` before the window ends and
// `1` at or after it (`growth.js` quotes it whole). So an egg starts at three tenths of its art,
// reaches `0.3 + 0.7 × 0.7` by the time it is due, and is drawn at its full art once it has
// hatched out. Nothing about it is about the species: `eggId` names the art.
//
// The sprite is built with no anchor and no pivot (neither word appears in the class), so it is
// scaled about the anchor its own frame states — 0.72 of the way down an egg's art, which the atlas
// states per frame rather than the middle of the tile the page used to scale about.
//
// ## The crystal
//
// `topHudAtoms-DndCWqIj.js` (1192; `LayoutMotionController-CwhDlPns.js` in 1176), the crystal view:
//
//     Gm = .85, Km = .3, qm = 2
//     function Jm(e){ let t = Math.max(0, e) / We; return Math.min(qm, Km + (1 - Km) * t) }
//     function Ym(e){ return Gm * Jm(e) }
//     syncScale(){ let e = 1 / this.sprite.texture.sourcePixelRatio
//                  this.sprite.scale.set(Ym(this.crystal.remainingActiveSeconds) * e) ... }
//
// `We` is one shard's worth of charge — four hours, `fr = 14400` seconds, with a full crystal three
// shards (`pr = fr * 3`) — and the class states no anchor either, so a crystal is scaled about its
// frame's anchor (0.8 down, 0.76 for `Strength`). One shard is drawn at `0.85`, a full one at
// `1.7`, and the cap `qm` stops a crystal charged past full at twice its art.
//
// Note what this is: a **multiple of the art**, not a share of a full crystal. The viewer drew a
// share, because it fitted every tile's art to a fixed box; a composer draws in the art's own
// pixels, so the game's own multiple is what it can and does use.
//
// ## The decoration
//
// A decoration is not scaled by anything the save says. `resources-D_3Zwcn-.js`'s decor sprite
// (`Qn`) sets its anchor from the frame, sets its scale through
// `De(this.sprite, 1 / st(texture), { flipH, flipV })` — the art's own pixel ratio, sign only — and
// moves itself by one offset:
//
//     Qn = class { constructor(e){ let { decorId: t, rotation: n = 0, forInventory: r = false } = e
//                    ... this.refreshTexturePresentation()
//                    !r && (e = _n(t, n), this.sprite.position.set(e.x, e.y)) ... }
//                  refreshTexturePresentation(){ let e = this.sprite.texture
//                    this.sprite.anchor.set(e.defaultAnchor?.x ?? 0, e.defaultAnchor?.y ?? 0)
//                    De(this.sprite, 1 / st(e), { flipH: this.flipH, flipV: this.flipV }) } }
//
// and the tile view takes the y of that same offset as its **depth offset**:
//
//     this.depthOffsetYPixels = fr(e.decorId, e.rotation).y
//
// (`installWorldSystems-2I5vu80Q.js`), which `wl` feeds straight into the world depth key:
//
//     function wl({ tileCenterYPixels: e, depthOffsetYPixels: t, layer: n, bodyBottomYPixels: r }) {
//       return { depthYPixels: e + (t ?? 0), layer: n, bodyBottomPixels: r } }
//
// `fr` is `resources-D_3Zwcn-.js`'s `_n`, and it is worth quoting whole because it is narrower than
// its name suggests:
//
//     var gn = new Set([`ColoredStringLights`, `StringLights`, `WindchimeMoon`, `WindchimeStar`,
//                       `PaperLantern`, `FanousLantern`])
//     function _n(e, t) { if (!gn.has(e)) return { x: 0, y: 0 }
//       let n = Math.abs(t)
//       return t === 0 || n === 360 ? { x: 0, y: -0.5 * 256 }
//         : n === 180 ? { x: 0, y: 0.5 * 256 }
//         : n === 90 ? { x: 0.5 * 256, y: 0 }
//         : n === 270 ? { x: -0.5 * 256, y: 0 }
//         : { x: 0, y: 0 } }
//
// So the offset is not a hash of the id, as an earlier reading of this had it: only the six hanging
// decorations have one, it is half a tile (128 px at the reference tile) along one axis, and a hutch
// or a birdhouse stands at the tile's middle with no offset at all. A tile that states no rotation
// draws the same picture the game's own `rotation = 0` default does.
//
// Two things a decoration can state that this API does not read, and neither is guessed around:
// a `rotationVariants` entry (a grave stone's 90/180/270 art) and the flip a negative rotation asks
// for. Both come from the decor **definition** table (`kn` in `worldDepthSortKey-BXUHHrP0.js`),
// which this API's `/data/art` does not publish yet, so a decoration is drawn from the art its id
// names and placed where the game places it. Which tile rung it stacks at has the same source: a
// decoration whose `depthBehavior` is `Ground` (a rug) draws at `Base`, every other at
// `OccludingObject`, and without that table every decoration is taken as the latter.

import { GROWN_BY_MATURITY, throughWindow } from "./growth.js";

/** Where the game starts an egg: its own `Vm`, three tenths of the art. */
export const EGG_START = 0.3;

/** One shard's worth of crystal charge, in seconds: the game's own `fr`. */
export const CRYSTAL_SHARD_SECONDS = 14_400;

/** A full crystal is three shards: the game's own `pr = fr * 3`. */
export const CRYSTAL_FULL_SECONDS = CRYSTAL_SHARD_SECONDS * 3;

/** Where the game starts a crystal's charge at: its own `Km`, three tenths. */
export const CRYSTAL_CHARGE_START = 0.3;

/** How large a full crystal is drawn, as a multiple of its art: the game's own `Vm`/`Gm`, 0.85. */
export const CRYSTAL_SCALE_BASE = 0.85;

/** The cap on that multiple, the game's own `Um`/`qm` — twice the art, however charged. */
export const CRYSTAL_SCALE_CAP = 2;

/**
 * How large an egg is drawn, as a multiple of its own art.
 *
 * `Vm + (1 - Vm) × Ae(plantedAt, maturedAt, now)`, with `Ae` the ramp the rest of the game grows by:
 * `0.7 × through` while the window is running, and `1` at or after its end. A spec that states no
 * window — no `startTime`, or an end at or before the start — is drawn at its full art, the same
 * reading `growthOf` takes for a crop: there is nothing to say about when it is, and drawing it at
 * nothing would be worse.
 */
export function eggScale(egg) {
  if (egg?.ready === true) return 1;
  const { startTime, endTime, remainingMs } = egg ?? {};
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || !Number.isFinite(remainingMs)) return 1;
  const now = endTime - remainingMs;
  if (now >= endTime) return 1;
  return EGG_START + (1 - EGG_START) * GROWN_BY_MATURITY * throughWindow(startTime, endTime, now);
}

/**
 * How large a crystal is drawn, as a multiple of its own art, from the charge it holds.
 *
 * `Gm × min(qm, Km + (1 − Km) × max(0, seconds) / fr)`, which is the game's own `Ym(Jm(e))`. A
 * crystal the wire states no charge for is drawn at its art's own size: nothing else is knowable
 * about it, and a guess would be a picture of a charge it does not have.
 */
export function crystalScale(remainingSeconds) {
  if (!Number.isFinite(remainingSeconds)) return 1;
  const held = Math.max(0, remainingSeconds) / CRYSTAL_SHARD_SECONDS;
  return CRYSTAL_SCALE_BASE * Math.min(CRYSTAL_SCALE_CAP, CRYSTAL_CHARGE_START + (1 - CRYSTAL_CHARGE_START) * held);
}

// ## A charged tool, which is drawn as the crystal it holds
//
// A shard in the bag is an item of type `Tool` whose entry carries `remainingActiveSeconds`, and the game's
// own predicate for it is exactly that:
//
//     function gn(e){ return e.itemType === E.Tool && `remainingActiveSeconds` in e }
//
// (`worldDepthSortKey-BXUHHrP0.js`, 1192; the same predicate routes the icon builder). Its art is **not** the
// shard's own name: the game maps the shard back to the crystal it is and draws that, through `pn` —
//
//     pn = { RainWard: T.Item.RainWardCrystal, SnowWard: T.Item.SnowWardCrystal,
//            ThunderWard: T.Item.ThunderWardCrystal, Hunger: T.Item.HungerCrystal,
//            XP: T.Item.XPCrystal, Strength: T.Item.StrengthCrystal }
//
// — and the map back from the shard is the game's own six-case switch, quoted whole:
//
//     function hn(e){ switch(e){ case `HungerShard`: return `Hunger`; case `XPShard`: return `XP`;
//       case `StrengthShard`: return `Strength`; case `RainWardShard`: return `RainWard`;
//       case `SnowWardShard`: return `SnowWard`; case `ThunderWardShard`: return `ThunderWard`;
//       default: return } }
//
// Six shards, and no seventh: a charged tool whose id is not one of them is a picture the game has no art
// for, which is a refusal here rather than a name built out of the id.

/** The crystal a charged shard is drawn as: the game's own `hn`, one entry per case. */
export const CHARGED_TOOL_CRYSTAL = Object.freeze({
  HungerShard: "Hunger",
  XPShard: "XP",
  StrengthShard: "Strength",
  RainWardShard: "RainWard",
  SnowWardShard: "SnowWard",
  ThunderWardShard: "ThunderWard",
});

/**
 * The sprite name a charged tool is drawn from — `<crystal>Crystal`, which is the same item name a crystal
 * tile states — or `null` for a shard the game's own switch does not name.
 */
export function chargedToolArtName(toolId) {
  const crystal = CHARGED_TOOL_CRYSTAL[toolId];
  return crystal === undefined ? null : `${crystal}Crystal`;
}

/** The decorations the game gives an offset to: its own `gn` set, quoted whole above. */
export const HANGING_DECOR = Object.freeze(
  new Set(["ColoredStringLights", "StringLights", "WindchimeMoon", "WindchimeStar", "PaperLantern", "FanousLantern"]),
);

/**
 * Where the game moves a decoration, in the reference tile's own pixels: the game's own `fr(_n)`.
 *
 * `{x: 0, y: 0}` for every decoration but the six hanging ones, and for those it is half a tile along
 * one axis of the rotation's own quarter — up at `0`, down at `180`, right at `90`, left at `270`,
 * and nothing at an angle that is none of them. The tile view takes `y` as the object's depth offset
 * and the sprite takes both as its position, so a caller needs the one function for both.
 */
export function decorOffset(decorId, rotation) {
  if (!HANGING_DECOR.has(decorId)) return { x: 0, y: 0 };
  const degrees = Number.isFinite(rotation) ? rotation : 0;
  const quarter = Math.abs(degrees);
  if (degrees === 0 || quarter === 360) return { x: 0, y: -0.5 * 256 };
  if (quarter === 180) return { x: 0, y: 0.5 * 256 };
  if (quarter === 90) return { x: 0.5 * 256, y: 0 };
  if (quarter === 270) return { x: -0.5 * 256, y: 0 };
  return { x: 0, y: 0 };
}
