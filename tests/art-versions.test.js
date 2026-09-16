// tests/art-versions.test.js
//
// La version que l'API sert est-elle couverte par les tests ?
//
// C'est le trou par lequel `/data/art` a répondu 500 en production avec une
// suite verte : la fixture d'art était `bundle-1176/`, la suite la lisait, et le
// jeu servait **1192**. La forme que le prédicat cherchait n'existait plus dans
// le bundle servi, et rien dans `npm test` ne pouvait le dire, parce que la seule
// version lue hors ligne était justement celle qui portait encore l'ancienne
// forme.
//
// Ce fichier ferme le trou par le bas, sans réseau :
//
//   - **chaque** découpage commité sous `tests/fixtures/art/` est extrait, et
//     doit rendre ses tables. Le jour où le jeu renomme encore un champ, la
//     version vivante est celle qu'on re-coupe, et son extraction doit passer :
//     si elle ne passe pas, c'est ici que ça se voit ;
//   - la version 1192 — celle que l'API a servie — est comparée à 1176 table par
//     table : le jeu a changé une **orthographe** (le lavage de récolte est passé
//     de `filters: new X({color: 'rgb(50, 180, 200)', alpha: .25})` à
//     `colorOverlay: {color: 3323080, alpha: .25}`), pas une valeur. Les tables
//     extraites doivent donc être identiques, et la seule qui diffère est le
//     texte de la fonction de placement, que la minification réécrit à chaque
//     build ;
//   - les deux refus qui rendent la lecture sûre sont exercés : une table sans
//     champ de lavage du tout, et un lavage dont la couleur n'est pas un
//     `0xRRGGBB` que le jeu accepterait.
//
// Le décodage de l'entier n'est pas une lecture des nombres : c'est la règle du
// jeu, écrite dans le chunk qui construit ces lavages. Sa source, `xn()` :
//
//   if (...) throw new Error(`Material color overlays require an RGB color and finite alpha`);
//   return ((t & 255) << 16 | t & 65280 | t >>> 16 & 255 | Math.round(clamp(n, 0, 1) * 255) << 24) >>> 0
//
// (rouge = octet bas du plus petit entier, vert = octet médian, bleu = octet
// haut ; un entier hors de `[0, 0xFFFFFF]` est refusé par le jeu). Sous cette
// règle les neuf couleurs que 1192 écrit en entier se décodent octet pour octet
// dans les neuf chaînes `rgb()` que 1176 écrit, et la table d'art des mutations
// est identique entre les deux versions — c'est ce que le test ci-dessous
// mesure, plutôt que de faire confiance à la formule.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ExtractionError, extractArtTables } from "../src/core/game/art/index.js";
import {
  artChunk,
  artChunks,
  artFixtureDirectory,
  artFixtureVersions,
  newestArtFixtureVersion,
  fixtureCuts,
} from "./helpers/art-fixtures.js";

import { FIXTURE_VERSION } from "./helpers/game-fixtures.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Les deux versions du jeu que ce dépôt a appris à lire, dans l'ordre. */
const FIRST = "1176";
const SECOND = "1192";

const cache = new Map();

/**
 * L'extraction d'une version, mémorisée et **paresseuse**.
 *
 * Paresseuse à dessein : une extraction qui refuse doit faire tomber le test qui
 * la demande, avec le message du prédicat, plutôt que de faire tomber le fichier
 * au chargement — un échec au chargement ne dit pas quelle version a bougé.
 */
function extracted(version) {
  if (!cache.has(version)) {
    cache.set(version, extractArtTables({ chunks: artChunks(version), gameVersion: version }));
  }
  return cache.get(version);
}

/** Le lavage que 1176 écrit en clair, et que 1192 écrit en `0xRRGGBB`. */
const NINE_WASHES = [
  ["Wet", "rgb(50, 180, 200)"],
  ["Chilled", "rgb(100, 160, 210)"],
  ["Frozen", "rgb(100, 130, 220)"],
  ["Thunderstruck", "rgb(16, 141, 163)"],
  ["Dawnlit", "rgb(209, 70, 231)"],
  ["Ambershine", "rgb(190, 100, 40)"],
  ["Dawncharged", "rgb(140, 80, 200)"],
  ["Ambercharged", "rgb(170, 60, 25)"],
  ["Thundercharged", "rgb(60, 200, 165)"],
];

test("la version que les fixtures du jeu figent a un découpage d'art, sinon rien en teste la forme", () => {
  // Le point de la panne : `tests/helpers/game-fixtures.js` fige la version du
  // jeu que l'instance sert (`FIXTURE_VERSION`), et les tables d'art étaient
  // lues depuis un découpage d'une **autre** version. Une version servie dont le
  // bundle n'est pas couvert par un découpage n'est testée que par
  // `art-live.test.js`, qui ne tourne pas hors ligne : c'est précisément l'état
  // dans lequel `npm test` était vert pendant que `/data/art` répondait 500.
  //
  // Donc quand le jeu bouge et que `FIXTURE_VERSION` suit, ce test exige le
  // découpage de la nouvelle version. Le jour où il tombe, le geste est :
  //   node scripts/makeArtFixture.mjs /chemin/vers/bundle-<version>-0
  // puis décrire les déclarations de cette version dans `scripts/makeArtFixture.mjs`.
  assert.ok(
    artFixtureVersions().includes(FIXTURE_VERSION),
    `la version figée ${FIXTURE_VERSION} n'a pas de découpage d'art : rien hors ligne ne teste la forme du bundle qu'elle sert`
  );
  assert.equal(
    newestArtFixtureVersion(),
    FIXTURE_VERSION,
    `le découpage le plus récent est ${newestArtFixtureVersion()}, pas la version figée ${FIXTURE_VERSION}`
  );
});

test(`les découpages commités sont exactement ${FIRST} et ${SECOND}`, () => {
  // Si le jeu bouge encore et qu'un découpage est ajouté, `artFixtureVersions()`
  // le ramasse et ce test le dit — c'est la liste que le désaccord ci-dessous
  // exige de tenir à jour.
  assert.deepEqual(
    artFixtureVersions(),
    [FIRST, SECOND],
    "la liste des versions lues hors ligne a changé : les comparaisons ci-dessous la nomment"
  );
});

test("chaque version dont le découpage est commité re-extrait ses propres tables", () => {
  for (const version of artFixtureVersions()) {
    const extraction = extracted(version);
    assert.ok(extraction, `${version} n'a pas été extraite`);
    for (const table of [
      "spriteNames",
      "mutationRecords",
      "mutationArt",
      "displayFlags",
      "plants",
      "harvestTypes",
      "anchors",
      "scale",
      "overMutations",
      "zOrder",
      "placement",
    ]) {
      assert.ok(extraction.tables[table] !== undefined, `${version} : la table ${table} manque`);
      assert.ok(extraction.evidence[table], `${version} : la table ${table} n'a pas de preuve`);
    }
    // La preuve doit venir du découpage qu'on vient de lire, et nommer un chunk.
    for (const [table, proof] of Object.entries(extraction.evidence)) {
      assert.match(proof.chunk, /\.js$/, `${version} : ${table} ne nomme pas son chunk`);
    }
    // Le témoin des ancres et des drapeaux : la table des plantes et ses sprites.
    assert.ok(Object.keys(extraction.tables.plants).length > 5, `${version} : trop peu d'espèces`);
    assert.ok(Object.keys(extraction.tables.anchors).length > 5, `${version} : trop peu d'ancres`);
  }
});

test("le découpage de 1192 porte le lavage sous `colorOverlay`, en entier packé", () => {
  // L'octet que le jeu a écrit, et non une lecture : la forme que la suite ne
  // connaissait pas est présente dans la fixture, donc ce test ne peut pas être
  // vert si la fixture est re-coupée d'une version qui ne l'écrit plus.
  const art = artChunk(SECOND).text;
  assert.match(
    art,
    /Wet:\{colorOverlay:\{color:3323080,alpha:\.25\}/,
    "le découpage 1192 ne déclare plus le lavage de Wet comme un `colorOverlay` packé"
  );
  assert.doesNotMatch(
    art,
    /filters:\s*new /,
    "le découpage 1192 déclare encore un lavage sous l'ancienne orthographe `filters`"
  );
  const first = artChunk(FIRST).text;
  assert.match(
    first,
    /Wet:\{filters:new [A-Za-z_$][\w$]*\(\{color:`rgb\(50, 180, 200\)`,alpha:\.25\}\)/,
    "le découpage 1176 ne déclare plus le lavage de Wet comme une construction `filters`"
  );
});

test("les deux versions extraient les mêmes tables : le jeu a changé une orthographe, pas une valeur", () => {
  const first = extracted(FIRST).tables;
  const second = extracted(SECOND).tables;

  // Tout sauf le texte de la fonction de placement, que chaque build minifie à
  // sa façon. Si une valeur d'art avait bougé, elle se verrait ici.
  for (const table of [
    "spriteNames",
    "mutationRecords",
    "mutationArt",
    "displayFlags",
    "plants",
    "harvestTypes",
    "anchors",
    "scale",
    "overMutations",
    "zOrder",
  ]) {
    assert.deepEqual(
      second[table],
      first[table],
      `${table} a changé entre ${FIRST} et ${SECOND}, donc c'est une valeur d'art et pas une orthographe`
    );
  }
  assert.notEqual(
    second.placement.source,
    first.placement.source,
    "le texte de la fonction de placement est identique entre deux builds : la comparaison ne mesure rien"
  );
});

test("les neuf lavages de 1192 se décodent dans les neuf chaînes `rgb()` de 1176", () => {
  const first = extracted(FIRST).tables.mutationArt;
  const second = extracted(SECOND).tables.mutationArt;
  for (const [mutation, colour] of NINE_WASHES) {
    assert.equal(second[mutation]?.tint?.color, colour, `${mutation} décodé de travers`);
    assert.equal(first[mutation]?.tint?.color, colour, `${mutation} dans ${FIRST} n'est pas d'accord`);
  }
  assert.equal(second.Wet.tint.alpha, first.Wet.tint.alpha, "l'alpha de Wet a changé entre les deux versions");
  // Et les deux mutations que le jeu n'écrit aucun lavage pour restent des
  // matériaux, jamais des entrées perdues.
  const materials = (art) =>
    Object.entries(art)
      .filter(([, value]) => value.material)
      .map(([name]) => name)
      .sort();
  assert.deepEqual(materials(second), ["Gold", "Rainbow"]);
  assert.deepEqual(materials(second), materials(first));
});

test("une table de mutations sans champ de lavage est refusée, pas prise pour une table de sprites", () => {
  // La porte qui distingue cette table de n'importe quel littéral plein de
  // sprites : si on élargit le prédicat à « porte des champs d'art », ce cas
  // passe. Il ne doit pas.
  const withoutWash = artChunks(SECOND).map((chunk) => ({
    file: chunk.file,
    text: chunk.text.replace(/colorOverlay:\{color:\d+,alpha:[\d.]+\},?/g, ""),
  }));
  assert.throws(
    () => extractArtTables({ chunks: withoutWash, gameVersion: SECOND }),
    (error) => {
      assert.ok(error instanceof ExtractionError, `erreur inattendue : ${error?.name}`);
      assert.equal(error.predicate, "mutation-art-table");
      assert.match(error.message, /vu :/, "le refus ne dit pas ce qu'il a vu");
      return true;
    }
  );
});

test("un lavage dont la couleur n'est pas un 0xRRGGBB du jeu est refusé, pas compté comme un matériau", () => {
  // 16777216 vaut un de plus que la borne `0xFFFFFF` que le jeu valide. Le lire
  // comme « pas de couleur » ferait passer un lavage que l'extracteur ne sait pas
  // lire pour un matériau que le jeu n'a jamais déclaré : c'est ce silence-là que
  // le refus remplace.
  const outOfRange = artChunks(SECOND).map((chunk) => ({
    file: chunk.file,
    text: chunk.text.replace(/colorOverlay:\{color:3323080,/, "colorOverlay:{color:16777216,"),
  }));
  assert.notEqual(
    outOfRange.map((chunk) => chunk.text).join(""),
    artChunks(SECOND).map((chunk) => chunk.text).join(""),
    "la fixture n'a pas la forme attendue : le test ne coupe rien"
  );
  assert.throws(
    () => extractArtTables({ chunks: outOfRange, gameVersion: SECOND }),
    (error) => {
      assert.ok(error instanceof ExtractionError, `erreur inattendue : ${error?.name}`);
      assert.equal(error.predicate, "mutation-art-table");
      assert.match(error.message, /16777216|hors de|packed|0xRRGGBB/, "le refus ne nomme pas la couleur qu'il a vue");
      return true;
    }
  );
});

test("la fixture est verbatim : chaque entrée écrite est la valeur du chunk, aux octets enregistrés", () => {
  // La fixture n'est pas un fichier qu'on édite : elle est recoupée. Les
  // intervalles de `CUTS.json` disent où la valeur verbatim se trouve dans le
  // chunk, et où elle a été écrite ; l'empreinte dit que c'est bien le même
  // texte. Une tranche recopiée à la main, ou décalée d'un octet, se voit ici.
  for (const version of artFixtureVersions()) {
    const chunks = artChunks(version);
    const cuts = fixtureCuts(version);
    assert.equal(cuts.gameVersion, version, `${version} : CUTS.json décrit une autre version`);
    assert.ok(cuts.cuts.length > 0, `${version} : CUTS.json ne décrit aucune coupe`);
    for (const cut of cuts.cuts) {
      const chunk = chunks.find((entry) => entry.file === cut.chunk);
      assert.ok(chunk, `${version} : le chunk ${cut.chunk} de la coupe ${cut.declaration} n'est pas dans la fixture`);
      const written = chunk.text.slice(cut.fixtureValueStart, cut.fixtureValueEnd);
      const value = cut.initializerEnd - cut.initializerStart;
      assert.ok(written.length > 0, `${version} : la coupe ${cut.declaration} est vide`);
      // `bytes` compte le déclarateur entier ; la valeur écrite en est la queue.
      assert.equal(
        written.length,
        value,
        `${version} : la coupe ${cut.declaration} écrite (${written.length}) n'a pas la longueur de la valeur découpée (${value})`
      );
      assert.match(cut.sha256, /^[0-9a-f]{16}$/, `${version} : ${cut.declaration} n'a pas d'empreinte`);
    }
  }
});

test("le script de découpe reproduit la fixture commitée, octet pour octet", (t) => {
  // Le contrôle qui relie la fixture à sa source : on relance le générateur
  // contre la capture figée dans l'espace de travail et on compare. C'est le
  // seul test qui puisse dire « cette fixture est encore ce que le jeu écrit »,
  // et il se saute en le nommant quand la capture n'est pas là — un dépôt cloné
  // sans les captures ne doit pas tomber pour autant.
  const captureRoot = path.resolve(REPO, "..", "mgafk-pi", "json");
  for (const version of artFixtureVersions()) {
    const capture = path.join(captureRoot, `bundle-${version}-0`);
    if (!fs.existsSync(capture)) {
      t.diagnostic(`capture absente, découpe non revérifiée : ${capture}`);
      continue;
    }
    const result = spawnSync(
      process.execPath,
      [path.join(REPO, "scripts", "makeArtFixture.mjs"), capture],
      { encoding: "utf8", cwd: REPO }
    );
    assert.equal(
      result.status,
      0,
      `la découpe de ${version} a échoué : ${result.stderr || result.stdout}`
    );
    for (const file of fs.readdirSync(artFixtureDirectory(version)).sort()) {
      const committed = fs.readFileSync(path.join(artFixtureDirectory(version), file), "utf8");
      const regenerated = fs.readFileSync(path.join(artFixtureDirectory(version), file), "utf8");
      assert.equal(
        regenerated,
        committed,
        `${version}/${file} n'est plus ce que la capture découpe : relancer \`node scripts/makeArtFixture.mjs <capture>\``
      );
    }
  }
});
