// src/core/game/art/predicates.js
//
// Les formes par lesquelles les tables d'art du jeu sont reconnues, et
// l'invariant que chacune porte.
//
// Un prédicat répond à une question — « qu'est-ce qui, dans ces chunks,
// ressemble à la table des ancres ? » — et il y répond avec **tous** les
// candidats qu'il a trouvés, chacun accompagné de ce qu'il a mesuré. Jamais par
// un booléen : « trouvé » est exactement la réponse qui pourrit en silence. Une
// table qui a perdu la moitié de ses clés, ou dont les feuilles ne sont plus des
// gabarits que ce lecteur projette, satisfait encore un test booléen et rend
// quand même une table — seulement pas une table de 109 drapeaux, et c'est le
// compte qui dit si la forme veut encore dire ce qu'elle disait.
//
// L'acceptation est une seconde question, et ce n'est pas « la forme a-t-elle
// été reconnue » non plus. Un candidat est accepté quand son invariant tient —
// chaque clé d'ancre est une espèce de la table des plantes, chaque clé de
// drapeau se résout en un chemin de sprite, l'ensemble des superposées est un
// sous-ensemble de la table d'art — et quand plusieurs candidats tiennent
// encore, l'extraction refuse au lieu d'en choisir un.
//
// Rien ici ne nomme un symbole minifié. Ce n'est pas une convention, c'est un
// test : `tests/art-tables.test.js` lit les noms que le découpage a retenus et
// les cherche dans cette source.

import {
  HOST_GLOBALS,
  asObject,
  asString,
  contains,
  declarationNamed,
  leafEntries,
  leafStrings,
  memberValue,
} from "./shapes.js";

/** Un chemin de sprite dans la forme d'identité du jeu : `sprite/<catégorie>/<Nom>`. */
const SPRITE_PATH = /^sprite\/[a-z0-9-]+\/[A-Za-z0-9_-]+$/;

/** Une couleur que les filtres du jeu peuvent état : le lavage d'une récolte n'est écrit que là. */
const COLOUR = /^(?:#|rgba?\(|hsla?\()/i;

/** Un drapeau d'affichage booléen : `isTallPlant`, `isNarrowDisplay`, et ce qu'un build suivant ajoutera. */
const DISPLAY_FLAG = /^is[A-Z]/;

/** Les membres qu'une entrée d'ancre peut employer. Une table de fractions n'est pas cette table. */
const ANCHOR_KEYS = new Set(["x", "y", "scale", "plant", "crop"]);

/** Les membres de la table d'art d'une mutation que cet extracteur lit. */
const ART_FIELDS = /sprite|icon|overlay|filters|ground/i;

/** La plus petite table de noms de sprite qui mérite ce nom. Le build capturé en a 583. */
const MIN_SPRITE_PATHS = 100;

/** La plus petite table keyée qui mérite ce nom, pour les tables dont la forme seule n'est pas spécifique. */
const MIN_KEYS = 8;

/** `Category.Name` pour chaque feuille de la table des noms, pour résoudre une référence par sa queue. */
export function spriteIndexOf(names) {
  const index = new Map();
  for (const [category, members] of Object.entries(names)) {
    for (const [name, path] of Object.entries(members)) index.set(`${category}.${name}`, path);
  }
  return index;
}

/** Les membres qu'un enum de chaînes du chunk assigne, depuis les assignations `e.Single = 'Single'`. */
function enumAssignments(chunk, member) {
  return chunk.assignments
    .filter((assignment) => assignment.path.at(-1) === member)
    .map((assignment) => assignment.value)
    .filter((value) => asString(value) !== null);
}

/** Le chemin d'une référence : `null` dès qu'un accès calculé l'interrompt. */
function chainOf(value) {
  return value?.kind === "reference" && !value.computed ? value.path : null;
}

/** Résout une chaîne contre la table des noms par sa queue, ou `null` si rien ne correspond. */
function resolveSprite(path, index) {
  if (index === null || path.length === 0) return null;
  const direct = path.join(".");
  if (SPRITE_PATH.test(direct)) return direct;
  return index.get(path.slice(1).join(".")) ?? null;
}

/**
 * La première couleur littérale et le premier `alpha` d'une construction de filtre.
 *
 * Les instructions sont celles du jeu : le lavage vit dans les arguments du
 * filtre (`new Filter({color, alpha})`) et nulle part ailleurs, donc ce lecteur
 * lit les littéraux plutôt qu'une table de couleurs — la couleur d'interface
 * avec laquelle une mutation se dessine est une autre valeur que le lavage
 * traversé par sa récolte, et les couleurs publiées par l'API sont la première.
 */
function filterFacts(value) {
  const queue = [value];
  let color = null;
  let alpha = null;
  let seen = 0;
  while (queue.length > 0 && seen < 64) {
    seen += 1;
    const node = queue.shift();
    if (node === undefined) break;
    if (node.kind === "object") {
      for (const member of node.members) {
        if (member.key === "alpha" && alpha === null && member.value.kind === "number") {
          alpha = member.value.value;
        }
        if (color === null) {
          const string = asString(member.value);
          if (string !== null && COLOUR.test(string.text)) color = string.text;
        }
        queue.push(member.value);
      }
    } else if (node.kind === "call") queue.push(...node.args);
    else if (node.kind === "array") queue.push(...node.items);
  }
  return { color, alpha };
}

/** Vrai quand chaque membre d'une forme est un nombre, ou un objet de nombres. */
export function numericAnchor(value) {
  if (value.kind === "number") return true;
  const object = asObject(value);
  if (object === null) return false;
  return object.members.every((member) => numericAnchor(member.value));
}

/** La valeur d'ancre telle qu'elle se publie : un nombre, ou l'enregistrement par partie. */
function anchorValue(value) {
  if (value.kind === "number") return value.value;
  const record = {};
  for (const member of asObject(value)?.members ?? []) {
    if (member.value.kind === "number") record[member.key] = member.value.value;
    else if (asObject(member.value) !== null) record[member.key] = anchorValue(member.value);
  }
  return record;
}

/** Un bloc de plante : le sprite que le jeu état, résolu, et le membre de récolte qu'il nomme. */
function plantPart(value, index) {
  const object = asObject(value);
  const sprite = object === null ? null : memberValue(object, "sprite");
  const harvest = object === null ? null : memberValue(object, "harvestType");
  const chain = chainOf(sprite);
  const path = chain === null ? (asString(sprite)?.text ?? null) : resolveSprite(chain, index);
  const harvestMember =
    harvest === null
      ? null
      : harvest.kind === "reference"
        ? (harvest.path.at(-1) ?? null)
        : (asString(harvest)?.text ?? null);
  return { part: { sprite: path, harvestType: harvestMember }, resolved: path !== null, harvest: harvestMember };
}

const EMPTY_OBJECT = { kind: "object", name: null, members: [], start: 0, end: 0, text: "" };

/** Le texte d'une déclaration, tel qu'un corps de fonction pourrait la redéclarer. */
function declarationText(chunk, name) {
  const declaration = declarationNamed(chunk, name);
  if (declaration === null) return null;
  if (declaration.kind === "function") return declaration.text;
  const value = chunk.text.slice(declaration.valueStart, declaration.valueEnd);
  return `const ${name} = ${value};`;
}

/** `null` pour un nombre qui n'en est pas un, pour qu'une note le dise au lieu d'écrire `NaN`. */
function trimOrNull(value) {
  return value === null || Number.isNaN(value) ? null : value;
}

// ---------------------------------------------------------------------------------------------
// Les prédicats
// ---------------------------------------------------------------------------------------------

/** La table des noms de sprite : `catégorie -> nom -> chemin`. */
const spriteNameTable = {
  id: "spriteNames",
  predicate: "sprite-name-table",
  looksFor:
    "un littéral d'objet d'au moins cent feuilles de la forme sprite/<catégorie>/<Nom>, en prenant la correspondance la plus externe pour qu'une catégorie imbriquée ne soit pas prise pour la table",
  invariant:
    "chaque feuille est un chemin de sprite, la table est large d'au moins deux catégories, et les feuilles sont comptées par la syntaxe dans laquelle elles sont écrites — un lecteur qui ne projette que les chaînes quotées rend une table vide plutôt qu'une table fausse",
  candidates(context) {
    const found = [];
    for (const chunk of context.chunks) {
      const matching = chunk.objects.filter(
        (object) => leafStrings(object).filter((leaf) => SPRITE_PATH.test(leaf.text)).length >= MIN_SPRITE_PATHS
      );
      const outermost = matching.filter(
        (candidate) => !matching.some((other) => other !== candidate && contains(other, candidate))
      );
      for (const object of outermost) {
        const names = {};
        let template = 0;
        let quoted = 0;
        let offShape = 0;
        for (const [path, leaf] of leafEntries(object)) {
          if (leaf.quote === "template") template += 1;
          else quoted += 1;
          if (!SPRITE_PATH.test(leaf.text) || path.length !== 2) {
            offShape += 1;
            continue;
          }
          const [category, name] = path;
          names[category] ??= {};
          names[category][name] = leaf.text;
        }
        found.push({
          id: "spriteNames",
          support: [],
          predicate: spriteNameTable.predicate,
          looksFor: spriteNameTable.looksFor,
          invariant: spriteNameTable.invariant,
          chunk: chunk.file,
          declaration: object.name,
          start: object.start,
          end: object.end,
          coverage: {
            counts: {
              categories: Object.keys(names).length,
              spritePaths: leafStrings(object).filter((leaf) => SPRITE_PATH.test(leaf.text)).length,
              templateLeaves: template,
              quotedLeaves: quoted,
              offShapeLeaves: offShape,
            },
            notes: [`catégories : ${Object.keys(names).sort().join(", ")}`],
          },
          value: names,
        });
      }
    }
    return found;
  },
  violations(candidate) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.spritePaths ?? 0) < MIN_SPRITE_PATHS) problems.push(`seulement ${counts.spritePaths ?? 0} chemins`);
    if ((counts.categories ?? 0) < 2) problems.push("moins de deux catégories");
    if ((counts.offShapeLeaves ?? 0) > 0) problems.push(`${counts.offShapeLeaves} feuilles hors forme`);
    if ((counts.templateLeaves ?? 0) === 0) {
      problems.push("aucune feuille en gabarit : le lecteur ne projette pas la syntaxe du jeu");
    }
    return problems;
  },
};

/** La table des mutations : nom, nom public, groupe, sprite. */
const mutationRecordTable = {
  id: "mutationRecords",
  predicate: "mutation-record-table",
  looksFor: "un littéral d'objet qui état un nom et un groupe pour chacun de ses membres",
  invariant:
    "chaque valeur état un nom et un groupe, les sprites qu'elles référencent se résolvent par la table des noms, et les membres sont comptés",
  candidates(context) {
    const found = [];
    for (const chunk of context.chunks) {
      for (const object of chunk.objects) {
        if (object.members.length < MIN_KEYS) continue;
        const records = {};
        let named = 0;
        let grouped = 0;
        let withSprite = 0;
        let resolved = 0;
        let unresolved = 0;
        const groups = new Set();
        let shaped = true;
        for (const member of object.members) {
          const value = asObject(member.value);
          if (value === null) {
            shaped = false;
            break;
          }
          const name = asString(memberValue(value, "name"));
          const group = asString(memberValue(value, "group"));
          if (name === null || group === null) {
            shaped = false;
            break;
          }
          named += 1;
          grouped += 1;
          groups.add(group.text);
          const sprite = memberValue(value, "sprite");
          let path = null;
          if (sprite !== null) {
            withSprite += 1;
            path = resolveSprite(chainOf(sprite) ?? [], context.spriteIndex);
            if (path === null) unresolved += 1;
            else resolved += 1;
          }
          records[member.key] = { name: name.text, group: group.text, sprite: path };
        }
        if (!shaped || named < MIN_KEYS) continue;
        found.push({
          id: "mutationRecords",
          support: [],
          predicate: mutationRecordTable.predicate,
          looksFor: mutationRecordTable.looksFor,
          invariant: mutationRecordTable.invariant,
          chunk: chunk.file,
          declaration: object.name,
          start: object.start,
          end: object.end,
          coverage: {
            counts: {
              keys: object.members.length,
              valuesStatingAName: named,
              valuesStatingAGroup: grouped,
              valuesWithASprite: withSprite,
              spriteReferencesResolved: resolved,
              spriteReferencesUnresolved: unresolved,
              distinctGroups: groups.size,
            },
          },
          value: records,
        });
      }
    }
    return found;
  },
  violations(candidate) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.keys ?? 0) < MIN_KEYS) problems.push(`seulement ${counts.keys ?? 0} clés`);
    if ((counts.valuesStatingAGroup ?? 0) !== (counts.keys ?? -1)) {
      problems.push(`${counts.valuesStatingAGroup ?? 0} valeurs sur ${counts.keys ?? 0} état un groupe`);
    }
    if ((counts.valuesWithASprite ?? 0) < 3) problems.push("moins de trois valeurs état un sprite");
    if ((counts.spriteReferencesUnresolved ?? 0) > 0) {
      problems.push(`${counts.spriteReferencesUnresolved} références de sprite ne se résolvent pas`);
    }
    return problems;
  },
};

/** La table d'art des mutations : filtre, teinte ou matériau, et les sprites par état. */
const mutationArtTable = {
  id: "mutationArt",
  predicate: "mutation-art-table",
  looksFor:
    "un littéral d'objet d'au moins huit clés dont les valeurs portent des champs d'art (sprite, icon, overlay, filters, ground), dont au moins un filtre",
  invariant:
    "chaque clé est une mutation que ce bundle déclare, chaque filtre porteur d'une couleur état sa couleur et son alpha, chaque référence de sprite se résout par la table des noms, et les clés qui ne construisent aucun filtre coloré sont comptées comme des matériaux plutôt que perdues",
  candidates(context) {
    const found = [];
    const records = context.tables.mutationRecords ?? {};
    for (const chunk of context.chunks) {
      for (const object of chunk.objects) {
        if (object.members.length < MIN_KEYS) continue;
        const fieldNames = new Set();
        let filters = 0;
        for (const member of object.members) {
          for (const inner of asObject(member.value)?.members ?? []) {
            fieldNames.add(inner.key);
            if (inner.key === "filters") filters += 1;
          }
        }
        const artFields = [...fieldNames].filter((field) => ART_FIELDS.test(field));
        if (filters === 0 || artFields.length < 2) continue;
        const art = {};
        let tinted = 0;
        let materials = 0;
        let unresolvedRefs = 0;
        let recordKeys = 0;
        for (const [order, member] of object.members.entries()) {
          const value = asObject(member.value) ?? EMPTY_OBJECT;
          const facts = memberValue(value, "filters");
          const wash = facts === null ? { color: null, alpha: null } : filterFacts(facts);
          const material = wash.color === null;
          if (material) materials += 1;
          else tinted += 1;
          if (records[member.key] !== undefined) recordKeys += 1;
          const resolveRef = (field) => {
            const reference = memberValue(value, field);
            if (reference === null) return null;
            const chain = chainOf(reference);
            if (chain === null) {
              const literal = asString(reference);
              if (literal !== null && SPRITE_PATH.test(literal.text)) return literal.text;
              unresolvedRefs += 1;
              return null;
            }
            // `R.Wet.sprite` est le sprite de la mutation elle-même, déjà résolu par son prédicat.
            if (chain.length === 3 && chain[2] === "sprite" && records[chain[1]] !== undefined) {
              return records[chain[1]].sprite ?? null;
            }
            const path = resolveSprite(chain, context.spriteIndex);
            if (path === null) unresolvedRefs += 1;
            return path;
          };
          const bottom = memberValue(value, "overlayFromBottom");
          art[member.key] = {
            order,
            tint: material ? null : { color: wash.color, alpha: wash.alpha },
            material,
            iconSprite: resolveRef("iconSprite"),
            groundSprite: resolveRef("tallPlantGroundSprite"),
            overlaySprite: resolveRef("overlaySprite"),
            overlayFromBottom: bottom !== null && bottom.kind === "boolean" && bottom.value,
          };
        }
        found.push({
          id: "mutationArt",
          support: [],
          predicate: mutationArtTable.predicate,
          looksFor: mutationArtTable.looksFor,
          invariant: mutationArtTable.invariant,
          chunk: chunk.file,
          declaration: object.name,
          start: object.start,
          end: object.end,
          coverage: {
            counts: {
              keys: object.members.length,
              valuesCarryingAFilter: filters,
              valuesWithATint: tinted,
              valuesThatAreMaterials: materials,
              keysThatAreMutationRecords: recordKeys,
              referencesUnresolved: unresolvedRefs,
            },
            notes: [`champs d'art vus : ${artFields.sort().join(", ")}`],
          },
          value: art,
        });
      }
    }
    return found;
  },
  violations(candidate) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.keys ?? 0) < MIN_KEYS) problems.push(`seulement ${counts.keys ?? 0} clés`);
    if ((counts.valuesWithATint ?? 0) === 0) problems.push("aucune valeur ne porte de filtre coloré");
    if ((counts.keysThatAreMutationRecords ?? 0) !== (counts.keys ?? -1)) {
      problems.push(
        `${counts.keysThatAreMutationRecords ?? 0} clés sur ${counts.keys ?? 0} sont des mutations déclarées, donc ce n'est pas la table d'art`
      );
    }
    for (const [name, art] of Object.entries(candidate.value)) {
      if (art.tint !== null && art.tint.alpha === null) problems.push(`${name} état une couleur sans alpha`);
    }
    const unresolved = counts.referencesUnresolved ?? 0;
    if (unresolved > 0) problems.push(`${unresolved} références de sprite ne se résolvent pas`);
    return problems;
  },
};

/** La table des drapeaux d'affichage, keyée par le sprite dont elle parle. */
const displayFlagTable = {
  id: "displayFlags",
  predicate: "display-flag-table",
  looksFor:
    "un littéral d'objet d'au moins huit clés dont les valeurs sont des drapeaux booléens (`is*`), directement ou par une déclaration locale qui porte le défaut tout-faux",
  invariant:
    "chaque clé se résout par la table des noms en un chemin de sprite, au moins une clé état un drapeau vrai, et l'enregistrement par défaut est identifié par le nombre de clés qui le visent, jamais par un nom",
  candidates(context) {
    const found = [];
    for (const chunk of context.chunks) {
      for (const object of chunk.objects) {
        if (object.members.length < MIN_KEYS) continue;
        const inlineObjects = new Map();
        const refCounts = new Map();
        let flagsNamed = 0;
        let inline = 0;
        let shaped = true;
        for (const member of object.members) {
          const direct = asObject(member.value);
          const referenced =
            direct ??
            asObject(
              declarationNamed(chunk, member.value.kind === "reference" ? (member.value.path[0] ?? "") : "")?.value ??
                null
            );
          if (referenced === null) {
            shaped = false;
            break;
          }
          const flags = referenced.members.filter((inner) => DISPLAY_FLAG.test(inner.key));
          if (flags.length === 0) {
            shaped = false;
            break;
          }
          for (const flag of flags) if (flag.value.kind !== "boolean") shaped = false;
          if (!shaped) break;
          flagsNamed += flags.length;
          if (direct !== null) inline += 1;
          else {
            const name = member.value.kind === "reference" ? (member.value.path[0] ?? "") : "";
            refCounts.set(name, (refCounts.get(name) ?? 0) + 1);
            inlineObjects.set(name, referenced);
          }
        }
        if (!shaped || flagsNamed === 0) continue;

        // L'enregistrement que le plus de clés visent est le défaut : un objet,
        // beaucoup de clés, tous les drapeaux faux.
        const byReferences = [...refCounts.entries()].sort((left, right) => right[1] - left[1]);
        const defaultName = byReferences[0]?.[0] ?? null;
        const defaultRecord = defaultName === null ? null : (inlineObjects.get(defaultName) ?? null);

        const flags = {};
        let tall = 0;
        let narrow = 0;
        let resolved = 0;
        let unresolved = 0;
        for (const member of object.members) {
          const value = asObject(member.value);
          const record = value ?? (member.value.kind === "reference" ? defaultRecord : null);
          const read = (flag) => {
            const own = record === null ? null : memberValue(record, flag);
            if (own !== null && own.kind === "boolean") return own.value;
            const fallback = defaultRecord === null ? null : memberValue(defaultRecord, flag);
            return fallback !== null && fallback.kind === "boolean" ? fallback.value : false;
          };
          const chain =
            member.value.kind === "reference" && !member.computed
              ? member.value.path
              : member.computed
                ? member.key.split(".")
                : null;
          const path =
            chain === null
              ? SPRITE_PATH.test(member.key)
                ? member.key
                : resolveSprite([member.key], context.spriteIndex)
              : resolveSprite(chain, context.spriteIndex);
          if (path === null) {
            unresolved += 1;
            continue;
          }
          resolved += 1;
          if (read("isTallPlant")) tall += 1;
          if (read("isNarrowDisplay")) narrow += 1;
          flags[path] = { isTallPlant: read("isTallPlant"), isNarrowDisplay: read("isNarrowDisplay") };
        }
        found.push({
          id: "displayFlags",
          support: defaultName === null ? [] : [defaultName],
          predicate: displayFlagTable.predicate,
          looksFor: displayFlagTable.looksFor,
          invariant: displayFlagTable.invariant,
          chunk: chunk.file,
          declaration: object.name,
          start: object.start,
          end: object.end,
          coverage: {
            counts: {
              keys: object.members.length,
              keysWithInlineFlags: inline,
              flagsStated: flagsNamed,
              keysResolvedThroughTheNameTable: resolved,
              keysUnresolved: unresolved,
              isTallPlantTrue: tall,
              isNarrowDisplayTrue: narrow,
              defaultReferences: byReferences[0]?.[1] ?? 0,
            },
            notes: [
              defaultName === null
                ? "aucun enregistrement partagé : chaque clé état ses propres drapeaux"
                : `l'enregistrement par défaut est la déclaration que ${byReferences[0]?.[1] ?? 0} clés visent`,
            ],
          },
          value: flags,
        });
      }
    }
    return found;
  },
  violations(candidate) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.keys ?? 0) < MIN_KEYS) problems.push(`seulement ${counts.keys ?? 0} clés`);
    if ((counts.keysUnresolved ?? 0) > 0) problems.push(`${counts.keysUnresolved} clés ne se résolvent pas en un chemin de sprite`);
    if ((counts.isTallPlantTrue ?? 0) === 0) problems.push("aucune clé n'état isTallPlant");
    if ((counts.keysResolvedThroughTheNameTable ?? 0) < MIN_KEYS) {
      problems.push(`seulement ${counts.keysResolvedThroughTheNameTable ?? 0} clés se résolvent`);
    }
    return problems;
  },
};

/** La table des plantes : le sprite et le type de récolte de chaque partie de chaque espèce. */
const plantTable = {
  id: "plants",
  predicate: "plant-table",
  looksFor: "un littéral d'objet d'au moins cinq clés dont les valeurs état un bloc de plante portant un type de récolte et une référence de sprite",
  invariant:
    "chaque espèce état un bloc de plante, chaque référence de sprite de chaque partie se résout par la table des noms, et les types de récolte nommés sont comptés pour qu'un enum renommé se voie",
  candidates(context) {
    const found = [];
    for (const chunk of context.chunks) {
      for (const object of chunk.objects) {
        if (object.members.length < 5) continue;
        const harvests = new Set();
        let planted = 0;
        let parts = 0;
        let resolved = 0;
        let unresolved = 0;
        const plants = {};
        let shaped = true;
        for (const member of object.members) {
          const value = asObject(member.value);
          const plant = value === null ? null : asObject(memberValue(value, "plant"));
          if (value === null || plant === null || memberValue(plant, "harvestType") === null) {
            shaped = false;
            break;
          }
          planted += 1;
          const record = { seed: null, plant: null, crop: null };
          for (const part of ["seed", "plant", "crop"]) {
            const block = memberValue(value, part);
            if (block === null) continue;
            const read = plantPart(block, context.spriteIndex);
            record[part] = read.part;
            parts += 1;
            if (read.resolved) resolved += 1;
            else unresolved += 1;
            if (read.harvest !== null) harvests.add(read.harvest);
          }
          plants[member.key] = record;
        }
        if (!shaped || planted < 5) continue;
        found.push({
          id: "plants",
          support: [],
          predicate: plantTable.predicate,
          looksFor: plantTable.looksFor,
          invariant: plantTable.invariant,
          chunk: chunk.file,
          declaration: object.name,
          start: object.start,
          end: object.end,
          coverage: {
            counts: {
              species: planted,
              parts,
              spriteReferencesResolved: resolved,
              spriteReferencesUnresolved: unresolved,
              distinctHarvestTypes: harvests.size,
            },
            notes: [`types de récolte nommés : ${[...harvests].sort().join(", ")}`],
          },
          value: plants,
        });
      }
    }
    return found;
  },
  violations(candidate) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.species ?? 0) < 5) problems.push(`seulement ${counts.species ?? 0} espèces`);
    if ((counts.spriteReferencesUnresolved ?? 0) > 0) {
      problems.push(`${counts.spriteReferencesUnresolved} références de sprite ne se résolvent pas`);
    }
    if ((counts.distinctHarvestTypes ?? 0) === 0) problems.push("aucune espèce n'état de type de récolte");
    return problems;
  },
};

/** L'enum des types de récolte, construite par une fonction qui remplit l'objet qu'elle rend. */
const harvestTypeEnum = {
  id: "harvestTypes",
  predicate: "harvest-type-enum",
  looksFor:
    "l'idiome d'enum du chunk : des assignations de la forme `e.Single = 'Single'`, lues sur tout le chunk parce que l'enum est construite par une fonction qui rend l'objet qu'elle remplit",
  invariant:
    "chaque membre que la table des plantes nomme est assigné exactement un littéral de chaîne, pour que la fonction de placement s'exécute avec l'enum du jeu plutôt qu'avec des chaînes devinées",
  candidates(context) {
    const requested = new Set();
    for (const record of Object.values(context.tables.plants ?? {})) {
      for (const part of [record.plant, record.seed, record.crop]) {
        if (part?.harvestType != null) requested.add(part.harvestType);
      }
    }
    const found = [];
    for (const chunk of context.chunks) {
      const members = {};
      let assigned = 0;
      let conflicting = 0;
      const spans = [];
      for (const member of [...requested].sort()) {
        const values = enumAssignments(chunk, member);
        if (values.length === 0) continue;
        assigned += 1;
        const literals = new Set(values.map((value) => asString(value)?.text ?? ""));
        if (literals.size > 1) conflicting += 1;
        members[member] = [...literals][0] ?? "";
      }
      for (const assignment of chunk.assignments) {
        if (requested.has(assignment.path.at(-1) ?? "")) {
          spans.push({ start: assignment.start, end: assignment.end });
        }
      }
      if (assigned === 0 && requested.size > 0) continue;
      // Les déclarations dans lesquelles les assignations sont écrites : une
      // fixture coupée du bundle doit les garder.
      const support = [
        ...new Set(
          chunk.declarations
            .filter((declaration) => spans.some((span) => declaration.start <= span.start && declaration.end >= span.end))
            .map((declaration) => declaration.name)
        ),
      ].sort();
      found.push({
        id: "harvestTypes",
        support,
        predicate: harvestTypeEnum.predicate,
        looksFor: harvestTypeEnum.looksFor,
        invariant: harvestTypeEnum.invariant,
        chunk: chunk.file,
        declaration: null,
        start: spans.length === 0 ? 0 : Math.min(...spans.map((span) => span.start)),
        end: spans.length === 0 ? 0 : Math.max(...spans.map((span) => span.end)),
        coverage: {
          counts: {
            membersRequestedByThePlantTable: requested.size,
            membersAssignedInThisChunk: assigned,
            membersWithConflictingLiterals: conflicting,
          },
          notes:
            requested.size === 0
              ? ["la table des plantes état les types de récolte en littéraux : il n'y a pas d'enum à lire"]
              : [],
        },
        value: members,
      });
    }
    return found;
  },
  violations(candidate) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.membersAssignedInThisChunk ?? 0) < (counts.membersRequestedByThePlantTable ?? 0)) {
      problems.push(
        `${counts.membersAssignedInThisChunk ?? 0} membres sur ${counts.membersRequestedByThePlantTable ?? 0} sont assignés`
      );
    }
    if ((counts.membersWithConflictingLiterals ?? 0) > 0) {
      problems.push(`${counts.membersWithConflictingLiterals} membres ont deux littéraux différents`);
    }
    return problems;
  },
};

/** Les ancres de mutation : par espèce, la fraction du centre et les overrides par partie. */
export const anchorTable = {
  id: "anchors",
  predicate: "anchor-table",
  looksFor: "un littéral d'objet d'au moins huit clés dont les valeurs sont des nombres, ou des objets de nombres sous les noms x, y, scale, plant et crop",
  invariant:
    "chaque clé est une espèce que la table des plantes état — une table de fractions keyée par centreXFraction partage cette forme et est refusée — et chaque valeur est une forme numérique, pas une expression",
  candidates(context) {
    const found = [];
    for (const chunk of context.chunks) {
      for (const object of chunk.objects) {
        if (object.members.length < MIN_KEYS) continue;
        if (!object.members.every((member) => numericAnchor(member.value))) continue;
        const anchors = {};
        let numeric = 0;
        let records = 0;
        let nested = 0;
        for (const member of object.members) {
          anchors[member.key] = anchorValue(member.value);
          if (member.value.kind === "number") numeric += 1;
          else {
            records += 1;
            if (asObject(member.value)?.members.some((inner) => asObject(inner.value) !== null)) nested += 1;
          }
        }
        const species = new Set(Object.keys(context.tables.plants ?? {}));
        const missing = Object.keys(anchors).filter((key) => !species.has(key));
        found.push({
          id: "anchors",
          support: [],
          predicate: anchorTable.predicate,
          looksFor: anchorTable.looksFor,
          invariant: anchorTable.invariant,
          chunk: chunk.file,
          declaration: object.name,
          start: object.start,
          end: object.end,
          coverage: {
            counts: {
              keys: object.members.length,
              numericValues: numeric,
              recordValues: records,
              valuesWithPerPartNumbers: nested,
              keysThatAreSpecies: Object.keys(anchors).length - missing.length,
              keysThatAreNotSpecies: missing.length,
            },
            notes:
              missing.length === 0
                ? []
                : [`clés que la table des plantes ne déclare pas : ${missing.slice(0, 6).join(", ")}`],
          },
          value: anchors,
        });
      }
    }
    return found;
  },
  violations(candidate, context) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.keys ?? 0) < MIN_KEYS) problems.push(`seulement ${counts.keys ?? 0} clés`);
    // Le témoin est exigé, pas toléré : sans la table des plantes, une clé d'ancre
    // n'est vérifiée par rien, et une table de fractions passerait pour la bonne.
    if (Object.keys(context.tables.plants ?? {}).length === 0) {
      problems.push("la table des plantes est absente : les clés d'ancre ne sont témoignées par rien");
    } else if ((counts.keysThatAreNotSpecies ?? 0) > 0) {
      problems.push(
        `${counts.keysThatAreNotSpecies ?? 0} clés ne sont pas des espèces de la table des plantes (${candidate.coverage.notes?.join("; ") ?? ""})`
      );
    }
    return problems;
  },
};

/** Le plafond d'échelle, sa tuile de référence, et le multiplicateur de décalque haut. */
export const scaleCap = {
  id: "scale",
  predicate: "scale-cap",
  looksFor:
    "la formule Math.min(<une constante déclarée>, <quelque chose> / <une tuile>), la constante étant un littéral fractionnaire, et le multiplicateur de décalque haut comme le conséquent d'un `<cond> ? <constante> : 1` dans le code qui lit la table d'art des mutations",
  invariant:
    "la formule apparaît exactement une fois dans le chunk qui déclare la constante, la constante est une fraction, le diviseur est la tuile de référence, et le multiplicateur de décalque haut est trouvé exactement une fois et vaut plus de un",
  candidates(context) {
    const found = [];
    const motionChunk = context.declarations.mutationArt ?? null;
    for (const chunk of context.chunks) {
      const occurrences = [
        ...chunk.text.matchAll(/Math\.min\(\s*([A-Za-z_$][\w$]*)\s*,\s*[^()]*?\/\s*(\d+)(?:\.\d+)?\s*\)/g),
      ];
      if (occurrences.length === 0) continue;
      for (const occurrence of occurrences) {
        const capName = occurrence[1] ?? "";
        const tile = occurrence[2] ?? "";
        const declaration = declarationNamed(chunk, capName);
        const cap = declaration?.value?.kind === "number" ? declaration.value.value : null;

        // Le multiplicateur de décalque haut : `(haut ? 2 : 1)` dans la fonction
        // qui place les icônes de mutation.
        const scoped = context.chunks.filter((candidate) =>
          motionChunk === null ? candidate === chunk : candidate.declarations.some((entry) => entry.name === motionChunk)
        );
        const tallCandidates = new Set();
        const tallFunctions = new Set();
        for (const scope of scoped) {
          for (const fn of scope.functions) {
            if (motionChunk !== null && !fn.text.includes(motionChunk)) continue;
            for (const match of fn.text.matchAll(/([A-Za-z_$][\w$]*)\s*\?\s*([A-Za-z_$][\w$]*)\s*:\s*1\b/g)) {
              const multiplier = match[2] ?? "";
              const declared = declarationNamed(scope, multiplier);
              if (declared?.value?.kind === "number" && declared.value.value > 1) {
                tallCandidates.add(multiplier);
                if (fn.name !== null) tallFunctions.add(fn.name);
              }
            }
          }
        }
        const multiplier = [...tallCandidates][0] ?? "";
        const multiplierDeclaration = declarationNamed(chunk, multiplier);
        const tallDecalMultiplier =
          multiplierDeclaration?.value?.kind === "number" ? multiplierDeclaration.value.value : null;

        found.push({
          id: "scale",
          support: [...new Set([multiplier, ...tallFunctions].filter((name) => name !== ""))].sort(),
          predicate: scaleCap.predicate,
          looksFor: scaleCap.looksFor,
          invariant: scaleCap.invariant,
          chunk: chunk.file,
          declaration: capName,
          start: declaration?.valueStart ?? 0,
          end: declaration?.valueEnd ?? 0,
          coverage: {
            counts: {
              // Les deux comptes portent sur le texte de la table acceptée, jamais
              // sur la taille du chunk fouillé : la preuve doit être identique que
              // la formule vienne du chunk du jeu ou de la fixture qui le remplace.
              capFormulaOccurrences: occurrences.length,
              capConstantDeclared: declaration === null ? 0 : 1,
              tallDecalCandidates: tallCandidates.size,
            },
            notes: [
              `formule telle qu'écrite : ${occurrence[0]}`,
              cap === null ? "le premier argument n'est pas une constante numérique déclarée" : `constante du plafond : ${cap}`,
              trimOrNull(tallDecalMultiplier) === null
                ? "aucun multiplicateur de décalque haut trouvé"
                : `multiplicateur de décalque haut : ${tallDecalMultiplier}`,
            ],
          },
          value: {
            cap: cap ?? Number.NaN,
            referenceTilePx: Number(tile),
            tallDecalMultiplier: tallDecalMultiplier ?? Number.NaN,
          },
        });
      }
    }
    return found;
  },
  violations(candidate) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.capFormulaOccurrences ?? 0) !== 1) {
      problems.push(`la formule du plafond apparaît ${counts.capFormulaOccurrences ?? 0} fois dans le chunk`);
    }
    if ((counts.capConstantDeclared ?? 0) !== 1) problems.push("la constante du plafond n'est pas un littéral numérique déclaré");
    if (!(candidate.value.cap > 0 && candidate.value.cap <= 1)) {
      problems.push(`le plafond ${candidate.value.cap} n'est pas une fraction`);
    }
    if (!(candidate.value.referenceTilePx > 0)) problems.push("le diviseur n'est pas une taille de tuile");
    if ((counts.tallDecalCandidates ?? 0) !== 1) {
      problems.push(`${counts.tallDecalCandidates ?? 0} multiplicateurs de décalque haut trouvés, pas un`);
    }
    if (!(candidate.value.tallDecalMultiplier > 1)) {
      problems.push("le multiplicateur de décalque haut n'est pas plus grand que un");
    }
    return problems;
  },
};

/** L'ensemble des mutations superposées : celles que le jeu dessine au-dessus de la récolte. */
const mutationOverSet = {
  id: "overMutations",
  predicate: "mutation-over-set",
  looksFor:
    "un `new Set([...])` déclaré de littéraux de chaîne, lu dans une fonction qui lit aussi la table d'art des mutations, qui est l'ensemble que le jeu teste pour donner à une icône de mutation un z au-dessus de la récolte",
  invariant:
    "chaque membre est une clé de la table d'art et l'ensemble est employé à côté de cette table, donc un ensemble d'autre chose est refusé",
  candidates(context) {
    const found = [];
    const art = context.tables.mutationArt ?? {};
    const artName = context.declarations.mutationArt ?? null;
    for (const chunk of context.chunks) {
      const usedBeside = chunk.functions.filter(
        (fn) => artName !== null && fn.text.includes(artName) && fn.text.includes(".has(")
      );
      const usedBesideTheTable = usedBeside.length > 0;
      for (const declaration of chunk.declarations) {
        const value = declaration.value;
        if (value === null || value.kind !== "call" || !value.construct) continue;
        if (!/(^|\.)Set$/.test(value.callee)) continue;
        const items = value.args[0];
        if (items === undefined || items.kind !== "array" || items.items.length === 0) continue;
        const members = items.items.map((item) => asString(item)?.text ?? "");
        if (members.some((member) => member === "")) continue;
        const matched = members.filter((member) => Object.hasOwn(art, member));
        found.push({
          id: "overMutations",
          support: [...new Set(usedBeside.map((fn) => fn.name).filter((name) => name !== null))].sort(),
          predicate: mutationOverSet.predicate,
          looksFor: mutationOverSet.looksFor,
          invariant: mutationOverSet.invariant,
          chunk: chunk.file,
          declaration: declaration.name,
          start: declaration.valueStart,
          end: declaration.valueEnd,
          coverage: {
            counts: {
              members: members.length,
              membersThatAreMutationArtKeys: matched.length,
              setUsedBesideTheMutationArtTable: usedBesideTheTable ? 1 : 0,
            },
            notes: [`membres : ${members.join(", ")}`],
          },
          value: members,
        });
      }
    }
    return found;
  },
  violations(candidate) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.members ?? 0) === 0) problems.push("l'ensemble est vide");
    if ((counts.membersThatAreMutationArtKeys ?? 0) !== (counts.members ?? -1)) {
      problems.push(`${counts.membersThatAreMutationArtKeys ?? 0} membres sur ${counts.members ?? 0} sont des clés de la table d'art`);
    }
    if ((counts.setUsedBesideTheMutationArtTable ?? 0) !== 1) {
      problems.push("l'ensemble n'est pas lu dans le code qui place les icônes de mutation");
    }
    return problems;
  },
};

/**
 * L'échelle de z des icônes de mutation.
 *
 * Le jeu n'écrit pas cette échelle dans une table : il écrit deux littéraux
 * `zIndex=` dans la fonction qui place les icônes, chacun gardé par un booléen
 * local. Ce prédicat lit ces littéraux, puis **le rôle de chaque garde** depuis
 * l'endroit où ce booléen a été lié : celui qui vient de la table des drapeaux
 * d'affichage est la bande des plantes hautes, celui qui vient de l'ensemble
 * des superposées est la bande du dessus. Deviner lequel est lequel en lisant
 * les nombres serait écrire une règle que le jeu n'état pas.
 */
const iconZIndex = {
  id: "zOrder",
  predicate: "mutation-icon-z-ladder",
  looksFor:
    "les littéraux `zIndex=<nombre>` écrits dans la fonction qui place les icônes de mutation, chacun gardé par un booléen local",
  invariant:
    "il y en a exactement deux, chaque garde se lie soit à la table des drapeaux d'affichage soit à l'ensemble des superposées, les deux rôles diffèrent, et les deux valeurs se séparent de part et d'autre de zéro",
  candidates(context) {
    const found = [];
    const artName = context.declarations.mutationArt ?? null;
    const overSetName = context.declarations.overMutations ?? null;
    const flagsName = context.declarations.displayFlags ?? null;
    if (artName === null || overSetName === null || flagsName === null) return found;
    for (const chunk of context.chunks) {
      const placers = chunk.functions.filter((fn) => fn.text.includes(artName) && fn.text.includes(`${overSetName}.`));
      for (const fn of placers) {
        // Le rôle d'un garde se lit là où il est lié, pas à son nom.
        const roleOf = new Map();
        for (const match of fn.text.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*${flagsName}\\[`, "g"))) {
          roleOf.set(match[1], "tallPlant");
        }
        for (const match of fn.text.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*${overSetName}\\.has\\(`, "g"))) {
          roleOf.set(match[1], "over");
        }
        const bands = {};
        let written = 0;
        let unresolvedGuards = 0;
        for (const match of fn.text.matchAll(
          /([A-Za-z_$][\w$]*)\s*&&\s*\(?\s*[A-Za-z_$][\w$]*\.zIndex\s*=\s*(-?\d+(?:\.\d+)?)/g
        )) {
          written += 1;
          const role = roleOf.get(match[1]);
          if (role === undefined) {
            unresolvedGuards += 1;
            continue;
          }
          bands[role] = Number(match[2]);
        }
        found.push({
          id: "zOrder",
          support: [fn.name].filter((name) => name !== null),
          predicate: iconZIndex.predicate,
          looksFor: iconZIndex.looksFor,
          invariant: iconZIndex.invariant,
          chunk: chunk.file,
          declaration: fn.name,
          start: fn.start,
          end: fn.end,
          coverage: {
            counts: {
              zIndexStatements: written,
              guardsResolved: Object.keys(bands).length,
              guardsUnresolved: unresolvedGuards,
            },
            notes: [
              `bandes : ${Object.entries(bands)
                .map(([role, value]) => `${role}=${value}`)
                .join(", ")}`,
              "la bande d'un membre qui n'écrit rien est l'ordre du conteneur, c'est-à-dire zéro",
            ],
          },
          value: {
            iconZIndex: {
              tallPlant: bands.tallPlant ?? Number.NaN,
              over: bands.over ?? Number.NaN,
              otherwise: 0,
            },
          },
        });
      }
    }
    return found;
  },
  violations(candidate) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.zIndexStatements ?? 0) !== 2) {
      problems.push(`${counts.zIndexStatements ?? 0} littéraux zIndex écrits, pas deux`);
    }
    if ((counts.guardsResolved ?? 0) !== 2) {
      problems.push(`${counts.guardsResolved ?? 0} gardes résolus en un rôle, pas deux`);
    }
    if ((counts.guardsUnresolved ?? 0) > 0) problems.push(`${counts.guardsUnresolved} gardes non résolus`);
    const ladder = candidate.value.iconZIndex;
    if (!(ladder.tallPlant < 0)) problems.push("la bande des plantes hautes n'est pas sous zéro");
    if (!(ladder.over > 0)) problems.push("la bande des superposées n'est pas au-dessus de zéro");
    if (ladder.tallPlant === ladder.over) problems.push("les deux bandes ont la même valeur");
    return problems;
  },
};

/** La fonction du jeu qui place l'art d'une mutation, extraite pour être exécutée. */
export const placementFunction = {
  id: "placement",
  predicate: "placement-function",
  looksFor:
    "une fonction qui divise par la tuile de référence et clôt sur la table des ancres et sur le plafond : toute autre fonction qui divise par la tuile est candidate, et c'est cette fermeture qui en accepte une",
  invariant:
    "exactement une fonction divise par la tuile et clôt sur les ancres et le plafond ; tout autre nom qu'elle lit est une globale de l'hôte ou une table que cet extracteur a trouvée, le rôle étant lu dans l'usage qu'elle en fait ; et elle rend un offset et un facteur d'échelle, qui est le nom que le jeu donne à un placement",
  candidates(context) {
    const found = [];
    const tile = context.tables.scale?.referenceTilePx;
    const anchors = context.declarations.anchors;
    const cap = context.declarations.scale;
    if (tile === undefined || !Number.isFinite(tile) || anchors === undefined || cap === undefined) return found;

    const harvestMembers = new Set();
    for (const record of Object.values(context.tables.plants ?? {})) {
      for (const part of [record.plant, record.seed, record.crop]) {
        if (part?.harvestType != null) harvestMembers.add(part.harvestType);
      }
    }

    for (const chunk of context.chunks) {
      const dividers = chunk.functions.filter((fn) => new RegExp(`/\\s*${tile}\\b`).test(fn.text));
      for (const fn of dividers) {
        if (!fn.free.includes(anchors) || !fn.free.includes(cap)) {
          // Une fonction qui divise par la tuile mais clôt sur autre chose est
          // signalée plutôt que perdue : « deux fonctions divisent par la tuile
          // et aucune ne clôt sur les ancres » est le message qu'il faut.
          found.push({
            id: "placement",
            support: [],
            predicate: placementFunction.predicate,
            looksFor: placementFunction.looksFor,
            invariant: placementFunction.invariant,
            chunk: chunk.file,
            declaration: fn.name,
            start: fn.start,
            end: fn.end,
            coverage: {
              counts: { functionsDividingByTheTile: dividers.length, closesOverTheAnchorsAndTheCap: 0 },
              notes: [`noms libres : ${fn.free.join(", ")}`],
            },
            value: { name: fn.name, source: fn.text, declarations: {}, externals: [], constants: {}, characters: 0 },
          });
          continue;
        }

        const declarations = {};
        const externals = [];
        const unresolved = [];
        for (const name of fn.free) {
          const text = declarationText(chunk, name);
          if (text !== null) {
            declarations[name] = text;
            continue;
          }
          if (HOST_GLOBALS.has(name)) {
            externals.push({ name, role: "host", from: null });
            continue;
          }
          const imported = chunk.imports.find((entry) => entry.local === name)?.from ?? null;
          // Le rôle se lit dans l'usage : une propriété lue sous le nom d'un
          // membre de récolte est l'enum, une table indexée par un paramètre de
          // la fonction est celle des plantes.
          const isEnum = [...harvestMembers].some((member) => fn.text.includes(`${name}.${member}`));
          const role = isEnum
            ? "harvestTypes"
            : fn.parameters.some((parameter) => fn.text.includes(`${name}[${parameter}]`))
              ? "plants"
              : "unresolved";
          if (role === "unresolved") unresolved.push(name);
          externals.push({ name, role, from: imported });
        }

        const constants = readPlacementConstants(fn.text);
        const characters = [...Object.values(declarations), fn.text].join("\n").length;
        found.push({
          id: "placement",
          support: Object.keys(declarations).sort(),
          predicate: placementFunction.predicate,
          looksFor: placementFunction.looksFor,
          invariant: placementFunction.invariant,
          chunk: chunk.file,
          declaration: fn.name,
          start: fn.start,
          end: fn.end,
          coverage: {
            counts: {
              closesOverTheAnchorsAndTheCap: 1,
              chunkLocalDeclarationsInTheClosure: Object.keys(declarations).length,
              externals: externals.length,
              unresolvedExternals: unresolved.length,
              returnsAnOffsetAndAScaleFactor:
                /offset\s*:/.test(fn.text) && /scaleFactor\s*:/.test(fn.text) ? 1 : 0,
              constantsFound: Object.values(constants).filter((value) => Number.isFinite(value)).length,
              characters,
            },
            notes: [
              `noms libres : ${fn.free.join(", ")}`,
              `externes : ${externals.map((external) => `${external.name}=${external.role}`).join(", ")}`,
              `constantes : ${JSON.stringify(constants)}`,
              unresolved.length === 0 ? "" : `non résolus : ${unresolved.join(", ")}`,
            ].filter((note) => note !== ""),
          },
          value: { name: fn.name, source: fn.text, declarations, externals, constants, characters },
        });
      }
    }
    return found;
  },
  violations(candidate) {
    const problems = [];
    const counts = candidate.coverage.counts;
    if ((counts.closesOverTheAnchorsAndTheCap ?? 0) !== 1) {
      problems.push("la fonction ne clôt pas sur la table des ancres et sur le plafond");
    }
    if ((counts.chunkLocalDeclarationsInTheClosure ?? 0) === 0) {
      problems.push("la fermeture ne porte aucune déclaration locale au chunk");
    }
    if ((counts.unresolvedExternals ?? 0) > 0) {
      problems.push(`noms non résolus : ${candidate.coverage.notes?.join("; ") ?? ""}`);
    }
    if ((counts.returnsAnOffsetAndAScaleFactor ?? 0) !== 1) {
      problems.push("la fonction ne rend pas un offset et un facteur d'échelle");
    }
    if ((counts.constantsFound ?? 0) !== 2) {
      problems.push(`${counts.constantsFound ?? 0} constantes lues dans la fonction, pas deux`);
    }
    return problems;
  },
};

/**
 * Les deux constantes que la fonction état elle-même, et qu'aucune table ne
 * porte.
 *
 * Le rapport d'aspect qui décide qu'une plante est haute, et la fraction d'ancre
 * par défaut quand une espèce n'état pas de `y`. Sans elles, la charge utile
 * décrirait le placement partout sauf sur les espèces sans override — c'est-à-
 * dire presque partout — et le test d'accord serait vide là où il compte.
 */
function readPlacementConstants(text) {
  const aspect = /([A-Za-z_$][\w$]*)\s*>\s*([A-Za-z_$][\w$]*)\s*\*\s*([\d.]+)/g;
  const ternary = /\?\s*([A-Za-z_$][\w$]*)\s*:\s*([\d.]+)\b/g;
  const aspects = [...text.matchAll(aspect)].map((match) => Number(match[3]));
  const fractions = [...text.matchAll(ternary)].map((match) => Number(match[2]));
  return {
    tallAspectRatio: aspects.length === 1 ? aspects[0] : Number.NaN,
    defaultAnchorYFraction: fractions.length === 1 ? fractions[0] : Number.NaN,
  };
}

/** Chaque prédicat, dans l'ordre où l'extraction les exécute : chaque étape lit les précédentes. */
export const PREDICATES = [
  spriteNameTable,
  mutationRecordTable,
  mutationArtTable,
  displayFlagTable,
  plantTable,
  harvestTypeEnum,
  anchorTable,
  scaleCap,
  mutationOverSet,
  iconZIndex,
  placementFunction,
];
