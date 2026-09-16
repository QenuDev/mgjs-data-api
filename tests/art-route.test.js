// tests/art-route.test.js
//
// `GET /data/art` servi par l'app, sur un bundle local.
//
// Le bundle est un faux serveur qui sert le découpage de `tests/fixtures/art/`
// sous l'arborescence d'URL du jeu (`/version/<v>/assets/…`), donc la route
// exerce le vrai chemin : `resolveMainFromPage`, le parcours du graphe de
// chunks, la cible d'art, l'extraction, le cache, l'ETag et le bloc `_meta`.
// Rien ne sort de la boucle locale, et la version publiée est celle que les URL
// du bundle portent — pas une constante du test.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../src/config/index.js";
import { startTestApp } from "./helpers/httpApp.js";

// Le plafond d'un amont qui ne répond pas est une propriété de `config`, pas une
// constante : le descendre garde ce fichier sous la seconde au lieu de vingt.
config.bundle.timeout = 2000;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, "fixtures", "art", "bundle-1176");

/** La version que ce faux bundle porte, et celle que l'endpoint de version annonce. */
const VERSION = "1176";
const INDEX_FILE = "index-Cxu-pBRw.js";
/** Le nom du chunk de données, qui est aussi celui que la fixture copie. */
const DATA_FILE = "quinoaPredictionAtoms-ptrrFeF6.js";
const ART_FILE = "LayoutMotionController-CwhDlPns.js";

/**
 * Le faux amont : l'endpoint de version, la page, l'index et les deux chunks.
 *
 * Il ne répond que ce qu'un bundle réel répondrait à ces chemins, et il répond
 * 404 à tout le reste — un test qui laisserait passer une requête vers le vrai
 * `magicgarden.gg` ne serait pas hors ligne.
 */
async function startFakeGame({ omit = [] } = {}) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    const asset = (file) => fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8");

    if (pathname === "/platform/v1/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: VERSION }));
      return;
    }
    if (/\/version\/[^/]+\/index\.html$/.test(pathname)) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><body><script type="module" src="/version/${VERSION}/assets/${INDEX_FILE}"></script></body></html>`);
      return;
    }
    if (pathname.endsWith(`/${INDEX_FILE}`)) {
      // L'index du bundle : deux imports relatifs, comme le build du jeu les écrit.
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(`import "./${DATA_FILE}";\nimport "./${ART_FILE}";\n`);
      return;
    }
    if (pathname.endsWith(`/${DATA_FILE}`) || pathname.endsWith(`/${ART_FILE}`)) {
      const file = path.basename(pathname);
      if (omit.includes(file)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("gone");
        return;
      }
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(asset(file));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/**
 * Pointe le fork sur le faux amont.
 *
 * Deux origines comptent et une seule ne suffit pas : `fetchGameVersion` prend
 * `config.game.origin`, tandis que `fetchBundleFor` construit l'URL de la page
 * depuis la même valeur. Le changer après l'import de `config` est ce que fait
 * déjà `tests/upstream-timeout.test.js`.
 */
async function pointAtFakeGame(origin) {
  const { config } = await import("../src/config/index.js");
  const { invalidateAllCaches } = await import("../src/core/game/cache.js");
  const { clearTransformedDataCache } = await import("../src/api/routes/data.js");

  config.game.origin = origin;
  config.game.pageUrl = `${origin}/version/${VERSION}/index.html`;
  invalidateAllCaches();
  clearTransformedDataCache();
}

async function restoreRealGame() {
  const { config } = await import("../src/config/index.js");
  const { invalidateAllCaches } = await import("../src/core/game/cache.js");
  const { clearTransformedDataCache } = await import("../src/api/routes/data.js");

  invalidateAllCaches();
  clearTransformedDataCache();
  config.game.origin = process.env.GAME_ORIGIN ?? "https://magicgarden.gg";
  config.game.pageUrl = `${config.game.origin}/`;
}

test("/data/art publie les tables d'art lues dans le bundle, avec sa version", async (t) => {
  const game = await startFakeGame();
  await pointAtFakeGame(game.origin);

  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await game.close();
    await restoreRealGame();
  });

  // Un premier appel à froid : c'est lui qui télécharge et met en cache le
  // bundle. `getProvenance` est lu avant la construction du corps, donc sur ce
  // premier appel la version de l'instance n'est pas encore connue — c'est le
  // comportement de toutes les routes `/data/*`, et le corps porte malgré tout
  // la version dont il a été extrait, dans `source`.
  const cold = await api.get("/data/art");
  assert.equal(cold.status, 200);
  const coldBody = await cold.json();
  assert.equal(coldBody.source.gameVersion, VERSION);

  const res = await api.get("/data/art");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  assert.match(res.headers.get("cache-control") ?? "", /max-age=\d+/);
  assert.ok(res.headers.get("etag"), "pas d'ETag sur une réponse /data/*");

  const body = await res.json();

  // L'en-tête, le bloc `_meta` et la provenance du corps annoncent la même
  // version, et c'est celle des URL du bundle — celle dont les tables ont
  // réellement été lues.
  assert.equal(res.headers.get("x-game-version"), VERSION);
  assert.equal(body._meta.gameVersion, VERSION);
  assert.equal(body._meta.contract, 1);
  assert.equal(body.source.gameVersion, VERSION);

  // La charge utile : les tables que l'item nomme, et rien d'inventé.
  for (const key of [
    "anchors",
    "displayFlags",
    "mutationArt",
    "mutationRecords",
    "overMutations",
    "scale",
    "zOrder",
    "plants",
    "harvestTypes",
    "spriteNames",
    "placement",
    "evidence",
    "source",
  ]) {
    assert.ok(Object.hasOwn(body, key), `${key} manque au corps de /data/art`);
  }

  assert.ok(Object.keys(body.displayFlags).length > 0, "aucun drapeau d'affichage publié");
  assert.ok(Object.keys(body.anchors).length > 0, "aucune ancre publiée");
  assert.ok(Object.keys(body.mutationArt).length > 0, "aucune mutation publiée");
  assert.ok(body.placement.source.includes("scaleFactor"), "le texte de la fonction n'est pas publié");
  assert.ok(
    body.source.chunks.some((chunk) => chunk.file === ART_FILE),
    "le chunk d'art n'est pas dans la provenance : la cible d'art n'a pas été résolue"
  );

  // L'échec doit être nommé, pas silencieux : la preuve porte le prédicat et le
  // chunk de chaque table.
  for (const [table, proof] of Object.entries(body.evidence)) {
    assert.ok(proof.predicate, `${table}: la preuve ne nomme pas son prédicat`);
    assert.ok(proof.chunk, `${table}: la preuve ne nomme pas son chunk`);
  }
});

test("la réponse est revalidable : un If-None-Match qui correspond rend un 304 versionné", async (t) => {
  const game = await startFakeGame();
  await pointAtFakeGame(game.origin);

  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await game.close();
    await restoreRealGame();
  });

  // Le premier appel amorce le bundle ; c'est le deuxième qui porte un ETag
  // calculé sur la version servie, donc celui qu'un client revalidera.
  await (await api.get("/data/art")).json();

  const first = await api.get("/data/art");
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  await first.json();

  const second = await api.get("/data/art", { headers: { "if-none-match": etag } });
  assert.equal(second.status, 304);
  assert.equal(
    second.headers.get("x-game-version"),
    VERSION,
    "un 304 doit encore dire de quelle version il parle"
  );
});

test("l'extraction refuse de publier quand le chunk d'art est introuvable", async (t) => {
  // Le même bundle, sans le chunk d'art : la cible d'art reste insatisfaite,
  // donc l'extraction n'a qu'un chunk de données à lire. Les ancres n'y sont
  // témoignées par rien, et c'est exactement le cas où publier serait inventer :
  // la route échoue au lieu de servir une table que rien ne confirme.
  const game = await startFakeGame({ omit: [ART_FILE] });
  await pointAtFakeGame(game.origin);

  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await game.close();
    await restoreRealGame();
  });

  const res = await api.get("/data/art");
  assert.equal(res.status, 500, `la route a répondu ${res.status} sans le chunk d'art`);
  const body = await res.json().catch(() => ({}));
  assert.match(
    body.error?.message ?? "",
    /^\[[a-z-]+\]/,
    "l'échec ne nomme pas le prédicat qui a refusé"
  );
  assert.match(body.error.message, /vu :/, "l'échec ne dit pas ce qu'il a vu");
});

test("/data/art est documenté, déclaré comme catégorie, et n'a pas d'export délimité", async (t) => {
  const game = await startFakeGame();
  await pointAtFakeGame(game.origin);

  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await game.close();
    await restoreRealGame();
  });

  const doc = await (await api.get("/docs/openapi.json")).json();
  assert.ok(doc.paths["/data/art"], "/data/art n'est pas documenté");
  assert.ok(
    doc["x-mg-contract"].data.includes("art"),
    "'art' absent de x-mg-contract.data, donc /schema.json ne l'annonce pas"
  );

  const schema = await (await api.get("/schema.json")).json();
  assert.ok(schema.paths.includes("/data/art"), "/data/art absent de /schema.json");

  const operation = doc.paths["/data/art"].get;
  assert.equal(operation.responses["200"].headers["X-Game-Version"].$ref, "#/components/headers/GameVersion");
  assert.equal(operation.responses["304"].headers["X-Game-Version"].$ref, "#/components/headers/GameVersion");

  // La décision est explicite : ce corps n'est pas une table d'entités keyée par
  // nom, donc pas d'export CSV/TSV — et donc aucun chemin délimité à documenter.
  assert.equal(doc.paths["/data/art.csv"], undefined, "/data/art.csv est documenté alors qu'il n'est pas monté");
  assert.equal((await api.get("/data/art.csv")).status, 404, "/data/art.csv est monté alors qu'il ne doit pas l'être");
  assert.equal(doc.paths["/data/art.tsv"], undefined, "/data/art.tsv est documenté alors qu'il n'est pas monté");
  assert.equal((await api.get("/data/art.tsv")).status, 404, "/data/art.tsv est monté alors qu'il ne doit pas l'être");
});
