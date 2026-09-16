// tests/data-single-version.test.js
//
// Une réponse, une version.
//
// Mesuré en direct avant ce correctif : `/health` publiait le bundle du jeu en
// version **1191** pendant que les URLs de sprites de `/data/*` portaient
// `?v=1190` dans la même fenêtre. `?v=` venait de l'enregistrement de build
// (`data/version.json`, ce que la synchro a écrit) alors que le corps était
// extrait du bundle en cache, qui se rafraîchit tout seul (TTL de 5 min) sans
// attendre la synchro. Une réponse ne disait donc nulle part de quelle version
// elle parlait, et deux appels du même client pouvaient se contredire.
//
// Ce test monte les deux sources en écart, hors ligne : un amont factice annonce
// 1191 et sert le bundle de chaque version, `data/version.json` dit 1190 (les
// sprites et atlas sur disque sont ceux-là). Chaque réponse doit annoncer une
// seule version, la même partout ; et quand l'amont ne sert plus la version
// construite, l'écart doit rester lisible sur `/data/version`.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
// 1 ms : le bundle expire à chaque appel, donc la fenêtre mesurée — un cache qui
// se rafraîchit pendant que la synchro tourne encore — se rejoue à volonté.
process.env.CACHE_BUNDLE_TTL = "1";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILE = path.join(REPO, "data", "version.json");

/** La version dont les sprites et les atlas sont sur disque (l'enregistrement). */
const BUILT = "1190";
/** La version que le jeu annonce à l'instant. */
const LATEST = "1191";

// =====================
// Un amont factice
// =====================

let serveBuilt = true;
const requested = [];

/**
 * `/platform/v1/version` annonce la dernière version, et chaque version servie
 * expose une page + un chunk qui porte la signature de données du jeu
 * (`secondsToHatch`) — donc résolu comme le chunk de données, sans réseau.
 *
 * `requested` garde la trace de ce qui a été demandé : c'est la preuve que le
 * bundle de la nouvelle version n'est pas seulement ignoré, il n'est pas
 * téléchargé.
 */
async function startUpstream() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://upstream");
    requested.push(url.pathname);

    if (url.pathname === "/platform/v1/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: LATEST }));
      return;
    }

    const match = /^\/version\/([^/]+)\//.exec(url.pathname);
    const served = new Set([LATEST, ...(serveBuilt ? [BUILT] : [])]);

    if (match && served.has(match[1])) {
      const version = match[1];
      if (url.pathname.endsWith(".html")) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          `<script type="module" src="/version/${version}/assets/index-${version}.js"></script>`
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end("const secondsToHatch = 1;");
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const upstream = await startUpstream();
process.env.GAME_ORIGIN = upstream.baseUrl;

/** Combien de requêtes l'amont a reçues sous ce préfixe. */
const requestedUnder = (prefix) => requested.filter((p) => p.startsWith(prefix)).length;

// L'enregistrement de build existe avant le premier import de `config` : c'est
// l'état « le jeu a bougé, la synchro n'a pas encore rattrapé ».
const originalVersionFile = await fs.readFile(VERSION_FILE, "utf8").catch(() => null);

{
  const { saveVersion } = await import("../src/core/game/versionStorage.js");
  await saveVersion(BUILT);
}

after(async () => {
  await upstream.close();
  if (originalVersionFile === null) {
    await fs.rm(VERSION_FILE, { force: true });
  } else {
    await fs.writeFile(VERSION_FILE, originalVersionFile);
  }
});

// =====================
// Les données du jeu, sans extraction ni réseau
// =====================

const { gameDataService } = await import("../src/services/index.js");

const stubbed = [];
function stub(method, data) {
  stubbed.push([method, gameDataService[method]]);
  gameDataService[method] = async () => data;
}

// `contract`, `version` et `gameVersion` sont exactement les noms qu'une
// catégorie de données pourrait porter : ils doivent traverser la réponse
// intacts.
stub("getPlants", {
  Carrot: {
    seed: { name: "Carrot", sprite: "sprite/seed/Carrot" },
    plant: { sprite: "sprite/plant/Carrot" },
    crop: { sprite: "sprite/plant/CarrotCrop" },
  },
  contract: { seed: { sprite: "sprite/seed/contract" } },
  version: { seed: { sprite: "sprite/seed/version" } },
  gameVersion: { seed: { sprite: "sprite/seed/gameVersion" } },
});
stub("getPets", { Chicken: { sprite: "sprite/pet/Chicken" } });
stub("getItems", { WateringCan: { sprite: "sprite/item/WateringCan" } });
stub("getDecor", { Bench: { art: "sprite/decor/Bench" } });
stub("getEggs", { CommonEgg: { sprite: "sprite/item/CommonEgg" } });
stub("getAbilities", { GreenThumb: { sprite: "sprite/ui/GreenThumb" } });
stub("getMutations", { Gold: { sprite: "sprite/mutation/Gold" } });
stub("getWeathers", { Sunny: { name: "Sunny", sprite: "sprite/ui/SunnyIcon" } });
stub("getEnums", { Rarity: ["Common"] });

after(() => {
  for (const [method, original] of stubbed) gameDataService[method] = original;
});

/** Les routes JSON de `/data`, sans les formats délimités. */
const JSON_ROUTES = [
  "/data",
  "/data/plants",
  "/data/pets",
  "/data/items",
  "/data/decors",
  "/data/eggs",
  "/data/abilities",
  "/data/mutations",
  "/data/weathers",
  "/data/weather-groups",
  "/data/enums",
];

/** Toutes les versions portées par un `?v=` du corps, où qu'il soit. */
function versionsInBody(value, found = new Set()) {
  if (typeof value === "string") {
    const match = /[?&]v=([^&]*)/.exec(value);
    if (match) found.add(decodeURIComponent(match[1]));
    return found;
  }

  if (Array.isArray(value)) {
    for (const entry of value) versionsInBody(entry, found);
    return found;
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) versionsInBody(entry, found);
  }

  return found;
}

const versionOf = (url) => new URL(url).searchParams.get("v");

test("le bundle servi reste celui de la version enregistrée", async () => {
  const { getMainBundle, getCacheStats } = await import("../src/core/game/cache.js");

  // À froid : c'est le bundle de la version enregistrée qu'on charge, pas celui
  // de la version que le jeu annonce.
  await getMainBundle();
  assert.match(getCacheStats().bundleUrl, new RegExp(`/version/${BUILT}/`));

  // À chaud, le jeu ayant bougé sous nos pieds : on reste sur le bundle déjà en
  // cache plutôt que de l'échanger contre une version dont les sprites n'ont pas
  // encore été exportés.
  await getMainBundle();
  assert.match(getCacheStats().bundleUrl, new RegExp(`/version/${BUILT}/`));

  assert.ok(
    requestedUnder(`/version/${BUILT}/`) > 0,
    "le bundle de la version enregistrée n'a jamais été demandé"
  );
  assert.equal(
    requestedUnder(`/version/${LATEST}/`),
    0,
    `le bundle de la version ${LATEST} a été téléchargé pendant que la synchro n'avait pas tourné`
  );
});

test("chaque réponse /data/* n'annonce qu'une version, celle dont le corps est extrait", async (t) => {
  const { startTestApp } = await import("./helpers/httpApp.js");
  const api = await startTestApp();
  t.after(() => api.close());

  let sawSpriteUrl = false;

  for (const route of JSON_ROUTES) {
    const res = await api.get(route);
    assert.equal(res.status, 200, `${route} : ${res.status}`);

    const versions = versionsInBody(await res.json());

    assert.ok(
      versions.size <= 1,
      `${route} annonce ${versions.size} versions dans la même réponse : ${[...versions]}`
    );

    for (const version of versions) {
      sawSpriteUrl = true;
      assert.equal(version, BUILT, `${route} porte ?v=${version}`);
    }
  }

  assert.ok(sawSpriteUrl, "aucune URL de sprite dans les réponses : test vide");
});

test("le seul endroit où /health publie une version dit la même chose", async (t) => {
  const { startTestApp } = await import("./helpers/httpApp.js");
  const api = await startTestApp();
  t.after(() => api.close());

  await api.get("/data/plants");

  const { getCacheStats } = await import("../src/core/game/cache.js");
  assert.match(getCacheStats().bundleUrl, new RegExp(`/version/${BUILT}/`));

  const health = await (await api.get("/health")).json();
  assert.match(health.cache.bundleUrl, new RegExp(`/version/${BUILT}/`));

  // La dernière version du jeu n'apparaît nulle part dans la réponse.
  const body = await (await api.get("/data/plants")).json();
  assert.deepEqual([...versionsInBody(body)], [BUILT]);
});

test("quand l'amont ne sert plus la version construite, l'écart reste visible", async (t) => {
  // La version enregistrée a été retirée de l'amont : son bundle n'est plus
  // atteignable, donc la donnée vient de la dernière version — et la réponse le
  // dit, sans jamais mélanger deux versions.
  serveBuilt = false;

  const { invalidateAllCaches, getMainBundle } = await import("../src/core/game/cache.js");
  invalidateAllCaches();
  await getMainBundle();

  t.after(async () => {
    serveBuilt = true;
    invalidateAllCaches();
  });

  const { startTestApp } = await import("./helpers/httpApp.js");
  const api = await startTestApp();
  t.after(() => api.close());

  const res = await api.get("/data/plants");
  assert.equal(res.status, 200);

  const versions = versionsInBody(await res.json());
  assert.deepEqual([...versions], [LATEST]);

  // L'écart est publié : `/data/version` donne les deux versions, côte à côte.
  const version = await (await api.get("/data/version")).json();
  assert.equal(version.artVersion, BUILT);
  assert.equal(version.gameVersion, LATEST);
  assert.notEqual(version.gameVersion, version.artVersion);
});

test("les formats délimités n'inventent pas de ligne de métadonnées", async (t) => {
  const { startTestApp } = await import("./helpers/httpApp.js");
  const api = await startTestApp();
  t.after(() => api.close());

  const res = await api.get("/data/plants.csv");
  assert.equal(res.status, 200);

  const csv = await res.text();
  const [header, first] = csv.split("\n");

  // Une colonne de métadonnées ferait une colonne vide sur chaque entité, et une
  // ligne sans données : le format est une table, pas un objet keyé.
  assert.ok(!header.includes("v="), `en-tête CSV inattendu : ${header}`);
  assert.ok(!/^_meta/.test(first), `ligne de métadonnées dans le CSV : ${first}`);
  assert.match(first, /^Carrot,/);
});

test("les URLs de sprite gardent la version du corps", async (t) => {
  const { startTestApp } = await import("./helpers/httpApp.js");
  const api = await startTestApp();
  t.after(() => api.close());

  const body = await (await api.get("/data/plants")).json();

  assert.equal(versionOf(body.Carrot.seed.sprite), BUILT);
  assert.equal(versionOf(body.Carrot.plant.sprite), BUILT);
  assert.equal(versionOf(body.contract.seed.sprite), BUILT);
  assert.equal(versionOf(body.version.seed.sprite), BUILT);
  assert.equal(versionOf(body.gameVersion.seed.sprite), BUILT);
});
