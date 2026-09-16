// src/core/game/art/index.js
//
// Les tables d'art du jeu, extraites du bundle et publiées.
//
// Le fork publie `/data/*` depuis les tables de données du jeu, mais les tables
// d'art de la mutation vivent dans le contrôleur de dessin, pas dans la table de
// données, et n'étaient publiées nulle part : les ancres par espèce, les
// drapeaux `isTallPlant`/`isNarrowDisplay`, le plafond d'échelle et sa tuile, le
// multiplicateur de décalque haut, l'ensemble des mutations superposées,
// l'échelle de z, et la teinte de récolte de chaque mutation — ou le matériau de
// shader qui la remplace.
//
// Les publier plutôt que les garder internes est le point : un composeur qui
// re-dérive ces nombres finit par diverger du jeu, et deux rendus qui divergent
// sont exactement ce que cet item existe pour empêcher.
//
// Les noms des tables sont ceux du paquet frère `@mg.js/art` (`packages/art`,
// `data/<version>.json`) parce que c'est le même jeu lu deux fois : les deux
// rendus doivent pouvoir se comparer table par table, et deux vocabulaires
// différents garantiraient la dérive qu'on veut éviter.

import { gameVersionFromAssetUrl, getMainBundle } from "../cache.js";
import { ExtractionError, extractTables } from "./extract.js";
import { projectChunk } from "./shapes.js";
import { spriteIndexOf } from "./predicates.js";

export { ExtractionError } from "./extract.js";
export { extractTables } from "./extract.js";
export { compilePlacement } from "./placement.js";
export { validateArtTables } from "./validate.js";
export { looksLikeArtTables, looksLikeSpriteNames } from "./probe.js";
export { spriteIndexOf } from "./predicates.js";
export { projectChunk, tokenize } from "./shapes.js";

/** Le nom de fichier d'une URL de chunk. */
function fileOf(url) {
  if (!url) return "unknown";
  const withoutQuery = String(url).split("?")[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
}

/**
 * Extrait les tables depuis des chunks déjà en texte.
 *
 * C'est le point d'entrée pur : l'appelant décide quels chunks sont lus, et
 * c'est là que se joue la couverture — un chunk oublié se voit comme une table
 * absente, jamais comme une table périmée publiée en silence.
 */
export function extractArtTables({ chunks, gameVersion = null, bundleUrl = null } = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new ExtractionError({
      predicate: "bundle",
      looksFor: "au moins un chunk de jeu à lire",
      saw: ["aucun chunk fourni"],
    });
  }

  const { tables, evidence } = extractTables(
    chunks.map((chunk) => projectChunk(chunk.file ?? "unknown", chunk.text))
  );

  return {
    tables,
    evidence,
    source: {
      gameVersion,
      bundleUrl,
      chunks: chunks.map((chunk) => ({ file: chunk.file ?? "unknown", bytes: chunk.text.length })),
    },
  };
}

/**
 * Extrait la charge utile publiée à partir d'un bundle déjà résolu.
 *
 * `mainJs` est le chunk de données que `fetchMainBundle` résout déjà ;
 * `artSource` est le chunk que `looksLikeArtTables` a reconnu. Les deux sont
 * passés à l'extraction ensemble : c'est ce qui permet aux ancres d'être
 * témoignées par les espèces, et à la fonction de placement d'être exécutée avec
 * la table des plantes et l'enum du jeu.
 */
export function extractArtPayload({
  mainJs,
  artSource = null,
  mainUrl = null,
  artUrl = null,
  namesSource = null,
  namesUrl = null,
} = {}) {
  if (typeof mainJs !== "string" || mainJs.length === 0) {
    throw new ExtractionError({
      predicate: "bundle",
      looksFor: "le chunk de données du jeu, que le résolveur doit avoir trouvé",
      saw: ["aucun chunk de données en cache"],
    });
  }

  // Les chunks sont dédupliqués par URL : en 1176 la table des noms vit dans le
  // chunk de données, en 1192 dans un chunk à part, et l'extraction ne doit pas
  // lire deux fois le même contenu — deux candidats identiques feraient refuser
  // l'extraction, ce qui serait un faux échec.
  const chunks = [{ file: fileOf(mainUrl), text: mainJs }];
  const seen = new Set([mainUrl]);
  if (typeof artSource === "string" && artUrl != null && !seen.has(artUrl)) {
    seen.add(artUrl);
    chunks.push({ file: fileOf(artUrl), text: artSource });
  }
  if (typeof namesSource === "string" && namesUrl != null && !seen.has(namesUrl)) {
    seen.add(namesUrl);
    chunks.push({ file: fileOf(namesUrl), text: namesSource });
  }

  const { tables, evidence, source } = extractArtTables({
    chunks,
    gameVersion: gameVersionFromAssetUrl(mainUrl),
    bundleUrl: mainUrl,
  });

  return { ...tables, evidence, source: { ...source, artChunkUrl: artUrl, namesChunkUrl: namesUrl } };
}

/** L'extraction depuis le bundle en cache : ce que la route `/data/art` publie. */
export async function getArtData() {
  const bundle = await getMainBundle();
  return extractArtPayload(bundle);
}
