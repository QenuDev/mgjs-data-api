// tests/compose-spec.test.js
//
// La spec d'une scène, ses limites et le refus nommé (docs/mgjs-community-api-plan.md §3.2 et item 22).
//
// Ce que ce fichier prouve :
//
//   * une spec est normalisée en une valeur canonique — items triés par id, mutations déduplicatées et
//     triées, défauts remplis — donc deux specs qui demandent la même scène ont la même clé ;
//   * une spec malformée est refusée par un code **nommé**, pas par un 500 ni par une scène tronquée ;
//   * une spec au-dessus d'une limite est refusée par `COMPOSE_LIMIT_EXCEEDED`, avec le nom de la
//     limite et ce que la spec demandait ;
//   * une version de spec que cette instance n'implémente pas est refusée par son propre code ;
//   * `/schema.json` déclare la capacité `compose`, la version de spec et les mêmes limites que le code.
//
// Hors ligne et sans composition : ces tests n'appellent que le normalisateur et le contrat.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";

import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPOSE_LIMITS,
  SPEC_VERSION,
  SUPPORTED_SPEC_VERSIONS,
  ComposeSpecError,
  normalizeSpec,
} from "../src/assets/compose/spec.js";
import { contentKey } from "../src/assets/compose/sceneCache.js";
import { startTestApp } from "./helpers/httpApp.js";

/** The smallest spec that is not malformed. */
const minimal = (items) => ({ spec: SPEC_VERSION, items });

test("une spec minimale est normalisée et prend ses défauts", () => {
  const normalized = normalizeSpec(minimal([{ id: "a", kind: "crop", species: "Clover" }]));
  assert.equal(normalized.spec, SPEC_VERSION);
  assert.equal(normalized.canvas.fit, "content");
  assert.equal(normalized.canvas.padding, 0);
  assert.equal(normalized.background, null);
  assert.deepEqual(normalized.items, [
    {
      id: "a",
      kind: "crop",
      species: "Clover",
      at: null,
      size: null,
      mutations: [],
      // Spec 2: the game's own per-crop flag the save carries, echoed with its default so the shape a
      // caller reads back is the shape it sent, filled in.
      flipped: false,
      startTime: null,
      endTime: null,
      ready: null,
    },
  ]);
});

test("la normalisation trie les items et déduplique les mutations", () => {
  const normalized = normalizeSpec(
    minimal([
      { id: "b", kind: "crop", species: "Clover", mutations: ["Wet", "Frozen", "Wet"] },
      { id: "a", kind: "crop", species: "Clover" },
    ]),
  );
  assert.deepEqual(normalized.items.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(normalized.items[1].mutations, ["Frozen", "Wet"]);
  // Et l'ordre des mutations ne change pas la clé : c'est la même scène.
  const first = contentKey(normalizeSpec(minimal([{ id: "a", kind: "crop", species: "Clover", mutations: ["Wet", "Frozen"] }])));
  const second = contentKey(normalizeSpec(minimal([{ id: "a", kind: "crop", species: "Clover", mutations: ["Frozen", "Wet"] }])));
  assert.equal(first, second);
});

test("une spec malformée est refusée par un code nommé", () => {
  const cases = [
    [null, "must be a JSON object"],
    [{ items: [] }, "spec"],
    [{ spec: 3, items: [{ id: "a", species: "Clover" }] }, "spec 3 is not supported"],
    [{ spec: 1 }, "items"],
    [{ spec: 1, items: [] }, "at least one item"],
    [{ spec: 1, items: [{ species: "Clover" }] }, "id"],
    [{ spec: 1, items: [{ id: "a", kind: "decor", species: "Clover" }] }, "kind"],
    [{ spec: 1, items: [{ id: "a" }] }, "species"],
    [{ spec: 1, items: [{ id: "a", species: "Clover", size: 49 }] }, "band"],
    [{ spec: 1, items: [{ id: "a", species: "Clover", size: 101 }] }, "band"],
    [{ spec: 1, items: [{ id: "a", species: "Clover", at: { column: -1, row: 0 } }] }, "must not be negative"],
    [{ spec: 1, items: [{ id: "a", species: "Clover" }, { id: "a", species: "Clover" }] }, "used twice"],
    [{ spec: 1, canvas: { fit: "tile" }, items: [{ id: "a", species: "Clover" }] }, "fit"],
    [{ spec: 1, canvas: { padding: 999 }, items: [{ id: "a", species: "Clover" }] }, "padding"],
    [{ spec: 1, background: { kind: "solid" }, items: [{ id: "a", species: "Clover" }] }, "kind"],
    // Spec 2 : une place est un nombre fini, et une patch a besoin de ses brins.
    [{ spec: 2, items: [{ id: "a", species: "Clover", at: { column: 0, row: 0, x: "0.5" } }] }, "x must be a finite number"],
    [
      { spec: 2, items: [{ id: "a", species: "Clover", at: { column: 0, row: 0, rotation: false } }] },
      "rotation must be a finite number",
    ],
    [{ spec: 2, items: [{ id: "a", kind: "patch", species: "Clover" }] }, "at least one crop"],
    [{ spec: 2, items: [{ id: "a", kind: "patch", species: "Clover", crops: [] }] }, "at least one crop"],
    [
      { spec: 2, items: [{ id: "a", kind: "patch", species: "Clover", crops: [{ size: 50, at: { x: "0.1" } }] }] },
      "x must be a finite number",
    ],
  ];

  for (const [raw, expected] of cases) {
    let thrown = null;
    try {
      normalizeSpec(raw);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof ComposeSpecError, `${JSON.stringify(raw)} : une ComposeSpecError`);
    assert.match(thrown.message, new RegExp(expected), `${JSON.stringify(raw)} : le message nomme la faute`);
    assert.equal(thrown.status, 400);
  }
});

test("spec 2 normalise une place et une patch, et spec 1 reste acceptée", () => {
  // Une place : x et y en fractions de tuile, rotation en degrés, remplie telle quelle.
  const placed = normalizeSpec({
    spec: 2,
    items: [
      {
        id: "a",
        kind: "crop",
        species: "Clover",
        at: { column: 2, row: 3, x: 0.125, y: -0.25, rotation: 30 },
      },
    ],
  });
  assert.deepEqual(placed.items[0].at, { column: 2, row: 3, x: 0.125, y: -0.25, rotation: 30 });

  // Une patch : les brins, chacun avec sa taille, ses mutations et sa place optionnelle.
  const patch = normalizeSpec({
    spec: 2,
    items: [
      {
        id: "p",
        kind: "patch",
        species: "Clover",
        at: { column: 0, row: 0 },
        crops: [{ size: 100 }, { size: 50, at: { x: 0.1, y: 0.2, rotation: 5 }, flipped: true }],
      },
    ],
  });
  assert.equal(patch.items[0].kind, "patch");
  assert.equal(patch.items[0].crops.length, 2);
  assert.deepEqual(patch.items[0].crops[0], {
    slot: 0,
    size: 100,
    mutations: [],
    flipped: false,
    // Le moment où le brin a été planté, qui est ce dont le jeu tire l'inclinaison d'une culture
    // multi-récolte (`35 - startTime % 70`) : absent ici, et lu comme `0` par le placement.
    startTime: null,
    at: { x: null, y: null, rotation: null },
  });
  assert.deepEqual(patch.items[0].crops[1].at, { x: 0.1, y: 0.2, rotation: 5 });
  assert.equal(patch.items[0].crops[1].flipped, true);
  // Une patch n'a pas de mutations de corps : le champ existe et reste vide.
  assert.deepEqual(patch.items[0].mutations, []);

  // Spec 1 est toujours acceptée, et une spec sans place normalise la même chose dans les deux
  // versions : c'est ce qui garde une clé de contenu stable pour une scène qui ne s'en sert pas.
  assert.deepEqual(SUPPORTED_SPEC_VERSIONS, [2, 1]);
  const one = normalizeSpec({ spec: 1, items: [{ id: "a", kind: "crop", species: "Clover" }] });
  const two = normalizeSpec({ spec: 2, items: [{ id: "a", kind: "crop", species: "Clover" }] });
  assert.deepEqual(one.items, two.items);
});

test("une version de spec inconnue a son propre code, et dit ce que l'instance implémente", () => {
  let thrown = null;
  try {
    normalizeSpec({ spec: 7, items: [{ id: "a", species: "Clover" }] });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown.code, "COMPOSE_SPEC_VERSION_UNSUPPORTED");
  assert.equal(thrown.limit, SPEC_VERSION);
  assert.equal(thrown.saw, 7);
});

test("une spec au-dessus d'une limite est refusée, avec le nom de la limite", () => {
  // Le nombre d'items.
  const many = Array.from({ length: COMPOSE_LIMITS.maxItems + 1 }, (_, index) => ({
    id: `i${index}`,
    kind: "crop",
    species: "Clover",
  }));
  let thrown = null;
  try {
    normalizeSpec(minimal(many));
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown.code, "COMPOSE_LIMIT_EXCEEDED");
  assert.equal(thrown.limit, "maxItems");
  assert.equal(thrown.saw, COMPOSE_LIMITS.maxItems + 1);
  assert.match(thrown.message, new RegExp(String(COMPOSE_LIMITS.maxItems)));
  assert.equal(thrown.status, 400);

  // Le nombre d'items tient aussi pour les tuiles d'un fond : c'est le même coût par tuile.
  let background = null;
  try {
    normalizeSpec({
      spec: 1,
      background: { kind: "tiles", ground: "Dirt_A", columns: 64, rows: 64 },
      items: [{ id: "a", kind: "crop", species: "Clover" }],
    });
  } catch (error) {
    background = error;
  }
  assert.equal(background.code, "COMPOSE_LIMIT_EXCEEDED");
  assert.equal(background.limit, "maxItems");
  assert.equal(background.saw, 4096);
});

test("le canevas est borné après mesure, pas tronqué", async () => {
  const { assertWithinCanvas } = await import("../src/assets/compose/spec.js");
  assert.deepEqual(assertWithinCanvas({ width: 10, height: 10 }), { width: 10, height: 10 });

  let thrown = null;
  try {
    assertWithinCanvas({ width: COMPOSE_LIMITS.maxCanvas.width + 1, height: 10 });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown.code, "COMPOSE_LIMIT_EXCEEDED");
  assert.equal(thrown.limit, "maxCanvas");
  assert.deepEqual(thrown.saw, { width: COMPOSE_LIMITS.maxCanvas.width + 1, height: 10 });

  let pixels = null;
  try {
    // Sous le plafond par côté, au-dessus du plafond de pixels.
    assertWithinCanvas({ width: 4096, height: 4096 });
    assertWithinCanvas({ width: 4096, height: 4097 });
  } catch (error) {
    pixels = error;
  }
  assert.equal(pixels.limit, "maxCanvas");
});

test("/schema.json déclare compose, sa version de spec et les mêmes limites que le code", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const schema = await (await api.get("/schema.json")).json();
  assert.ok(schema.capabilities.includes("compose"), "compose est une capacité déclarée");
  assert.ok(schema.paths.includes("/compose"), "et son chemin est déclaré");
  assert.deepEqual(schema.compose, {
    spec: SPEC_VERSION,
    maxItems: COMPOSE_LIMITS.maxItems,
    maxCanvas: `${COMPOSE_LIMITS.maxCanvas.width}x${COMPOSE_LIMITS.maxCanvas.height}`,
    maxPixels: COMPOSE_LIMITS.maxPixels,
  });

  // Et le document dit la même chose : c'est le même fichier qui les sert tous les deux.
  const doc = await (await api.get("/docs/openapi.json")).json();
  assert.deepEqual(doc["x-mg-contract"].compose, schema.compose);
  assert.match(doc.info.version, /^\d+$/);
});

test("POST /compose refuse une spec malformée par un corps d'erreur nommé", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const over = Array.from({ length: COMPOSE_LIMITS.maxItems + 1 }, (_, index) => ({
    id: `i${index}`,
    kind: "crop",
    species: "Clover",
  }));
  const response = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(minimal(over)),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "COMPOSE_LIMIT_EXCEEDED");
  assert.equal(body.error.limit, "maxItems");
  assert.equal(body.error.saw, COMPOSE_LIMITS.maxItems + 1);

  const version = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spec: 99, items: [{ id: "a", species: "Clover" }] }),
  });
  assert.equal(version.status, 400);
  assert.equal((await version.json()).error.code, "COMPOSE_SPEC_VERSION_UNSUPPORTED");

  const format = await api.get("/compose?format=png", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(minimal([{ id: "a", kind: "crop", species: "Clover" }])),
  });
  assert.equal(format.status, 400);
});
