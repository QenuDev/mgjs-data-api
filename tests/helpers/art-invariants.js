// tests/helpers/art-invariants.js
//
// Les invariants des tables d'art, en fonctions pures, pour que la même
// vérification tourne sur le découpage figé (hors ligne) et sur le bundle que le
// jeu sert (voie `test:live`).
//
// Les contrôles ne comparent jamais une table à elle-même : une clé d'ancre est
// une espèce de la table des plantes, un chemin de sprite est une feuille de la
// table des noms, une mutation se résout en une teinte ou en un matériau, et la
// fonction de placement extraite s'exécute et doit rendre les nombres que les
// tables publiées impliquent.

import { compilePlacement } from "../../src/core/game/art/index.js";
import { syntheticFrame } from "./art-fixtures.js";

const SPRITE_PATH = /^sprite\/[a-z0-9-]+\/[A-Za-z0-9_-]+$/;

/**
 * L'arithmétique que les tables **publiées** impliquent.
 *
 * Chaque nombre vient du corps publié — `anchors`, `plants`, `harvestTypes`,
 * `scale`, `placement.constants` — et le membre d'enum qui décide de la branche
 * « récolte simple » est lu dans le texte publié de la fonction, jamais écrit
 * ici. C'est cette comparaison qui donne son sens à « la fonction extraite est
 * bien celle qui produit ces tables ».
 */
export function portedPlacement(tables, frame, species, part) {
  const harvest = tables.plants[species]?.plant?.harvestType ?? null;
  const anchor = tables.anchors[species];
  const pick = (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") return value;
    return typeof value[part] === "number" ? value[part] : undefined;
  };

  const width = frame.width;
  const height = frame.height;
  const originX = frame.defaultAnchor?.x ?? 0;
  const originY = frame.defaultAnchor?.y ?? 0;
  const ratio = frame.sourcePixelRatio > 0 ? frame.sourcePixelRatio : 1;

  const enumExternal = tables.placement.externals.find((external) => external.role === "harvestTypes");
  const singleMember =
    enumExternal === undefined
      ? null
      : new RegExp(`${enumExternal.name}\\.([A-Za-z_$][\\w$]*)`).exec(tables.placement.source)?.[1] ?? null;

  const left = pick(anchor?.x) ?? originX;
  const tall = height > width * tables.placement.constants.tallAspectRatio;
  const fallbackY =
    harvest !== null && singleMember !== null && harvest === singleMember && tall
      ? originY
      : tables.placement.constants.defaultAnchorYFraction;
  const top = pick(anchor?.y) ?? fallbackY;
  const scale = pick(anchor?.scale) ?? 1;

  return {
    offset: { x: (left - originX) * width, y: (top - originY) * height },
    scaleFactor:
      Math.min(tables.scale.cap, Math.min(width, height) / ratio / tables.scale.referenceTilePx) * scale,
  };
}

/** Ce qui, dans les tables, ne tient pas tout seul : les invariants sans témoin externe. */
export function structureFailures(tables) {
  const failures = [];

  const anchors = Object.keys(tables.anchors ?? {});
  const species = Object.keys(tables.plants ?? {});
  if (anchors.length === 0) failures.push("anchors: aucune ancre");
  if (species.length === 0) failures.push("plants: aucune espèce");
  for (const key of anchors) {
    if (!species.includes(key)) failures.push(`anchors: ${key} n'est pas une espèce`);
  }

  const namePaths = new Set(
    Object.values(tables.spriteNames ?? {}).flatMap((members) => Object.values(members))
  );
  const flags = Object.entries(tables.displayFlags ?? {});
  if (flags.length === 0) failures.push("displayFlags: aucun drapeau");
  let tall = 0;
  for (const [path, value] of flags) {
    if (!SPRITE_PATH.test(path)) failures.push(`displayFlags: ${path} n'est pas un chemin de sprite`);
    else if (!namePaths.has(path)) failures.push(`displayFlags: ${path} n'est pas dans la table des noms`);
    if (value.isTallPlant) tall += 1;
  }
  if (tall === 0) failures.push("displayFlags: aucun isTallPlant vrai");

  const records = Object.keys(tables.mutationRecords ?? {});
  const art = Object.entries(tables.mutationArt ?? {});
  if (art.length === 0) failures.push("mutationArt: aucune mutation");
  let tinted = 0;
  let materials = 0;
  const orders = new Set();
  for (const [name, value] of art) {
    if (!records.includes(name)) failures.push(`mutationArt: ${name} n'est pas une mutation déclarée`);
    if (value.material) {
      materials += 1;
      if (value.tint !== null) failures.push(`mutationArt: ${name} est un matériau avec une teinte`);
    } else {
      tinted += 1;
      if (value.tint === null || typeof value.tint.alpha !== "number") {
        failures.push(`mutationArt: ${name} n'a ni teinte complète ni matériau`);
      }
    }
    for (const field of ["iconSprite", "groundSprite", "overlaySprite"]) {
      const path = value[field];
      if (path === null || path === undefined) continue;
      if (!namePaths.has(path)) failures.push(`mutationArt: ${name}.${field} (${path}) n'est pas dans la table des noms`);
    }
    if (orders.has(value.order)) failures.push(`mutationArt: deux mutations à la position ${value.order}`);
    orders.add(value.order);
  }
  if (tinted === 0) failures.push("mutationArt: aucune teinte");
  if (materials === 0) failures.push("mutationArt: aucun matériau");

  for (const name of tables.overMutations ?? []) {
    if (!Object.hasOwn(tables.mutationArt ?? {}, name)) {
      failures.push(`overMutations: ${name} n'est pas une mutation de la table d'art`);
    }
  }
  if ((tables.overMutations ?? []).length === 0) failures.push("overMutations: ensemble vide");

  const scale = tables.scale ?? {};
  if (!(scale.cap > 0 && scale.cap <= 1)) failures.push(`scale: plafond hors (0,1] : ${scale.cap}`);
  if (!(scale.referenceTilePx > 0)) failures.push("scale: diviseur invraisemblable");
  if (!(scale.tallDecalMultiplier > 1)) failures.push("scale: multiplicateur haut invraisemblable");
  if (!Number.isFinite(scale.cap)) failures.push("scale: plafond non trouvé");
  if (!Number.isFinite(scale.tallDecalMultiplier)) failures.push("scale: multiplicateur haut non trouvé");

  const ladder = tables.zOrder?.iconZIndex;
  if (ladder === undefined) failures.push("zOrder: pas d'échelle de z");
  else {
    if (!(ladder.tallPlant < 0)) failures.push("zOrder: la bande des plantes hautes n'est pas sous zéro");
    if (!(ladder.over > 0)) failures.push("zOrder: la bande des superposées n'est pas au-dessus de zéro");
  }

  const placement = tables.placement ?? {};
  if (typeof placement.source !== "string" || placement.source.length === 0) {
    failures.push("placement: pas de texte de fonction");
  } else if (!placement.source.includes("scaleFactor")) {
    failures.push("placement: la fonction ne rend pas de facteur d'échelle");
  }
  if ((placement.externals ?? []).some((external) => external.role === "unresolved")) {
    failures.push("placement: des noms lus par la fonction ne sont pas résolus");
  }
  if (!Number.isFinite(placement.constants?.tallAspectRatio)) failures.push("placement: pas de rapport d'aspect");
  if (!Number.isFinite(placement.constants?.defaultAnchorYFraction)) {
    failures.push("placement: pas de fraction d'ancre par défaut");
  }

  const members = new Set();
  for (const record of Object.values(tables.plants ?? {})) {
    for (const part of ["seed", "plant", "crop"]) {
      const harvest = record[part]?.harvestType;
      if (harvest !== null && harvest !== undefined) members.add(harvest);
    }
  }
  for (const member of members) {
    if (!Object.hasOwn(tables.harvestTypes ?? {}, member)) {
      failures.push(`harvestTypes: ${member} n'est pas assigné par l'enum`);
    }
  }

  return failures;
}

/** La fonction extraite, exécutée, doit rendre ce que les tables publiées impliquent. */
export function placementFailures(tables) {
  const failures = [];
  let game;
  try {
    game = compilePlacement(tables);
  } catch (err) {
    return [`placement: la fonction extraite ne se compile pas (${err.message})`];
  }

  const frames = [
    syntheticFrame({ width: 128, height: 128, anchorX: 0.5, anchorY: 0.5 }),
    syntheticFrame({ width: 128, height: 192, anchorX: 0.5, anchorY: 0.7 }),
  ];

  for (const frame of frames) {
    for (const species of Object.keys(tables.plants ?? {})) {
      const mine = game(frame, species, "plant");
      const ported = portedPlacement(tables, frame, species, "plant");
      if (Math.abs(mine.offset.x - ported.offset.x) > 1e-9 || Math.abs(mine.offset.y - ported.offset.y) > 1e-9) {
        failures.push(
          `placement: ${species} offset (${mine.offset.x},${mine.offset.y}) contre (${ported.offset.x},${ported.offset.y})`
        );
      }
      if (Math.abs(mine.scaleFactor - ported.scaleFactor) > 1e-12) {
        failures.push(`placement: ${species} facteur ${mine.scaleFactor} contre ${ported.scaleFactor}`);
      }
    }
  }
  return failures;
}
