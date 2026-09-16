// src/core/game/art/placement.js
//
// La fonction de placement du jeu, compilée pour être **exécutée**, jamais
// réécrite.
//
// C'est tout l'objet de l'item : une formule re-portée à la main ne peut pas
// être prouvée juste en la relisant, seulement en faisant tourner les deux sur
// les mêmes frames. Le texte de la fonction sort du bundle par extraction
// (`predicates.js`), ses déclarations locales et ses externes aussi, et ce
// module n'ajoute qu'une chose : de quoi l'appeler.
//
// Les liaisons viennent des **rôles** que l'extracteur a résolus, pas de noms :
// un externe que la fonction indexe par son propre paramètre d'espèce est la
// table des plantes, un externe dont elle lit un membre sous le nom d'un type de
// récolte est l'enum, et tout le reste est une globale de l'hôte. Si un build
// renomme l'une ou l'autre table, les rôles se résolvent encore ; et si un build
// change ce que la fonction fait de ces tables, elle se met à rendre autre chose
// et le test d'accord échoue.
//
// `new Function` est employé ici volontairement : le sujet de l'item est
// d'exécuter le code du jeu, et l'exécuter dans le même processus que
// l'extraction est ce qui rend l'accord vérifiable. Le texte qui y entre vient
// du bundle que l'hôte a déjà téléchargé et déjà évalué par ailleurs.

/**
 * Compile la fonction de placement extraite.
 *
 * @param {{plants: object, harvestTypes: object, placement: object}} tables
 * @returns {(frame: object, species: string, part: string) => {offset: {x: number, y: number}, scaleFactor: number}}
 */
export function compilePlacement(tables) {
  const placement = tables.placement;
  if (!placement || typeof placement.source !== "string") {
    throw new Error("no extracted placement function to compile");
  }

  const plants = {};
  for (const [species, record] of Object.entries(tables.plants ?? {})) {
    const harvest = record.plant?.harvestType;
    plants[species] = {
      plant: { harvestType: harvest == null ? "" : (tables.harvestTypes?.[harvest] ?? harvest) },
    };
  }

  const bindingFor = (external) => {
    if (external.role === "plants") return plants;
    if (external.role === "harvestTypes") return tables.harvestTypes ?? {};
    if (external.role === "host") return globalThis[external.name];
    throw new Error(`the extractor could not resolve ${external.name}, so the function cannot be run`);
  };

  const names = placement.externals.map((external) => external.name);
  const values = placement.externals.map(bindingFor);
  const preamble = [...Object.values(placement.declarations), placement.source].join("\n");
  if (placement.name === null) {
    throw new Error("the extracted function is anonymous, so it cannot be returned by name");
  }

  const factory = new Function(...names, `${preamble}\nreturn ${placement.name};`);
  return factory(...values);
}
