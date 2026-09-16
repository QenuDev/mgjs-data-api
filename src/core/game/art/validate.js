// src/core/game/art/validate.js
//
// La seconde moitié de « un prédicat propose, la validation dispose » :
// vérifier une table contre quelque chose hors d'elle-même.
//
// La forme seule ne suffit pas, et le plan dit pourquoi : les prédicats qui
// trouvent la table des drapeaux d'affichage ont aussi trouvé une table
// `isHidden` dans un autre chunk, et la forme des ancres a aussi reconnu une
// table de fractions d'animation. Ce qui les sépare, c'est que **l'atlas a les
// chemins de sprite** — donc chaque contrôle ici compare une table à un témoin
// au lieu de la comparer à elle-même.
//
// Le témoin est la liste des frames que cet hôte sert réellement : le manifeste
// d'atlas et ses atlas JSON. Un chemin qui n'y est pas est un chemin que le jeu
// ne dessine pas, donc une table qui a bougé.
//
// Un échec nomme la table et montre les coupables, parce qu'il est lu par
// quelqu'un qui regarde un changement de version : « 109 clés, dont 3 ne sont
// pas des frames de l'atlas : sprite/plant/X, … » mène quelque part, et
// « validation échouée » ne mène nulle part.

/** Combien de coupables un échec liste avant de dire « et N autres ». */
const LIST_LIMIT = 8;

function frameSet(atlas) {
  if (atlas instanceof Set) return atlas;
  if (Array.isArray(atlas)) return new Set(atlas);
  return new Set(Object.keys(atlas ?? {}));
}

function capped(offenders) {
  if (offenders.length <= LIST_LIMIT) return offenders;
  return [...offenders.slice(0, LIST_LIMIT), `et ${offenders.length - LIST_LIMIT} autres`];
}

/**
 * Contrôle les tables contre les frames de l'atlas.
 *
 * @param {object} tables - les tables extraites
 * @param {Iterable<string>|Record<string, unknown>} atlas - les frames que l'hôte sert
 * @returns {Array<{check: string, table: string, saw: string[], detail: string}>}
 */
export function validateArtTables(tables, atlas) {
  const frames = frameSet(atlas);
  const failures = [];

  const orphanPaths = (table, paths) => {
    const offenders = paths.filter((path) => path !== null && !frames.has(path));
    if (offenders.length > 0) {
      failures.push({
        check: `${table}: chaque chemin est une frame que l'atlas a`,
        table,
        saw: capped(offenders),
        detail: `${offenders.length} chemins de ${table} ne sont pas des frames de l'atlas`,
      });
    }
  };

  orphanPaths("displayFlags", Object.keys(tables.displayFlags ?? {}));

  const mutationPaths = [];
  for (const art of Object.values(tables.mutationArt ?? {})) {
    for (const field of ["iconSprite", "groundSprite", "overlaySprite"]) {
      if (art[field] !== null && art[field] !== undefined) mutationPaths.push(art[field]);
    }
  }
  orphanPaths("mutationArt", mutationPaths);

  const plantPaths = [];
  for (const record of Object.values(tables.plants ?? {})) {
    for (const part of ["seed", "plant", "crop"]) {
      const path = record[part]?.sprite;
      if (path !== null && path !== undefined) plantPaths.push(path);
    }
  }
  orphanPaths("plants", plantPaths);

  const spritePaths = Object.values(tables.spriteNames ?? {}).flatMap((members) => Object.values(members));
  orphanPaths("spriteNames", spritePaths);

  return failures;
}
