// tests/art-tables.test.js
//
// L'extraction des tables d'art du bundle, et les invariants qui la rendent
// vérifiable.
//
// Ce fichier ne compare jamais une table à elle-même : chaque contrôle a un
// **témoin** hors de la table. Les ancres sont témoignées par la table des
// plantes (une clé d'ancre qui n'est pas une espèce est refusée), les drapeaux
// et les sprites de mutation par les frames des atlas figés, les teintes par la
// construction de filtre qui les porte, et la fonction de placement par
// l'arithmétique que les tables publiées impliquent — exécutée, pas relue.
//
// Hors ligne : les tables viennent des découpages de `tests/fixtures/art/`,
// **toutes versions confondues** — une seule laissait la suite verte contre 1176
// pendant que l'API servait 1192 —, et les frames des atlas 1192 déjà figés.
// Aucun réseau.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ExtractionError,
  compilePlacement,
  extractArtTables,
  looksLikeArtTables,
  looksLikeSpriteNames,
  validateArtTables,
} from "../src/core/game/art/index.js";
import { projectChunk, tokenize } from "../src/core/game/art/shapes.js";
import { portedPlacement } from "./helpers/art-invariants.js";
import {
  artChunk,
  artChunks,
  artFixtureVersions,
  atlasFrames,
  dataChunk,
  fixtureCuts,
  syntheticFrame,
} from "./helpers/art-fixtures.js";

const SPRITE_PATH = /^sprite\/[a-z0-9-]+\/[A-Za-z0-9_-]+$/;

/** Les atlas ne dépendent pas de la version du découpage : ils sont figés à part. */
const FRAMES = atlasFrames();

/**
 * Toute la suite, pour **une** version de découpage.
 *
 * Rien ici ne nomme 1176 ni 1192 : le dossier de la fixture est la seule chose
 * qui change, et c'est ce qui fait qu'une version ajoutée à
 * `tests/fixtures/art/` est exercée sans toucher à ce fichier.
 */
function artTablesFor(version) {
  const chunks = artChunks(version);
  const ART = artChunk(version);
  const DATA = dataChunk(version);
  const extraction = extractArtTables({ chunks, gameVersion: version });
  const { tables, evidence } = extraction;

  /** Une variante du chunk d'art, avec les autres chunks inchangés. */
  function withArtChunk(text) {
    return [...chunks.filter((entry) => entry.file !== ART.file), { file: ART.file, text }];
  }

// ---------------------------------------------------------------------------------------------
// Le repérage du chunk : c'est le test que `fetchMainBundle` utilise pour choisir quoi télécharger
// ---------------------------------------------------------------------------------------------

test(`[${version}] le chunk qui porte les tables d'art est reconnu par sa forme, pas par son nom`, () => {
  assert.equal(
    looksLikeArtTables(ART.text),
    true,
    "le chunk d'art n'est pas reconnu par sa forme, donc le résolveur ne le téléchargerait pas"
  );
  assert.equal(
    looksLikeArtTables(DATA.text),
    false,
    "le chunk de données est pris pour le chunk d'art, donc le résolveur téléchargerait le mauvais"
  );
  assert.deepEqual(
    chunks.filter((entry) => looksLikeArtTables(entry.text)).map((entry) => entry.file),
    [ART.file],
    "le découpage ne contient pas exactement un porteur des tables d'art"
  );
});

// ---------------------------------------------------------------------------------------------
// Le repérage par forme, jamais par un nom minifié
// ---------------------------------------------------------------------------------------------

test(`[${version}] aucune table n'est trouvée par un nom minifié`, () => {
  // Les noms que le découpage a retenus sont ceux que le jeu écrit ; ils changent à chaque build,
  // donc les citer dans le code serait une panne programmée. Le test lit les noms dans la fixture
  // et cherche ces mots comme **identifiants** dans la source d'extraction : le tokeniseur du
  // projet est réutilisé pour cela, parce qu'une regex qui retire chaînes et commentaires se
  // trompe — `"E"` est un caractère comparé dans `scanNumber`, pas le symbole du jeu.
  const minified = new Set(
    artFixtureVersions().flatMap((version) => fixtureCuts(version).cuts.map((cut) => cut.declaration))
  );
  assert.ok(minified.size >= 10, `trop peu de déclarations coupées : ${minified.size}`);

  for (const file of [
    "src/core/game/art/shapes.js",
    "src/core/game/art/probe.js",
    "src/core/game/art/predicates.js",
    "src/core/game/art/extract.js",
    "src/core/game/art/placement.js",
    "src/core/game/art/validate.js",
    "src/core/game/art/index.js",
  ]) {
    const names = new Set(
      tokenize(readFileSync(file, "utf8"))
        .filter((token) => token.type === "name")
        .map((token) => token.value)
    );
    for (const name of minified) {
      assert.ok(!names.has(name), `${file} nomme ${name}, un symbole minifié du bundle`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Les tables et leurs invariants
// ---------------------------------------------------------------------------------------------

test(`[${version}] les ancres sont keyées par des espèces que la table des plantes porte`, () => {
  const species = new Set(Object.keys(tables.plants));
  const keys = Object.keys(tables.anchors);
  assert.ok(keys.length > 0, "aucune ancre extraite");
  for (const key of keys) {
    assert.ok(species.has(key), `l'ancre ${key} n'est pas une espèce de la table des plantes`);
  }
  const values = Object.values(tables.anchors);
  // Chaque valeur est un nombre, ou un enregistrement de nombres — et une version où *toutes* les
  // valeurs sont des nombres est légitime, donc le contrôle porte sur la forme et pas sur un
  // mélange attendu.
  const numeric = (value) =>
    typeof value === "number" ||
    (value !== null && typeof value === "object" && Object.values(value).every(numeric));
  assert.ok(values.every(numeric), "une valeur d'ancre n'est pas une forme numérique");
  assert.ok(
    values.some((value) => value !== null && typeof value === "object"),
    "aucune ancre n'est un enregistrement, donc la forme par partie n'est pas couverte"
  );
  assert.ok(
    values.some(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        Object.values(value).some((inner) => inner !== null && typeof inner === "object")
    ),
    "aucune ancre ne distingue ses parties : la forme par partie n'est jamais exercée"
  );
});

test(`[${version}] chaque drapeau d'affichage est une frame que les atlas ont`, () => {
  const keys = Object.keys(tables.displayFlags);
  assert.ok(keys.length > 0, "aucun drapeau extrait");
  const missing = keys.filter((key) => !(key in FRAMES));
  assert.deepEqual(missing, [], "des clés de drapeaux ne sont pas des frames d'atlas");

  let tall = 0;
  let narrow = 0;
  for (const [key, flags] of Object.entries(tables.displayFlags)) {
    assert.equal(typeof flags.isTallPlant, "boolean", `${key}: isTallPlant n'est pas un booléen`);
    assert.equal(typeof flags.isNarrowDisplay, "boolean", `${key}: isNarrowDisplay n'est pas un booléen`);
    if (flags.isTallPlant) tall += 1;
    if (flags.isNarrowDisplay) narrow += 1;
  }
  // Un tableau tout-faux passerait le test ci-dessus : les deux drapeaux doivent servir.
  assert.ok(tall > 0, "aucune plante haute");
  assert.ok(narrow > 0, "aucune plante étroite");
});

test(`[${version}] chaque mutation se résout en une teinte ou en un matériau, jamais en rien`, () => {
  const records = Object.keys(tables.mutationRecords);
  const keys = Object.keys(tables.mutationArt);
  assert.ok(keys.length > 0, "aucune mutation extraite");
  for (const key of keys) {
    assert.ok(records.includes(key), `${key} n'est pas une mutation que le jeu déclare`);
  }
  assert.deepEqual(
    [...keys].sort(),
    [...records].sort(),
    "la table d'art et la table des mutations ne couvrent pas les mêmes mutations"
  );

  let tinted = 0;
  let materials = 0;
  const orders = new Set();
  for (const [key, art] of Object.entries(tables.mutationArt)) {
    if (art.material) {
      materials += 1;
      assert.equal(art.tint, null, `${key}: un matériau ne peut pas porter de teinte`);
    } else {
      tinted += 1;
      assert.ok(art.tint, `${key}: ni teinte ni matériau`);
      assert.match(art.tint.color, /^(#|rgba?\(|hsla?\()/i, `${key}: la teinte n'est pas une couleur`);
      assert.equal(typeof art.tint.alpha, "number", `${key}: une couleur sans alpha`);
    }
    // L'échelle de z est la position dans la table du jeu : elle doit être unique et dense.
    assert.equal(typeof art.order, "number", `${key}: pas de position dans la table`);
    assert.ok(!orders.has(art.order), `${key}: deux mutations à la même position ${art.order}`);
    orders.add(art.order);

    for (const field of ["iconSprite", "groundSprite", "overlaySprite"]) {
      const path = art[field];
      if (path === null) continue;
      assert.match(path, SPRITE_PATH, `${key}.${field}: ${path} n'est pas un chemin de sprite`);
      assert.ok(path in FRAMES, `${key}.${field}: ${path} n'est pas une frame que les atlas ont`);
    }
  }
  // Les deux moitiés de la règle : un bundle où tout est matériau, ou tout est teinte, est un
  // bundle que ce test doit refuser plutôt que laisser passer.
  assert.ok(tinted > 0, "aucune mutation n'a de teinte de récolte");
  assert.ok(materials > 0, "aucune mutation n'est un matériau de shader");
  assert.equal(orders.size, keys.length, "les positions ne couvrent pas toutes les mutations");
  assert.equal(Math.min(...orders), 0, "l'échelle ne commence pas à zéro");
});

test(`[${version}] l'échelle est lue : la formule du plafond trouvée une fois, le multiplicateur haut dérivé`, () => {
  const counts = evidence.scale.coverage.counts;
  assert.equal(counts.capFormulaOccurrences, 1, "la formule du plafond n'est pas trouvée exactement une fois");
  assert.equal(counts.capConstantDeclared, 1, "le plafond n'est pas une constante déclarée");
  assert.equal(counts.tallDecalCandidates, 1, "le multiplicateur de décalque haut n'est pas unique");

  assert.ok(tables.scale.cap > 0 && tables.scale.cap <= 1, `plafond hors (0,1] : ${tables.scale.cap}`);
  assert.ok(tables.scale.referenceTilePx > 0, "le diviseur n'est pas une taille de tuile");
  assert.ok(tables.scale.tallDecalMultiplier > 1, "le multiplicateur haut n'agrandit rien");

  // La formule est citée par la preuve, pas recopiée ici : le diviseur publié est celui que la
  // note de couverture a lu dans la formule.
  const note = evidence.scale.coverage.notes.join(" ");
  assert.match(note, /Math\.min\(/, "la formule du plafond n'est pas citée dans la preuve");
  assert.match(
    note,
    new RegExp(`/\\s*${tables.scale.referenceTilePx}\\b`),
    "le diviseur de la preuve n'est pas la tuile publiée"
  );
});

test(`[${version}] l'ensemble des mutations superposées est un sous-ensemble des mutations déclarées`, () => {
  assert.ok(tables.overMutations.length > 0, "l'ensemble des superposées est vide");
  for (const name of tables.overMutations) {
    assert.ok(Object.hasOwn(tables.mutationArt, name), `${name} n'est pas une mutation de la table d'art`);
  }
  const counts = evidence.overMutations.coverage.counts;
  assert.equal(counts.setUsedBesideTheMutationArtTable, 1, "l'ensemble n'est pas lu à côté de la table d'art");
});

test(`[${version}] l'échelle de z est extraite du code qui place les mutations`, () => {
  const ladder = tables.zOrder.iconZIndex;
  for (const [band, value] of Object.entries(ladder)) {
    assert.equal(typeof value, "number", `la bande ${band} n'est pas un nombre`);
  }
  // Les bandes que le jeu écrit doivent différer : une échelle où tout vaut zéro ne décrit rien.
  const written = Object.entries(ladder).filter(([band]) => band !== "otherwise");
  assert.ok(written.length >= 2, "moins de deux bandes écrites par le jeu");
  assert.notEqual(written[0][1], written[1][1], "deux bandes écrites ont la même valeur");
  assert.ok(
    written.some(([, value]) => value > 0) && written.some(([, value]) => value < 0),
    "l'échelle ne sépare pas le dessus du dessous"
  );
});

test(`[${version}] la table des plantes porte les types de récolte que le placement lit`, () => {
  const members = new Set();
  for (const record of Object.values(tables.plants)) {
    for (const part of ["seed", "plant", "crop"]) {
      const harvest = record[part]?.harvestType;
      if (harvest !== null && harvest !== undefined) members.add(harvest);
    }
  }
  assert.ok(members.size > 0, "aucune plante ne nomme un type de récolte");
  for (const member of members) {
    assert.ok(Object.hasOwn(tables.harvestTypes, member), `${member} n'est pas assigné par l'enum du jeu`);
  }
  const counts = evidence.harvestTypes.coverage.counts;
  assert.ok(
    counts.membersAssignedInThisChunk >= counts.membersRequestedByThePlantTable,
    "moins de membres assignés que la table des plantes n'en demande"
  );
  assert.equal(counts.membersWithConflictingLiterals, 0, "deux littéraux pour un même membre");
});

// ---------------------------------------------------------------------------------------------
// La fonction de placement : extraite, et exécutée
// ---------------------------------------------------------------------------------------------

test(`[${version}] la fonction de placement est le texte du jeu, clos sur trois déclarations locales`, () => {
  const counts = evidence.placement.coverage.counts;
  assert.equal(counts.closesOverTheAnchorsAndTheCap, 1, "la fonction ne clôt pas sur les ancres et le plafond");
  assert.equal(counts.unresolvedExternals, 0, "des noms lus par la fonction ne sont pas résolus");
  assert.equal(counts.returnsAnOffsetAndAScaleFactor, 1, "la fonction ne rend pas un offset et un facteur d'échelle");
  assert.ok(counts.chunkLocalDeclarationsInTheClosure > 0, "la fermeture ne porte aucune déclaration locale");

  // Le texte extrait doit se retrouver **verbatim** dans le chunk : une fonction réécrite, ou
  // recollée depuis deux endroits, ne s'y retrouve pas.
  assert.ok(
    ART.text.includes(tables.placement.source),
    "le texte de la fonction n'est pas verbatim dans le chunk d'art"
  );
  assert.equal(
    tables.placement.characters,
    [...Object.values(tables.placement.declarations), tables.placement.source].join("\n").length,
    "le compte de caractères ne décrit pas ce qui est publié"
  );
  // Une borne, pas une valeur écrite : une forme qui tire la moitié du chunk avec elle échoue.
  assert.ok(
    tables.placement.characters > 0 && tables.placement.characters < 4000,
    `la fermeture a une taille invraisemblable : ${tables.placement.characters}`
  );

  assert.match(tables.placement.source, /offset\s*:/, "la fonction ne rend pas d'offset");
  // Le portage témoin lit le membre d'enum qui décide de la branche « récolte
  // simple » dans le texte de la fonction : si la fonction ne compare plus de
  // membre, l'accord ci-dessous ne serait plus mesuré sur la bonne branche.
  const enumExternal = tables.placement.externals.find((external) => external.role === "harvestTypes");
  assert.ok(enumExternal, "aucun externe de rôle harvestTypes");
  assert.match(
    tables.placement.source,
    new RegExp(`${enumExternal.name}\\.[A-Za-z_$][\\w$]*`),
    "la fonction ne compare aucun membre de l'enum de récolte"
  );
  assert.match(tables.placement.source, /scaleFactor\s*:/, "la fonction ne rend pas de facteur d'échelle");

  // Les rôles sont lus dans l'usage qu'en fait la fonction, jamais dans son nom.
  const roles = Object.fromEntries(
    tables.placement.externals.map((external) => [external.role, external.name])
  );
  assert.ok(roles.plants, "aucun externe n'est indexé par l'espèce : la table des plantes n'est pas résolue");
  assert.ok(roles.harvestTypes, "aucun externe n'est lu par un type de récolte : l'enum n'est pas résolu");
  assert.ok(
    tables.placement.externals.some((external) => external.role === "host"),
    "aucun global de l'hôte n'est reconnu"
  );
});

test(`[${version}] la fonction extraite s'accorde avec les nombres que les tables publiées impliquent`, () => {
  const game = compilePlacement(tables);
  // Deux frames : une large, une haute, pour que la branche « plante haute » soit exercée.
  const frames = [
    syntheticFrame({ width: 128, height: 128, anchorX: 0.5, anchorY: 0.5 }),
    syntheticFrame({ width: 128, height: 192, anchorX: 0.5, anchorY: 0.7 }),
  ];

  let compared = 0;
  let withAnOverride = 0;
  for (const frame of frames) {
    for (const species of Object.keys(tables.plants)) {
      const mine = game(frame, species, "plant");
      const ported = portedPlacement(tables, frame, species, "plant");
      if (tables.anchors[species] !== undefined) withAnOverride += 1;

      assert.ok(
        Math.abs(mine.offset.x - ported.offset.x) < 1e-9,
        `${species}: offset.x ${mine.offset.x} contre ${ported.offset.x}`
      );
      assert.ok(
        Math.abs(mine.offset.y - ported.offset.y) < 1e-9,
        `${species}: offset.y ${mine.offset.y} contre ${ported.offset.y}`
      );
      assert.ok(
        Math.abs(mine.scaleFactor - ported.scaleFactor) < 1e-12,
        `${species}: scaleFactor ${mine.scaleFactor} contre ${ported.scaleFactor}`
      );
      compared += 1;
    }
  }
  assert.ok(compared > 0, "aucune espèce comparée");
  assert.ok(withAnOverride > 0, "aucune espèce comparée ne porte d'ancre : la comparaison serait vide");
});

test(`[${version}] les overrides par espèce font un vrai travail dans cette comparaison`, () => {
  const game = compilePlacement(tables);
  const frame = syntheticFrame({ width: 128, height: 128, anchorX: 0.5, anchorY: 0.5 });

  // Une espèce qui état un override de `scale` ne peut pas rendre le même facteur qu'une espèce
  // qui n'en état aucun, sinon l'override serait perdu sans que rien ne le dise.
  const withScaleOverride = Object.entries(tables.anchors).find(
    ([, value]) => value && typeof value === "object" && typeof value.scale === "number"
  );
  assert.ok(withScaleOverride, "aucune ancre ne porte de `scale` : la branche n'est pas couverte");
  const [species, value] = withScaleOverride;

  const plain = game(frame, "Aloe", "plant");
  const overridden = game(frame, species, "plant");
  assert.ok(
    Math.abs(overridden.scaleFactor - plain.scaleFactor) > 1e-9,
    `l'override de ${species} ne change pas le facteur d'échelle`
  );
  assert.ok(
    Math.abs(overridden.scaleFactor - plain.scaleFactor * value.scale) < 1e-12,
    `le facteur de ${species} n'est pas le facteur commun multiplié par son override`
  );
});

test(`[${version}] le placement distingue la partie dessinée, pour une espèce qui la distingue`, () => {
  const game = compilePlacement(tables);
  const frame = syntheticFrame({ width: 128, height: 128, anchorX: 0.5, anchorY: 0.5 });
  const perPart = Object.entries(tables.anchors).find(([, value]) => {
    if (!value || typeof value !== "object") return false;
    return ["x", "y", "scale"].some(
      (axis) =>
        value[axis] &&
        typeof value[axis] === "object" &&
        typeof value[axis].crop === "number" &&
        typeof value[axis].plant === "number" &&
        value[axis].crop !== value[axis].plant
    );
  });
  assert.ok(perPart, "aucune ancre ne distingue `crop` de `plant` : la partie ne serait jamais lue");
  const [species] = perPart;

  const asPlant = game(frame, species, "plant");
  const asCrop = game(frame, species, "crop");
  assert.notDeepEqual(asPlant, asCrop, `${species}: la partie dessinée ne change rien au placement`);
});

// ---------------------------------------------------------------------------------------------
// La validation contre les atlas, et les refus
// ---------------------------------------------------------------------------------------------

test(`[${version}] la validation contre les atlas ne trouve aucun chemin orphelin`, () => {
  const failures = validateArtTables(tables, FRAMES);
  assert.deepEqual(failures, [], `chemins que les atlas n'ont pas : ${JSON.stringify(failures)}`);
});

test(`[${version}] un chemin de sprite que les atlas n'ont pas est refusé`, () => {
  const broken = {
    ...tables,
    displayFlags: {
      ...tables.displayFlags,
      "sprite/plant/NotAPlant": { isTallPlant: true, isNarrowDisplay: false },
    },
  };
  const failures = validateArtTables(broken, FRAMES);
  assert.equal(failures.length, 1, "un drapeau orphelin n'a pas été signalé");
  assert.equal(failures[0].table, "displayFlags");
  assert.ok(
    failures[0].saw.join(" ").includes("NotAPlant"),
    `le refus ne nomme pas le coupable : ${failures[0].saw.join(", ")}`
  );
});

test(`[${version}] une ancre keyée par autre chose qu'une espèce est refusée`, () => {
  // Le refus est la moitié utile d'une extraction par forme : une table de fractions qui partage
  // la forme des ancres doit être refusée, pas publiée.
  const art = ART.text.replace(
    "{Banana:{x:.6,y:.68}",
    "{Banana:{x:.6,y:.68},CentreXFraction:{x:.5,y:.5}"
  );
  assert.notEqual(art, ART.text, "la fixture n'a pas la forme attendue : le test ne coupe rien");
  assert.throws(
    () => extractArtTables({ chunks: withArtChunk(art) }),
    (err) => {
      assert.ok(err instanceof ExtractionError, `erreur inattendue : ${err?.name}`);
      assert.equal(err.predicate, "anchor-table");
      assert.match(err.message, /CentreXFraction/);
      return true;
    }
  );
});

test(`[${version}] un bundle sans le multiplicateur de décalque haut est refusé`, () => {
  const withoutTall = ART.text.replace(/\?\s*([A-Za-z_$][\w$]*)\s*:\s*1\b/, "?1:1");
  assert.notEqual(withoutTall, ART.text, "la fixture n'a pas la forme attendue : le test ne coupe rien");
  assert.throws(
    () => extractArtTables({ chunks: withArtChunk(withoutTall) }),
    (err) => {
      assert.ok(err instanceof ExtractionError, `erreur inattendue : ${err?.name}`);
      assert.equal(err.predicate, "scale-cap");
      return true;
    }
  );
});

test(`[${version}] un chunk de données absent fait refuser plutôt que publier des tables non témoignées`, () => {
  assert.throws(
    () => extractArtTables({ chunks: [{ file: ART.file, text: ART.text }] }),
    (err) => {
      assert.ok(err instanceof ExtractionError, `erreur inattendue : ${err?.name}`);
      return true;
    }
  );
});

test(`[${version}] un gabarit hostile ne fait pas tomber la projection, et ne fait pas passer un chunk`, () => {
  // Trouvé contre le bundle de la version servie : une expression régulière
  // contenant un guillemet (`/['"]/`) à l'intérieur d'une substitution de
  // gabarit ressemble à une chaîne qui ne se referme jamais. La projection
  // levait, et comme ces deux fonctions servent de test de cible au résolveur,
  // une exception ici laissait toutes les routes `/data/*` sans bundle. Elles
  // doivent donc répondre « ce n'est pas ce chunk », jamais tomber.
  const hostile = 'var a=`x${b.replace(/[\'"]/g,\'\')}y`;var c={k:1};';
  const chunk = projectChunk("hostile.js", hostile);
  assert.ok(
    chunk.declarations.some((declaration) => declaration.name === "c"),
    "la déclaration après le gabarit hostile n'a pas été lue"
  );
  assert.equal(looksLikeArtTables(hostile), false);
  assert.equal(looksLikeSpriteNames(hostile), false);
});
}

// ---------------------------------------------------------------------------------------------
// Toutes les versions dont le découpage est commité
// ---------------------------------------------------------------------------------------------

for (const version of artFixtureVersions()) artTablesFor(version);
