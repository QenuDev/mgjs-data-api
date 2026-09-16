// tests/data-provenance-doc.test.js
//
// Le document doit décrire ce que chaque réponse de `/data` annonce déjà : la
// version du jeu dans l'en-tête `X-Game-Version`, et les trois faits de
// provenance dans le corps JSON sous la clé réservée `_meta` — avec ses deux
// exceptions, `/data/version` (son corps *est* le bloc) et les formats
// délimités (une table, pas un objet keyé).
//
// Le test lit `META_KEY` et `GAME_VERSION_HEADER` dans le code, jamais des
// chaînes recopiées : renommer la clé ou l'en-tête doit casser ici plutôt que
// dériver en silence entre ce que le serveur envoie et ce que le document
// promet. Même habitude que `contract-schema.test.js`, qui confronte les chemins
// documentés à ce qui est réellement monté.
//
// Le même fichier garde aussi la description de `/assets/sprites/composed` : le
// tableau y est la caisse de la culture et le dit, l'en-tête de boîte et
// `?format=layout` sont la même vérité sous deux formes. Là où `composed.js`
// n'exporte aucun nom, le test lit la source de la route et apparie ses
// littéraux — un renommage casse le test au lieu de dé-documenter en silence.
//
// Hors ligne et rapide : les documents sont lus sur disque et leurs `$ref`
// résolus à la main, aucun serveur n'est démarré.

process.env.LOG_LEVEL = "silent";
process.env.RATE_LIMIT_ENABLED = "false";

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yamljs";

// Import dynamique : `config` (donc le niveau de log) est lu au chargement du
// module, et les variables ci-dessus doivent être posées avant.
const { META_KEY, GAME_VERSION_HEADER } = await import("../src/api/routes/data.js");

const DOC_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "docs",
  "openapi.yaml"
);
const raw = readFileSync(DOC_PATH, "utf8");
const doc = YAML.load(DOC_PATH);

/** Ce que `getProvenance()` met dans le bloc. */
const PROVENANCE_FIELDS = ["gameVersion", "contract", "generatedAt"];

/** Un export délimité : `jsonToDelimited` en fait une table, pas un objet keyé. */
const DELIMITED = /\.(csv|tsv)$/;
/** Son corps **est** le bloc de provenance : il ne le porte pas sous `_meta`. */
const VERSION_PATH = "/data/version";

const isDataPath = (p) => p === "/data" || p.startsWith("/data/");

/** Résout un `$ref` local ; rend le nœud tel quel s'il n'en est pas un. */
function deref(node) {
  const seen = new Set();
  let current = node;

  while (current && typeof current === "object" && typeof current.$ref === "string") {
    const ref = current.$ref;
    assert.match(ref, /^#\//, `$ref non local : ${ref}`);
    assert.ok(!seen.has(ref), `$ref circulaire : ${ref}`);
    seen.add(ref);
    current = ref
      .slice(2)
      .split("/")
      .reduce((acc, key) => acc?.[key], doc);
    assert.ok(current, `$ref non résolu : ${ref}`);
  }

  return current;
}

const dataPaths = Object.keys(doc.paths).filter(isDataPath);
const delimitedPaths = dataPaths.filter((p) => DELIMITED.test(p));
const jsonPaths = dataPaths.filter((p) => !DELIMITED.test(p) && p !== VERSION_PATH);

test("assez de chemins de `/data` documentés pour que le reste ait un sens", () => {
  // `/data`, `/data/version`, et les dix catégories de `x-mg-contract.data`.
  assert.ok(dataPaths.length >= 12, `chemins de /data documentés : ${dataPaths.length}`);
  assert.ok(jsonPaths.length >= 10, `corps JSON documentés : ${jsonPaths.length}`);
  assert.ok(delimitedPaths.length > 0, "aucun export délimité documenté");
});

test("chaque chemin de `/data` déclare l'en-tête de version", () => {
  for (const p of dataPaths) {
    const responses = doc.paths[p].get?.responses ?? {};
    const body = responses["200"];
    assert.ok(body, `${p} : pas de réponse 200`);

    for (const [code, response] of Object.entries(responses)) {
      // 200 porte le corps, 304 la revalidation : les deux annoncent la version.
      if (code !== "200" && code !== "304") continue;

      const header = response.headers?.[GAME_VERSION_HEADER];
      assert.ok(header, `${p} ${code} : ${GAME_VERSION_HEADER} n'est pas déclaré`);
      assert.match(
        header.$ref ?? "",
        /^#\/components\/headers\//,
        `${p} ${code} : l'en-tête n'est pas le composant réutilisable`
      );
      assert.equal(
        deref(header).schema?.type,
        "string",
        `${p} ${code} : ${GAME_VERSION_HEADER} n'est pas décrit comme une chaîne`
      );
    }
  }
});

test("chaque corps JSON de `/data` nomme le bloc de provenance sous la clé réservée", () => {
  for (const p of jsonPaths) {
    const schema = deref(doc.paths[p].get.responses["200"].content?.["application/json"]?.schema);
    assert.ok(schema, `${p} : pas de schéma de corps JSON`);

    const meta = schema.properties?.[META_KEY];
    assert.ok(meta, `${p} : le corps ne nomme pas ${META_KEY}`);

    const block = deref(meta);
    assert.deepEqual(
      Object.keys(block.properties ?? {}).sort(),
      [...PROVENANCE_FIELDS].sort(),
      `${p} : les champs du bloc de provenance`
    );
    assert.deepEqual(
      [...(block.required ?? [])].sort(),
      [...PROVENANCE_FIELDS].sort(),
      `${p} : les champs requis du bloc de provenance`
    );
  }
});

test("les deux exceptions sont documentées, pas silencieuses", () => {
  const version = doc.paths[VERSION_PATH];
  assert.ok(version, `${VERSION_PATH} n'est pas documenté`);
  assert.ok(
    version.get.responses["200"].headers?.[GAME_VERSION_HEADER],
    `${VERSION_PATH} : l'en-tête manque`
  );
  const versionBody = deref(version.get.responses["200"].content?.["application/json"]?.schema);
  assert.equal(
    versionBody.properties?.[META_KEY],
    undefined,
    `${VERSION_PATH} : le corps est le bloc, il ne doit pas le répéter sous ${META_KEY}`
  );

  for (const p of delimitedPaths) {
    const content = doc.paths[p].get.responses["200"].content ?? {};
    assert.ok(!content["application/json"], `${p} : un export délimité n'est pas du JSON`);

    for (const [mediaType, media] of Object.entries(content)) {
      const schema = deref(media?.schema);
      assert.equal(
        schema?.properties?.[META_KEY],
        undefined,
        `${p} (${mediaType}) : un export délimité ne porte pas ${META_KEY}`
      );
    }
  }
});

test("le document dit où le bloc recule si le jeu occupe la clé", () => {
  // Le code préfixe d'un underscore tant que la clé est prise : le premier repli
  // est donc `_${META_KEY}`. Un document qui ne le dit pas laisserait le repli
  // invisible pour un client qui lit le contrat.
  const fallback = `_${META_KEY}`;
  assert.ok(
    raw.includes(`\`${fallback}\``),
    `le document ne nomme pas la clé de repli \`${fallback}\``
  );
});

// =====================
// /assets/sprites/composed : le canevas est l'union, la caisse dit où est la culture
// =====================
//
// La composition a d'abord cadré son canevas sur la caisse de la culture, donc l'art d'une
// mutation qui débordait était coupé. Le jeu ne fait pas ça : chaque sprite de mutation est
// ajouté au conteneur de la culture sans masque (la preuve est dans
// `src/assets/sprites/cropBox.js`), donc son art va où le calcul de placement le met. Le
// canevas est maintenant l'union serrée de la caisse et de ses calques, la caisse dit où la
// culture est dedans, et le seul calque encore coupé est la surcouche de plante haute, que le
// jeu masque lui-même au contour de la culture. Le test tient les deux contre la route.

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSED_PATH = "/assets/sprites/composed";
const composedSource = readFileSync(path.join(REPO, "src", "api", "routes", "composed.js"), "utf8");
const corsSource = readFileSync(path.join(REPO, "src", "api", "middleware", "cors.js"), "utf8");

function sourceLiteral(regex, what) {
  const match = regex.exec(composedSource);
  assert.ok(match, `${what} introuvable dans src/api/routes/composed.js`);
  return match[1];
}

// `composed.js` n'exporte que le routeur : le nom de l'en-tête et le jeton de
// format se lisent dans la source, pas dans un export.
const spriteBoxHeader = sourceLiteral(
  /res\.set\(\s*"([^"]+)"\s*,\s*boxHeader\(/,
  "le nom de l'en-tête de boîte"
);
const formatParam = sourceLiteral(
  /req\.query\.([A-Za-z0-9_]+)[^\n]*toLowerCase\(\)\s*===\s*"/,
  "le paramètre de format"
);
const layoutValue = sourceLiteral(
  /req\.query\.[A-Za-z0-9_]+[^\n]*toLowerCase\(\)\s*===\s*"([^"]+)"/,
  "la valeur qui demande le layout"
);

/** Les champs du boîtier, dans l'ordre du `boxHeader()` de la route. */
const boxFields = [...new Set([...composedSource.matchAll(/\bbox\.([A-Za-z]+)/g)].map((m) => m[1]))];

/** La liste `exposedHeaders` du middleware CORS, telle qu'elle est écrite. */
const exposedHeaders = (() => {
  const match = /exposedHeaders:\s*\[([^\]]*)\]/.exec(corsSource);
  assert.ok(match, "exposedHeaders introuvable dans src/api/middleware/cors.js");
  return match[1]
    .split(",")
    .map((name) => name.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
})();

test("le document dit que le canevas est l'union, et quel calque reste coupé", () => {
  const description = doc.paths[COMPOSED_PATH]?.get?.description;
  assert.ok(description, `${COMPOSED_PATH} : pas de description`);

  // Ce que la description ne doit plus promettre : un canevas à la caisse de la culture, et
  // un art de mutation coupé à cette caisse. Les deux étaient la convention fausse.
  assert.ok(
    !/the picture is the crop's own art/i.test(description),
    "la description dit encore que l'image est l'art de la culture"
  );
  assert.ok(
    !/image dimensions are exactly what the game draws/i.test(description),
    "la description promet encore que l'image fait exactement l'art de la culture"
  );

  // Ce qu'elle doit dire : l'union, la caisse comme rectangle de l'art dedans, et le seul
  // calque que le jeu masque lui-même.
  assert.match(description, /tight union/i, "la description ne dit pas que le canevas est l'union");
  assert.match(
    description,
    /crop art's own rectangle inside the picture/i,
    "la description ne dit pas que la caisse est le rectangle de l'art dedans"
  );
  assert.match(
    description,
    /tall-plant overlay/i,
    "la description ne nomme pas le seul calque encore coupé"
  );
  assert.match(
    description,
    /never changes the picture's size/i,
    "la description ne dit pas que la surcouche ne change pas la taille de l'image"
  );
});

test("l'en-tête de boîte déclaré est celui que la route pose", () => {
  assert.deepEqual(
    [...boxFields].sort(),
    ["height", "width", "x", "y"],
    `champs lus dans boxHeader() : ${boxFields}`
  );

  const response = doc.paths[COMPOSED_PATH].get.responses["200"];
  const header = response.headers?.[spriteBoxHeader];
  assert.ok(header, `${COMPOSED_PATH} : ${spriteBoxHeader} n'est pas déclaré sur le 200`);
  assert.match(header.$ref ?? "", /^#\/components\/headers\//, "l'en-tête n'est pas le composant réutilisable");
  assert.equal(deref(header).schema?.type, "string", `${spriteBoxHeader} n'est pas décrit comme une chaîne`);
  const boxHeaderDoc = deref(header);
  assert.match(
    String(boxHeaderDoc.example ?? boxHeaderDoc.schema?.example ?? ""),
    /^\d+,\d+,\d+,\d+$/,
    "l'exemple n'a pas la forme x,y,width,height"
  );

  // La même réponse a deux représentations : l'en-tête vaut pour les deux.
  assert.ok(response.content?.["image/png"], "la représentation PNG manque");
  assert.ok(response.content?.["application/json"], "la représentation JSON manque");
});

test("le paramètre de layout est celui de la route, et sa caisse est décrite", () => {
  const parameters = doc.paths[COMPOSED_PATH].get.parameters ?? [];
  const parameter = parameters.find((p) => p.name === formatParam);
  assert.ok(parameter, `${COMPOSED_PATH} : le paramètre ${formatParam} n'est pas documenté`);
  assert.equal(parameter.in, "query", `${formatParam} n'est pas un paramètre de requête`);
  assert.ok(
    (parameter.schema?.enum ?? []).includes(layoutValue),
    `${formatParam} : ${layoutValue} absent de l'enum`
  );

  const layout = deref(doc.paths[COMPOSED_PATH].get.responses["200"].content?.["application/json"]?.schema);
  assert.ok(layout, "pas de corps JSON documenté pour le layout");
  assert.ok((layout.required ?? []).includes("box"), "le corps JSON ne requiert pas box");

  const box = deref(layout.properties?.box);
  assert.deepEqual(
    Object.keys(box.properties ?? {}).sort(),
    [...boxFields].sort(),
    "les champs du boîtier documenté ne sont pas ceux de boxHeader()"
  );
  assert.deepEqual([...(box.required ?? [])].sort(), [...boxFields].sort(), "champs requis du boîtier");
});

test("l'en-tête de boîte n'est pas exposé en CORS, et le document dit pourquoi", () => {
  assert.ok(
    !exposedHeaders.includes(spriteBoxHeader),
    `${spriteBoxHeader} est exposé en CORS : la raison écrite dans le document serait fausse`
  );

  const { description } = deref(doc.paths[COMPOSED_PATH].get.responses["200"].headers[spriteBoxHeader]);
  assert.match(description, /Access-Control-Expose-Headers/, "le document ne dit pas que l'en-tête n'est pas exposé");
  assert.ok(
    description.includes(`?${formatParam}=${layoutValue}`),
    `le document ne nomme pas ?${formatParam}=${layoutValue} comme la forme lisible`
  );

  // « Pas sur un 304 » : la route pose l'en-tête après le retour anticipé.
  assert.ok(
    composedSource.indexOf(`"${spriteBoxHeader}"`) > composedSource.indexOf("status(304)"),
    `la route pose ${spriteBoxHeader} avant le 304 : le document doit le dire`
  );
});
