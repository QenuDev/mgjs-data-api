// tests/cors-exposed-headers.test.js
//
// Un `fetch()` cross-origin ne laisse lire au client que les en-têtes
// « safelisted » (Content-Type, Cache-Control, Expires, Last-Modified, Pragma).
// Tout en-tête applicatif doit donc être publié par
// `Access-Control-Expose-Headers` : sans cette liste, le navigateur reçoit la
// réponse mais pas l'information.
//
// C'est exactement le cas des deux en-têtes que ce dépôt vient d'ajouter :
// `X-Game-Version`, qui dit quelle version du jeu la réponse décrit, et `ETag`,
// dont dépendent les `304` de `/data`. Sans exposition, le travail des commits
// précédents est invisible depuis un navigateur.
//
// CORS est **activé** ici, contrairement aux autres tests de routes : c'est le
// middleware testé. L'app est montée hors ligne sur un port éphémère, sans
// service de fond, rate limiting coupé, logs muets.

process.env.LOG_LEVEL = "silent";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.CORS_ENABLED = "true";

import test from "node:test";
import assert from "node:assert/strict";

const { startTestApp } = await import("./helpers/httpApp.js");
const { GAME_VERSION_HEADER } = await import("../src/api/routes/data.js");

const ORIGIN = "https://garden.example";

/** Une liste d'en-têtes HTTP : séparée par des virgules, espaces tolérés. */
const headerList = (value) =>
  (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

const exposed = (res) => headerList(res.headers.get("access-control-expose-headers"));

test("une réponse /data cross-origin publie X-Game-Version et ETag", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const res = await api.get("/data/plants", { headers: { origin: ORIGIN } });

  assert.equal(res.headers.get("access-control-allow-origin"), "*");

  const names = exposed(res);
  assert.ok(
    names.includes(GAME_VERSION_HEADER),
    `${GAME_VERSION_HEADER} absent de Access-Control-Expose-Headers : ${names}`
  );
  assert.ok(names.includes("ETag"), `ETag absent de Access-Control-Expose-Headers : ${names}`);
});

test("l'exposition vient du middleware, pas de la route", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  // `/health` ne pose aucun en-tête de version : si la liste y est aussi, c'est
  // bien le middleware qui la pose, et elle vaut pour toute l'API.
  const res = await api.get("/health", { headers: { origin: ORIGIN } });

  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.ok(exposed(res).includes(GAME_VERSION_HEADER));
});

test("le préflight publie la même liste sans élargir ce que le client peut envoyer", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const res = await api.get("/data/plants", {
    method: "OPTIONS",
    headers: { origin: ORIGIN, "access-control-request-method": "GET" },
  });

  assert.equal(res.status, 204);

  const names = exposed(res);
  assert.ok(names.includes(GAME_VERSION_HEADER), `préflight : ${names}`);
  assert.ok(names.includes("ETag"), `préflight : ${names}`);

  // Publier n'est pas autoriser : la liste des en-têtes de requête est celle
  // d'avant, `Content-Type` et `Accept`.
  assert.deepEqual(headerList(res.headers.get("access-control-allow-headers")).sort(), [
    "Accept",
    "Content-Type",
  ]);
});
