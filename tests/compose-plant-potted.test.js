// tests/compose-plant-potted.test.js
//
// Une plante en pot : une récolte `Single` y est dessinée comme une **icône**, et l'icône du jeu ne place
// pas ses cultures au milieu du pot — elle sertit chacune à sa **propre** place, celle que la sauvegarde
// lui a donnée.
//
// La règle est celle du jeu, citée ici une fois pour toutes (`resources-D_3Zwcn-.js`, bundle 1192, la
// fabrique du corps d'une plante) :
//
//     createCrops(){ let {plant:e, blueprint:t} = this.options, n = t.plant, r = [];
//       if (n.harvestType === D.Single)
//         if (e.slots[0]?.x !== void 0) { let t = this.isolateRendering;
//           for (let n = 0; n < e.slots.length; n++) { let i = e.slots[n]; if (!i) continue;
//             let a = {x: i.x ?? 0, y: i.y ?? 0, rotation: i.rotation ?? 0};
//             r.push({index: n, offset: t ? vi(a, n, e.slots.length) : a}) } }
//         else e.slots[0] ? r.push({index: 0, offset: {x: 0, y: 0, rotation: 0}})
//                         : console.warn(`No slot found for single harvest plant`, e);
//       else { /* les `slotOffsets` du blueprint, plus le milieu du corps */ } }
//
//     mi = .4, hi = .15, gi = .05, _i = 15;
//     function vi(e, t, n){ if (n <= 1) return {x: 0, y: gi, rotation: 0};
//       let r = t * 137 % (_i * 2) - _i; return {x: e.x * mi, y: e.y * hi + gi, rotation: e.rotation + r} }
//
// Trois choses s'y lisent, et chacune peut échouer séparément :
//
//   * la branche est celle de la **plante** (`isolateRendering`, qui est le pot) et la place est celle de
//     la **culture** : `vi` reçoit `{x: i.x, y: i.y, rotation: i.rotation}` du slot, jamais le milieu ;
//   * une culture qui ne déclare aucun point tombe au milieu (`{0, 0, 0}`), qui est la seule lecture que
//     le jeu fait d'un slot dont il ne voit pas le `x` — pas la dispersion d'une patch, qui est pour une
//     tuile et non pour un pot ;
//   * une récolte `Multiple` n'entre pas dans cette branche : ses places sont les `slotOffsets` de son
//     blueprint, et une place déclarée sur sa culture est lue et ignorée.
//
// Hors ligne : `installOfflineGame()` sert l'atlas et le bundle capturés. Emberbloom (récolte `Single`,
// capacité 15) et PricklyPear (récolte `Multiple`, cinq slots) ont leur corps **et** leur culture dans la
// fixture.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.COMPOSE_CACHE_DIR = new URL("./fixtures/compose-cache-potted/", import.meta.url).pathname;
process.env.COMPOSE_CACHE_MAX = "8";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { installOfflineGame, plantFixture } from "./helpers/offlineGame.js";
import { startTestApp } from "./helpers/httpApp.js";

const CACHE_DIR = new URL("./fixtures/compose-cache-potted/", import.meta.url);

const restoreFetch = await installOfflineGame({ version: 1192 });

const { gameDataService } = await import("../src/services/gameData.js");
const PLANTS = await plantFixture();
gameDataService.getPlants = async () => PLANTS;

const { initSprites } = await import("../src/assets/sprites/sprites.js");
const { SPEC_VERSION } = await import("../src/assets/compose/spec.js");
const { POT_ICON } = await import("../src/assets/compose/cropPlacement.js");
const { resetSceneCache } = await import("../src/assets/compose/sceneCache.js");
const { clearSceneCaches } = await import("../src/assets/compose/sceneService.js");

await initSprites();

/** La courbe du jeu pour une taille : `1 + ((taille - 50) / 50) x (maxSizeMultiplier - 1)`. */
const curve = (size, species) => 1 + ((size - 50) / 50) * (PLANTS[species].crop.maxSizeMultiplier - 1);

/**
 * Ce que le jeu fait d'une place pour l'icône d'une plante en pot : `vi(place, index, count)`, écrit ici
 * depuis la citation — un seul brin n'est pas tourné, un amas est tiré vers le milieu, descendu et
 * éventaillé par son index.
 */
function vi(place, index, count) {
  if (count <= 1) return { x: 0, y: POT_ICON.drop, rotation: 0 };
  const fan = ((index * POT_ICON.step) % (POT_ICON.fan * 2)) - POT_ICON.fan;
  return {
    x: place.x * POT_ICON.across,
    y: place.y * POT_ICON.down + POT_ICON.drop,
    rotation: place.rotation + fan,
  };
}

/**
 * La spec d'une plante en pot. `crops` est une liste d'entrées telles quelles — c'est la spec qui déclare,
 * et le test ne complète rien à sa place.
 */
function potted({ id = "pot", species = "Emberbloom", crops }) {
  return {
    spec: SPEC_VERSION,
    canvas: { fit: "content", padding: 0 },
    items: [{ id, kind: "plant", species, potted: true, matured: true, crops }],
  };
}

async function layoutOf(api, spec) {
  return api.get("/compose?format=layout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec),
  });
}

async function cleanCache() {
  await fs.rm(CACHE_DIR, { recursive: true, force: true });
  resetSceneCache();
  clearSceneCaches();
}

/** Les cultures publiées, par leur `slot` : la disposition est dans l'ordre de dessin, pas de la spec. */
const bySlot = (layout) => new Map(layout.items[0].crops.map((crop) => [crop.slot, crop]));

test("les constantes du sertissage sont celles du bundle, écrites ici une seule fois", () => {
  // `mi = .4, hi = .15, gi = .05, _i = 15` et `yr = 137` : les quatre nombres du sertissage et le pas de
  // l'éventail. Partout ailleurs ils se lisent sur le module, donc un `.4` recopié en `.04` y passerait
  // pour la règle du jeu — c'est le seul endroit où ils sont écrits.
  assert.deepEqual(POT_ICON, { across: 0.4, down: 0.15, drop: 0.05, fan: 15, step: 137 });
});

test("les cultures d'une plante en pot gardent leur propre place, sertie vers le milieu", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Des places distinctes, telles qu'une sauvegarde les écrit : `x`/`y` en fractions de tuile et une
  // rotation en degrés. La cinquième est à l'origine, pour que le cas « au milieu » soit dans le même pot
  // que les autres plutôt que dans un test qui ne prouve que lui-même.
  const places = [
    { x: 0.0388481432085936, y: 0.07824676644355577, rotation: -21.021378759126158 },
    { x: -0.07358235248078997, y: -0.009414173190624799, rotation: 0.22038543645736253 },
    { x: 0.12332214169939895, y: 0.014973054743261285, rotation: -15.85918645792885 },
    { x: -0.12981626482540032, y: 0.0865150558835947, rotation: 4.365996935273192 },
    { x: 0, y: 0, rotation: 0 },
  ];
  const spec = potted({
    crops: places.map((at, slot) => ({ slot, size: 50, at })),
  });

  const response = await layoutOf(api, spec);
  assert.equal(response.status, 200);
  const layout = await response.json();
  const item = layout.items[0];
  assert.equal(item.kind, "plant");
  assert.equal(item.species, "Emberbloom");
  assert.equal(item.crops.length, 5);

  const crops = bySlot(layout);
  for (let slot = 0; slot < places.length; slot += 1) {
    const crop = crops.get(slot);
    // La place attendue est `vi(place, slot, 5)` : l'index est celui de la culture dans la liste de la
    // plante (le `n` de la boucle du jeu), et le nombre est celui des cultures, pas la capacité de l'espèce.
    const wanted = vi(places[slot], slot, places.length);
    assert.ok(
      Math.abs(crop.place.x - wanted.x) < 1e-12,
      `slot ${slot}: x ${crop.place.x} au lieu de ${wanted.x}`,
    );
    assert.ok(
      Math.abs(crop.place.y - wanted.y) < 1e-12,
      `slot ${slot}: y ${crop.place.y} au lieu de ${wanted.y}`,
    );
    assert.ok(
      Math.abs(crop.place.rotation - wanted.rotation) < 1e-12,
      `slot ${slot}: rotation ${crop.place.rotation} au lieu de ${wanted.rotation}`,
    );
    // Le sertissage est bien un sertissage : `|x|` ne dépasse jamais sa place d'origine.
    assert.ok(Math.abs(crop.place.x) <= Math.abs(places[slot].x) + 1e-12);
  }

  // Les cinq places sont distinctes : un composeur qui poserait toutes les cultures au milieu du pot les
  // aurait toutes à `{x: 0, y: .05}` avec pour seule différence l'éventail — c'est exactement ce que ce
  // test refuse.
  const points = new Set([...crops.values()].map((crop) => `${crop.place.x},${crop.place.y}`));
  assert.equal(points.size, 5, "cinq places distinctes dans le pot");
  assert.equal(crops.get(2).place.x, places[2].x * POT_ICON.across);
});

test("une culture en pot qui ne déclare aucun point tombe au milieu, pas dans la dispersion d'une patch", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // C'est la branche `else` du jeu : un slot dont le `x` est absent est lu `{0, 0, 0}`, puis sertit comme
  // les autres. La dispersion (`sceneScatter.js`) est celle d'une **tuile**, et l'API ne doit pas s'en
  // servir ici : une patch répand ses brins, un pot ne les répand pas.
  const response = await layoutOf(api, potted({ crops: [{ slot: 0, size: 50 }, { slot: 1, size: 50 }] }));
  assert.equal(response.status, 200);
  const crops = bySlot(await response.json());
  assert.deepEqual(
    crops.get(0).place,
    { x: 0, y: POT_ICON.drop, rotation: 0 - POT_ICON.fan },
    "le premier slot d'un amas non placé : le milieu, éventaillé par son index",
  );
  assert.equal(crops.get(0).place.y, POT_ICON.drop);
  assert.equal(crops.get(1).place.x, 0);
});

test("une plante à récolte multiple place par son slot et ignore la place déclarée", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Le figuier de Barbarie est une récolte `Multiple` dont le corps **et** la culture sont dans l'atlas
  // hors ligne (FavaBean, lui, dessine son corps en `SproutFlower`, absent de la fixture) : cinq
  // `slotOffsets`, aucun `plantTransform`, donc sa place est celle du blueprint et rien d'autre. Le champ
  // `at` est lu — il n'est pas une faute — et il ne change rien : les deux dispositions sont identiques.
  const slots = [0, 3];
  const startTime = 1_700_000_000_000;
  const bare = potted({
    species: "PricklyPear",
    crops: slots.map((slot) => ({ slot, size: 80, startTime })),
  });
  const placed = potted({
    species: "PricklyPear",
    crops: slots.map((slot) => ({ slot, size: 80, startTime, at: { x: 0.3, y: -0.2, rotation: 40 } })),
  });

  const [first, second] = await Promise.all([layoutOf(api, bare), layoutOf(api, placed)]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const one = await first.json();
  const two = await second.json();
  assert.deepEqual(
    two.items[0].crops.map((crop) => crop.place),
    one.items[0].crops.map((crop) => crop.place),
  );
  // Et la place est celle du blueprint — `slotOffsets[slot]`, pas la place déclarée sertie.
  assert.equal(PLANTS.PricklyPear.plant.harvestType, "Multiple");
  for (const crop of one.items[0].crops) {
    const offset = PLANTS.PricklyPear.plant.slotOffsets[crop.slot];
    assert.ok(
      Math.abs(crop.place.x - offset.x) < 0.1,
      `slot ${crop.slot}: x ${crop.place.x} au lieu du slotOffset ${offset.x}`,
    );
    assert.ok(Math.abs(crop.place.rotation - offset.rotation) < 0.1);
  }
  assert.notEqual(one.items[0].crops[0].place.x, 0.3 * POT_ICON.across);
});

test("la fenêtre d'une culture en pot la dessine à la taille qu'elle a atteinte", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Une culture encore en croissance dans un pot est dessinée sur la même courbe que dans une tuile : la
  // montée du jeu, mélangée au cinquième d'une récolte `Single`. À `remainingMs` 800 d'une fenêtre de
  // 1000, le moment est 200, donc `ti = .2`, la montée `.2 x .7 = .14` et le mélange `.2 + .8 x .14 = .312`.
  const ramp = 0.2 * 0.7;
  const grown = 0.2 + 0.8 * ramp;
  const size = 100;
  const response = await layoutOf(
    api,
    potted({
      crops: [{ slot: 0, size, at: { x: 0.1, y: 0.1, rotation: 0 }, startTime: 0, endTime: 1000, remainingMs: 800 }],
    }),
  );
  assert.equal(response.status, 200);
  const growing = bySlot(await response.json()).get(0);
  assert.ok(
    Math.abs(growing.scale - curve(size, "Emberbloom") * grown) < 1e-9,
    `${growing.scale} au lieu de ${curve(size, "Emberbloom") * grown}`,
  );

  // La même culture sans fenêtre est mûre — c'est ce que faisait toute spec d'inventaire avant que la
  // fenêtre soit envoyée, et c'est la taille que ce test refuse de voir dans le premier cas.
  const ripe = await layoutOf(api, potted({ crops: [{ slot: 0, size, ready: true, at: { x: 0.1, y: 0.1, rotation: 0 } }] }));
  const ripeCrop = bySlot(await ripe.json()).get(0);
  assert.equal(ripeCrop.scale, curve(size, "Emberbloom"));
  assert.ok(growing.scale < ripeCrop.scale, "une culture en croissance est plus petite qu'une mûre");
});

test("deux cultures en pot à deux places différentes font une image plus large qu'au milieu", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // La disposition se donne raison à elle-même : c'est l'**image** qui dit que les places arrivent
  // jusqu'aux pixels. Deux places opposées écartent les deux cultures, donc l'union que l'image recadre
  // est plus large que si les deux étaient au milieu du pot.
  const places = [
    { x: -0.2, y: 0, rotation: 0 },
    { x: 0.2, y: 0, rotation: 0 },
  ];
  const spread = await layoutOf(api, potted({ crops: places.map((at, slot) => ({ slot, size: 50, at })) }));
  const heaped = await layoutOf(api, potted({ crops: [0, 1].map((slot) => ({ slot, size: 50 })) }));
  const [wide, narrow] = [await spread.json(), await heaped.json()];
  assert.ok(
    wide.canvas.width > narrow.canvas.width,
    `l'image placée fait ${wide.canvas.width} px, celle au milieu ${narrow.canvas.width} px`,
  );

  // Et les pixels eux-mêmes : les deux specs composent deux images différentes, jamais la même clé.
  const one = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(potted({ crops: places.map((at, slot) => ({ slot, size: 50, at })) })),
  });
  const two = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(potted({ crops: [0, 1].map((slot) => ({ slot, size: 50 })) })),
  });
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.notEqual(one.headers.get("x-mg-compose-key"), two.headers.get("x-mg-compose-key"));
});

test.after(() => {
  restoreFetch();
});
