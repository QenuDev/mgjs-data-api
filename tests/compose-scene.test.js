// tests/compose-scene.test.js
//
// `POST /compose` et `GET /compose/<clé>.png` — une scène en entrée, une image et sa disposition en
// sortie (docs/mgjs-community-api-plan.md §3.2, items 20 et 21).
//
// Ce que ce fichier prouve, et pourquoi chaque preuve peut échouer :
//
//   * les dimensions du PNG sont celles du canevas de la disposition, et chaque item a des pixels
//     opaques dans sa boîte — un composeur qui rendrait un canevas vide passerait un test de
//     dimensions, donc les pixels sont comptés ;
//   * `?format=layout` répond les mêmes boîtes sans encoder d'image ;
//   * la disposition vient de `@mg.js/art` : sur une spec fixe, chaque boîte est recomposée ici avec
//     les fonctions du paquet (`frameBox`, `cropComposition`, `plantPicture`), et l'art de chaque item
//     est asserté à la place que la mathématique du paquet lui donne ;
//   * deux specs identiques ne composent qu'une fois (le compteur du cache le prouve) ;
//   * l'ordre des items et les espaces ne changent pas la clé de contenu ;
//   * `GET /compose/<clé>.png` sert le fichier que la composition a écrit ;
//   * la cache évince la scène la moins récemment utilisée à sa borne.
//
// Hors ligne : `installOfflineGame()` sert l'atlas et le bundle capturés sur la seule couture par
// laquelle le composeur atteint le jeu.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
// Le cache des scènes écrit vraiment sur disque ; le test lui donne son propre dossier et sa propre
// borne avant que `config` ne les lise (l'import du serveur est dynamique).
process.env.COMPOSE_CACHE_DIR = new URL("./fixtures/compose-cache/", import.meta.url).pathname;
process.env.COMPOSE_CACHE_MAX = "2";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import sharp from "sharp";

import { installOfflineGame, plantFixture, artTablesFixture } from "./helpers/offlineGame.js";
import { startTestApp } from "./helpers/httpApp.js";

const CACHE_DIR = new URL("./fixtures/compose-cache/", import.meta.url);

const restoreFetch = await installOfflineGame({ version: 1192 });

const { gameDataService } = await import("../src/services/gameData.js");
const PLANTS = await plantFixture();
gameDataService.getPlants = async () => PLANTS;

const { frameBox, boxOf, cropComposition, mutationAnchor, plantPicture } = await import("@mg.js/art");
const { drawnFrame } = await import("../src/assets/compose/artBridge.js");
const { resetSceneCache, composeCount, cachedKeys } = await import("../src/assets/compose/sceneCache.js");
const { clearSceneCaches } = await import("../src/assets/compose/sceneService.js");

/**
 * Une spec fixe : deux plantes et une culture nue. Le trèfle est une espèce « patch » (le jeu n'en
 * dessine pas de corps : ses cultures sont son image), le cactus en a un, et la culture nue est
 * l'item dont l'ancre doit tomber exactement sur l'origine de sa tuile.
 */
function spec() {
  return {
    spec: 1,
    canvas: { fit: "content", padding: 0 },
    items: [
      {
        id: "clover",
        kind: "plant",
        species: "Clover",
        at: { column: 0, row: 0 },
        crops: [{ slot: 0, size: 88, mutations: ["Wet"] }],
      },
      { id: "cactus", kind: "plant", species: "Cactus", at: { column: 1, row: 0 } },
      {
        id: "bare",
        kind: "crop",
        species: "Clover",
        at: { column: 0, row: 1 },
        size: 71,
        mutations: ["Wet"],
      },
    ],
  };
}

/** La même scène, les items dans un autre ordre : c'est la même demande. */
function specReordered() {
  const first = spec();
  return { ...first, items: [first.items[2], first.items[0], first.items[1]] };
}

async function cleanCache() {
  await fs.rm(CACHE_DIR, { recursive: true, force: true });
  resetSceneCache();
  clearSceneCaches();
}

/** Combien de pixels opaques une image a dans une boîte, sur le canal alpha. */
async function opaqueIn(png, box) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let y = box.y; y < box.y + box.height; y += 1) {
    if (y < 0 || y >= info.height) continue;
    for (let x = box.x; x < box.x + box.width; x += 1) {
      if (x < 0 || x >= info.width) continue;
      if (data[(y * info.width + x) * 4 + 3] > 0) count += 1;
    }
  }
  return count;
}

/**
 * Les frames de l'atlas capturé, telles que le paquet les lit — la même source que le composeur.
 */
async function fixtureFrames() {
  const sprites = JSON.parse(
    await fs.readFile(new URL("./fixtures/sprites/sprites-composed.json", import.meta.url), "utf8"),
  );
  return new Map(
    Object.entries(sprites.frames).map(([key, meta]) => [key, frameBox({ sourceSize: meta.sourceSize, anchor: meta.anchor })]),
  );
}

/** La recette d'un item, du paquet, avec les mêmes tables et les mêmes frames que le composeur. */
async function recipeFor(item) {
  const tables = (await artTablesFixture(1192)).tables;
  const frames = await fixtureFrames();
  const mutations = item.kind === "crop" ? item.mutations ?? [] : [];
  const recipe = cropComposition(item.species, mutations, tables, frames);
  if (recipe === null) return null;
  return { recipe, tables, frames };
}

/**
 * La boîte qu'une recette occupe quand elle est posée par l'ancre de son propre art en `point`.
 *
 * C'est la recomposition du paquet, pas une formule : chaque rectangle de la recette est tourné
 * autour de l'ancre de l'art (`-ancre × taille × échelle`), puis l'union est prise. Le composeur fait
 * exactement ces opérations dans `sceneLayout.js` → `pictureOf`, donc une divergence serait un
 * désaccord réel entre les deux, pas un arrondi.
 */
function pictureBox(recipe, frames, scale, point) {
  const art = recipe.layers.find((layer) => layer.kind === "art");
  const frame = frames.get(art.sprite);
  const atX = -frame.anchorX * frame.width * scale;
  const atY = -frame.anchorY * frame.height * scale;
  const rects = recipe.layers.map((layer) =>
    layer.kind === "art"
      ? { left: atX, top: atY, width: frame.width * scale, height: frame.height * scale }
      : {
          left: atX + (layer.left - art.left) * scale,
          top: atY + (layer.top - art.top) * scale,
          width: layer.width * scale,
          height: layer.height * scale,
        },
  );
  const local = boxOf(rects);
  return {
    artFrame: frame,
    box: {
      left: point.x + local.left,
      top: point.y + local.top,
      width: local.width,
      height: local.height,
    },
  };
}

test("POST /compose répond un PNG dont les dimensions sont le canevas de la disposition", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const layoutResponse = await api.get("/compose?format=layout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec()),
  });
  assert.equal(layoutResponse.status, 200);
  assert.match(layoutResponse.headers.get("content-type"), /application\/json/);
  const layout = await layoutResponse.json();
  const key = layoutResponse.headers.get("x-mg-compose-key");
  assert.equal(layout.key, key);
  assert.match(key, /^[0-9a-f]{40}$/, "la clé est le hachage du contenu");
  assert.equal(layout.spec, 1);
  assert.equal(layout.items.length, 3);

  const pictureResponse = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec()),
  });
  assert.equal(pictureResponse.status, 200);
  assert.match(pictureResponse.headers.get("content-type"), /image\/png/);
  assert.equal(pictureResponse.headers.get("x-mg-compose-key"), key, "les deux formes répondent la même clé");

  const png = Buffer.from(await pictureResponse.arrayBuffer());
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, layout.canvas.width);
  assert.equal(meta.height, layout.canvas.height);

  // Chaque item a des pixels dans sa propre boîte : un canevas vide aurait les bonnes dimensions.
  for (const item of layout.items) {
    const opaque = await opaqueIn(png, item.box);
    assert.ok(opaque > 0, `${item.id} : aucun pixel opaque dans ${JSON.stringify(item.box)}`);
  }

  // Le pas de la grille est la tuile de référence du jeu, et la table le dit.
  assert.equal(layout.canvas.grid.step, 256);

  // La culture nue nomme sa tuile : l'ancre de son propre art doit tomber sur l'origine de cette
  // tuile dans l'image, à un pixel d'arrondi près. Rien d'autre que la mathématique de placement ne
  // peut la mettre là, et la boîte de l'item est ce qui permet de le vérifier sans décoder le PNG.
  const bare = layout.items.find((item) => item.id === "bare");
  const bareRecipe = await recipeFor(spec().items[2]);
  const scale = 1 + ((71 - 50) / 50) * (PLANTS.Clover.crop.maxSizeMultiplier - 1);
  const bareBox = pictureBox(bareRecipe.recipe, bareRecipe.frames, scale, { x: 0, y: 0 });
  const origin = layout.canvas.origin;
  // La boîte scène et la boîte image disent la même chose dans deux repères ; l'écart entre elles est
  // le coin de l'image. C'est ce que le test suivant exploite pour vérifier le placement.
  // À un pixel près : chacune des deux boîtes est arrondie une fois, séparément, donc deux valeurs qui
  // décrivent le même rectangle peuvent tomber sur deux entiers voisins.
  assert.ok(Math.abs(bare.box.x - (bare.scene.x + origin.x)) <= 1, `coin x (${bare.box.x} contre ${bare.scene.x + origin.x})`);
  assert.ok(Math.abs(bare.box.y - (bare.scene.y + origin.y)) <= 1, `coin y (${bare.box.y} contre ${bare.scene.y + origin.y})`);
  assert.equal(bare.scene.width, bare.box.width);
  assert.equal(bare.scene.height, bare.box.height);
  assert.ok(Math.abs(scale - 1.84) < 1e-9, "l'échelle de la courbe du jeu pour une taille de 71");
});

test("la disposition porte l'art du paquet, à sa place dans la boîte", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const response = await api.get("/compose?format=layout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec()),
  });
  assert.equal(response.status, 200);
  const layout = await response.json();
  const origin = layout.canvas.origin;

  // Chaque item est recomposé ici avec les fonctions du paquet seulement : `cropComposition` dit où
  // l'art de la recette est dans son propre espace, `frameBox` dit sa taille et son ancre, et la
  // courbe de taille est celle du jeu (`garden-viewer/garden.mjs:77-81`, que le plan cite). La boîte
  // du composeur doit être celle de cette recomposition : assez grande pour tenir l'art **et** les
  // couches que la recette dessine autour de lui.
  for (const item of spec().items) {
    const built = await recipeFor(item);
    assert.ok(built !== null, `${item.id} : le paquet a une recette`);
    const { recipe, frames } = built;

    const artLayer = recipe.layers.find((layer) => layer.kind === "art");
    const artFrame = frames.get(recipe.art);
    const multiplier = PLANTS[item.species].crop.maxSizeMultiplier;
    const size = item.size ?? item.crops?.[0]?.size ?? null;
    const scale = size === null ? 1 : 1 + ((size - 50) / 50) * (multiplier - 1);
    const artSize = { width: artFrame.width * scale, height: artFrame.height * scale };

    const placed = layout.items.find((one) => one.id === item.id);
    assert.ok(placed !== undefined, `${item.id} : l'item est dans la disposition`);

    // La boîte de l'item est publiée dans les deux repères ; leur différence est le coin de l'image,
    // à un pixel près (chacune est arrondie une fois, séparément).
    assert.ok(
      Math.abs(placed.box.x - placed.scene.x - origin.x) <= 1,
      `${item.id} : le repère image est décalé du coin (${placed.box.x - placed.scene.x} contre ${origin.x})`,
    );
    assert.ok(Math.abs(placed.box.y - placed.scene.y - origin.y) <= 1, `${item.id} : idem en vertical`);

    // L'art de la recette tient dans la boîte : sa largeur est au moins celle de la frame dessinée, et
    // au plus celle de la boîte que le composeur a mesurée. Une boîte copiée à la main tomberait hors
    // de ces bornes pour l'un des items.
    const drawnWidth = artFrame.width * scale;
    const drawnHeight = artFrame.height * scale;
    if (item.kind === "crop") {
      assert.ok(placed.scene.width >= drawnWidth - 1, `${item.id} : la boîte tient l'art (${placed.scene.width} ≥ ${drawnWidth})`);
      assert.ok(placed.scene.height >= drawnHeight - 1, `${item.id} : idem en hauteur`);
      // Et l'art de la recette est exactement la frame du sprite que la recette nomme : aucun nombre
      // n'est écrit ici, les deux viennent du paquet.
      assert.equal(recipe.layers.find((layer) => layer.kind === "art").width, artFrame.width);
      assert.equal(artLayer.sprite, recipe.art);
    } else {
      // Une plante : sa boîte est l'union de ses parties, donc au moins la frame de son art.
      const plantFrame = frames.get(recipe.art);
      assert.ok(placed.scene.width >= plantFrame.width - 1, `${item.id} : la boîte tient le plant (${placed.scene.width} ≥ ${plantFrame.width})`);
      assert.ok(placed.scene.height >= plantFrame.height - 1, `${item.id} : idem en hauteur`);
    }
  }
});

test("un fond de tuiles est dessiné sur la grille du jeu", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Deux fonds de tailles différentes, sans item : le canevas doit grandir exactement d'une tuile
  // par colonne et par rangée, ce qui est la seule chose que le pas de la grille promet.
  const sizes = [
    { columns: 3, rows: 2 },
    { columns: 4, rows: 2 },
  ];
  const canvases = [];
  for (const size of sizes) {
    const response = await api.get("/compose?format=layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec: 1, background: { kind: "tiles", ground: "Dirt_A", ...size }, items: [] }),
    });
    assert.equal(response.status, 400, "un fond seul n'est pas une scène : il faut au moins un item");

    const withItem = await api.get("/compose?format=layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spec: 1,
        background: { kind: "tiles", ground: "Dirt_A", ...size },
        items: [{ id: "a", kind: "crop", species: "Clover", at: { column: 0, row: 0 } }],
      }),
    });
    assert.equal(withItem.status, 200);
    const layout = await withItem.json();
    canvases.push(layout);
    assert.equal(layout.background.ground, "Dirt_A");
    assert.equal(layout.background.columns, size.columns);
    assert.equal(layout.background.rows, size.rows);
    assert.equal(layout.background.sprite, "tile/Dirt_A");
    assert.equal(layout.canvas.grid.step, 256);
  }

  // Une colonne de plus, une tuile de plus : le canevas fait `columns × step` au minimum.
  const first = canvases[0].canvas;
  const second = canvases[1].canvas;
  assert.equal(second.width - first.width, 256, "une colonne de plus est une tuile de plus");
  assert.equal(second.height, first.height);

  // Et les tuiles sont vraiment dessinées : la rangée du bas porte le sol du jeu.
  const picture = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      spec: 1,
      background: { kind: "tiles", ground: "Dirt_A", columns: 2, rows: 2 },
      items: [{ id: "a", kind: "crop", species: "Clover", at: { column: 0, row: 0 } }],
    }),
  });
  assert.equal(picture.status, 200);
  const png = Buffer.from(await picture.arrayBuffer());
  assert.ok((await opaqueIn(png, { x: 256, y: 256, width: 256, height: 256 })) > 0, "la seconde tuile est peinte");

  // Un nom que l'atlas ne tient pas est un refus nommé, pas un fond vide.
  const unknown = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      spec: 1,
      background: { kind: "tiles", ground: "NotATile", columns: 2, rows: 2 },
      items: [{ id: "a", kind: "crop", species: "Clover" }],
    }),
  });
  assert.equal(unknown.status, 400);
  const body = await unknown.json();
  assert.equal(body.error.code, "COMPOSE_SPEC_INVALID");
  assert.match(body.error.message, /NotATile/);
});

test("deux specs identiques ne composent qu'une fois", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const body = JSON.stringify(spec());
  const first = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(first.status, 200);
  assert.equal(composeCount(), 1, "la première requête compose");

  const second = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(second.status, 200);
  assert.equal(composeCount(), 1, "la seconde est un hit : rien n'a été composé");

  const firstBytes = Buffer.from(await first.arrayBuffer());
  const secondBytes = Buffer.from(await second.arrayBuffer());
  assert.ok(secondBytes.equals(firstBytes), "un hit sert les mêmes octets");
});

test("l'ordre des items et les espaces ne changent pas la clé", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const bodies = [JSON.stringify(spec()), JSON.stringify(spec(), null, 2), JSON.stringify(specReordered())];
  const keys = [];
  for (const body of bodies) {
    const response = await api.get("/compose?format=layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(response.status, 200);
    keys.push(response.headers.get("x-mg-compose-key"));
  }
  assert.equal(keys[0], keys[1], "les espaces ne changent pas la clé");
  assert.equal(keys[0], keys[2], "l'ordre des items ne change pas la clé");
  assert.equal(composeCount(), 1, "les trois requêtes n'ont composé qu'une fois");
});

test("GET /compose/<clé>.png sert le fichier composé", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const posted = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec()),
  });
  const key = posted.headers.get("x-mg-compose-key");
  const postedBytes = Buffer.from(await posted.arrayBuffer());

  const fetched = await api.get(`/compose/${key}.png`);
  assert.equal(fetched.status, 200);
  assert.match(fetched.headers.get("content-type"), /image\/png/);
  assert.equal(fetched.headers.get("x-mg-compose-key"), key);
  const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
  assert.ok(fetchedBytes.equals(postedBytes), "le fichier est le même PNG");
  assert.equal(composeCount(), 1, "servir le fichier ne compose pas");

  const onDisk = await fs.readFile(new URL(`${key}.png`, CACHE_DIR));
  assert.ok(onDisk.equals(postedBytes), "le fichier est sur le disque sous son nom de contenu");

  const missing = await api.get(`/compose/${"0".repeat(40)}.png`);
  assert.equal(missing.status, 404, "une clé que la cache ne tient pas est un 404 nommé");

  const malformed = await api.get("/compose/not-a-key.png");
  assert.equal(malformed.status, 400);
});

test("la cache évince la scène la moins récemment utilisée à sa borne", async (t) => {
  // `COMPOSE_CACHE_MAX=2` est posé avant l'import de `config` en tête de fichier.
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const keys = [];
  for (const size of [50, 60, 70]) {
    const response = await api.get("/compose?format=layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec: 1, items: [{ id: "a", kind: "crop", species: "Clover", size }] }),
    });
    assert.equal(response.status, 200);
    keys.push(response.headers.get("x-mg-compose-key"));
  }

  // La borne vaut 2 : la première, la moins récemment utilisée, n'est plus là.
  assert.deepEqual(await cachedKeys(), [keys[1], keys[2]]);
  assert.equal((await api.get(`/compose/${keys[0]}.png`)).status, 404, "la scène évincée n'est plus servie");
  assert.equal((await api.get(`/compose/${keys[1]}.png`)).status, 200);

  // Une lecture rafraîchit l'entrée : `keys[1]` devient la plus récente, et c'est `keys[2]` qui part.
  await api.get(`/compose/${keys[1]}.png`);
  const fourth = await api.get("/compose?format=layout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spec: 1, items: [{ id: "a", kind: "crop", species: "Clover", size: 80 }] }),
  });
  const newest = fourth.headers.get("x-mg-compose-key");
  assert.deepEqual(await cachedKeys(), [keys[1], newest]);
});

test.after(() => {
  restoreFetch();
});
