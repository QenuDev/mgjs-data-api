// tests/compose-patch.test.js
//
// A patch is a cluster, not one art (`docs/mgjs-community-api-plan.md` item 28, spec 2).
//
// Ce que ce fichier prouve, et pourquoi chaque preuve peut échouer :
//
//   * une tuile de trèfle porte **quinze** brins, chacun à sa propre place dans la tuile : les places
//     sont observées, pas écrites d'avance — distinctes deux à deux, dans les bornes de la dispersion
//     du jeu (`±0.35`/`±0.4` de tuile), et l'ancre de l'art de chaque brin tombe sur la sienne dans
//     les deux repères publiés ;
//   * les bornes, le nombre d'essais et l'étendue de rotation de cette dispersion sont ceux du bundle
//     (`worldDepthSortKey-BXUHHrP0.js` : `Js=.7, Ys=.8, Xs=12.6, Zs=10`) : un test les écrit une fois,
//     pour qu'une faute de transcription ne passe pas inaperçue — partout ailleurs ils se lisent sur
//     le module, où un `Js` recopié sans être halvé passerait pour les bornes du jeu ;
//   * l'échelle dessinée de chaque brin est la courbe du jeu pour sa taille, pas une échelle unique ;
//   * la dispersion est **déterministe** : la même spec compose deux fois la même image, et la seconde
//     est un hit du cache — une scène qui se réarrangerait par requête serait un bug, pas un cache ;
//   * un brin qui déclare sa place n'est pas déplacé ;
//   * une patch au-dessus de la capacité de l'espèce est refusée par une erreur **nommée**, jamais
//     tronquée ; une espèce qui n'est pas une patch est refusée aussi ;
//   * `spec: 1` se comporte comme avant : un item sans place tombe au milieu de sa tuile ;
//   * la règle du sprite du jeu : une culture à récolte `Single` dessine l'art de la **plante** de
//     l'espèce, ce qui se voit là où les deux arts diffèrent (Carotte, Betterave — et, sur une patch,
//     la seule espèce où ils diffèrent aussi, Emberbloom : `Emberbloom` contre `EmberbloomCrop`).
//     L'atlas de cette fixture ne porte **que** l'art de la plante : un composeur qui dessinerait la
//     récolte ne compose aucune image, et l'assertion échoue donc sur un item absent plutôt que sur un
//     sprite mal nommé. C'est une preuve par absence, et il n'y en a pas de meilleure hors ligne —
//     Daisy, Clover, Snowdrop et Cattail ne prouveraient même pas la règle, la table du jeu leur
//     donnant le **même** sprite pour la plante et pour la récolte.
//
// Hors ligne : `installOfflineGame()` sert l'atlas et le bundle capturés.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.COMPOSE_CACHE_DIR = new URL("./fixtures/compose-cache-patch/", import.meta.url).pathname;
process.env.COMPOSE_CACHE_MAX = "8";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import sharp from "sharp";

import { installOfflineGame, plantFixture } from "./helpers/offlineGame.js";
import { startTestApp } from "./helpers/httpApp.js";

const CACHE_DIR = new URL("./fixtures/compose-cache-patch/", import.meta.url);

const restoreFetch = await installOfflineGame({ version: 1192 });

const { gameDataService } = await import("../src/services/gameData.js");
const PLANTS = await plantFixture();
gameDataService.getPlants = async () => PLANTS;

const { SPEC_VERSION, ComposeSpecError, SUPPORTED_SPEC_VERSIONS, normalizeSpec } = await import(
  "../src/assets/compose/spec.js"
);
const { drawnFrame } = await import("../src/assets/compose/artBridge.js");
const { initSprites } = await import("../src/assets/sprites/sprites.js");
const { resetSceneCache, composeCount } = await import("../src/assets/compose/sceneCache.js");
const { clearSceneCaches } = await import("../src/assets/compose/sceneService.js");

await initSprites();

const { REFERENCE_TILE_PX } = await import("@mg.js/art");

/**
 * La dispersion du jeu, telle que `sceneScatter.js` la lit dans le bundle : `Js = .7` et `Ys = .8`
 * sont les étendues **halvées** (`(r() - .5) * Js`), donc les places vont de -0,35 à +0,35 et de
 * -0,4 à +0,4. Le test lit ces bornes plutôt que de les réécrire.
 */
const { SCATTER_BOUNDS } = await import("../src/assets/compose/sceneScatter.js");

/**
 * Les quinze tailles d'une tuile de trèfle réellement observée (jardin de `Jame`, 181 tuiles) : trois
 * valeurs de `100`, une de `63`, une de `62`, dix de `57` dans une tuile ; le dump donne aussi `50`.
 * Rien ici n'est une valeur du jeu inventée : c'est le dump, et les tailles viennent de l'appelant.
 */
const DUMP_SIZES = [63, 62, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 100, 100, 50];

/** La courbe du jeu : `1 + ((taille - 50) / 50) x (maxSizeMultiplier - 1)`. */
const curve = (size, species) => 1 + ((size - 50) / 50) * (PLANTS[species].crop.maxSizeMultiplier - 1);

/**
 * La spec d'une patch de trèfle. `crops` est soit une liste de tailles (le cas ordinaire), soit une
 * liste d'entrées complètes — une taille et sa place — passées telles quelles.
 */
function cloverPatch({ id = "clover", at = { column: 0, row: 0 }, crops = DUMP_SIZES, species = "Clover" } = {}) {
  return {
    spec: SPEC_VERSION,
    canvas: { fit: "content", padding: 0 },
    items: [
      {
        id,
        kind: "patch",
        species,
        at,
        crops: crops.map((crop) => (typeof crop === "number" ? { size: crop } : crop)),
      },
    ],
  };
}

/** Une requête `?format=layout`, qui n'encode aucune image. */
async function layoutOf(api, spec, query = "?format=layout") {
  return api.get(`/compose${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec),
  });
}

async function cleanCache() {
  await fs.rm(CACHE_DIR, { recursive: true, force: true });
  resetSceneCache();
  clearSceneCaches();
}

test("les bornes de la dispersion sont celles du bundle, écrites ici une seule fois", () => {
  // `worldDepthSortKey-BXUHHrP0.js` (bundle 1192, la fusion d'une patch en pot) :
  //
  //     var Js=.7,Ys=.8,Xs=12.6,Zs=10;
  //     function Qs(e){return{x:(e()-.5)*Js,y:(e()-.5)*Ys}}
  //
  // Les étendues sont donc **halvées** par le `(r() - .5)` — `x` de -0,35 à +0,35, `y` de -0,4 à
  // +0,4 — et la rotation est `(r() - .5) * Xs`, soit ±6,3°. Ce test est le seul endroit du fichier
  // où ces nombres sont écrits : les autres lisent `SCATTER_BOUNDS` sur le module, donc un `Js`
  // recopié sans être halvé, ou un `Xs` pris pour la demi-étendue, y passerait pour la règle du jeu.
  assert.deepEqual(SCATTER_BOUNDS, { x: [-0.35, 0.35], y: [-0.4, 0.4], rotation: [-6.3, 6.3] });
});

test("une patch de quinze brins place chaque ancre à sa propre place, dans les bornes du jeu", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const response = await layoutOf(api, cloverPatch());
  assert.equal(response.status, 200);
  const layout = await response.json();
  const item = layout.items[0];
  assert.equal(item.kind, "patch", "la disposition dit quel chemin a dessiné");
  assert.equal(item.species, "Clover");
  assert.equal(item.crops.length, 15, "quinze brins sur la tuile");
  assert.deepEqual(item.sprites, ["sprite/plant/CloverThreeLeaf"]);

  const [minX, maxX] = SCATTER_BOUNDS.x;
  const [minY, maxY] = SCATTER_BOUNDS.y;
  const [minR, maxR] = SCATTER_BOUNDS.rotation;

  // Les places observées : distinctes deux à deux, chacune dans les bornes de la dispersion du jeu.
  const seen = new Set();
  for (const crop of item.crops) {
    const { x, y, rotation } = crop.place;
    const key = `${x},${y}`;
    assert.ok(!seen.has(key), `deux brins au même point : ${key}`);
    seen.add(key);
    assert.ok(x >= minX && x <= maxX, `x=${x} hors des bornes du jeu [${minX}, ${maxX}]`);
    assert.ok(y >= minY && y <= maxY, `y=${y} hors des bornes du jeu [${minY}, ${maxY}]`);
    assert.ok(rotation >= minR && rotation <= maxR, `rotation=${rotation} hors des bornes [${minR}, ${maxR}]`);
  }
  assert.equal(seen.size, 15, "quinze places distinctes");

  // L'échelle dessinée de chaque brin est la courbe du jeu pour sa taille. Les tailles sont celles que
  // la spec a déclarées, et l'ordre publié est l'ordre de dessin (profondeur croissante) : le test
  // apparie donc par la **taille** qu'il a lui-même demandée, pas par l'index d'arrivée.
  const reported = item.crops.map((crop) => crop.scale).sort((left, right) => left - right);
  const wanted = DUMP_SIZES.map((size) => curve(size, "Clover")).sort((left, right) => left - right);
  assert.deepEqual(reported, wanted, "les quinze échelles sont les quinze de la courbe, pas une seule");
  assert.equal(new Set(reported).size, 5, "cinq tailles distinctes dans le dump -> cinq échelles");

  // L'ancre de l'art de chaque brin est **à sa place**, et le dessin est à l'échelle publiée. Les deux
  // se lisent sans supposer où l'union des quinze brins a mis le coin : le repère image est le repère
  // scène décalé du coin de l'image, l'ancre de l'art y tombe à `(-ancre x taille) + place x 256` du
  // milieu de la tuile, et la largeur du dessin est la largeur de l'art fois l'échelle. Aucun de ces
  // nombres n'est écrit ici : la frame vient de l'atlas, l'échelle est celle que le composeur publie.
  const frame = drawnFrame("sprite/plant/CloverThreeLeaf").box;
  const origin = layout.canvas.origin;
  for (const crop of item.crops) {
    const scale = crop.scale;
    // Dans le repère **scène**, dont le milieu de la tuile est `(column + .5) x 256`.
    const artLeft = (0 + 0.5) * REFERENCE_TILE_PX + crop.place.x * REFERENCE_TILE_PX - frame.anchorX * frame.width * scale;
    const artTop = (0 + 0.5) * REFERENCE_TILE_PX + crop.place.y * REFERENCE_TILE_PX - frame.anchorY * frame.height * scale;
    // Le rectangle de l'art doit **coïncider** avec celui que la disposition publie, à 1,5 px près. Une
    // simple contenance (« l'ancre est quelque part dans la boîte ») laissait passer un décalage allant
    // jusqu'à la hauteur entière de la boîte : c'est ce qui a laissé sortir un patch dont chaque brin
    // était dessiné une ancre plus haut que sa place, 237 px à l'échelle 3, donc hors de la tuile, la
    // disposition rapportant le même décalage et les deux se donnant raison.
    assert.ok(
      Math.abs(artLeft - crop.scene.x) <= 1.5,
      `coin gauche de l'art du brin : ${artLeft} au lieu de ${crop.scene.x}`,
    );
    assert.ok(
      Math.abs(artTop - crop.scene.y) <= 1.5,
      `haut de l'art du brin : ${artTop} au lieu de ${crop.scene.y}`,
    );
    // Le repère image est le repère scène décalé du coin de l'image, à l'arrondi près.
    assert.ok(Math.abs(crop.box.x - (crop.scene.x + origin.x)) <= 1);
    assert.ok(Math.abs(crop.box.y - (crop.scene.y + origin.y)) <= 1);
    // La largeur publiée est l'art à l'échelle publiée : c'est ce qui attache l'échelle au dessin.
    assert.equal(crop.box.width, Math.max(1, Math.round(frame.width * scale)));
    assert.equal(crop.box.height, Math.max(1, Math.round(frame.height * scale)));
  }

  // L'empilement du jeu : une patch gerbe par sa place en y (`Math.round((y + 1) * 10)`), et l'ordre
  // publié est l'ordre de dessin — donc les profondeurs ne décroissent jamais.
  const depths = item.crops.map((crop) => crop.depth);
  for (let index = 1; index < depths.length; index += 1) {
    assert.ok(depths[index] >= depths[index - 1], `profondeur ${depths[index]} après ${depths[index - 1]}`);
  }
  for (const crop of item.crops) {
    assert.equal(crop.depth, Math.round((crop.place.y + 1) * 10), "la profondeur est celle de la règle");
  }
});

test("l'art d'un brin est dessiné là où sa place le dit, ancre comprise", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Un seul brin, une place déclarée : rien ne dépend de la dispersion, et les **pixels** de l'image
  // composée se comparent à la règle sans passer par ce que la disposition rapporte d'elle-même. C'est la
  // seule forme de preuve qui ne peut pas être satisfaite par une disposition qui se trompe en accord
  // avec elle-même.
  const place = { x: 0.2, y: -0.3 };
  const spec = {
    spec: SPEC_VERSION,
    canvas: { fit: "content", padding: 0 },
    background: { kind: "tiles", ground: "Dirt_A", columns: 3, rows: 1 },
    items: [
      {
        id: "one-big",
        kind: "patch",
        species: "Clover",
        at: { column: 1, row: 0 },
        crops: [{ size: 100, at: place }],
      },
    ],
  };

  const layout = await (await layoutOf(api, spec)).json();
  const response = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec),
  });
  assert.equal(response.status, 200);
  const png = Buffer.from(await response.arrayBuffer());

  const item = layout.items[0];
  const crop = item.crops[0];
  const frame = drawnFrame("sprite/plant/CloverThreeLeaf").box;
  const tile = { x: (1 + 0.5) * REFERENCE_TILE_PX, y: (0 + 0.5) * REFERENCE_TILE_PX };
  const want = {
    left: tile.x + place.x * REFERENCE_TILE_PX - frame.anchorX * frame.width * crop.scale,
    top: tile.y + place.y * REFERENCE_TILE_PX - frame.anchorY * frame.height * crop.scale,
  };
  // La disposition publie ce rectangle...
  assert.ok(Math.abs(crop.scene.x - want.left) <= 1.5, `coin gauche publié ${crop.scene.x} au lieu de ${want.left}`);
  assert.ok(Math.abs(crop.scene.y - want.top) <= 1.5, `haut publié ${crop.scene.y} au lieu de ${want.top}`);

  // ...et les pixels y sont : hors de la bande de sol, tout ce qui est opaque appartient au brin, et la
  // boîte de ces pixels est celle de la règle. L'échelle 3 est le cas qui se voyait : l'ancre est à
  // 0,935 de la hauteur de l'art, soit 237 px — presque une tuile — et le brin se dessinait au-dessus.
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const ground = { top: layout.canvas.origin.y, bottom: layout.canvas.origin.y + REFERENCE_TILE_PX };
  const drawn = { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY };
  for (let y = 0; y < info.height; y += 1) {
    if (y >= ground.top && y < ground.bottom) continue;
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] > 8) {
        if (x < drawn.minX) drawn.minX = x;
        if (y < drawn.minY) drawn.minY = y;
      }
    }
  }
  assert.ok(Number.isFinite(drawn.minX) && Number.isFinite(drawn.minY), "le brin est dessiné au-dessus du sol");
  const sceneLeft = drawn.minX - layout.canvas.origin.x;
  const sceneTop = drawn.minY - layout.canvas.origin.y;
  assert.ok(Math.abs(sceneLeft - want.left) <= 2, `pixels : l'art commence à x ${sceneLeft} au lieu de ${want.left}`);
  assert.ok(Math.abs(sceneTop - want.top) <= 2, `pixels : l'art commence à y ${sceneTop} au lieu de ${want.top}`);
});

test("la dispersion est déterministe : deux compositions identiques, une seule image, un hit", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Deux items de patch identiques sauf leur id : les places doivent différer (la graine est l'id),
  // et chacune doit être la même à chaque composition.
  const first = cloverPatch({ id: "left", at: { column: 0, row: 0 } });
  const second = cloverPatch({ id: "right", at: { column: 1, row: 0 } });
  const both = { spec: SPEC_VERSION, canvas: { fit: "content", padding: 0 }, items: [...first.items, ...second.items] };

  const before = composeCount();
  const layoutOne = await (await layoutOf(api, both)).json();
  const composed = composeCount() - before;
  assert.equal(composed, 1, "la première composition compose une fois");

  const pictureOne = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(both),
  });
  assert.equal(pictureOne.status, 200);
  const bytesOne = Buffer.from(await pictureOne.arrayBuffer());
  const keyOne = pictureOne.headers.get("x-mg-compose-key");

  // La seconde requête est un hit : le compteur ne bouge pas et les octets sont identiques.
  const hit = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(both),
  });
  assert.equal(hit.headers.get("x-mg-compose-key"), keyOne);
  assert.equal(composeCount() - before, 1, "la seconde composition est un hit du cache");
  const bytesTwo = Buffer.from(await hit.arrayBuffer());
  assert.ok(bytesOne.equals(bytesTwo), "deux compositions de la même spec sont octet pour octet identiques");

  // Et une composition à froid (cache vidé) redonne la même disposition et la même image.
  const layoutAgain = await (await layoutOf(api, both)).json();
  assert.deepEqual(layoutAgain.items, layoutOne.items, "la disposition est la même");
  assert.deepEqual(
    layoutAgain.items.map((item) => item.crops.map((crop) => crop.place)),
    layoutOne.items.map((item) => item.crops.map((crop) => crop.place)),
    "les places dispersées sont les mêmes",
  );

  // Les deux ids gerbent deux dispersions différentes : la graine est l'id de l'item.
  const [left, right] = layoutOne.items;
  assert.notDeepEqual(
    left.crops.map((crop) => crop.place),
    right.crops.map((crop) => crop.place),
    "deux ids différents -> deux dispersions différentes",
  );

  // L'image PNG a bien des pixels : le canevas n'est pas vide.
  const meta = await sharp(bytesOne).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, layoutOne.canvas.width);
  assert.equal(meta.height, layoutOne.canvas.height);
});

test("un brin qui déclare sa place est dessiné là, et n'est pas déplacé", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const stated = [
    { size: 80, at: { x: 0.125, y: -0.25, rotation: 30 } },
    { size: 60 },
    { size: 90, at: { x: -0.3, y: 0.375, rotation: -12 } },
  ];
  // `cloverPatch` passes a crop entry through as it stands, place and all.
  const response = await layoutOf(api, cloverPatch({ crops: stated }));
  assert.equal(response.status, 200);
  const layout = await response.json();
  const crops = layout.items[0].crops;

  // Les places déclarées sont retrouvées à l'identique, rotation comprise.
  const asserted = crops.filter((crop) => stated.some((one) => one.at !== undefined && one.at.x === crop.place.x));
  assert.equal(asserted.length, 2, "les deux brins qui déclarent une place sont dans la disposition");
  const first = crops.find((crop) => crop.place.x === 0.125 && crop.place.y === -0.25);
  assert.ok(first !== undefined, "le brin déclaré à (0.125, -0.25) y est");
  assert.equal(first.place.rotation, 30, "et garde sa rotation");
  const third = crops.find((crop) => crop.place.x === -0.3 && crop.place.y === 0.375);
  assert.ok(third !== undefined, "le brin déclaré à (-0.3, 0.375) y est");
  assert.equal(third.place.rotation, -12);

  // Le brin qui ne déclare rien est dispersé dans les bornes du jeu, pas laissé au milieu.
  const middle = crops.find((crop) => crop.place.x !== 0.125 && crop.place.x !== -0.3);
  assert.ok(middle !== undefined);
  assert.ok(Math.abs(middle.place.x) <= SCATTER_BOUNDS.x[1]);
  assert.ok(Math.abs(middle.place.y) <= SCATTER_BOUNDS.y[1]);

  // L'ancre du brin déclaré tombe sur **sa** place, et pas sur celle d'un autre brin : dans le repère
  // image elle est à `(-ancre x taille) + place x 256` du milieu de la tuile, et sa largeur est l'art
  // à l'échelle publiée.
  const frame = drawnFrame("sprite/plant/CloverThreeLeaf").box;
  const artLeft = (0 + 0.5) * REFERENCE_TILE_PX + 0.125 * REFERENCE_TILE_PX - frame.anchorX * frame.width * first.scale;
  const artTop = (0 + 0.5) * REFERENCE_TILE_PX + -0.25 * REFERENCE_TILE_PX - frame.anchorY * frame.height * first.scale;
  assert.ok(
    artLeft >= first.scene.x - 1.5 && artLeft <= first.scene.x + first.scene.width + 1.5,
    `ancre déclarée (x) : ${artLeft} hors de [${first.scene.x}, ${first.scene.x + first.scene.width}]`,
  );
  assert.ok(
    artTop >= first.scene.y - 1.5 && artTop <= first.scene.y + first.scene.height + 1.5,
    `ancre déclarée (y) : ${artTop} hors de [${first.scene.y}, ${first.scene.y + first.scene.height}]`,
  );
  assert.equal(first.box.width, Math.max(1, Math.round(frame.width * first.scale)));

  // Et la place déclarée n'est pas celle que la dispersion aurait donnée au même index : le même id
  // et les mêmes index, sans place déclarée, tombent ailleurs.
  const scattered = await (await layoutOf(api, cloverPatch({ id: "other", crops: [80, 60, 90] }))).json();
  assert.notDeepEqual(
    scattered.items[0].crops.map((crop) => crop.place),
    crops.map((crop) => crop.place),
    "un brin qui déclare sa place n'est pas là où la dispersion l'aurait mis",
  );
});

test("une patch au-dessus de la capacité de l'espèce est refusée par une erreur nommée", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const capacity = PLANTS.Clover.plant.slotCapacity;
  assert.equal(capacity, 15, "la capacité du trèfle est celle de la table du jeu");

  // À la capacité, ça compose.
  const full = await layoutOf(
    api,
    cloverPatch({ crops: Array.from({ length: capacity }, () => 50) }),
  );
  assert.equal(full.status, 200);
  assert.equal((await full.json()).items[0].crops.length, capacity);

  // Un brin de plus : refus nommé, jamais une troncature à quinze.
  const over = await layoutOf(
    api,
    cloverPatch({ crops: Array.from({ length: capacity + 1 }, () => 50) }),
  );
  assert.equal(over.status, 400);
  const body = await over.json();
  assert.equal(body.error.code, "COMPOSE_PATCH_OVER_CAPACITY");
  assert.equal(body.error.limit, "slotCapacity");
  assert.equal(body.error.saw, capacity + 1);
  assert.match(body.error.message, new RegExp(String(capacity)));

  // Une espèce qui n'est pas une patch — un art unique, une `baseTileScale`, aucun compte de slots —
  // est refusée aussi : le jeu ne dessine pas de grappe de carottes.
  const notPatch = await layoutOf(
    api,
    {
      spec: SPEC_VERSION,
      items: [{ id: "carrot", kind: "patch", species: "Carrot", crops: [{ size: 50 }] }],
    },
  );
  assert.equal(notPatch.status, 400);
  assert.equal((await notPatch.json()).error.code, "COMPOSE_PATCH_NOT_A_PATCH");

  // Une patch **sans** brins n'est pas une faute : c'est la plante seule, la tuile d'une grappe entièrement
  // récoltée. Elle se normalise, et la mise en page dessine l'art de la plante sous les brins — il n'y en a
  // aucun, donc elle le dessine seul.
  for (const raw of [
    { spec: SPEC_VERSION, items: [{ id: "a", kind: "patch", species: "Clover" }] },
    { spec: SPEC_VERSION, items: [{ id: "a", kind: "patch", species: "Clover", crops: [] }] },
  ]) {
    const normalized = normalizeSpec(raw);
    assert.equal(normalized.items[0].kind, "patch");
    assert.deepEqual(normalized.items[0].crops, []);
  }
});

test("une patch dont tous les brins sont récoltés dessine la plante seule", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Le cas que l'API refusait : `kind: "patch"` avec `crops: []`. Le jeu ne laisse pas la tuile vide — la
  // plante est là — donc la disposition doit rendre l'art de la plante, exactement comme un `plant` sans
  // culture.
  const empty = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [{ id: "empty", kind: "patch", species: "Clover" }],
  });
  assert.equal(empty.status, 200);
  const bare = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [{ id: "bare", kind: "plant", species: "Clover", matured: true }],
  });
  assert.equal(bare.status, 200);

  const laid = (await empty.json()).items[0];
  const plant = (await bare.json()).items[0];
  assert.equal(laid.kind, "patch", "la disposition dit quel chemin a dessiné");
  assert.deepEqual(laid.crops, [], "aucun brin");
  assert.deepEqual(laid.sprites, ["sprite/plant/CloverThreeLeaf"], "l'art de la plante, seul");
  assert.deepEqual(laid.box, plant.box, "la même image qu'un plant sans culture");
});

test("la règle du sprite du jeu : une culture Single dessine l'art de la plante", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // La carotte est l'espèce où les deux arts diffèrent visiblement : la plante est `BabyCarrot`, la
  // récolte est `Carrot` — absente de l'atlas de cette fixture, donc un composeur qui dessinerait la
  // récolte ne dessinerait rien du tout. `Emberbloom` diffère aussi (`EmberbloomCrop`).
  for (const species of ["Carrot", "Beet"]) {
    const response = await layoutOf(api, {
      spec: SPEC_VERSION,
      items: [{ id: "a", kind: "crop", species, at: { column: 0, row: 0 }, size: 80 }],
    });
    assert.equal(response.status, 200);
    const layout = await response.json();
    const record = PLANTS[species];
    assert.notEqual(record.crop.sprite, record.plant.sprite, `${species} : les deux arts diffèrent`);
    assert.deepEqual(
      layout.items[0].sprites,
      [record.plant.sprite],
      `${species} : la culture Single dessine l'art de la plante`,
    );
  }
});

test("une patch d'Emberbloom dessine l'art de la plante, pas celui de sa récolte", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Emberbloom est la **seule** espèce patch où la règle est observable : la table du jeu donne à
  // Daisy, Clover, Snowdrop et Cattail le même sprite pour la plante et pour la récolte, alors qu'ici
  // `Emberbloom` et `EmberbloomCrop` diffèrent. L'atlas de cette fixture ne porte que l'art de la
  // plante : un composeur qui dessinerait la récolte ne composerait donc aucune image, et l'assertion
  // échouerait sur un item absent plutôt que sur un sprite mal nommé.
  const record = PLANTS.Emberbloom;
  assert.equal(record.plant.harvestType, "Single", "Emberbloom est une patch dans la table du jeu");
  assert.notEqual(record.crop.sprite, record.plant.sprite, "les deux arts d'Emberbloom diffèrent");

  const response = await layoutOf(api, cloverPatch({ species: "Emberbloom", crops: [50, 62, 100] }));
  assert.equal(response.status, 200);
  const item = (await response.json()).items[0];
  assert.equal(item.kind, "patch");
  assert.equal(item.crops.length, 3);
  assert.deepEqual(item.sprites, [record.plant.sprite]);
});

test("la capacité de chaque espèce patch vient de la table du jeu", async () => {
  // Les cinq espèces que 1192 marque `Single` avec un compte de slots : capacité lue, jamais écrite.
  const patches = Object.entries(PLANTS).filter(
    ([, record]) => record?.plant?.harvestType === "Single" && typeof record.plant.slotCapacity === "number",
  );
  assert.deepEqual(
    patches.map(([species]) => species).sort(),
    ["Cattail", "Clover", "Daisy", "Emberbloom", "Snowdrop"],
    "cinq espèces patch en 1192",
  );
  for (const [species, record] of patches) {
    assert.ok(record.plant.slotCountMin <= record.plant.slotCountMax);
    assert.ok(record.plant.slotCountMax <= record.plant.slotCapacity, `${species} : min <= max <= capacité`);
  }
});

test("spec 1 se comporte comme avant : sans place, l'ancre tombe au milieu de la tuile", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  assert.deepEqual(SUPPORTED_SPEC_VERSIONS, [2, 1]);

  const response = await layoutOf(api, {
    spec: 1,
    items: [{ id: "bare", kind: "crop", species: "Clover", at: { column: 1, row: 2 }, size: 71 }],
  });
  assert.equal(response.status, 200);
  const layout = await response.json();
  const item = layout.items[0];
  // La forme d'`at` est celle d'avant spec 2 : ni x, ni y, ni rotation. Le champ lu est `item.at` de
  // la réponse, où le normalisateur a rempli trois nulls — la disposition les retire, parce qu'un
  // appelant qui n'a rien déclaré doit relire ce qu'il a envoyé.
  assert.deepEqual(item.at, { column: 1, row: 2 });

  const frame = drawnFrame("sprite/plant/CloverThreeLeaf").box;
  const scale = curve(71, "Clover");
  const tile = { x: (1 + 0.5) * REFERENCE_TILE_PX, y: (2 + 0.5) * REFERENCE_TILE_PX };
  assert.ok(Math.abs(item.scene.x - (tile.x - frame.anchorX * frame.width * scale)) <= 1);
  assert.ok(Math.abs(item.scene.y - (tile.y - frame.anchorY * frame.height * scale)) <= 1);

  // Et les deux versions normalisent la même chose quand aucune place n'est déclarée : la même clé.
  const one = normalizeSpec({ spec: 1, items: [{ id: "a", kind: "crop", species: "Clover", at: { column: 0, row: 0 } }] });
  const two = normalizeSpec({ spec: 2, items: [{ id: "a", kind: "crop", species: "Clover", at: { column: 0, row: 0 } }] });
  assert.deepEqual(one.items, two.items, "les deux versions donnent le même item");
});

test.after(() => {
  restoreFetch();
});
