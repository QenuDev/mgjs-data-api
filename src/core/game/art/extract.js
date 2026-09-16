// src/core/game/art/extract.js
//
// L'exécution des prédicats : une étape par table, chacune pouvant lire celles
// d'avant.
//
// Les étapes sont ordonnées par ce qu'elles lisent, pas par ce qui compte : la
// table des noms de sprite vient d'abord parce que toute référence de sprite
// s'y résout, la table des plantes avant les ancres parce que les ancres sont
// validées contre les espèces qu'elle déclare, et le plafond d'échelle avant la
// fonction de placement parce que c'est la formule qui identifie la fonction.
//
// Une extraction ne choisit jamais entre deux candidats qui tiennent tous les
// deux. Deux tables qui partagent la même forme, c'est exactement la situation
// où une devinette ressemble à un résultat : c'est donc une erreur qui les porte
// toutes les deux, et le message dit quel prédicat, ce qu'il cherchait et ce
// qu'il a vu.

import { PREDICATES, spriteIndexOf } from "./predicates.js";

/**
 * Un prédicat n'a pas pu être satisfait.
 *
 * Le message nomme le prédicat, la forme cherchée et ce qui a été vu : tout
 * l'intérêt de lire des tables par leur forme est qu'un changement de forme
 * échoue bruyamment.
 */
export class ExtractionError extends Error {
  constructor({ predicate, looksFor, saw }) {
    super(`[${predicate}] ${looksFor}\n  vu : ${saw.join("\n        ")}`);
    this.name = "ExtractionError";
    this.predicate = predicate;
    this.looksFor = looksFor;
    this.saw = saw;
  }
}

/** La preuve d'une table : le candidat sans sa valeur, que le fichier de données porte à la place. */
export function evidenceOf(candidate) {
  return {
    predicate: candidate.predicate,
    looksFor: candidate.looksFor,
    invariant: candidate.invariant,
    chunk: candidate.chunk,
    declaration: candidate.declaration,
    start: candidate.start,
    end: candidate.end,
    support: candidate.support,
    coverage: candidate.coverage,
  };
}

/** Ce qu'un candidat a de faux, en une phrase lisible pour quelqu'un qui regarde un changement de version. */
function describe(candidate, violations) {
  const counts = Object.entries(candidate.coverage.counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const notes = candidate.coverage.notes ?? [];
  return [
    `${candidate.chunk}${candidate.declaration === null ? "" : ` ${candidate.declaration}`}`,
    counts,
    ...violations,
    ...notes,
  ]
    .filter((part) => part !== "")
    .join(" | ");
}

/**
 * Exécute toutes les étapes et rend les tables et leur preuve.
 *
 * `chunks` est une liste de chunks projetés ; l'appelant décide lesquels, et
 * c'est là que se joue la couverture : un chunk oublié se voit comme une table
 * absente, jamais comme une table périmée publiée en silence.
 */
export function extractTables(chunks) {
  const tables = {};
  const evidence = {};
  const declarations = {};
  let spriteIndex = null;

  for (const predicate of PREDICATES) {
    const context = { chunks, tables, declarations, spriteIndex };
    const candidates = predicate.candidates(context);
    const accepted = candidates.filter((candidate) => predicate.violations(candidate, context).length === 0);

    if (accepted.length === 0) {
      throw new ExtractionError({
        predicate: predicate.predicate,
        looksFor: predicate.looksFor,
        saw:
          candidates.length === 0
            ? ["aucun candidat de cette forme dans les chunks lus"]
            : candidates.map((candidate) =>
                describe(candidate, predicate.violations(candidate, context))
              ),
      });
    }
    if (accepted.length > 1) {
      throw new ExtractionError({
        predicate: predicate.predicate,
        looksFor: predicate.looksFor,
        saw: [
          `${accepted.length} candidats tiennent l'invariant, donc aucun n'est choisi :`,
          ...accepted.map((candidate) => describe(candidate, [])),
        ],
      });
    }

    const chosen = accepted[0];
    tables[predicate.id] = chosen.value;
    evidence[predicate.id] = evidenceOf(chosen);
    if (chosen.declaration !== null) declarations[predicate.id] = chosen.declaration;
    if (predicate.id === "spriteNames") spriteIndex = spriteIndexOf(chosen.value);
  }

  return { tables, evidence, declarations };
}
