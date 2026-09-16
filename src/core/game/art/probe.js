// src/core/game/art/probe.js
//
// Le test de forme qui décide quel chunk télécharger.
//
// Il vit dans son propre module, et ce n'est pas un détail d'organisation : le
// résolveur de bundle l'importe, et `art/index.js` importe le cache du bundle,
// qui importe le résolveur. Mettre ce test dans `index.js` fermerait ce cycle,
// donc ce module n'importe que les prédicats — qui n'importent que la projection
// de formes.
//
// Le test est celui que le plan §3.3 avait déjà mesuré : **la fonction de
// placement est reconnaissable à sa fermeture**. Un chunk qui divise par la
// tuile ne suffit pas — la capture en contient deux, et un chunk de sièges
// (`installSeatSystems`) partage même la forme des ancres et une formule
// `Math.min`. Ce qui n'existe qu'à un endroit, c'est une fonction qui divise par
// la tuile **et** clôt sur la table des ancres et sur le plafond. C'est donc
// cela qu'on cherche, et pas une ressemblance.

import { anchorTable, placementFunction, scaleCap } from "./predicates.js";
import { leafEntries, projectChunk } from "./shapes.js";

/**
 * Projette un chunk en avalant une erreur de lecture.
 *
 * Un test de cible ne peut pas faire tomber la résolution du bundle : si le
 * lecteur rencontre une forme qu'il ne sait pas projeter, la bonne réponse est
 * « ce chunk n'est pas celui que je cherche », pas une exception qui laisse
 * toutes les routes `/data/*` sans bundle. La projection a été rendue
 * défensive pour les gabarits (voir `shapes.js`), et cette ceinture-ci couvre
 * le reste.
 */
function project(file, text) {
  try {
    return projectChunk(file, text);
  } catch {
    return null;
  }
}

/** Un chemin de sprite, dans la forme d'identité du jeu. */
const SPRITE_PATH = /^sprite\/[a-z0-9-]+\/[A-Za-z0-9_-]+$/;

/** Le plus petit nombre de chemins qui fait d'un objet la table des noms. Le build capturé en a 583. */
const MIN_SPRITE_PATHS = 100;

/**
 * La forme de la formule du plafond, telle qu'elle se cherche dans le texte.
 *
 * C'est un filtre **bon marché** avant la projection, pas le test : un chunk qui
 * ne divise nulle part par une constante n'a pas de table d'art, et cela se lit
 * sans projeter. Un faux positif ici ne coûte qu'une projection de plus.
 */
const CAP_FORMULA = /Math\.min\(\s*[A-Za-z_$][\w$]*\s*,\s*[^()]*?\/\s*\d+(?:\.\d+)?\s*\)/;

/**
 * Ce chunk porte-t-il les tables d'art ?
 *
 * Le résolveur s'en sert comme test de cible : c'est l'extraction réelle qui
 * décide quel chunk télécharger, comme pour les couleurs et les textes
 * d'ability, jamais un nom de fichier — les noms portent une empreinte de
 * contenu et changent à chaque build.
 *
 * Les invariants ne sont pas appliqués ici : la table des plantes vit dans un
 * autre chunk, et c'est elle qui témoigne des clés d'ancre. Ce test ne fait que
 * reconnaître la forme ; l'extraction, elle, refuse si l'invariant ne tient pas.
 */
export function looksLikeArtTables(text) {
  if (typeof text !== "string" || !CAP_FORMULA.test(text)) return false;

  const chunk = project("probe", text);
  if (chunk === null) return false;
  const context = { chunks: [chunk], tables: {}, declarations: {}, spriteIndex: null };
  const caps = scaleCap
    .candidates(context)
    .filter((candidate) => candidate.value.cap > 0 && candidate.value.cap <= 1 && candidate.value.referenceTilePx > 0);
  if (caps.length === 0) return false;

  const anchors = anchorTable.candidates(context);
  if (anchors.length === 0) return false;

  for (const cap of caps) {
    for (const anchor of anchors) {
      const placement = placementFunction.candidates({
        chunks: [chunk],
        tables: { scale: cap.value, plants: {} },
        declarations: { anchors: anchor.declaration, scale: cap.declaration },
        spriteIndex: null,
      });
      if (placement.some((candidate) => candidate.coverage.counts.closesOverTheAnchorsAndTheCap === 1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Ce chunk porte-t-il la table des noms de sprite ?
 *
 * Elle vit dans le chunk de données en 1176, et **ailleurs** en 1192
 * (`BakedRoundedRect`, à une autre profondeur du graphe) — c'est-à-dire que la
 * table qui témoigne de tous les chemins de sprite a déménagé sans que rien ne
 * le dise. Le résolveur la cherche donc elle aussi par sa forme, sinon
 * l'extraction refuserait de publier une seule ancre sur une version où tout le
 * reste est lisible : les références `B.Plant.Aloe` ne se résoudraient plus.
 *
 * Le filtre bon marché est le nombre d'occurrences de `sprite/` dans le texte :
 * un chunk qui n'en porte pas cent ne peut pas être cette table, et cela se
 * compte sans projeter. Les feuilles sont ensuite classées par leur syntaxe,
 * comme dans le prédicat.
 */
export function looksLikeSpriteNames(text) {
  if (typeof text !== "string") return false;
  if ((text.match(/sprite\//g) ?? []).length < MIN_SPRITE_PATHS) return false;

  const chunk = project("probe", text);
  if (chunk === null) return false;
  return chunk.objects.some(
    (object) => leafEntries(object).filter(([, leaf]) => SPRITE_PATH.test(leaf.text)).length >= MIN_SPRITE_PATHS
  );
}
