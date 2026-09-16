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
// Hors ligne et rapide : le document est lu sur disque et ses `$ref` résolus à
// la main, aucun serveur n'est démarré.

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
