// tests/data-version.test.js
//
// `GET /data/version` — le chemin que mg.js demande déjà et auquel l'hôte
// amont répond 404. Il doit dire ce que cet hôte sert réellement : la version
// enregistrée sur disque quand la synchro a construit les données et les
// sprites, pas une version re-fetchée à chaque appel.
//
// Hors ligne et rapide : l'app est montée sur un port éphémère sans service de
// fond, CORS et rate limiting coupés, logs muets.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";

import test from "node:test";
import assert from "node:assert/strict";
import { startTestApp } from "./helpers/httpApp.js";

test("/data/version rapporte la version dont les données ont été construites", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const res = await api.get("/data/version");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  assert.match(res.headers.get("cache-control") ?? "", /max-age=\d+/);

  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), [
    "artVersion",
    "contract",
    "gameVersion",
    "generatedAt",
  ]);

  // La vérité de l'instance, pas une constante recopiée : sans bundle en cache
  // ni `data/version.json` (clone frais), les trois champs valent null ; avec
  // un bundle en cache, `gameVersion` est celle qu'il porte.
  const { getBuildInfo, CONTRACT_VERSION } = await import("../src/docs/contract.js");
  const build = await getBuildInfo();

  assert.equal(body.contract, CONTRACT_VERSION);
  assert.equal(body.contract, 1);
  assert.equal(body.gameVersion, build.gameVersion);
  assert.equal(body.artVersion, build.artVersion);
  assert.equal(body.generatedAt, build.generatedAt);

  if (body.generatedAt !== null) {
    assert.ok(
      Number.isFinite(Date.parse(body.generatedAt)),
      `generatedAt n'est pas une date : ${body.generatedAt}`
    );
  }
});

test("la version est lue dans l'URL versionnée du bundle, sans réseau", async () => {
  const { gameVersionFromAssetUrl } = await import("../src/core/game/cache.js");

  // URL réelle observée sur un process chaud (audit, 2026-09-16).
  assert.equal(
    gameVersionFromAssetUrl("https://magicgarden.gg/version/1192/assets/worldDepthSortKey-BXUHHrP0.js"),
    "1192"
  );
  assert.equal(gameVersionFromAssetUrl("https://magicgarden.gg/assets/main.js"), null);
  assert.equal(gameVersionFromAssetUrl(null), null);
});

test("/data/version et le contrat servi disent la même chose", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const version = await (await api.get("/data/version")).json();
  const schema = await (await api.get("/schema.json")).json();

  assert.equal(version.contract, schema.contract);
  assert.equal(version.gameVersion, schema.gameVersion);
  assert.equal(version.artVersion, schema.artVersion);
  assert.equal(version.generatedAt, schema.generatedAt);

  // Le document OpenAPI annonce la même route et la même catégorie.
  const doc = await (await api.get("/docs/openapi.json")).json();
  assert.ok(doc.paths["/data/version"], "/data/version n'est pas documenté");
  assert.ok(doc["x-mg-contract"].data.includes("version"), "'version' absent de x-mg-contract.data");
});
