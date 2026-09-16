// scripts/makeArtFixture.mjs
//
// Reconstruit `tests/fixtures/art/art-tables-1176.js` à partir de la capture du
// bundle 1176 (`mgafk-pi/json/bundle-1176-0/`), en découpant les déclarations
// verbatim dont les prédicats d'art ont besoin.
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
// Chaque déclaration porte un `expect` : une sous-chaîne qui doit se trouver
// dans la tranche. C'est ce qui rend le repérage vérifiable plutôt que
// chanceux — un nom minifié d'une lettre apparaît partout.
//
// Usage :
//   node scripts/makeArtFixture.mjs <capture-dir> [sortie]
//
// `sortie` est le dossier des chunks coupés (défaut
// `tests/fixtures/art/bundle-1176`).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const captureDir = process.argv[2];
if (!captureDir) {
  console.error("usage: node scripts/makeArtFixture.mjs <capture-dir> [output-dir]");
  process.exit(2);
}

/** Les déclarations à découper, par chunk. `expect` doit apparaître dans la tranche. */
const CUTS = [
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
];

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
 * Les intervalles d'un déclarateur `NAME=` (ou d'une fonction `function NAME(`),
 * avec `expect` vérifié.
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

const outDir = process.argv[3] ?? "tests/fixtures/art/bundle-1176";

const pieces = new Map();
const manifest = [];
for (const cut of CUTS) {
  const text = fs.readFileSync(path.join(captureDir, cut.file), "utf8");
  for (const declaration of cut.declarations) {
    const { start, end, slice } = spansFor(text, declaration);
    if (!pieces.has(cut.file)) pieces.set(cut.file, []);
    pieces.get(cut.file).push(slice);
    manifest.push({
      chunk: cut.file,
      declaration: declaration.name,
      what: declaration.what,
      start,
      end,
      bytes: slice.length,
      sha256: createHash("sha256").update(slice).digest("hex").slice(0, 16),
    });
  }
}

const banner = (file) => `// tests/fixtures/art/bundle-1176/${file}
//
// Découpage verbatim de \`${file}\` (bundle **1176**, capture
// \`mgafk-pi/json/bundle-1176-0/\`), régénérable par
// \`node scripts/makeArtFixture.mjs <capture-dir>\`. Chaque tranche est copiée
// octet pour octet ; intervalles et empreintes dans \`tests/fixtures/art/README.md\`.
//
// Ce fichier n'est pas le jeu complet : c'est ce que les prédicats d'art lisent.
// Deux choses sont rétablies autour des tranches, jamais dedans, pour que le
// découpage reste du JavaScript valide : le \`var \` d'un déclarateur qui était
// au milieu d'une chaîne (\`var J={…},mo={…}\`) et le \`;\` qui ferme
// l'instruction. La valeur, elle, est le texte du jeu, octet pour octet.

`;

fs.mkdirSync(outDir, { recursive: true });
for (const [file, slices] of pieces) {
  const body = slices
    .map((slice) => {
      if (/^(var|let|const)\s/.test(slice)) return `${slice};`;
      // Un déclarateur qui était au milieu d'une chaîne : c'est la valeur qui
      // est verbatim, le mot-clé manquant est rétabli.
      if (/^[A-Za-z_$][\w$]*\s*=/.test(slice)) return `var ${slice};`;
      return `${slice};`;
    })
    .join("\n");
  fs.writeFileSync(path.join(outDir, file), banner(file) + body + "\n");
}
fs.writeFileSync(
  path.join(outDir, "CUTS.json"),
  `${JSON.stringify({ gameVersion: "1176", source: captureDir, cuts: manifest }, null, 2)}\n`
);

console.log(`wrote ${outDir} (${[...pieces.values()].flat().join("").length} bytes of game text)`);
for (const entry of manifest) {
  console.log(
    `  ${entry.chunk} ${entry.declaration.padEnd(3)} [${entry.start},${entry.end}) ${String(entry.bytes).padStart(7)}B  ${entry.what}`
  );
}
