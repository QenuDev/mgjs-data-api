// tests/proxy-own-origin.test.js
//
// Ce que `/assets/proxy` accepte de relayer.
//
// Le défaut : la liste blanche nommait `mg-api.ariedam.fr`, le déploiement
// d'origine, et pas *cette* instance. Le commentaire au-dessus de la liste dit
// depuis toujours que nos propres sprites « needed adding here too » — ils ne
// l'ont jamais été, parce que le motif nommait un hôte que nous n'exploitons pas.
// Conséquence : un fork auto-hébergé ne pouvait pas relayer ses propres fichiers
// vers un navigateur, alors que c'est le seul chemin pixel qui existe pour un
// navigateur (le jeu n'envoie pas d'en-tête CORS, et nginx sert nos sprites sans
// CORS non plus — d'où le proxy).
//
// Un proxy ouvert serait pire que le défaut, donc la liste reste courte et
// calculée par requête : le jeu, l'URL publique configurée de l'instance, son
// `SPRITES_BASE_URL` si elle en a un, et l'origine que la requête a atteinte.
// Les deux premiers cas sont le même code que le troisième avec une autre entrée
// — c'est celui-ci qui est testé ici, parce qu'il ne demande aucune configuration.

import assert from "node:assert/strict";
import test from "node:test";

import express from "express";
import { createProxyHandler } from "../src/api/routes/assets.js";

/** L'app minimale qui porte le proxy, avec un `fetch` injecté et une origine connue. */
async function startProxyApp(fetchImpl) {
  const app = express();
  const router = express.Router();
  router.get("/proxy", (req, res, next) => {
    Promise.resolve(createProxyHandler({ fetchImpl })(req, res, next)).catch(next);
  });
  app.use("/assets", router);
  app.use((err, _req, res, _next) => {
    res.status(err.status ?? 500).json({ error: { code: err.code ?? "INTERNAL_ERROR", message: err.message } });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Un `fetch` qui répond une image et retient ce qu'on lui a demandé. */
function recordingFetch() {
  const asked = [];
  const impl = async (url) => {
    asked.push(String(url));
    return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  return { asked, impl };
}

test("le proxy relaie les sprites de l'instance que la requête a atteinte", async (t) => {
  const recorder = recordingFetch();
  const app = await startProxyApp(recorder.impl);
  t.after(() => app.close());

  const own = `${app.base}/assets/sprites/plants/Carrot.png`;
  const res = await fetch(`${app.base}/assets/proxy?url=${encodeURIComponent(own)}`);

  assert.equal(res.status, 200, `notre propre sprite doit passer : ${own}`);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.deepEqual(recorder.asked, [own], "et c'est bien cette URL qui a été demandée à l'amont");
});

test("le proxy relaie toujours le jeu, et refuse toujours un hôte quelconque", async (t) => {
  const recorder = recordingFetch();
  const app = await startProxyApp(recorder.impl);
  t.after(() => app.close());

  const game = await fetch(
    `${app.base}/assets/proxy?url=${encodeURIComponent("https://magicgarden.gg/assets/sprites/x.png")}`
  );
  assert.equal(game.status, 200, "le jeu est l'amont légitime et ne dépend d'aucun réglage");

  const elsewhere = await fetch(
    `${app.base}/assets/proxy?url=${encodeURIComponent("https://example.invalid/assets/sprites/x.png")}`
  );
  assert.equal(elsewhere.status, 400, "un hôte tiers reste refusé : ce n'est pas un proxy ouvert");
});

test("le déploiement d'origine n'est plus relayé, parce qu'il n'est pas le nôtre", async (t) => {
  const recorder = recordingFetch();
  const app = await startProxyApp(recorder.impl);
  t.after(() => app.close());

  const upstream = await fetch(
    `${app.base}/assets/proxy?url=${encodeURIComponent(
      "https://mg-api.ariedam.fr/assets/sprites/plants/Carrot.png"
    )}`
  );

  assert.equal(upstream.status, 400, "cet hôte n'est pas cette instance et n'a pas à être relayé");
  assert.deepEqual(recorder.asked, [], "et rien ne doit être demandé en amont");
});
