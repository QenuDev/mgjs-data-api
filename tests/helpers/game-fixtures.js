// tests/helpers/game-fixtures.js
//
// Sert les fixtures du jeu sur la boucle locale (127.0.0.1), pour que les tests
// qui passent par `fetch` — manifest, atlas JSON, endpoint de version — tournent
// sans réseau et ne dépendent plus de la version que le jeu sert ce jour-là.
//
// La capture est figée sous `tests/fixtures/game/`, à la même arborescence que
// les URL du jeu ; provenance, version et empreintes dans
// `tests/fixtures/README.md`.
//
// Ce qui n'est **pas** là, volontairement : les binaires (KTX2, `.riv`). Ils
// pèsent des mégaoctets ; les tests qui en ont besoin se sautent en le disant
// (voir `tests/helpers/live-assets.js`).

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../../src/config/index.js";
import { extractJsonFiles, getBundleByName } from "../../src/assets/manifest.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_ROOT = path.resolve(HERE, "..", "fixtures", "game");

/** Version du jeu dont les fixtures ont été capturées (cf. fixtures/README.md). */
export const FIXTURE_VERSION = "1192";

// Les origines que `src/` interroge. Il y en a deux, et il faut les deux :
// `src/assets/assets.js` fige la sienne dans une constante locale (`ORIGIN`),
// tandis que `src/core/game/version.js` prend `config.game.origin` par défaut.
// N'en réécrire qu'une laisse l'autre partir sur le vrai réseau sans que rien
// ne le signale. Le littéral est celui d'`assets.js` : s'il y change, c'est ici
// qu'il faut le suivre.
const GAME_ORIGINS = [...new Set(["https://magicgarden.gg", config.game.origin])];

const CONTENT_TYPES = {
  ".json": "application/json",
  ".html": "text/html",
  ".riv": "application/octet-stream",
  ".ktx2": "image/ktx2",
  ".webp": "image/webp",
  ".png": "image/png",
};

let serverPromise = null;
let serverHandle = null;

function resolveFixture(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.resolve(FIXTURE_ROOT, relative);
  // Rien en dehors des fixtures, même si une URL contient `..`.
  if (file !== FIXTURE_ROOT && !file.startsWith(FIXTURE_ROOT + path.sep)) return null;
  return file;
}

async function readFixture(pathname) {
  // L'endpoint de version n'a pas d'extension : on essaie `<path>.json` ensuite.
  for (const candidate of [resolveFixture(pathname), resolveFixture(`${pathname}.json`)]) {
    if (!candidate) return null;
    try {
      return { file: candidate, body: await fs.readFile(candidate) };
    } catch {
      // essaie le candidat suivant
    }
  }
  return null;
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://127.0.0.1");
    const found = await readFixture(pathname);

    if (!found) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no such fixture", path: pathname, root: FIXTURE_ROOT }));
      return;
    }

    const type = CONTENT_TYPES[path.extname(found.file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type, "content-length": found.body.length });
    res.end(found.body);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      // Ne retient pas le process du test après la dernière assertion.
      server.unref();
      resolve(server);
    });
  });
}

/** Origine locale (ex: `http://127.0.0.1:41235`), démarrée au premier appel. */
export async function fixtureOrigin() {
  if (!serverPromise) {
    serverPromise = startServer()
      .then((server) => {
        serverHandle = server;
        return `http://127.0.0.1:${server.address().port}`;
      })
      .catch((error) => {
        // Ne pas mettre un démarrage raté en cache : le prochain appel réessaie
        // au lieu d'hériter d'une promesse rejetée pour tout le fichier.
        serverPromise = null;
        serverHandle = null;
        throw error;
      });
  }
  return serverPromise;
}

/** Base des assets, équivalent de ce que `getBaseUrl()` renvoie en vrai. */
export async function fixtureBaseUrl() {
  return `${await fixtureOrigin()}/version/${FIXTURE_VERSION}/assets/`;
}

export async function stopFixtureServer() {
  if (!serverPromise) return;
  await serverPromise;
  const server = serverHandle;
  serverPromise = null;
  serverHandle = null;
  if (server) await new Promise((resolve) => server.close(resolve));
}

function rewriteOrigin(url) {
  if (typeof url !== "string") return null;
  for (const origin of GAME_ORIGINS) {
    if (origin && url.startsWith(origin)) {
      return { origin, path: url.slice(origin.length) || "/" };
    }
  }
  return null;
}

let installed = null;

/**
 * Réécrit les requêtes vers l'origine du jeu vers la boucle locale.
 *
 * `getBaseUrl()` et `initSprites()` figent l'origine du jeu dans `src/` et
 * n'acceptent pas de `baseUrl` : c'est la seule façon de faire tourner le
 * chemin de production hors ligne sans toucher au source. À installer dans le
 * test qui en a besoin et à restaurer aussitôt.
 *
 * @returns {Promise<() => void>} restore
 */
export async function useFixtureOrigin() {
  if (installed) {
    throw new Error("useFixtureOrigin() is already installed — restore the previous call first");
  }

  const origin = await fixtureOrigin();
  const realFetch = globalThis.fetch;
  installed = { realFetch };

  globalThis.fetch = (input, init) => {
    if (typeof input === "string") {
      const rewritten = rewriteOrigin(input);
      return rewritten ? realFetch(origin + rewritten.path, init) : realFetch(input, init);
    }
    if (input instanceof Request) {
      const rewritten = rewriteOrigin(input.url);
      // On reconstruit la Request pour ne pas perdre méthode, en-têtes ni signal.
      return rewritten
        ? realFetch(new Request(origin + rewritten.path, input), init)
        : realFetch(input, init);
    }
    return realFetch(input, init);
  };

  return () => {
    // Idempotent : un `finally` défensif ne doit pas casser sur un second appel.
    if (!installed) return;
    globalThis.fetch = installed.realFetch;
    installed = null;
  };
}

/** Chemin, sous `tests/fixtures/game/`, d'un asset de la version épinglée. */
export function fixtureAssetPath(relativePath) {
  return path.join("version", FIXTURE_VERSION, "assets", relativePath);
}

/** Lit une fixture JSON, chemin relatif à `tests/fixtures/game/`. */
export async function readFixtureJson(relativePath) {
  const file = path.resolve(FIXTURE_ROOT, relativePath);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

/**
 * Les atlas déclarés par la fixture, dans l'ordre du manifest, multi-packs
 * compris : les atlas JSON du bundle `default` (via `extractJsonFiles`, donc la
 * même liste que celle qu'ingère `initSprites()`), puis les
 * `meta.related_multi_packs` de chacun, résolus dans son dossier.
 *
 * Sert aux tests de géométrie, qui n'ont besoin que des JSON.
 *
 * @returns {Promise<Array<{ src: string, json: object }>>}
 */
export async function readFixtureAtlases() {
  const manifest = await readFixtureJson(fixtureAssetPath("manifest.json"));
  const bundle = getBundleByName(manifest, "default");
  if (!bundle) throw new Error("fixture manifest has no `default` bundle");

  const ordered = [];
  const seen = new Set();
  const add = (src) => {
    if (src && !seen.has(src)) {
      seen.add(src);
      ordered.push(src);
    }
  };

  for (const src of extractJsonFiles(bundle)) {
    add(src);
    // Les multi-packs vivent dans le dossier du JSON qui les déclare.
    const dir = src.includes("/") ? src.replace(/[^/]+$/, "") : "";
    const atlas = await readFixtureJson(fixtureAssetPath(src));
    for (const related of atlas?.meta?.related_multi_packs ?? []) {
      if (typeof related === "string") add(dir + related);
    }
  }

  return Promise.all(
    ordered.map(async (src) => ({ src, json: await readFixtureJson(fixtureAssetPath(src)) }))
  );
}
