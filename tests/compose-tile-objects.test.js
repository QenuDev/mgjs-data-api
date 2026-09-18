// tests/compose-tile-objects.test.js
//
// Les trois objets de tuile qui ne sont ni une plante ni une culture : un œuf, un cristal et une
// décoration. Chacun est **une seule art** dans un cadre, dessinée à l'échelle qu'une règle du jeu
// calcule, et les trois règles sont citées ici une fois pour toutes (bundle 1192) :
//
//     // installWorldSystems-2I5vu80Q.js, `Yo` (le visuel de l'œuf)
//     var Jo=.3, Yo=class{ ... applyGrowthScale(e){ this.sprite.scale.set(e/this.sprite.texture.sourcePixelRatio) }
//       updateGrowth(e,t){ ... this.growthScale=Jo+(1-Jo)*at(this.plantedAt,this.maturedAt,e) ... } }
//     // quinoaAssetResolver-CVtuXws2.js : `at` = `Yr`
//     function Yr(e,t,n){ return n>=t ? 1 : e<t ? ti(e,t,n)*.7 : 0 }
//
//     // topHudAtoms-DndCWqIj.js, `$o` (le cristal chargé)
//     var Jo=.85, Yo=.3, Xo=2
//     function Zo(e){ let t=Math.max(0,e)/mn; return Math.min(Xo, Yo+(1-Yo)*t) }
//     function Qo(e){ return Jo*Zo(e) }        // mn = 14400 s = un éclat
//
//     // resources-D_3Zwcn-.js, `_n` (le décalage d'une décoration suspendue)
//     var gn=new Set([`ColoredStringLights`,`StringLights`,`WindchimeMoon`,`WindchimeStar`,`PaperLantern`,`FanousLantern`])
//     function _n(e,t){ if(!gn.has(e))return{x:0,y:0} ... }
//
// Ce que le fichier épingle : les trois échelles, l'ancre du cadre posée sur le milieu de la tuile, le
// décalage de profondeur d'une suspension, et le refus nommé d'une décoration dont l'art n'est pas
// publiée sous son propre identifiant.
//
// Hors ligne : `installOfflineGame()` sert l'atlas et le bundle capturés, qui portent les trois arts.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.COMPOSE_CACHE_DIR = new URL("./fixtures/compose-cache-tile-objects/", import.meta.url).pathname;
process.env.COMPOSE_CACHE_MAX = "8";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { installOfflineGame, plantFixture } from "./helpers/offlineGame.js";
import { LIVE_ASSETS } from "./helpers/live-assets.js";
import { startTestApp } from "./helpers/httpApp.js";

/**
 * Ce que l'atlas hors ligne ne porte pas.
 *
 * La fixture de sprites ne contient que des plantes et des mutations (89 cadres), et les trois arts de
 * ce fichier — un œuf, un cristal, une décoration — n'y sont pas. Les épreuves qui composent vraiment
 * se sautent donc **en le disant**, et `MG_LIVE_ASSETS=1 npm run test:live` les exécute : dans ce mode
 * l'atlas est celui que le jeu sert. Les trois règles, elles, sont épinglées hors ligne en unitaire,
 * juste en dessous.
 */
const NEEDS_LIVE_ATLAS =
  LIVE_ASSETS ? false : "needs the live atlas (the offline fixture holds plants and mutations only) - run `MG_LIVE_ASSETS=1 npm run test:live`";

const CACHE_DIR = new URL("./fixtures/compose-cache-tile-objects/", import.meta.url);

const restoreFetch = LIVE_ASSETS ? () => {} : await installOfflineGame({ version: 1192 });

const { gameDataService } = await import("../src/services/gameData.js");
gameDataService.getPlants = async () => plantFixture();

const { initSprites } = await import("../src/assets/sprites/sprites.js");
await initSprites();

const { crystalScale, decorOffset, eggScale } = await import("../src/assets/compose/tileObjects.js");
const { decorArtPath, drawnFrame } = await import("../src/assets/compose/artBridge.js");
const { SPEC_VERSION } = await import("../src/assets/compose/spec.js");
const { resetSceneCache } = await import("../src/assets/compose/sceneCache.js");
const { clearSceneCaches } = await import("../src/assets/compose/sceneService.js");

const T = 1_750_000_000_000;
const HOUR = 3_600_000;
/** Le milieu d'une tuile : `sceneLayout` place l'ancre de l'art sur ce point. */
const TILE_MIDDLE = 128;

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

test("l'œuf part de trois dixièmes de son art et vaut l'art entier à l'échéance", () => {
  // `Jo + (1 - Jo) x Yr(plantedAt, maturedAt, now)`, donc 0,3 x l'art au début de la fenêtre,
  // 0,3 + 0,7 x 0,7 x avancement pendant, et l'art entier une fois l'échéance passée.
  const window = (remainingMs) => ({ startTime: T, endTime: T + HOUR, remainingMs });
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} vs ${expected}`);
  close(eggScale(window(HOUR)), 0.3);
  close(eggScale(window(0.5 * HOUR)), 0.3 + 0.7 * 0.7 * 0.5);
  close(eggScale(window(0)), 1);
  // Un œuf dont l'échéance est passée est dessiné à son art entier, comme `Yr` le dit (`n >= t ? 1`).
  close(eggScale(window(-HOUR)), 1);
  // Une tuile qui ne déclare pas de fenêtre est dessinée à son art entier : on ne peut rien dire de
  // « quand », et la dessiner à rien serait pire.
  assert.equal(eggScale({}), 1);
  assert.equal(eggScale({ startTime: T }), 1);
  assert.equal(eggScale({ startTime: T, endTime: T + HOUR }), 1);
  assert.equal(eggScale({ startTime: T, endTime: T + HOUR, remainingMs: 0, ready: true }), 1);
});

test("le cristal vaut 0,85 fois son art par éclat, plafonné au double", () => {
  // `0.85 x min(2, 0.3 + 0.7 x secondes / 14400)`.
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} vs ${expected}`);
  close(crystalScale(0), 0.85 * 0.3);
  close(crystalScale(14_400), 0.85);
  close(crystalScale(14_400 * 2), 0.85 * (0.3 + 0.7 * 2));
  // Le plafond `Xo = 2` mord à partir de `14400 x 17/7` secondes.
  close(crystalScale((14_400 * 17) / 7), 0.85 * 2);
  close(crystalScale(1_000_000), 0.85 * 2);
  // Un cristal chargé négativement est tenu pour dépensé, et une tuile qui ne dit rien de sa charge est
  // dessinée à son art : rien d'autre n'est savoir.
  close(crystalScale(-5), 0.85 * 0.3);
  assert.equal(crystalScale(null), 1);
  assert.equal(crystalScale(undefined), 1);
});

test("le décalage d'une décoration ne dépend que de six identifiants et de son angle", () => {
  // Un nichoir, une niche : aucun décalage, quel que soit l'angle.
  assert.deepEqual(decorOffset("Birdhouse", 0), { x: 0, y: 0 });
  assert.deepEqual(decorOffset("PetHutch", 180), { x: 0, y: 0 });
  // Les six suspensions : une demi-tuile (128 px) sur un axe, et rien au-delà d'un quart.
  assert.deepEqual(decorOffset("PaperLantern", 0), { x: 0, y: -128 });
  assert.deepEqual(decorOffset("PaperLantern", 360), { x: 0, y: -128 });
  assert.deepEqual(decorOffset("PaperLantern", 180), { x: 0, y: 128 });
  assert.deepEqual(decorOffset("PaperLantern", 90), { x: 128, y: 0 });
  assert.deepEqual(decorOffset("PaperLantern", 270), { x: -128, y: 0 });
  assert.deepEqual(decorOffset("PaperLantern", 45), { x: 0, y: 0 });
});

test("le layout pose l'art de l'œuf, du cristal et de la décoration sur le milieu de la tuile", { skip: NEEDS_LIVE_ATLAS }, async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const half = { startTime: T, endTime: T + HOUR, remainingMs: 0.5 * HOUR };
  const response = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      { id: "a-egg", kind: "egg", eggId: "CommonEgg", at: { column: 0, row: 0 }, ...half },
      { id: "b-crystal", kind: "crystal", crystalType: "Hunger", remainingSeconds: 14_400, at: { column: 1, row: 0 } },
      { id: "c-decor", kind: "decor", decorId: "PetHutch", at: { column: 0, row: 1 } },
      { id: "d-lantern", kind: "decor", decorId: "PaperLantern", rotation: 180, at: { column: 1, row: 1 } },
    ],
  });
  assert.equal(response.status, 200);
  const layout = await response.json();
  const byId = Object.fromEntries(layout.items.map((item) => [item.id, item]));

  // L'œuf : l'art du cadre x l'échelle de la fenêtre, l'ancre posée sur le milieu de sa tuile. Les
  // boîtes du layout sont en pixels entiers (`toPicture` arrondit), donc la comparaison l'est aussi.
  const eggFrame = drawnFrame("sprite/pet/CommonEgg");
  const eggScaleValue = 0.3 + 0.7 * 0.7 * 0.5;
  assert.equal(byId["a-egg"].z, 3);
  assert.equal(byId["a-egg"].box.width, Math.round(eggFrame.box.width * eggScaleValue));
  assert.equal(byId["a-egg"].box.height, Math.round(eggFrame.box.height * eggScaleValue));
  // Le milieu de la colonne 0 est à 128, et l'ancre de l'art tombe dessus, donc le bord gauche est
  // `128 - anchorX x largeur` (`scene` est en coordonnées de scène, non arrondies à l'origine près).
  assert.ok(
    Math.abs(byId["a-egg"].scene.x - (TILE_MIDDLE - eggFrame.box.anchorX * eggFrame.box.width * eggScaleValue)) <= 0.5,
  );

  // Le cristal : 0,85 x son art pour un éclat.
  const crystalFrame = drawnFrame("sprite/item/HungerCrystal");
  assert.equal(byId["b-crystal"].box.width, Math.round(crystalFrame.box.width * 0.85));
  assert.equal(byId["b-crystal"].box.height, Math.round(crystalFrame.box.height * 0.85));

  // La décoration : l'art à sa taille, sans échelle, et l'ancre du cadre sur la tuile.
  const hutchFrame = drawnFrame("sprite/decor/PetHutch");
  assert.equal(byId["c-decor"].box.width, Math.round(hutchFrame.box.width));
  assert.equal(byId["c-decor"].box.height, Math.round(hutchFrame.box.height));
  assert.equal(byId["c-decor"].depthOffsetYPixels, 0);

  // La suspension tournée à 180 : dessinée 128 px plus bas, et sa clé de profondeur avec elle.
  const lanternFrame = drawnFrame("sprite/decor/PaperLantern");
  assert.equal(byId["d-lantern"].depthOffsetYPixels, 128);
  const middle = 1.5 * 256;
  assert.ok(
    Math.abs(
      byId["d-lantern"].scene.y - (middle + 128 - lanternFrame.box.anchorY * lanternFrame.box.height),
    ) <= 0.5,
  );
});

test("une décoration dont l'identifiant n'est pas la clé est lue sous sa graphie d'artboard", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // `StoneBirdbath` est l'une des huit décorations dont la définition nomme un autre artboard
  // (`StoneBirdBath`), et la table des noms de sprites range le PNG sous le nom de l'artboard : l'identifiant
  // est donc la mauvaise clé. Ce test attendait un refus avant que les deux tables ne soient mesurées ; c'est
  // la même réconciliation que `decorTransformer.js` fait pour `/data/decors` (« sans tenir compte de la
  // casse ») et que `/data/pets` fait par `artboardKey`.
  assert.equal(await decorArtPath("StoneBirdbath"), "sprite/decor/StoneBirdBath");
  // Un décor dont l'identifiant est déjà la clé n'est pas touché par cette lecture.
  assert.equal(await decorArtPath("PetHutch"), "sprite/decor/PetHutch");
  // L'atlas hors ligne ne porte aucune art de décor, donc ce qui se vérifie ici est la résolution du chemin ;
  // que l'art se dessine est vérifié en direct (`npm run test:live`).
  assert.equal(await decorArtPath(""), null);
  assert.equal(await decorArtPath("PasUnDecorDuTout"), null);
});

test("une décoration dont ni l'identifiant ni l'artboard ne résolvent est refusée par son nom", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const response = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [{ id: "ghost", kind: "decor", decorId: "NotADecorAtAll", at: { column: 0, row: 0 } }],
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error.message, /NotADecorAtAll/);
  assert.match(body.error.message, /no decor art/);
});

test("un œuf et un cristal dont l'art n'existe pas sont refusés, pas dessinés", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const egg = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [{ id: "nope", kind: "egg", eggId: "NotAnEgg", at: { column: 0, row: 0 } }],
  });
  assert.equal(egg.status, 400);
  assert.match((await egg.json()).error.message, /NotAnEgg/);

  const crystal = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [{ id: "nope", kind: "crystal", crystalType: "NotACrystal", at: { column: 0, row: 0 } }],
  });
  assert.equal(crystal.status, 400);
  assert.match((await crystal.json()).error.message, /NotACrystal/);
});

// La fixture hors ligne est restaurée à la fin : les autres fichiers de test partagent le processus
// quand la suite tourne avec `--test-concurrency=1`, et un `fetch` resté en place les ferait mentir.
test.after(() => {
  restoreFetch();
});
