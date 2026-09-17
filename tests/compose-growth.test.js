// tests/compose-growth.test.js
//
// Ce qu'une culture encore en train de pousser vaut comme échelle : la fenêtre que la spec déclare
// (`startTime` → `endTime`) et le moment où elle en est (`remainingMs`), à travers la courbe du jeu.
//
// La courbe est celle du bundle, citée ici une fois pour toutes
// (`quinoaAssetResolver-CVtuXws2.js`, bundle 1192) :
//
//     Jr = 1e3;
//     function ti(e, t, n){ return e > t ? 1 : Math.min(Math.max((n - e) / (t - e), 0), 1) }
//     function Yr(e, t, n){ return n >= t ? 1 : e < t ? ti(e, t, n) * .7 : 0 }
//
// et le multiplicateur par type de récolte est la ligne du jeu lui aussi :
//
//     scaleForGrowthProgress(e){ return (harvestType === D.Single ? oi + (1 - oi) * e : e) * restingScale }
//
// avec `oi = .2`. Ce que le fichier épingle est donc : 0,7 de la montée à la fin de la fenêtre, 1 quand
// elle est finie, et le mélange « pousse » à un cinquième pour une récolte unique.
//
// Hors ligne : `installOfflineGame()` sert l'atlas et le bundle capturés.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.COMPOSE_CACHE_DIR = new URL("./fixtures/compose-cache-growth/", import.meta.url).pathname;
process.env.COMPOSE_CACHE_MAX = "8";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { installOfflineGame, plantFixture } from "./helpers/offlineGame.js";
import { startTestApp } from "./helpers/httpApp.js";

const CACHE_DIR = new URL("./fixtures/compose-cache-growth/", import.meta.url);

const restoreFetch = await installOfflineGame({ version: 1192 });

const { gameDataService } = await import("../src/services/gameData.js");
const PLANTS = await plantFixture();
gameDataService.getPlants = async () => PLANTS;

const { initSprites } = await import("../src/assets/sprites/sprites.js");
await initSprites();

const { GROWN_BY_MATURITY, SPROUT, growthOf, throughWindow } = await import("../src/assets/compose/growth.js");
const { SPEC_VERSION } = await import("../src/assets/compose/spec.js");
const { resetSceneCache } = await import("../src/assets/compose/sceneCache.js");
const { clearSceneCaches } = await import("../src/assets/compose/sceneService.js");

const T = 1_750_000_000_000;
const HOUR = 3_600_000;

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

test("la montée du jeu s'arrête à 0,7 de la fenêtre et vaut 1 quand elle est finie", () => {
  // `Yr` : `n >= t ? 1 : ti(e, t, n) * .7`.
  assert.equal(GROWN_BY_MATURITY, 0.7);
  assert.equal(throughWindow(T, T + HOUR, T), 0);
  assert.equal(throughWindow(T, T + HOUR, T + HOUR / 2), 0.5);
  assert.equal(throughWindow(T, T + HOUR, T + HOUR), 1);
  // Un moment hors de la fenêtre est ramené à ses bornes (`ti` clamps).
  assert.equal(throughWindow(T, T + HOUR, T - HOUR), 0);
  assert.equal(throughWindow(T, T + HOUR, T + 2 * HOUR), 1);
  // Une fenêtre qui n'en est pas une est tenue pour finie, donc l'art est à sa taille entière.
  assert.equal(throughWindow(T, T, T), 1);
  assert.equal(throughWindow(T + HOUR, T, T), 1);
});

test("la croissance d'une récolte multiple est la montée, celle d'une récolte unique part d'un cinquième", () => {
  const window = (remainingMs) => ({ startTime: T, endTime: T + HOUR, remainingMs });
  // Multiple : 0 au début, 0,7 x l'avancement, 1 à la fin. Les valeurs sont écrites comme les produits
  // du jeu plutôt que comme des décimales, parce que 0,7 x 0,4 n'est pas 0,28 en binaire.
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} vs ${expected}`);
  assert.equal(growthOf(window(HOUR), "Multiple"), 0);
  close(growthOf(window(0.6 * HOUR), "Multiple"), 0.7 * 0.4);
  close(growthOf(window(0.1 * HOUR), "Multiple"), 0.7 * 0.9);
  assert.equal(growthOf(window(0), "Multiple"), 1);
  // Single : `oi + (1 - oi) x` la même montée, donc 0,2 au début.
  assert.equal(SPROUT, 0.2);
  close(growthOf(window(HOUR), "Single"), 0.2);
  close(growthOf(window(0.6 * HOUR), "Single"), 0.2 + 0.8 * 0.7 * 0.4);
  close(growthOf(window(0.1 * HOUR), "Single"), 0.2 + 0.8 * 0.7 * 0.9);
  assert.equal(growthOf(window(0), "Single"), 1);
  // Un moment au-delà de la fenêtre est un moment fini, pas une montée négative.
  assert.equal(growthOf(window(-HOUR), "Multiple"), 1);
  assert.equal(growthOf(window(-HOUR), "Single"), 1);
});

test("une culture qui ne déclare pas son moment est dessinée mûre", () => {
  // C'est ce que faisaient toutes les specs avant que la croissance existe, et c'est ce que fait une
  // spec qui déclare une fenêtre sans dire où elle en est : on ne peut rien dire de « quand », et la
  // dessiner à rien serait pire.
  assert.equal(growthOf({}, "Multiple"), 1);
  assert.equal(growthOf({ startTime: T }, "Multiple"), 1);
  assert.equal(growthOf({ startTime: T, endTime: T + HOUR }, "Multiple"), 1);
  assert.equal(growthOf({ endTime: T + HOUR, remainingMs: HOUR }, "Multiple"), 1);
  // `ready` est le drapeau de la ligne elle-même et l'emporte sur l'arithmétique.
  assert.equal(growthOf({ startTime: T, endTime: T + HOUR, remainingMs: HOUR, ready: true }, "Multiple"), 1);
  assert.equal(growthOf({ startTime: T, endTime: T + HOUR, remainingMs: HOUR, ready: true }, "Single"), 1);
});

test("le layout dessine une culture en croissance à l'échelle de sa fenêtre", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Le figuier de barbarie est une récolte `Multiple` complet dans l'atlas hors ligne : sa courbe est
  // `1 + (size - 50)/50 x (mult - 1)` fois la montée, donc à taille 100 et 40 % de la fenêtre,
  // `2.5 x 0.28`.
  const multiplier = PLANTS.PricklyPear.crop.maxSizeMultiplier;
  assert.equal(PLANTS.PricklyPear.plant.harvestType, "Multiple");
  const response = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      {
        id: "prickly",
        kind: "plant",
        species: "PricklyPear",
        at: { column: 0, row: 0 },
        crops: [{ slot: 0, size: 100, startTime: T, endTime: T + HOUR, remainingMs: 0.6 * HOUR }],
      },
    ],
  });
  assert.equal(response.status, 200);
  const layout = await response.json();
  const crop = layout.items[0].crops[0];
  assert.ok(Math.abs(crop.scale - multiplier * 0.28) < 1e-9, `${crop.scale} vs ${multiplier * 0.28}`);

  // Et la même culture sans moment est mûre : la taille entière.
  const ripe = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      {
        id: "prickly",
        kind: "plant",
        species: "PricklyPear",
        at: { column: 0, row: 0 },
        crops: [{ slot: 0, size: 100 }],
      },
    ],
  });
  const ripeCrop = (await ripe.json()).items[0].crops[0];
  assert.ok(Math.abs(ripeCrop.scale - multiplier) < 1e-9);

  // Le trèfle est une récolte `Single` : ses brins portent le mélange « pousse », donc 0,2 au début.
  const clover = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      {
        id: "clover",
        kind: "patch",
        species: "Clover",
        at: { column: 0, row: 0 },
        crops: [{ size: 100, at: { x: 0, y: 0, rotation: 0 }, startTime: T, endTime: T + HOUR, remainingMs: HOUR }],
      },
    ],
  });
  assert.equal(clover.status, 200);
  const sprig = (await clover.json()).items[0].crops[0];
  assert.ok(Math.abs(sprig.scale - PLANTS.Clover.crop.maxSizeMultiplier * SPROUT) < 1e-9);
});
