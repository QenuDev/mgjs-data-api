// tests/helpers/art-fixtures.js
//
// Ce que les tests d'art lisent hors ligne, et d'où ça vient.
//
// **Toutes les versions dont le découpage est commité**, jamais une seule. Une
// fixture unique est exactement ce qui a laissé la suite verte contre 1176
// pendant que l'API servait 1192, dont la table d'art avait renommé son champ de
// lavage : `artFixtureVersions()` est ce que les tests parcourent, et
// `tests/art-versions.test.js` est ce qui refuse qu'une version servie n'y soit
// pas.
//
// Deux sources, et c'est volontaire : les tables viennent des découpages de
// `tests/fixtures/art/`, tandis que les chemins de sprite sont confirmés contre
// les **atlas 1192** déjà figés sous
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

/** Le dossier des découpages d'art, un par version. */
export const ART_FIXTURES_ROOT = path.resolve(HERE, "..", "fixtures", "art");

/** Les atlas figés contre lesquels les chemins de sprite sont témoignés. */
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

/**
 * Les versions dont le découpage d'art est commité, dans l'ordre des versions.
 *
 * Le dossier est la source : ajouter `bundle-<v>/` fait entrer `<v>` dans tous
 * les tests d'art, et l'oublier est visible ici.
 */
export function artFixtureVersions() {
  return fs
    .readdirSync(ART_FIXTURES_ROOT)
    .map((name) => /^bundle-(\d+)$/.exec(name)?.[1] ?? null)
    .filter((version) => version !== null)
    .sort();
}

/** Le dossier du découpage d'une version. */
export function artFixtureDirectory(version) {
  const dir = path.resolve(ART_FIXTURES_ROOT, `bundle-${version}`);
  if (!fs.existsSync(dir)) throw new Error(`no art fixture for game version ${version}`);
  return dir;
}

/** La version la plus récente dont le découpage est commité : celle que l'API sert. */
export function newestArtFixtureVersion() {
  const newest = artFixtureVersions().at(-1);
  if (newest === undefined) throw new Error("no art fixture is committed at all");
  return newest;
}

/** Les chunks d'un découpage, dans la forme que l'extracteur attend. */
export function artChunks(version) {
  const dir = artFixtureDirectory(version);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((file) => ({ file, text: fs.readFileSync(path.join(dir, file), "utf8") }));
}

/** Les intervalles et empreintes d'un découpage, tels que le script les a écrits. */
export function fixtureCuts(version) {
  return JSON.parse(fs.readFileSync(path.join(artFixtureDirectory(version), "CUTS.json"), "utf8"));
}

/** Le chunk qui porte les tables d'art d'une version, et son texte. */
export function artChunk(version) {
  const chunk = artChunks(version).find((entry) => looksLikeArtTables(entry.text));
  if (!chunk) throw new Error(`no chunk in the ${version} art fixture carries the art tables`);
  return chunk;
}

/**
 * Le disque de test : le chunk de données, qui est celui que `fetchMainBundle`
 * résout déjà par sa signature `secondsToHatch`.
 */
export function dataChunk(version) {
  const chunk = artChunks(version).find((entry) => entry.text.includes("secondsToHatch"));
  if (!chunk) throw new Error(`no chunk in the ${version} art fixture carries the data signature`);
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
