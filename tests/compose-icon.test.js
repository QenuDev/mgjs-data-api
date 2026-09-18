// tests/compose-icon.test.js
//
// L'icône d'une entrée d'inventaire : une art, dans le carré de 256 pixels du jeu, à la part que son
// genre remplit. La règle est celle du constructeur d'icônes du jeu et elle est citée une fois pour
// toutes (bundle 1192, `resources-D_3Zwcn-.js`, relevé dans `.logs/render/bundle-icon-fit.md`) :
//
//     function ji(e, t){ let { sizeRatio: s = 1, … } = … }      // le défaut est 1, dit une seule fois
//     // `en` → `Oe` (`quinoaAssetResolver-CVtuXws2.js`) : `function $r(e, t, n){ return n / Math.max(e, t, 1) }`
//     //   donc l'échelle est `(256 x sizeRatio) / max(largeur, hauteur)` : un « contain », pas un étirement.
//     // `zi` : `ji(e, 256)`, puis `s.rect(0, 0, 256, 256)` et `generateTexture({ frame: new _(0, 0, 256, 256) })`
//     // et le placement est `256/2 - (0.5 - ancre) x tailleDessinée` sur chaque axe — l'ancre s'annule.
//
//     var { get: Ti } = o(), Ei = .4, Di = .6, …        // Produce .4, Plant .6, les autres au défaut 1
//
// Ce que le fichier épingle : le carré de 256, la part de chaque genre, le centrage, les deux genres que
// cette API refuse en le disant (une plante est une image assemblée, un animal un portrait cuit depuis
// Rive), et le refus nommé d'un genre ou d'une art que le jeu ne nomme pas.
//
// Hors ligne, sauf les quatre genres dont les arts ne sont pas dans la fixture : la fixture de sprites ne
// contient que des plantes et des mutations, donc une graine, un outil, un œuf et une décoration se
// sautent en le disant et `MG_LIVE_ASSETS=1 npm run test:live` les exécute.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.COMPOSE_CACHE_DIR = new URL("./fixtures/compose-cache-icon/", import.meta.url).pathname;
process.env.COMPOSE_CACHE_MAX = "8";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

import { installOfflineGame, plantFixture } from "./helpers/offlineGame.js";
import { LIVE_ASSETS } from "./helpers/live-assets.js";
import { startTestApp } from "./helpers/httpApp.js";

/**
 * Ce que la fixture hors ligne ne porte pas : les arts d'une graine, d'un outil, d'un œuf et d'une
 * décoration. La production, elle, est l'art de la récolte d'une espèce, qui est dans la fixture.
 */
const NEEDS_LIVE_ATLAS =
  LIVE_ASSETS ? false : "needs the live atlas (the offline fixture holds plants and mutations only) - run `MG_LIVE_ASSETS=1 npm run test:live`";

const CACHE_DIR = new URL("./fixtures/compose-cache-icon/", import.meta.url);

const restoreFetch = LIVE_ASSETS ? () => {} : await installOfflineGame({ version: 1192 });

const { gameDataService } = await import("../src/services/gameData.js");
const PLANTS = await plantFixture();
gameDataService.getPlants = async () => PLANTS;

/**
 * Les items dont un art dépend, tels que la table du jeu les donne.
 *
 * Les trois valeurs sont celles de `/data/items` (jeu 1211), et elles disent la chose que ce fichier épingle :
 * l'identifiant d'un éclat n'est pas le nom de son art — `HungerShard` est dessiné par `HungerCrystalShard`.
 * Le `Shovel` est là pour la voie ordinaire, où les deux coïncident.
 */
const ITEMS = {
  HungerShard: { sprite: "sprite/item/HungerCrystalShard", name: "Hunger Shard" },
  XPShard: { sprite: "sprite/item/XPCrystalShard", name: "XP Shard" },
  StrengthShard: { sprite: "sprite/item/StrengthCrystalShard", name: "Strength Shard" },
  Shovel: { sprite: "sprite/item/Shovel", name: "Garden Shovel" },
};
gameDataService.getItems = async () => ITEMS;

const { initSprites } = await import("../src/assets/sprites/sprites.js");
await initSprites();

const { ICON_FILL } = await import("@mg.js/art");
const { spritePng } = await import("../src/assets/compose/atlasPixels.js");
const { portraitFrame } = await import("../src/assets/compose/artBridge.js");
const { config } = await import("../src/config/index.js");
const { drawnFrame } = await import("../src/assets/compose/artBridge.js");
const { ICON_BOX_PX } = await import("../src/assets/compose/sceneLayout.js");
const { SPEC_VERSION } = await import("../src/assets/compose/spec.js");
const { resetSceneCache } = await import("../src/assets/compose/sceneCache.js");
const { clearSceneCaches } = await import("../src/assets/compose/sceneService.js");
// La règle qui rapproche un identifiant de données d'un nom d'artboard : celle du côté sprites, que
// `/data/pets` lit aussi (`riveFrames.js`).
const { artboardKey } = await import("../src/assets/sprites/riveFrames.js");
// L'art qu'un outil tient de la table des items, qui est ce que les éclats ci-dessous éprouvent.
const { toolArtName } = await import("../src/assets/compose/artBridge.js");

async function layoutOf(api, item) {
  return api.get("/compose?format=layout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spec: SPEC_VERSION, canvas: { fit: "content", padding: 0 }, items: [item] }),
  });
}

async function cleanCache() {
  await fs.rm(CACHE_DIR, { recursive: true, force: true });
  resetSceneCache();
  clearSceneCaches();
}

/**
 * Les portraits que cette API exporte depuis Rive, et que l'atlas ne porte pas : sans l'export
 * (`sprites_dump/`, ignoré par git, écrit par `exportPetsFromRive.js`) il n'y a pas de portrait à
 * dessiner, et l'épreuve de l'animal se saute en le disant.
 */
const PORTRAITS = path.join(config.sprites.exportDir, "sprite", "pets", "_rive-frames.json");
const NEEDS_PORTRAITS = existsSync(PORTRAITS)
  ? false
  : "needs the Rive portraits this API exports (`sprites_dump/`, written by exportPetsFromRive.js)";

test("la table des parts est celle du jeu : 0,6 pour une plante, 0,4 pour une production, le reste entier", () => {
  // Les deux parts écrites par le jeu (`Di = .6`, `Ei = .4`) et le défaut de `ji` pour les cinq autres.
  assert.deepEqual(
    { ...ICON_FILL },
    { Seed: 1, Produce: 0.4, Plant: 0.6, Tool: 1, Egg: 1, Decor: 1, Pet: 1 },
    "les parts publiées par le paquet, que ses propres épreuves comparent à `data/1192.json`",
  );
  assert.equal(ICON_BOX_PX, 256, "le carré d'icône est le littéral du constructeur du jeu");
});

test("une icône est l'art contenu dans le carré de 256 px, centré, à la part de son genre", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // La production d'une espèce est l'art de sa récolte, que la table des sprites range sous `Plant`.
  const response = await layoutOf(api, { id: "produce", kind: "icon", itemType: "Produce", species: "Bamboo" });
  assert.equal(response.status, 200);
  const layout = await response.json();
  const item = layout.items[0];
  const frame = drawnFrame(PLANTS.Bamboo.crop.sprite);
  const scale = (ICON_BOX_PX * 0.4) / Math.max(frame.box.width, frame.box.height, 1);

  assert.equal(layout.canvas.width, ICON_BOX_PX, "la toile est le carré de l'icône");
  assert.equal(layout.canvas.height, ICON_BOX_PX);
  assert.equal(item.icon.width, ICON_BOX_PX, "et l'item déclare ce carré");
  assert.equal(item.icon.height, ICON_BOX_PX);
  assert.equal(item.z, 2, "une icône est une image de menu, pas un objet du monde");
  // L'art est contenu : son plus grand côté vaut la part du genre dans le carré, et le rapport est gardé.
  assert.equal(item.box.width, Math.round(frame.box.width * scale));
  assert.equal(item.box.height, Math.round(frame.box.height * scale));
  // Et centré : l'art occupe le milieu du carré sur les deux axes.
  assert.ok(Math.abs(item.box.x + item.box.width / 2 - ICON_BOX_PX / 2) <= 0.5, `centré en travers, ${item.box.x}`);
  assert.ok(Math.abs(item.box.y + item.box.height / 2 - ICON_BOX_PX / 2) <= 0.5, `centré en hauteur, ${item.box.y}`);
});

test("une graine, un outil, un œuf et une décoration suivent la part de leur genre", { skip: NEEDS_LIVE_ATLAS }, async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const cases = [
    ["Seed", { species: "Aloe" }],
    ["Tool", { toolId: "WateringCan" }],
    ["Egg", { eggId: "CommonEgg" }],
    ["Decor", { decorId: "Birdhouse" }],
  ];
  for (const [itemType, ids] of cases) {
    const response = await layoutOf(api, { id: "i", kind: "icon", itemType, ...ids });
    assert.equal(response.status, 200);
    const item = (await response.json()).items[0];
    const frame = drawnFrame(item.sprites[0]);
    const scale = (ICON_BOX_PX * ICON_FILL[itemType]) / Math.max(frame.box.width, frame.box.height, 1);
    assert.equal(item.box.width, Math.round(frame.box.width * scale), `${itemType} : la largeur de sa part`);
    assert.equal(item.box.height, Math.round(frame.box.height * scale), `${itemType} : sa hauteur`);
    assert.ok(
      Math.abs(item.box.x + item.box.width / 2 - ICON_BOX_PX / 2) <= 0.5 &&
        Math.abs(item.box.y + item.box.height / 2 - ICON_BOX_PX / 2) <= 0.5,
      `${itemType} : centré dans le carré`,
    );
  }
});

test("l'icône d'un animal est son portrait exporté, dans le même carré de 256 px", { skip: NEEDS_PORTRAITS }, async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Le jeu a sorti les pets de l'atlas pour `rive/pets.riv` : les pixels viennent donc du PNG que
  // l'export de cette API écrit, et le rectangle du sidecar (`sourceSize`, `anchor`, ratio 1).
  const portrait = await portraitFrame("Bunny");
  assert.ok(portrait !== null, "le sidecar nomme le portrait par l'espèce de l'entrée");
  assert.ok((await spritePng(portrait.key)) !== null, "et ses pixels sont lisibles");

  const response = await layoutOf(api, { id: "bunny", kind: "icon", itemType: "Pet", species: "Bunny" });
  assert.equal(response.status, 200);
  const item = (await response.json()).items[0];
  const scale = ICON_BOX_PX / Math.max(portrait.box.width, portrait.box.height, 1);
  assert.equal(item.sprites[0], portrait.key, "la couche nomme le portrait");
  assert.equal(item.box.height, Math.round(portrait.box.height * scale), "contenu dans le carré");
  assert.ok(
    Math.abs(item.box.x + item.box.width / 2 - ICON_BOX_PX / 2) <= 0.5 &&
      Math.abs(item.box.y + item.box.height / 2 - ICON_BOX_PX / 2) <= 0.5,
    "et centré",
  );
});

test("un animal dont l'artboard s'écrit autrement que son identifiant trouve quand même son portrait", { skip: NEEDS_PORTRAITS }, async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Les données du jeu appellent cette espèce `RedFox`, et son artboard — donc le fichier que l'export
  // écrit, `sprite/pet/Red Fox` — l'appelle `Red Fox`. Le côté données de cet écart se lit dans
  // `/data/pets` (`petTransformer.js` le rapproche pour la même raison) ; c'est le côté image qui est
  // épinglé ici : une entrée d'inventaire nomme l'espèce, pas l'artboard.
  assert.equal(artboardKey("RedFox"), artboardKey("Red Fox"), "la règle rapproche les deux orthographes");
  const portrait = await portraitFrame("RedFox");
  assert.ok(portrait !== null, "le portrait se lit à l'identifiant comme à l'artboard");
  assert.equal(portrait.key, "sprite/pet/Red Fox", "et c'est bien le fichier de l'artboard");
  assert.ok((await spritePng(portrait.key)) !== null, "ses pixels sont lisibles");

  const response = await layoutOf(api, { id: "fox", kind: "icon", itemType: "Pet", species: "RedFox" });
  assert.equal(response.status, 200, "une entrée qui nomme `RedFox` compose");
  const item = (await response.json()).items[0];
  assert.equal(item.sprites[0], portrait.key);

  // Une espèce que ni le sidecar ni son orthographe normalisée ne nomment reste refusée en le disant.
  const missing = await layoutOf(api, { id: "nope", kind: "icon", itemType: "Pet", species: "NotAPet" });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error.message, /no portrait of NotAPet/);
});

test("un outil chargé est dessiné comme le cristal qu'il tient, pas sous son propre nom", { skip: NEEDS_LIVE_ATLAS }, async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Un éclat dans le sac est une entrée de genre `Tool` qui porte une charge : le jeu le dessine comme le
  // cristal qu'il tient (`hn` ramène le nom de l'éclat au type du cristal, `pn` au sprite). Le nom de l'éclat
  // n'est pas dans la table des sprites — c'est tout l'intérêt du détour.
  const charged = await layoutOf(api, { id: "t", kind: "icon", itemType: "Tool", toolId: "HungerShard", charged: true });
  assert.equal(charged.status, 200, await charged.clone().text());
  const item = (await charged.json()).items[0];
  assert.deepEqual(item.sprites, ["sprite/item/HungerCrystal"], "le cristal, pas l'éclat");

  // Le même identifiant **sans** la charge est l'éclat lui-même : la table des items donne son art, qui n'est
  // pas son identifiant — `HungerShard` est dessiné par `sprite/item/HungerCrystalShard`.
  const plain = await layoutOf(api, { id: "t", kind: "icon", itemType: "Tool", toolId: "HungerShard" });
  assert.equal(plain.status, 200, await plain.clone().text());
  assert.deepEqual((await plain.json()).items[0].sprites, ["sprite/item/HungerCrystalShard"], "l'éclat, pas le cristal");

  // Et un éclat que le commutateur du jeu ne nomme pas est refusé en le disant.
  const unknown = await layoutOf(api, { id: "t", kind: "icon", itemType: "Tool", toolId: "NotAShard", charged: true });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error.message, /NotAShard/);
});

/**
 * L'art d'un éclat est celui que la table des items lui donne, pas son identifiant.
 *
 * Les trois éclats d'effet s'appellent `HungerShard`, `XPShard` et `StrengthShard`, et la table des items les
 * dessine avec `sprite/item/HungerCrystalShard`, `XPCrystalShard` et `StrengthCrystalShard` — un `Crystal` de
 * plus que leur identifiant. Une lecture par nom d'identifiant les refuse donc, alors que le saut est celui de
 * la table elle-même (`sprite: T.Item.<nom>` dans les enregistrements du jeu) : il se lit.
 *
 * Hors ligne, ce qui se prouve est la **résolution** de l'art : le nom vient de la table, et c'est l'atlas de
 * la fixture — qui ne porte aucun art d'item — qui manque ensuite. L'épreuve suivante, en ligne, le compose.
 */
test("un éclat est dessiné par l'art que la table des items lui donne, pas par son identifiant", async () => {
  assert.equal(await toolArtName("HungerShard"), "sprite/item/HungerCrystalShard");
  assert.equal(await toolArtName("XPShard"), "sprite/item/XPCrystalShard");
  assert.equal(await toolArtName("StrengthShard"), "sprite/item/StrengthCrystalShard");
  assert.equal(await toolArtName("Shovel"), "sprite/item/Shovel", "un outil dont l'identifiant est le nom");
  assert.equal(await toolArtName("NotATool"), null, "un identifiant que la table ne tient pas");
  assert.equal(await toolArtName(""), null, "et un identifiant vide");

  const api = await startTestApp();
  try {
    const response = await layoutOf(api, { id: "t", kind: "icon", itemType: "Tool", toolId: "HungerShard" });
    if (LIVE_ASSETS) {
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual((await response.json()).items[0].sprites, ["sprite/item/HungerCrystalShard"]);
    } else {
      // La disposition ne dit plus « la table ne nomme aucune art » : elle nomme l'art, et c'est l'atlas qui
      // ne l'a pas.
      assert.equal(response.status, 400);
      assert.match(
        (await response.json()).error.message,
        /the atlas holds no frame for sprite\/item\/HungerCrystalShard/,
      );
    }
  } finally {
    await api.close();
  }
});

test("une production mutée est l'image composée, contenue et centrée comme la simple", { skip: NEEDS_LIVE_ATLAS }, async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Une entrée de production porte les mutations avec lesquelles la récolte a été ramassée, et le jeu
  // dessine la récolte composée : les couches de la recette, puis la même containment. Ce que
  // l'épreuve épingle est que la mutation ne déplace ni ne redimensionne l'icône — la première version
  // centrait la boîte de l'image comme si elle partait de l'origine, alors qu'elle est mesurée autour de
  // l'ancre de l'art, et l'icône se retrouvait une demi-art en haut à gauche.
  const plain = (await (await layoutOf(api, { id: "p", kind: "icon", itemType: "Produce", species: "Tomato" })).json()).items[0];
  const mutated = (await (await layoutOf(api, { id: "m", kind: "icon", itemType: "Produce", species: "Tomato", mutations: ["Frozen"] })).json()).items[0];

  assert.ok(mutated.sprites.length >= 2, `la mutation est une couche de plus, got ${mutated.sprites.join(", ")}`);
  assert.equal(mutated.box.width, plain.box.width, "la mutation ne change pas la largeur de l'icône");
  assert.equal(mutated.box.height, plain.box.height, "ni sa hauteur");
  assert.equal(mutated.box.x, plain.box.x, "ni sa place en travers");
  assert.equal(mutated.box.y, plain.box.y, "ni en hauteur");
  assert.equal(mutated.icon.width, ICON_BOX_PX, "et le carré reste le carré du jeu");
});

test("une icône de plante est refusée en indiquant le genre qui la dessine", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Une plante : son icône est l'image assemblée que `kind: "plant"` dessine, pas une sprite.
  const plant = await layoutOf(api, { id: "p", kind: "icon", itemType: "Plant", species: "Bamboo" });
  assert.equal(plant.status, 400);
  const plantBody = await plant.json();
  assert.match(plantBody.error.message, /Plant/);
  assert.match(plantBody.error.message, /potted/);

  // Un animal que cette API n'a pas exporté est refusé par son nom plutôt que dessiné vide.
  const pet = await layoutOf(api, { id: "q", kind: "icon", itemType: "Pet", species: "NotAPet" });
  assert.equal(pet.status, 400);
  assert.match((await pet.json()).error.message, /NotAPet/);
});

test("un genre ou une espèce que le jeu ne nomme pas est refusé par son nom", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const unknownType = await layoutOf(api, { id: "x", kind: "icon", itemType: "Wand", species: "Bamboo" });
  assert.equal(unknownType.status, 400);
  assert.match((await unknownType.json()).error.message, /Wand/);

  const unknownSpecies = await layoutOf(api, { id: "x", kind: "icon", itemType: "Produce", species: "NotAPlant" });
  assert.equal(unknownSpecies.status, 400);
  assert.match((await unknownSpecies.json()).error.message, /NotAPlant/);

  // Seule une production porte des mutations dans le constructeur du jeu : une graine mutée est refusée
  // en le disant plutôt que dessinée sans sa mutation.
  const mutatedSeed = await layoutOf(api, { id: "x", kind: "icon", itemType: "Seed", species: "Bamboo", mutations: ["Frozen"] });
  assert.equal(mutatedSeed.status, 400);
  assert.match((await mutatedSeed.json()).error.message, /Produce/);

  // L'identifiant du genre est requis : une graine sans espèce ne nomme aucune art.
  const missing = await layoutOf(api, { id: "x", kind: "icon", itemType: "Seed" });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error.message, /species/);
});

test.after(() => {
  restoreFetch();
});
