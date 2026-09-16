// tests/helpers/offlineGame.js
//
// Le jeu hors ligne, pour les tests de composition : le stub de `fetch` qui sert la version et
// l'atlas capturés, plus les enregistrements de plantes que le composeur lit pour dire à quelle
// espèce appartient un art.
//
// C'est la même couture que `tests/sprites-composed-box.test.js` utilise, extraite ici parce que
// deux fichiers en ont besoin : `fetch` est la seule porte par laquelle le composeur atteint le jeu
// (`/platform/v1/version`, le manifeste, le JSON d'atlas, l'image), donc la remplacer suffit à
// garder le chemin de code réel sans qu'aucun octet ne sorte de la boucle locale.
//
// Le bundle du jeu — dont `gameDataService.getPlants()` et `/data/art` s'extraient — est absent
// hors ligne, exactement comme dans le test existant. Les tables d'art viennent donc de
// `tests/fixtures/art/bundle-1192/`, lues ici directement, et les enregistrements de plantes de
// `tests/fixtures/bake/plants.json` (même capture, jeu 1192).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(HERE, "..", "fixtures");

/** L'origine du jeu que le composeur appelle, et la version que la fixture annonce. */
export const GAME_ORIGIN = "https://magicgarden.gg";
export const FIXTURE_VERSION = "fixture-1192";

/** Les fichiers de l'atlas capturé : `tests/fixtures/sprites/`. */
const SPRITE_FILES = new Set(["manifest.json", "sprites-composed.json", "sprites-composed.png"]);

/** Le bundle d'art capturé, par version : `tests/fixtures/art/bundle-<v>/`. */
export const ART_BUNDLES = {
  1176: {
    dir: path.join(FIXTURES, "art", "bundle-1176"),
    index: "index-Cxu-pBRw.js",
    data: "quinoaPredictionAtoms-ptrrFeF6.js",
    art: "LayoutMotionController-CwhDlPns.js",
    names: null,
  },
  1192: {
    dir: path.join(FIXTURES, "art", "bundle-1192"),
    index: "index-Cxu-pBRw.js",
    data: "worldDepthSortKey-BXUHHrP0.js",
    art: "resources-D_3Zwcn-.js",
    names: "BakedRoundedRect-lGFgQzh1.js",
  },
};

/**
 * Installe le stub de `fetch` : la version, le manifeste, l'atlas, la page et les chunks du bundle.
 *
 * Tout le reste de l'origine du jeu répond 404 — l'état que le composeur tolère déjà — et toute
 * requête vers une autre origine passe au `fetch` réel, pour que le test puisse interroger son
 * propre serveur HTTP.
 */
export async function installOfflineGame({ version = 1192 } = {}) {
  const bundle = ART_BUNDLES[version];
  const realFetch = globalThis.fetch.bind(globalThis);
  const spritesDir = path.join(FIXTURES, "sprites");

  globalThis.fetch = async (url, init) => {
    let href;
    try {
      href = new URL(String(url)).href;
    } catch {
      return realFetch(url, init);
    }
    if (new URL(href).origin !== GAME_ORIGIN) return realFetch(url, init);

    if (href === `${GAME_ORIGIN}/platform/v1/version`) {
      return Response.json({ version: FIXTURE_VERSION });
    }
    const name = href.split("/").pop();
    if (SPRITE_FILES.has(name)) {
      const body = await fs.readFile(path.join(spritesDir, name));
      return new Response(body, {
        status: 200,
        headers: { "content-type": name.endsWith(".json") ? "application/json" : "image/png" },
      });
    }
    if (new URL(href).pathname.endsWith(`/${bundle.index}`)) {
      const files = [bundle.data, bundle.art, ...(bundle.names === null ? [] : [bundle.names])];
      return new Response(files.map((file) => `import "./${file}";`).join("\n"), {
        status: 200,
        headers: { "content-type": "text/javascript" },
      });
    }
    if (/\/version\/[^/]+\/index\.html$/.test(new URL(href).pathname)) {
      return new Response(
        `<!doctype html><html><body><script type="module" src="/version/${version}/assets/${bundle.index}"></script></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    for (const file of [bundle.data, bundle.art, ...(bundle.names === null ? [] : [bundle.names])]) {
      if (new URL(href).pathname.endsWith(`/${file}`)) {
        const text = await fs.readFile(path.join(bundle.dir, file), "utf8");
        return new Response(text, { status: 200, headers: { "content-type": "text/javascript" } });
      }
    }
    return new Response("offline", { status: 404 });
  };

  return () => {
    globalThis.fetch = realFetch;
  };
}

/** Les enregistrements de plantes de la capture, que le composeur lit pour nommer une espèce. */
export async function plantFixture() {
  return JSON.parse(await fs.readFile(path.join(FIXTURES, "bake", "plants.json"), "utf8"));
}

/**
 * Les tables d'art de la capture, extraites du bundle par le code de l'API — le même
 * `extractArtTables` que `/data/art` sert.
 */
export async function artTablesFixture(version = 1192) {
  const bundle = ART_BUNDLES[version];
  const { extractArtTables } = await import("../../src/core/game/art/index.js");
  const files = [bundle.data, bundle.art, ...(bundle.names === null ? [] : [bundle.names])];
  const chunks = await Promise.all(
    files.map(async (file) => ({ file, text: await fs.readFile(path.join(bundle.dir, file), "utf8") })),
  );
  return extractArtTables({ chunks, gameVersion: String(version) });
}
