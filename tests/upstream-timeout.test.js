// tests/upstream-timeout.test.js
//
// Un amont qui accepte la connexion et n'écrit jamais est le pire cas pour un
// serveur qui met ses réponses en cache derrière une seule promesse : la
// requête du client ne finit pas, la promesse non plus, et chaque requête
// suivante attend la même. Ces tests mesurent le plafond, pas la latence d'un
// réseau réel : le serveur local ne répond jamais.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.GAME_ORIGIN = "http://127.0.0.1:1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { config } from "../src/config/index.js";
import { fetchText, resolveMainFromPage } from "../src/core/game/bundle/resolver.js";
import { createProxyHandler } from "../src/api/routes/assets.js";

// Le plafond est une propriété de `config`, pas une constante : on le descend
// pour que ces tests durent moins d'une seconde au lieu de vingt. Chaque
// fichier de test tourne dans son propre process, donc cet objet est à nous.
config.bundle.timeout = 300;
config.platform.timeout = 300;
config.game.pageUrl = "http://127.0.0.1:1/r/test";

/** Un serveur qui accepte la connexion et ne répond jamais. */
async function startHangingServer() {
  const sockets = new Set();
  const server = http.createServer(() => {
    // Volontairement aucune réponse : ni corps, ni fin.
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
}

test("fetchText abandonne un amont qui ne répond jamais, en nommant l'URL", async (t) => {
  const upstream = await startHangingServer();
  t.after(() => upstream.close());

  const url = `${upstream.base}/version/1/index.html`;
  const started = Date.now();

  await assert.rejects(
    () => fetchText(url),
    (err) => {
      assert.match(err.message, /timed out after 300 ms/);
      assert.ok(err.message.includes(url), "l'erreur doit nommer l'URL qui a échoué");
      return true;
    }
  );

  const elapsed = Date.now() - started;
  // Sans plafond, ce test ne rendrait jamais la main. 300 ms de plafond : une
  // marge large au-dessus attrape un `AbortSignal` qui ne serait pas branché.
  assert.ok(elapsed < 5_000, `abandon après ${elapsed} ms, plafond attendu ~300 ms`);
});

test("resolveMainFromPage rend la même erreur nommée pour la page du jeu", async (t) => {
  const upstream = await startHangingServer();
  t.after(() => upstream.close());

  await assert.rejects(
    () => resolveMainFromPage(`${upstream.base}/r/test`),
    /Bundle fetch failed \(timed out after 300 ms\)/
  );
});

/** L'app minimale qui porte le proxy, avec son fetch injecté. */
async function startProxyApp(fetchImpl) {
  const app = express();
  const router = express.Router();
  router.get("/proxy", asyncHandlerFor(createProxyHandler({ fetchImpl })));
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

// Le vrai `asyncHandler` vit dans les middlewares de l'app ; ici une copie
// minimale évite de monter tout `createApp()` (et son extraction de bundle)
// pour tester un handler.
function asyncHandlerFor(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

test("le proxy rend un 504 nommé quand l'amont ne répond jamais", async (t) => {
  // Le fetch injecté attend l'abandon du signal : c'est exactement ce que fait
  // `fetch` réel face à un pair qui n'écrit pas.
  const fetchImpl = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      });
    });

  const app = await startProxyApp(fetchImpl);
  t.after(() => app.close());

  const res = await fetch(`${app.base}/assets/proxy?url=https%3A%2F%2Fmagicgarden.gg%2Fassets%2Fx.png`);
  assert.equal(res.status, 504);

  const body = await res.json();
  assert.equal(body.error.code, "UPSTREAM_TIMEOUT");
  assert.match(body.error.message, /300 ms/);
  assert.match(body.error.message, /magicgarden\.gg/, "le message doit nommer l'amont");
});

test("le proxy sert toujours un amont qui répond", async (t) => {
  const fetchImpl = async () =>
    new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });

  const app = await startProxyApp(fetchImpl);
  t.after(() => app.close());

  const res = await fetch(`${app.base}/assets/proxy?url=https%3A%2F%2Fmagicgarden.gg%2Fassets%2Fx.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(Buffer.from(await res.arrayBuffer()).length, 4);
});
