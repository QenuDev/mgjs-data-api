// scripts/makeArtFixture.mjs
//
// Reconstruit le découpage d'art d'une capture de bundle (`mgafk-pi/json/
// bundle-<version>-0/`) sous `tests/fixtures/art/bundle-<version>/`, en copiant
// verbatim les déclarations dont les prédicats d'art ont besoin.
//
// La fixture est un **découpage**, jamais une réécriture : chaque tranche est
// copiée octet pour octet depuis le chunk. Un extracteur qui lit la fixture doit
// trouver les mêmes tables que sur le chunk entier — c'est ce que la fixture
// existe pour prouver hors ligne.
//
// Le découpage est **un déclarateur à la fois** : le bundle écrit
// `var J={...},mo={...};`, donc prendre « jusqu'au point-virgule » dupliquerait
// `mo` dans la fixture et ferait refuser l'extraction (deux candidats).
//
// **Deux versions, et pas une seule.** Le jeu a renommé un champ entre 1176 et
// 1192 (le lavage de récolte est passé de `filters` à `colorOverlay`), et une
// fixture unique laisse la suite verte contre une version que l'API ne sert
// plus. `LEGACY` et `CURRENT` ci-dessous décrivent les deux découpages ; en
// ajouter une troisième est le geste à faire le jour où le jeu bouge encore, et
// `tests/art-versions.test.js` est ce qui le rappelle.
//
// Chaque déclaration porte un `expect` : une sous-chaîne qui doit se trouver
// dans la tranche. C'est ce qui rend le repérage vérifiable plutôt que
// chanceux — un nom minifié d'une lettre apparaît partout.
//
// Usage :
//   node scripts/makeArtFixture.mjs <capture-dir> [sortie] [--check]
//
// `sortie` est le dossier des chunks coupés (défaut déduit de la version portée
// par la capture). `--check` écrit dans un dossier temporaire et compare au
// dossier commité, octet pour octet : c'est le mode qu'un contrôle emploie pour
// qu'une fixture périmée se voie au lieu de se croire.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * La capture de la version que la fixture décrit, et ses déclarations.
 *
 * `capture` est enregistré **relatif à la racine du dépôt** : une fixture
 * commitée ne doit pas porter le chemin d'une machine.
 */
const LEGACY = {
  gameVersion: "1176",
  capture: "mgafk-pi/json/bundle-1176-0",
  cuts: [
    {
      file: "quinoaPredictionAtoms-ptrrFeF6.js",
      declarations: [
        { name: "E", expect: "sprite/plant/Aloe", what: "sprite-name table" },
        { name: "U", expect: "baseChance", what: "mutation record table" },
        { name: "V", expect: "maxSizeMultiplier", what: "plant table" },
        // La table des œufs n'est pas lue par l'extraction d'art : elle est coupée
        // parce qu'elle porte `secondsToHatch`, la signature par laquelle
        // `fetchMainBundle` reconnaît le chunk de données. Sans elle, le
        // découpage ne serait pas un bundle que le résolveur du fork sait lire.
        { name: "ri", expect: "secondsToHatch", what: "eggs table (signature du chunk de données)" },
        // Ce sont des déclarateurs à valeur d'IIFE (`var …,B=function(e){…}({})`),
        // pas des déclarations de fonction : l'enum est construit puis renvoyé.
        { name: "B", expect: "e.Single", what: "harvest-type enum" },
        { name: "Pa", expect: "e.Patch", what: "harvest-type enum (with Patch)" },
      ],
    },
    {
      file: "LayoutMotionController-CwhDlPns.js",
      declarations: [
        { name: "J", expect: "isTallPlant", what: "the all-false display-flag default" },
        { name: "mo", expect: "isNarrowDisplay", what: "display-flag table" },
        { name: "jo", expect: "tallPlantFilters", what: "mutation art table" },
        { name: "Wo", expect: ".75", what: "scale cap" },
        { name: "qo", expect: "2", what: "tall-decal multiplier" },
        { name: "Ko", expect: "new Set(", what: "mutation over-set" },
        { name: "Uo", expect: "BurrosTail", what: "anchor table" },
        { name: "Ho", expect: "typeof e==", what: "per-part override picker", kind: "function" },
        { name: "Jo", expect: "qo", what: "the function that places mutation icons", kind: "function" },
        { name: "Go", expect: "scaleFactor", what: "the placement function", kind: "function" },
      ],
    },
  ],
};

/**
 * La version 1192, dont le lavage a déménagé.
 *
 * Trois chunks et non deux : la table des noms de sprite n'est plus dans le
 * chunk de données, elle est dans `BakedRoundedRect`, et le chunk d'art est
 * `resources` — `LayoutMotionController` n'existe plus. Rien ici n'est deviné :
 * les noms de chunk et de déclaration sont ceux de la capture, et les formes
 * sont celles que `looksLikeArtTables` / `looksLikeSpriteNames` reconnaissent.
 */
const CURRENT = {
  gameVersion: "1192",
  capture: "mgafk-pi/json/bundle-1192-0",
  cuts: [
    {
      file: "worldDepthSortKey-BXUHHrP0.js",
      declarations: [
        { name: "H", expect: "baseChance", what: "mutation record table" },
        // La fonction de placement de 1192 lit la table des plantes sous le nom
        // `k`, une liaison d'import (`k` vient de ce chunk, où la table est
        // écrite `I`). Le découpage écrit la valeur verbatim sous le nom que le
        // consommateur emploie, comme la fixture 1176 garde `V` : c'est une
        // liaison, jamais une valeur, et `CUTS.json` porte l'alias.
        {
          name: "I",
          expect: "maxSizeMultiplier",
          what: "plant table (liée sous `k` dans le chunk d'art)",
          alias: "k",
        },
        { name: "Rt", expect: "secondsToHatch", what: "eggs table (signature du chunk de données)" },
        // `F` et `Rn` sont les deux enums du chunk : `Single`/`Multiple` et
        // `Single`/`Multiple`/`Patch`. L'enum est coupée sous son nom réel ; le
        // prédicat accepte celle qui couvre les membres que la table des
        // plantes nomme.
        { name: "F", expect: "e.Single", what: "harvest-type enum" },
        { name: "Rn", expect: "e.Patch", what: "harvest-type enum (with Patch)" },
      ],
    },
    {
      file: "resources-D_3Zwcn-.js",
      declarations: [
        { name: "F", expect: "isTallPlant", what: "the all-false display-flag default" },
        { name: "I", expect: "isNarrowDisplay", what: "display-flag table" },
        { name: "xn", expect: "colorOverlay", what: "mutation art table" },
        { name: "En", expect: "En=.75", what: "scale cap" },
        { name: "kn", expect: "kn=2", what: "tall-decal multiplier" },
        { name: "On", expect: "new Set(", what: "mutation over-set" },
        { name: "Tn", expect: "BurrosTail", what: "anchor table" },
        { name: "wn", expect: "typeof e==", what: "per-part override picker", kind: "function" },
        { name: "An", expect: "zIndex=10", what: "the function that places mutation icons", kind: "function" },
        { name: "Dn", expect: "scaleFactor", what: "the placement function", kind: "function" },
      ],
    },
    {
      file: "BakedRoundedRect-lGFgQzh1.js",
      declarations: [{ name: "Nn", expect: "sprite/plant/Aloe", what: "sprite-name table" }],
    },
  ],
};

/** Les deux découpages que ce dépôt commit, dans l'ordre des versions. */
export const FIXTURES = [LEGACY, CURRENT];

const captureDir = process.argv[2];
if (!captureDir) {
  console.error("usage: node scripts/makeArtFixture.mjs <capture-dir> [output-dir] [--check]");
  process.exit(2);
}

const rest = process.argv.slice(3);
const check = rest.includes("--check");
const explicitOut = rest.find((argument) => argument !== "--check");

const gameVersion = /bundle-(\d+)-/.exec(captureDir)?.[1] ?? null;
if (gameVersion === null) {
  console.error(`la capture ${captureDir} ne porte pas sa version (\`bundle-<version>-<n>\`)`);
  process.exit(2);
}
const spec = FIXTURES.find((fixture) => fixture.gameVersion === gameVersion);
if (spec === undefined) {
  console.error(
    `aucun découpage n'est décrit pour ${gameVersion} : la version que l'API servirait n'est pas couverte par les fixtures`
  );
  process.exit(2);
}

const outDir = explicitOut ?? `tests/fixtures/art/bundle-${gameVersion}`;
/**
 * La capture : le dossier que la fixture nomme, et un chemin relatif à la racine
 * du dépôt pour la régénérer sans écrire le chemin d'une machine.
 *
 * La capture vit **hors** du dépôt (`mgafk-pi/json/…` à la racine de l'espace
 * de travail), donc le chemin enregistré est celui du dossier de capture tel
 * qu'on le nomme, pas un `../../` qui ne se lirait que d'ici.
 */
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const captureRoot = path.resolve(captureDir);
const source = path.relative(repoRoot, captureRoot).split(path.sep).join("/");
const captureName = spec.capture;

/** L'index du caractère qui referme le bloc ouvert à `start`, quotes sautées. */
function balanced(text, start, open, close) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  throw new Error(`unbalanced ${open} at ${start}`);
}

/** La fin de la valeur d'un déclarateur : la première `,` ou `;` de niveau 0. */
function valueEnd(text, start) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (depth === 0 && (ch === "," || ch === ";")) return i;
  }
  return text.length;
}

/**
 * Le seul intervalle d'un déclarateur `NAME=` (ou d'une fonction `function NAME(`)
 * dont la tranche contient `expect`.
 */
function spansFor(text, declaration) {
  const { name, expect, kind } = declaration;
  const found = [];
  if (kind === "function") {
    const pattern = new RegExp(`(?:^|[;}])(?:async\\s+)?function\\s+${name}\\s*\\(`, "g");
    for (const match of text.matchAll(pattern)) {
      const start = match.index + match[0].search(/function/);
      const bodyOpen = text.indexOf("{", text.indexOf("(", start));
      const end = balanced(text, bodyOpen, "{", "}") + 1;
      found.push({ start, end, slice: text.slice(start, end) });
    }
  } else {
    // Le déclarateur, quel que soit le mot-clé qui l'introduit : `var E={`,
    // `,mo={` après un autre déclarateur, ou `function B(e){` (traité plus haut).
    const pattern = new RegExp(`(?:^|[;{}(,])(var |let |const )?${name}\\s*=`, "g");
    for (const match of text.matchAll(pattern)) {
      const nameAt = match.index + match[0].search(new RegExp(`(var |let |const )?${name}\\s*=`));
      const keywordAt = match[0].search(/(var |let |const )/);
      const start = keywordAt === -1 ? nameAt : match.index + keywordAt;
      const valueStart = text.indexOf("=", nameAt) + 1;
      const end = valueEnd(text, valueStart);
      found.push({ start, end, slice: text.slice(start, end) });
    }
  }
  const matching = found.filter((span) => span.slice.includes(expect));
  if (matching.length !== 1) {
    throw new Error(
      `declaration ${name} (${declaration.what}): ${found.length} textual matches, ${matching.length} contain ${JSON.stringify(expect)}`
    );
  }
  return matching[0];
}

/**
 * La valeur verbatim d'une tranche et son décalage.
 *
 * Une tranche est soit un déclarateur entier (`var J={…}`), soit la queue d'une
 * chaîne (`mo={…}` après `var J={…},`). Dans les deux cas la valeur commence
 * juste après le `=` : c'est elle qui est copiée, et le mot-clé manquant est
 * rétabli autour d'elle.
 */
function initializerOf(slice, declaration) {
  const { name, kind } = declaration;
  // Une déclaration de fonction est écrite telle quelle : elle n'a pas de `=`.
  if (kind === "function") return { value: slice, offset: 0, prefix: "" };
  const match = new RegExp(`^(?:var |let |const )?${name}\\s*=`).exec(slice);
  if (match === null) throw new Error(`la tranche de ${name} ne commence pas par son déclarateur`);
  return { value: slice.slice(match[0].length), offset: match[0].length, prefix: /^(var|let|const)\s/.test(slice) ? "var " : "var " };
}

const banner = (file) => `// tests/fixtures/art/bundle-${gameVersion}/${file}
//
// Découpage verbatim de \`${file}\` (bundle **${gameVersion}**, capture
// \`${captureName}/\`), régénérable par
// \`node scripts/makeArtFixture.mjs <capture-dir>\`. Chaque tranche est copiée
// octet pour octet ; intervalles et empreintes dans \`tests/fixtures/art/README.md\`.
//
// Ce fichier n'est pas le jeu complet : c'est ce que les prédicats d'art lisent.
// Deux choses sont rétablies autour des tranches, jamais dedans, pour que le
// découpage reste du JavaScript valide : le \`var \` d'un déclarateur qui était
// au milieu d'une chaîne (\`var J={…},mo={…}\`) et le \`;\` qui ferme
// l'instruction. La valeur, elle, est le texte du jeu, octet pour octet.

`;

/** Une entrée écrite dans la fixture : le nom sous lequel la valeur est liée, et la valeur verbatim. */
const entries = new Map();
const manifest = [];
for (const cut of spec.cuts) {
  const text = fs.readFileSync(path.join(captureRoot, cut.file), "utf8");
  for (const declaration of cut.declarations) {
    const span = spansFor(text, declaration);
    const initializer = initializerOf(span.slice, declaration);
    // Le nom que le consommateur emploie, quand ce n'est pas celui du chunk qui
    // déclare la valeur : une liaison, écrite verbatim sous l'autre nom. La
    // déclaration le porte, pas la version : deux déclarations du même chunk
    // peuvent porter le même nom minifié, et seule celle que le consommateur
    // emploie est liée.
    //
    // Le nom du chunk n'est **pas** écrit en plus : la même valeur sous deux
    // noms ferait deux candidats pour la table des plantes, et l'extraction
    // refuse deux candidats — ce qui est le bon comportement, et une raison de
    // plus pour que la fixture ne les produise pas.
    const alias = declaration.alias ?? null;
    const names = [
      {
        name: alias ?? declaration.name,
        initializer,
        span,
        what: alias === null ? declaration.what : `${declaration.what}, sous le nom que le consommateur emploie`,
        ...(alias === null ? {} : { aliasOf: declaration.name }),
      },
    ];
    if (!entries.has(cut.file)) entries.set(cut.file, []);
    for (const entry of names) {
      const record = {
        chunk: cut.file,
        declaration: entry.name,
        what: entry.what,
        start: entry.span.start,
        end: entry.span.end,
        bytes: entry.span.slice.length,
        sha256: createHash("sha256").update(entry.span.slice).digest("hex").slice(0, 16),
        // Où la valeur verbatim se trouve, dans le chunk puis dans la fixture :
        // la preuve lue dans une fixture se relit ainsi dans le chunk du jeu.
        initializerStart: entry.span.start + entry.initializer.offset,
        initializerEnd: entry.span.start + entry.span.slice.length,
        fixtureValueStart: null,
        fixtureValueEnd: null,
        ...(entry.aliasOf === undefined ? {} : { aliasOf: entry.aliasOf }),
      };
      entries.get(cut.file).push({ ...entry, declarationKind: declaration.kind ?? "value", record });
      manifest.push(record);
    }
  }
}

// Les offsets dans la fixture ne peuvent être calculés qu'en montant le corps :
// chaque entrée est écrite `<déclarateur>;` puis un saut de ligne, sous une
// bannière dont la longueur dépend du nom de chunk. Une déclaration de fonction
// garde sa forme ; une valeur est liée sous le nom que le consommateur emploie.
const files = new Map();
for (const [file, list] of entries) {
  const header = banner(file);
  let body = "";
  for (const entry of list) {
    const isFunction = entry.declarationKind === "function";
    const declaration = isFunction ? "" : `${entry.initializer.prefix}${entry.name}=`;
    entry.record.fixtureValueStart = header.length + body.length + (isFunction ? 0 : declaration.length);
    entry.record.fixtureValueEnd = entry.record.fixtureValueStart + entry.initializer.value.length;
    body += `${declaration}${entry.initializer.value};\n`;
  }
  files.set(file, header + body);
}

const cutsFile = `${JSON.stringify(
  {
    gameVersion,
    source,
    note:
      "`start`/`end` sont les intervalles du déclarateur dans le chunk du jeu, `initializerStart`/`initializerEnd` ceux de la valeur verbatim, et `fixtureValueStart`/`fixtureValueEnd` où cette même valeur se trouve dans le fichier écrit. `aliasOf` nomme la déclaration du chunk dont une entrée est une liaison.",
    cuts: manifest,
  },
  null,
  2
)}\n`;

const target = check ? fs.mkdtempSync(path.join(os.tmpdir(), "art-fixture-")) : outDir;
if (!check) fs.mkdirSync(outDir, { recursive: true });
for (const [file, text] of files) fs.writeFileSync(path.join(target, file), text);
fs.writeFileSync(path.join(target, "CUTS.json"), cutsFile);

if (check) {
  let differences = 0;
  const committed = fs.existsSync(outDir) ? fs.readdirSync(outDir).sort() : [];
  const written = [...files.keys(), "CUTS.json"].sort();
  for (const file of new Set([...committed, ...written])) {
    const left = path.join(outDir, file);
    const right = path.join(target, file);
    const same =
      fs.existsSync(left) && fs.existsSync(right) && fs.readFileSync(left, "utf8") === fs.readFileSync(right, "utf8");
    if (!same) {
      differences += 1;
      console.error(`  ${file}: ${fs.existsSync(left) ? "diffère" : "manque"} de la fixture commitée`);
    }
  }
  fs.rmSync(target, { recursive: true, force: true });
  if (differences > 0) {
    console.error(`la fixture ${outDir} n'est pas ce que ${source} découpe : ${differences} fichier(s) divergent`);
    process.exit(1);
  }
  console.log(`fixture ${outDir} à jour (${written.length} fichiers, ${source})`);
} else {
  const gameText = [...entries.values()]
    .flat()
    .reduce((total, entry) => total + entry.initializer.value.length, 0);
  console.log(`wrote ${outDir} (${gameText} bytes of game text)`);
  for (const entry of manifest) {
    console.log(
      `  ${entry.chunk} ${entry.declaration.padEnd(3)} [${entry.start},${entry.end}) ${String(entry.bytes).padStart(7)}B  ${entry.what}`
    );
  }
}
