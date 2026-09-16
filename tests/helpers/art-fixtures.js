// tests/helpers/art-fixtures.js
//
// Ce que les tests d'art lisent hors ligne, et d'où ça vient.
//
// Deux captures, et c'est volontaire : les tables viennent du bundle **1176**
// (le chunk coupé sous `tests/fixtures/art/bundle-1176/`), tandis que les
// chemins de sprite sont confirmés contre les **atlas 1192** déjà figés sous
// `tests/fixtures/game/version/1192/assets/atlases/`. Un invariant qui ne
// compare une table qu'à elle-même ne prouve rien ; celui-ci compare un
// découpage du jeu à des pixels que le jeu sert.
//
// Rien ici ne touche au réseau, et aucun chemin de sprite n'est écrit à la
// main : ils sortent de `Object.keys(frames)`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { looksLikeArtTables } from "../../src/core/game/art/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ART_FIXTURE_DIR = path.resolve(HERE, "..", "fixtures", "art", "bundle-1176");
export const ATLAS_FIXTURE_DIR = path.resolve(
  HERE,
  "..",
  "fixtures",
  "game",
  "version",
  "1192",
  "assets",
  "atlases"
);

/** La version de jeu du découpage d'art (cf. `tests/fixtures/art/README.md`). */
export const ART_FIXTURE_VERSION = "1176";

/** Les deux chunks du découpage, dans la forme que l'extracteur attend. */
export function artChunks() {
  return fs
    .readdirSync(ART_FIXTURE_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((file) => ({ file, text: fs.readFileSync(path.join(ART_FIXTURE_DIR, file), "utf8") }));
}

/** Les intervalles et empreintes du découpage, tels que le script les a écrits. */
export function fixtureCuts() {
  return JSON.parse(fs.readFileSync(path.join(ART_FIXTURE_DIR, "CUTS.json"), "utf8"));
}

/** Le chemin du chunk qui porte les tables d'art, et son texte. */
export function artChunk() {
  const chunk = artChunks().find((entry) => looksLikeArtTables(entry.text));
  if (!chunk) throw new Error("no chunk in the art fixture carries the art tables");
  return chunk;
}

/**
 * Le disque de test : le chunk de données, qui est celui que `fetchMainBundle`
 * résout déjà par sa signature `secondsToHatch`.
 */
export function dataChunk() {
  const chunk = artChunks().find((entry) => entry.text.includes("secondsToHatch"));
  if (!chunk) throw new Error("no chunk in the art fixture carries the data signature");
  return chunk;
}

/** Toutes les frames des atlas figés : `sprite/<category>/<Name>` -> frame. */
export function atlasFrames() {
  const frames = {};
  for (const name of fs.readdirSync(ATLAS_FIXTURE_DIR).sort()) {
    if (!name.endsWith(".json")) continue;
    const atlas = JSON.parse(fs.readFileSync(path.join(ATLAS_FIXTURE_DIR, name), "utf8"));
    for (const [path, frame] of Object.entries(atlas.frames ?? {})) frames[path] = frame;
  }
  return frames;
}

/**
 * Une frame telle que la fonction du jeu en lit une : ses pixels bruts, son
 * ancre et son ratio. C'est la forme que le jeu reçoit, pas celle d'un client.
 */
export function rawFrame(frame) {
  return {
    width: frame.sourceSize.w,
    height: frame.sourceSize.h,
    defaultAnchor: { x: frame.anchor.x, y: frame.anchor.y },
    sourcePixelRatio: frame.sourcePixelRatio > 0 ? frame.sourcePixelRatio : 1,
  };
}

/** Une frame synthétique, pour exercer les branches qu'un atlas ne porte pas. */
export function syntheticFrame({ width = 128, height = 128, anchorX = 0.5, anchorY = 0.5 } = {}) {
  return { width, height, defaultAnchor: { x: anchorX, y: anchorY }, sourcePixelRatio: 1 };
}
