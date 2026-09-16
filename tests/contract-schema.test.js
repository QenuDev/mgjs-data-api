// tests/contract-schema.test.js
//
// Le contrat public : `/schema.json` (ce qu'un client lit) et le document
// `/docs/openapi.json` doivent annoncer la même version de contrat, et la liste
// de chemins du contrat doit correspondre à ce qui est réellement monté.
//
// Hors ligne et rapide : CORS est coupé parce que sa réponse au preflight avale
// les OPTIONS — or OPTIONS est justement la sonde « ce chemin est-il monté ? »
// (Express répond 200 + Allow pour un chemin servi par un routeur monté, 404
// sinon) sans exécuter le handler. Le rate limiting est coupé parce que la sonde
// fait une requête par chemin, et les logs sont muets.
// `/docs/openapi.json` ne déclenche plus d'extraction de bundle à froid (voir
// historyQueries.getShopTypes).

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";

import test from "node:test";
import assert from "node:assert/strict";
import { startTestApp } from "./helpers/httpApp.js";
import { captureMountedPaths } from "./helpers/routeCensus.js";

/** Un chemin documenté comme `/assets/sprites/{category}/{name}` devient concret. */
const concrete = (path) => path.replace(/\{[^}]+\}/g, "x");

/**
 * Ce que l'app monte vraiment, recensé une fois pour tout le fichier.
 *
 * Au niveau du module et pas dans un `test()` : les modules de routes
 * enregistrent leurs chemins à l'import, donc l'instrumentation de
 * `helpers/routeCensus.js` doit être en place avant que le `startTestApp()` du
 * premier test n'importe `src/api/server.js`.
 */
const mountedPaths = await captureMountedPaths();

/**
 * Les routes posées directement sur l'app (`/`, `/data.csv`, `/live.tsv`…),
 * avec les verbes qu'elles déclarent.
 *
 * Express 5 ne répond la liste `Allow` automatique (200) que pour un chemin
 * servi par un routeur monté : une route posée sur l'app répond 404 à OPTIONS
 * comme un chemin inconnu. On lit donc ce petit ensemble dans la table des
 * routes, et on vérifie tout le reste par OPTIONS — sans exécuter un seul
 * handler. Dans les deux cas c'est le verbe `GET` qui est vérifié, parce que
 * c'est celui qu'un client utilisera.
 */
function appLevelRoutes(expressApp) {
  const routes = new Map();
  for (const layer of expressApp.router.stack) {
    if (!layer.route) continue;
    routes.set(
      layer.route.path,
      new Set(Object.keys(layer.route.methods).map((method) => method.toLowerCase()))
    );
  }
  return routes;
}

/** Capacité déclarée -> chemin qui la porte, pour que le contrat ne réclame rien d'absent. */
const CAPABILITY_PATHS = {
  data: "/data",
  sprites: "/assets/sprites",
  "sprites.composed": "/assets/sprites/composed",
  "sprites.data": "/assets/sprite-data",
  "live.weather": "/live/weather",
  "live.shops": "/live/shops",
  animations: "/assets/animations",
  rive: "/assets/rive",
};

test("/schema.json et /docs/openapi.json annoncent le même contrat", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const res = await api.get("/schema.json");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  assert.match(res.headers.get("cache-control") ?? "", /max-age=\d+/);
  const schema = await res.json();

  const doc = await (await api.get("/docs/openapi.json")).json();

  assert.equal(schema.contract, Number(doc.info.version));
  assert.equal(schema.api, doc["x-mg-contract"].api);
  assert.deepEqual(schema.capabilities, doc["x-mg-contract"].capabilities);
  assert.deepEqual(schema.paths, Object.keys(doc.paths));

  // Les faits de l'instance sont les mêmes des deux côtés.
  assert.equal(schema.gameVersion, doc["x-mg-contract"].gameVersion);
  assert.equal(schema.artVersion, doc["x-mg-contract"].artVersion);
  assert.equal(schema.generatedAt, doc["x-mg-contract"].generatedAt);
});

test("chaque chemin du contrat est réellement monté", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const schema = await (await api.get("/schema.json")).json();
  assert.ok(schema.paths.length > 0, "le contrat ne liste aucun chemin");

  const direct = appLevelRoutes(api.app);

  // Contrôle négatif : la sonde distingue un chemin monté d'un chemin inconnu.
  const missing = await api.get("/not-a-route", { method: "OPTIONS" });
  assert.equal(missing.status, 404);
  assert.ok(!direct.has("/not-a-route"));

  for (const path of schema.paths) {
    const verbs = direct.get(path);
    if (verbs) {
      assert.ok(verbs.has("get"), `${path} est monté, mais pas en GET`);
      continue;
    }

    const res = await api.get(concrete(path), { method: "OPTIONS" });
    assert.equal(res.status, 200, `${path} est déclaré mais pas monté`);
    assert.match(res.headers.get("allow") ?? "", /GET/, `${path} n'accepte pas GET`);
  }
});

test("aucun chemin monté n'est absent du document", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const doc = await (await api.get("/docs/openapi.json")).json();
  const documented = new Set(Object.keys(doc.paths));

  // Le sens inverse du test précédent : lui vérifie que le document ne promet
  // rien que le serveur ne monte pas, celui-ci qu'il ne tait rien de ce que le
  // serveur monte. Un document qui tait un chemin n'est pas faux, il est
  // incomplet — et un client qui génère son code depuis lui ne verra jamais la
  // route. Les deux listes sont dans la même forme (`:date` du routeur devient
  // `{date}`, comme dans le document), donc comparables telles quelles.
  const missing = mountedPaths.filter((path) => !documented.has(path));
  assert.deepEqual(
    missing,
    [],
    `chemins montés mais absents du document :\n${missing.join("\n")}`
  );
});

test("le contrat ne réclame que des capacités que le serveur a", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const schema = await (await api.get("/schema.json")).json();

  // Le composeur de scènes (POST /compose, item 20 du plan) n'existe pas
  // encore : le contrat ne doit pas l'annoncer. À retirer quand il arrivera.
  assert.ok(!schema.capabilities.includes("compose"), "compose n'est pas implémenté");

  for (const capability of schema.capabilities) {
    const path = CAPABILITY_PATHS[capability];
    assert.ok(path, `capacité déclarée sans chemin connu : ${capability}`);
    assert.ok(schema.paths.includes(path), `${capability} : ${path} absent du contrat`);
    assert.equal(
      (await api.get(path, { method: "OPTIONS" })).status,
      200,
      `${capability} : ${path} n'est pas monté`
    );
  }
});

test("chaque catégorie de données du contrat est documentée et montée", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const schema = await (await api.get("/schema.json")).json();
  const doc = await (await api.get("/docs/openapi.json")).json();

  for (const category of doc["x-mg-contract"].data) {
    const path = `/data/${category}`;
    assert.ok(doc.paths[path], `${path} n'est pas documenté`);
    assert.ok(schema.paths.includes(path), `${path} est absent de /schema.json`);
    assert.equal(
      (await api.get(path, { method: "OPTIONS" })).status,
      200,
      `${path} est annoncé mais pas monté`
    );
  }
});
