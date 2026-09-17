// tests/compose-placement.test.js
//
// Où une culture se tient sur sa plante : l'inclinaison, les places pré-établies du plan, le pivot,
// l'échelle, la pile, et la dispersion d'une patch.
//
// Chaque nombre du fichier est celui du bundle, cité à côté de l'assertion, parce que c'est le genre
// de fichier où un chiffre recopié de travers passerait pour la règle du jeu : `di = 35` pour
// l'inclinaison, `mi=.4, hi=.15, gi=.05, _i=15` pour l'icône, `2 + slotId` et
// `Math.round((y + 1) * 10)` pour la pile, `lg` pour la clé de profondeur du monde.
//
// La preuve qui compte le plus est celle du pivot, et elle est exacte plutôt qu'approchée : le point
// de l'art qu'un `plantTransform` épingle retombe **sur la place du slot**, à toute taille et à toute
// rotation. C'est ce que l'œil vérifie en comparant une culture à 50 et à 100 : si le pivot était
// appliqué sans être tourné, ou divisé par le mauvais ratio, le point épinglé glisserait avec la
// taille et l'ancre paraîtrait fausse dès qu'on agrandit la culture.
//
// Hors ligne : `installOfflineGame()` sert l'atlas et le bundle capturés.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.COMPOSE_CACHE_DIR = new URL("./fixtures/compose-cache-placement/", import.meta.url).pathname;
process.env.COMPOSE_CACHE_MAX = "8";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { installOfflineGame, plantFixture } from "./helpers/offlineGame.js";
import { LIVE_ASSETS } from "./helpers/live-assets.js";
import { startTestApp } from "./helpers/httpApp.js";

/**
 * Ce que l'atlas hors ligne ne porte pas.
 *
 * La fixture de sprites ne contient que 89 cadres : les corps de la fraise, de l'aubergine et du
 * ThunderCelestial n'y sont pas, alors que leurs récoltes y sont. Les épreuves qui ont besoin de ces
 * arts se sautent donc **en le disant** — le motif est affiché en `# SKIP` — et
 * `MG_LIVE_ASSETS=1 npm run test:live` les exécute, parce que dans ce mode l'atlas est celui que le
 * jeu sert (le stub hors ligne n'est pas installé) alors que les **données** de plantes restent
 * celles de la fixture : ce qui change est l'art, pas les tables.
 *
 * Les règles elles-mêmes sont de toute façon épinglées hors ligne, en unitaire, sur
 * `cropPlacement.js` : c'est l'arithmétique qui est vérifiée là, et l'atlas ici ne fait que fournir
 * les cadres réels qu'elle lit.
 */
const NEEDS_LIVE_ATLAS =
  LIVE_ASSETS ? false : "needs the live atlas (the offline fixture lacks these bodies) - run `MG_LIVE_ASSETS=1 npm run test:live`";

const CACHE_DIR = new URL("./fixtures/compose-cache-placement/", import.meta.url);

const restoreFetch = LIVE_ASSETS ? () => {} : await installOfflineGame({ version: 1192 });

const { gameDataService } = await import("../src/services/gameData.js");
const PLANTS = await plantFixture();
gameDataService.getPlants = async () => PLANTS;

const { initSprites } = await import("../src/assets/sprites/sprites.js");
await initSprites();

const { plantArt } = await import("../src/assets/compose/artBridge.js");
const {
  CROP_LAYER,
  PLANT_LAYER,
  iconPlace,
  pivotShift,
  placedInPatch,
  placedOnPlant,
  sizeScale,
  slotOffsetAt,
  slotSpecies,
  turnedDegrees,
  worldDepthKey,
} = await import("../src/assets/compose/cropPlacement.js");
const { SPEC_VERSION } = await import("../src/assets/compose/spec.js");
const { resetSceneCache } = await import("../src/assets/compose/sceneCache.js");
const { clearSceneCaches } = await import("../src/assets/compose/sceneService.js");

/** Le plan d'une espèce, augmenté du cadre de son art de récolte, comme le layout le construit. */
async function speciesRecord(species) {
  const art = await plantArt(species);
  return { ...PLANTS[species], crop: { ...PLANTS[species].crop, frame: art.crop.frame } };
}

async function layoutOf(api, spec) {
  return api.get("/compose?format=layout", {
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

test("la courbe d'échelle est celle du jeu : 1 à 50, le multiplicateur de l'espèce à 100", () => {
  // `resolveRestingScale` passe par `1 + (size - 50) / 50 * (maxSizeMultiplier - 1)`.
  assert.equal(sizeScale(50, 2.5), 1);
  assert.equal(sizeScale(100, 2.5), 2.5);
  assert.equal(sizeScale(75, 2.5), 1.75);
  // Une taille absente est l'art à sa propre taille, et une espèce qui n'annonce pas de
  // multiplicateur ne grossit pas : aucun des deux n'est NaN.
  assert.equal(sizeScale(null, 2.5), 1);
  assert.equal(sizeScale(100, undefined), 1);
});

test("l'inclinaison est `rotation + 35 - startTime % 70`, retournée si la culture est miroir", () => {
  // `resources-D_3Zwcn-.js` :
  //
  //     var di = 35;
  //     calculateRestingAngleDegrees(){
  //       let e = this.slotState.flipped ? -1 : 1;
  //       return this.plantBlueprint.harvestType === D.Multiple && this.plantBlueprint.rotateSlotOffsetsRandomly
  //         ? e * (this.slotOffset.rotation + di - this.slotState.startTime % (di * 2))
  //         : e * this.slotOffset.rotation }
  //
  // La fraise du plan porte `rotateSlotOffsetsRandomly: true` et une rotation de slot de 4,25°.
  const plant = PLANTS.Strawberry;
  const offset = plant.plant.slotOffsets[0];
  assert.equal(plant.plant.rotateSlotOffsetsRandomly, true);
  assert.equal(offset.rotation, 4.25);

  const startTime = 1_750_000_000_000;
  const spread = 35;
  assert.equal(
    turnedDegrees({ offset, plantRecord: plant, startTime }),
    4.25 + spread - (startTime % (spread * 2)),
  );
  // Un `startTime` qui décale d'un demi-cycle change l'angle : c'est ce qui fait que deux tomates
  // d'une même vigne ne sont pas au même angle.
  const other = startTime + 35;
  assert.notEqual(
    turnedDegrees({ offset, plantRecord: plant, startTime: other }),
    turnedDegrees({ offset, plantRecord: plant, startTime }),
  );
  // Miroir : le même angle, de l'autre signe.
  assert.equal(
    turnedDegrees({ offset, plantRecord: plant, startTime, flipped: true }),
    -turnedDegrees({ offset, plantRecord: plant, startTime }),
  );
  // Un `startTime` absent est lu comme `0`, donc l'inclinaison vaut `35` — la lecture du client du
  // jeu lui-même (`Number.isFinite(startTime) ? startTime % 70 : 0`).
  assert.equal(turnedDegrees({ offset, plantRecord: plant, startTime: null }), 4.25 + spread);

  // Sans le drapeau, la rotation est celle du slot : le ThunderCelestial ne l'a pas.
  const celestial = PLANTS.ThunderCelestial;
  assert.notEqual(celestial.plant.rotateSlotOffsetsRandomly, true);
  assert.equal(
    turnedDegrees({ offset: celestial.plant.slotOffsets[0], plantRecord: celestial, startTime }),
    0,
  );
  // Et une culture à récolte unique ne s'incline jamais, même si son plan portait le drapeau : le
  // test du jeu est `harvestType === Multiple`.
  const single = { plant: { harvestType: "Single", rotateSlotOffsetsRandomly: true } };
  assert.equal(turnedDegrees({ offset: { rotation: 12 }, plantRecord: single, startTime }), 12);
});

test("le décalage du pivot se tourne et s'échelle avec la culture", () => {
  // `CropVisual` : `container.pivot.set(flipped ? offsetXPixels : -offsetXPixels, -offsetYPixels)`,
  // dans les pixels de l'art, et le conteneur est mis à l'échelle par `scale / sourcePixelRatio`.
  // Le point pivot est donc dessiné `R(rotation) x (offsetX, offsetY) x scale / ratio` plus loin.
  const transform = { offsetXPixels: 33.312, offsetYPixels: 153.975 };
  const still = pivotShift({ plantTransform: transform, rotation: 0, scale: 1, pixelRatio: 2 });
  assert.equal(still.x, 33.312 / 2 / 256);
  assert.equal(still.y, 153.975 / 2 / 256);

  const turned = pivotShift({ plantTransform: transform, rotation: 90, scale: 1, pixelRatio: 2 });
  // Un quart de tour dans le sens des aiguilles (l'axe y descend, comme dans Pixi) envoie le
  // vecteur `(x, y)` sur `(-y, x)`.
  assert.ok(Math.abs(turned.x + 153.975 / 2 / 256) < 1e-12);
  assert.ok(Math.abs(turned.y - 33.312 / 2 / 256) < 1e-12);

  // Deux fois plus grand : deux fois plus loin, ce qui est ce qui garde le point épinglé en place.
  const big = pivotShift({ plantTransform: transform, rotation: 0, scale: 2, pixelRatio: 2 });
  assert.equal(big.x, still.x * 2);
  assert.equal(big.y, still.y * 2);

  // Miroir : le x du pivot change de signe (le sprite est mis en miroir à part).
  const flipped = pivotShift({ plantTransform: transform, rotation: 0, scale: 1, pixelRatio: 2, flipped: true });
  assert.equal(flipped.x, -still.x);
  assert.equal(flipped.y, still.y);

  // Aucun `plantTransform` : aucun décalage, et ce n'est pas `NaN`.
  assert.deepEqual(pivotShift({ plantTransform: null, rotation: 30, scale: 3, pixelRatio: 2 }), { x: 0, y: 0 });
});

test("le point de l'art qu'épingle le pivot retombe sur la place du slot, à toute taille", { skip: NEEDS_LIVE_ATLAS }, async () => {
  // La preuve d'ancrage, exacte : le cadre est posé avec son **ancre** à `place` (c'est ce que fait
  // `plantPicture`), et le pivot a déplacé cette ancre de `R(θ) x (offset x scale / ratio)`. Le point
  // de l'art épinglé est donc à `largeur x anchorX - offsetX / ratio` dans l'art dessiné, et sa place
  // dans la scène vaut
  //
  //     ancre + R(θ) x (point épinglé - ancre de l'art) x scale
  //           = place + R(θ) x (offset x scale / ratio) / 256 + R(θ) x (-offset x scale / ratio) / 256
  //           = place
  //
  // pour toute `scale` et toute `θ` — c'est-à-dire exactement ce qu'un œil vérifie en comparant une
  // culture à 50 et à 100. Chaque espèce du plan qui porte un `plantTransform` est essayée, à ses
  // propres rotations de slot, avec les restitutions de rotation qu'un `startTime` produit.
  const species = Object.keys(PLANTS).filter((name) => PLANTS[name]?.crop?.plantTransform !== undefined);
  assert.ok(species.length >= 5, `au moins cinq espèces portent un plantTransform (${species.length})`);

  let checked = 0;
  for (const name of species) {
    const record = await speciesRecord(name);
    const frame = await plantArt(name);
    const offset = PLANTS[name].plant.slotOffsets[0];
    for (const size of [50, 71, 100]) {
      for (const startTime of [1_750_000_000_000, 1_750_000_000_019]) {
        const placement = placedOnPlant({
          crop: { slot: 0, size, startTime, flipped: false },
          offset,
          plantRecord: PLANTS[name],
          cropSpecies: name,
          speciesRecord: record,
        });
        // Le point épinglé, dans l'art **dessiné** : `anchor x taille - offset / ratio`.
        const ratio = frame.crop.frame.pixelRatio;
        const pinned = {
          x: frame.crop.frame.anchorX * frame.crop.frame.width - PLANTS[name].crop.plantTransform.offsetXPixels / ratio,
          y: frame.crop.frame.anchorY * frame.crop.frame.height - PLANTS[name].crop.plantTransform.offsetYPixels / ratio,
        };
        // Sa place dans la scène : l'ancre, plus le vecteur tourné du point épinglé à l'ancre, mis à
        // l'échelle. La rotation est celle que la mise en place a calculée.
        const radians = (placement.rotation * Math.PI) / 180;
        const local = {
          x: (pinned.x - frame.crop.frame.anchorX * frame.crop.frame.width) * placement.scale,
          y: (pinned.y - frame.crop.frame.anchorY * frame.crop.frame.height) * placement.scale,
        };
        const landed = {
          x: placement.x + (local.x * Math.cos(radians) - local.y * Math.sin(radians)) / 256,
          y: placement.y + (local.x * Math.sin(radians) + local.y * Math.cos(radians)) / 256,
        };
        const slot = { x: offset.x, y: offset.y };
        assert.ok(
          Math.abs(landed.x - slot.x) < 1e-9 && Math.abs(landed.y - slot.y) < 1e-9,
          `${name} à ${size} : le point épinglé tombe sur la place du slot (${landed.x} vs ${slot.x}, ${landed.y} vs ${slot.y})`,
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 30, `les combinaisons essayées (${checked})`);
});

test("le plan place une culture par son `slotId`, et dit quelle espèce le slot dessine", () => {
  const celestial = PLANTS.ThunderCelestial;
  const first = slotOffsetAt(celestial, 0);
  const fifth = slotOffsetAt(celestial, 4);
  assert.deepEqual({ x: first.x, y: first.y }, { x: 0.44, y: -0.03 });
  assert.deepEqual({ x: fifth.x, y: fifth.y }, { x: -0.63, y: -1.02 });

  // `speciesOverride` : les quatre premiers slots sont des stormcaps, qui sont une espèce à part ;
  // les autres sont la culture du plante elle-même.
  assert.equal(slotSpecies("ThunderCelestial", first), "ThunderCelestialShroomPlant");
  assert.equal(slotSpecies("ThunderCelestial", fifth), "ThunderCelestial");
  assert.equal(slotSpecies("Strawberry", { x: 0, y: 0, rotation: 0 }), "Strawberry");

  // Un slot que le plan ne place pas n'est pas dessiné du tout : la mise en place le dit plutôt que
  // de retomber sur zéro (`s && r.push(...)`).
  assert.equal(slotOffsetAt(celestial, 99), null);
  assert.equal(slotOffsetAt({ plant: {} }, 0), null);
});

test("l'icône d'une plante à récolte unique resserre et éventaille ses brins", () => {
  // `mi=.4, hi=.15, gi=.05, _i=15; vi(e, t, n)`: un brin seul va sous le milieu sans être tourné,
  // et une grappe est ramenée à 0,4 en travers et 0,15 en profondeur, descendue de 0,05 et
  // éventaillée de `index x 137 % 30 - 15` degrés.
  assert.deepEqual(iconPlace({ place: { x: 0.3, y: -0.2, rotation: 7 }, index: 0, count: 1 }), {
    x: 0,
    y: 0.05,
    rotation: 0,
  });
  const fanned = [0, 1, 2].map((index) => iconPlace({ place: { x: 0.3, y: -0.2, rotation: 7 }, index, count: 3 }));
  assert.deepEqual(
    fanned.map((one) => one.rotation),
    [7 - 15, 7 + (137 % 30) - 15, 7 + ((2 * 137) % 30) - 15],
  );
  for (const one of fanned) {
    assert.equal(one.x, 0.3 * 0.4);
    assert.equal(one.y, -0.2 * 0.15 + 0.05);
  }
});

test("la pile d'une tuile est celle du monde : plus bas est dessiné plus tard", () => {
  // `worldDepthSortKey-BXUHHrP0.js` :
  //
  //     function lg({depthYPixels: e, layer: t, bodyBottomYPixels: n, band: r = 0}) {
  //       let i = (n ?? e) - e;
  //       return (r === 1 ? 9e11 : 0) + Math.floor(e * 1e4) + t + (i <= 0 ? 0 : i / (i + 256)) }
  //
  // alimenté par une tuile de jardin (`installWorldSystems-2I5vu80Q.js`) : la clé monte avec l'y de
  // la tuile, la couche d'un objet de jardin est `OccludingObject` (3), et dans une même rangée
  // c'est ce qui descend le plus bas qui passe devant.
  const upper = worldDepthKey({ tileCentreY: 128, bodyBottomPixels: 300 });
  const lower = worldDepthKey({ tileCentreY: 384, bodyBottomPixels: 556 });
  assert.ok(lower > upper, "une tuile plus basse a une clé plus grande");

  const shallow = worldDepthKey({ tileCentreY: 384, bodyBottomPixels: 400 });
  const deep = worldDepthKey({ tileCentreY: 384, bodyBottomPixels: 700 });
  assert.ok(deep > shallow, "dans une rangée, ce qui descend le plus bas passe devant");

  // La couche : une culture nue (2) passe avant un objet de jardin (3) à la même profondeur.
  assert.ok(
    worldDepthKey({ tileCentreY: 384, layer: CROP_LAYER }) <
      worldDepthKey({ tileCentreY: 384, layer: PLANT_LAYER }),
  );
  assert.equal(PLANT_LAYER, 3);
  assert.equal(CROP_LAYER, 2);

  // La clé est `floor(y x 1e4)` : deux tuiles d'une même rangée ont la même bande, et deux rangées
  // ne peuvent pas s'y confondre — l'écart entre les deux bandes est la distance entre les tuiles,
  // quelle que soit la portée des corps.
  const row0 = worldDepthKey({ tileCentreY: 128, bodyBottomPixels: 128 });
  const row1 = worldDepthKey({ tileCentreY: 384, bodyBottomPixels: 384 });
  assert.equal(Math.floor(row1) - Math.floor(row0), (384 - 128) * 1e4);
});

test("la pile d'une culture à récolte multiple est `2 + slotId`, pas le rang dans la liste", () => {
  // `i.container.zIndex = n.harvestType === D.Single ? Math.round((t.offset.y + 1) * 10) : 2 + r.slotId`
  // — c'est le **slotId** de la culture, pas son rang dans la liste que la spec envoie. Le figuier de
  // barbarie a cinq slots dans le plan et il est complet dans l'atlas hors ligne, donc ses slots 1 et 3
  // suffisent à distinguer les deux lectures : `2 + slotId` donne 3 et 5, `2 + rang` donnerait 2 et 3.
  const record = PLANTS.PricklyPear;
  assert.equal(record.plant.slotOffsets.length, 5);
  const placed = [1, 3].map((slot) =>
    placedOnPlant({
      crop: { slot, size: 50, startTime: null, flipped: false },
      offset: record.plant.slotOffsets[slot],
      plantRecord: record,
      cropSpecies: "PricklyPear",
      speciesRecord: record,
    }),
  );
  assert.deepEqual(
    placed.map((one) => one.depth),
    [2 + 1, 2 + 3],
  );
});

test("l'échelle d'une culture est celle de l'espèce que le slot dessine", () => {
  // `resolveRestingScale(t, a.size)` est appelé avec `t = e.species`, la culture du slot — donc un slot
  // qui déclare `speciesOverride` grossit selon **son** multiplicateur, pas selon celui de la plante.
  // Les deux espèces présentes dans les données ont le même multiplicateur (2), donc ce qui est
  // vérifié ici est le contrat : de quel plan le multiplicateur est lu.
  const plant = { plant: { harvestType: "Multiple", slotOffsets: [{ x: 0, y: 0, rotation: 0 }] }, crop: { maxSizeMultiplier: 2 } };
  const override = { plant: { harvestType: "Multiple" }, crop: { maxSizeMultiplier: 4 } };
  const placed = placedOnPlant({
    crop: { slot: 0, size: 100, startTime: 0, flipped: false },
    offset: plant.plant.slotOffsets[0],
    plantRecord: plant,
    cropSpecies: "Override",
    speciesRecord: override,
  });
  assert.equal(placed.scale, 4);
  assert.equal(placed.species, "Override");
  // Et sans `plantTransform` sur l'espèce dessinée, aucun décalage : c'est l'espèce qui le porte.
  assert.deepEqual({ x: placed.x, y: placed.y }, { x: 0, y: 0 });
});

test("une tuile de récolte unique refuse plus de brins que sa capacité", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // L'ube ne déclare pas de `slotCapacity` : une tuile en porte **un**. Deux ubes sur une tuile est
  // une image que le jeu ne dessine jamais, donc elle est refusée par son nom plutôt que dessinée.
  assert.equal(PLANTS.Ube.plant.slotCapacity, undefined);
  const two = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      {
        id: "ube",
        kind: "plant",
        species: "Ube",
        at: { column: 1, row: 1 },
        crops: [{ size: 50 }, { size: 50 }],
      },
    ],
  });
  assert.equal(two.status, 400);
  const refused = await two.json();
  assert.equal(refused.error.code, "COMPOSE_PLANT_OVER_CAPACITY");
  assert.match(refused.error.message, /at most 1 crops/);
  assert.match(refused.error.message, /one crop/);
  assert.equal(refused.error.limit, "slotCapacity");
  assert.equal(refused.error.saw, 2);

  // Le trèfle en porte quinze : quinze passent, seize sont refusés.
  const capacity = PLANTS.Clover.plant.slotCapacity;
  assert.equal(capacity, 15);
  const full = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      {
        id: "clover",
        kind: "plant",
        species: "Clover",
        at: { column: 1, row: 1 },
        crops: Array.from({ length: capacity }, () => ({ size: 57 })),
      },
    ],
  });
  assert.equal(full.status, 200);
  const sixteen = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      {
        id: "clover",
        kind: "plant",
        species: "Clover",
        at: { column: 1, row: 1 },
        crops: Array.from({ length: capacity + 1 }, () => ({ size: 57 })),
      },
    ],
  });
  assert.equal(sixteen.status, 400);
});

test("un slot que le plan ne place pas est refusé, nommément", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // L'aubergine a trois slots dans le plan du jeu, et la culture 7 n'en est pas un. Le corps de
  // l'aubergine n'est pas dans l'atlas hors ligne, donc c'est le figuier de barbarie qui sert ici :
  // cinq slots, et lui est complet dans la fixture.
  assert.equal(PLANTS.PricklyPear.plant.slotOffsets.length, 5);
  const response = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      {
        id: "prickly",
        kind: "plant",
        species: "PricklyPear",
        at: { column: 1, row: 1 },
        crops: [{ slot: 9, size: 50 }],
      },
    ],
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "COMPOSE_SPEC_INVALID");
  assert.match(body.error.message, /no slot offset for slot 9/);
  assert.match(body.error.message, /holds 5 slots/);
});

test("le layout publie l'espèce dessinée, la rotation et la place de chaque culture", { skip: NEEDS_LIVE_ATLAS }, async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const startTime = 1_750_000_000_000;
  const response = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      {
        id: "celestial",
        kind: "plant",
        species: "ThunderCelestial",
        at: { column: 1, row: 1 },
        matured: true,
        crops: [
          { slot: 0, size: 50, startTime },
          { slot: 4, size: 50, startTime },
        ],
      },
    ],
  });
  assert.equal(response.status, 200);
  const layout = await response.json();
  const item = layout.items[0];
  assert.equal(item.crops.length, 2);

  // Slot 0 : un stormcap, dessiné avec l'art de **sa** espèce — pas celui de la culture du
  // ThunderCelestial — et posé à la place que le plan lui donne, plus le décalage du pivot (aucun
  // ici : le plan des stormcaps ne déclare pas de `plantTransform`).
  const shroom = await plantArt("ThunderCelestialShroomPlant");
  const celestial = await plantArt("ThunderCelestial");
  assert.ok(item.sprites.includes(shroom.crop.sprite), "l'art du stormcap est dans l'image");
  assert.ok(item.sprites.includes(celestial.crop.sprite), "l'art de la culture l'est aussi");
  const first = item.crops.find((crop) => crop.slot === 0);
  assert.equal(first.species, "ThunderCelestialShroomPlant");
  assert.ok(Math.abs(first.place.x - 0.44) < 1e-9);
  assert.ok(Math.abs(first.place.y + 0.03) < 1e-9);
  assert.equal(first.place.rotation, 0);
  assert.equal(first.depth, 2 + 0);

  // Slot 4 : la culture du plante elle-même, à sa place du plan.
  const fifth = item.crops.find((crop) => crop.slot === 4);
  assert.equal(fifth.species, "ThunderCelestial");
  assert.ok(Math.abs(fifth.place.x + 0.63) < 1e-9);
  assert.ok(Math.abs(fifth.place.y + 1.02) < 1e-9);
  assert.equal(fifth.depth, 2 + 4);
});

test("l'inclinaison d'une culture multi-récolte est publiée, et suit son `startTime`", { skip: NEEDS_LIVE_ATLAS }, async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  const plant = PLANTS.Strawberry;
  const offset = plant.plant.slotOffsets[0];
  const startTime = 1_750_000_000_000;
  const response = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      {
        id: "strawberry",
        kind: "plant",
        species: "Strawberry",
        at: { column: 1, row: 1 },
        matured: true,
        crops: [{ slot: 0, size: 100, startTime }],
      },
    ],
  });
  assert.equal(response.status, 200);
  const layout = await response.json();
  const crop = layout.items[0].crops[0];
  const expected = offset.rotation + 35 - (startTime % 70);
  assert.ok(Math.abs(crop.place.rotation - expected) < 1e-9, `${crop.place.rotation} vs ${expected}`);

  // La place publiée est celle de l'**ancre**, donc elle inclut le décalage du pivot : c'est le point
  // que `plantPicture` pose sur `centre + place x 256`.
  const record = await speciesRecord("Strawberry");
  const placement = placedOnPlant({
    crop: { slot: 0, size: 100, startTime, flipped: false },
    offset,
    plantRecord: plant,
    cropSpecies: "Strawberry",
    speciesRecord: record,
  });
  assert.ok(Math.abs(crop.place.x - placement.x) < 1e-9);
  assert.ok(Math.abs(crop.place.y - placement.y) < 1e-9);
  assert.ok(Math.abs(crop.place.x - offset.x) > 1e-6, "le pivot a bien déplacé l'ancre");
  assert.ok(Math.abs(crop.scale - placement.scale) < 1e-9);
});

test("une patch laisse sa place à chaque brin, et empile par la profondeur du brin", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Deux brins à des places déclarées : le brin le plus bas dans la tuile est dessiné le dernier.
  const response = await layoutOf(api, {
    spec: SPEC_VERSION,
    items: [
      {
        id: "patch",
        kind: "patch",
        species: "Clover",
        at: { column: 1, row: 1 },
        crops: [
          { size: 50, at: { x: -0.2, y: -0.3, rotation: 4 } },
          { size: 50, at: { x: 0.2, y: 0.3, rotation: -4 } },
        ],
      },
    ],
  });
  assert.equal(response.status, 200);
  const layout = await response.json();
  const item = layout.items[0];
  assert.equal(item.crops.length, 2);
  const shallow = item.crops.find((crop) => crop.place.y < 0);
  const deep = item.crops.find((crop) => crop.place.y > 0);
  assert.equal(shallow.depth, Math.round((-0.3 + 1) * 10));
  assert.equal(deep.depth, Math.round((0.3 + 1) * 10));
  assert.ok(deep.depth > shallow.depth, "le brin le plus bas est dessiné devant");
  // Le brin qui déclare sa place n'est pas déplacé par la dispersion.
  assert.equal(shallow.place.rotation, 4);
  assert.ok(Math.abs(shallow.place.x + 0.2) < 1e-9);
  assert.equal(
    placedInPatch({ crop: { size: 50 }, place: { x: 0, y: 0, rotation: 0 }, speciesRecord: PLANTS.Clover }).depth,
    10,
  );
});

test("les tuiles d'une scène sont peintes de haut en bas, pas dans l'ordre de la spec", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Les identifiants sont choisis pour que l'ordre normalisé (`normalizeSpec` trie par `id`) soit
  // l'**inverse** de l'ordre de profondeur : `a-lower` est la tuile du bas et passe donc en premier
  // dans la spec, alors qu'elle doit être peinte en dernier. Sans le tri, l'épreuve échoue. Les deux
  // espèces sont des plantes à récolte unique sans brin : ce qui est comparé ici est le corps de la
  // tuile, et ces deux corps sont dans l'atlas hors ligne.
  //
  // Les couches peintes ne sortent pas d'une requête `?format=layout` — elles vont au rasteriseur —
  // donc c'est `layOutScene` qui est appelé ici, la même fonction que la route appelle.
  const { layOutScene } = await import("../src/assets/compose/sceneLayout.js");
  const laid = await layOutScene({
    spec: SPEC_VERSION,
    items: [
      {
        id: "a-lower",
        kind: "plant",
        species: "PineTree",
        at: { column: 1, row: 1 },
        crops: [],
      },
      {
        id: "z-upper",
        kind: "plant",
        species: "Cactus",
        at: { column: 1, row: 0 },
        crops: [],
      },
    ],
  });
  assert.equal(laid.error, undefined);
  const layout = laid.layout;
  const lower = await plantArt("PineTree");
  const upper = await plantArt("Cactus");
  const firstIndexOf = (sprite) => laid.layers.findIndex((layer) => layer.sprite === sprite);
  const lowerAt = firstIndexOf(lower.plant.sprite);
  const upperAt = firstIndexOf(upper.plant.sprite);
  assert.ok(lowerAt >= 0 && upperAt >= 0, "les deux corps sont dans la scène");
  assert.ok(lowerAt > upperAt, "la tuile du bas est peinte après celle du haut");

  // Le layout, lui, publie les items dans l'ordre **normalisé** — `normalizeSpec` trie par `id`, ce
  // qui est ce qui rend la clé de contenu stable — donc `a-lower` d'abord : l'ordre de la disposition
  // et l'ordre de peinture sont deux choses différentes, et c'est voulu.
  assert.deepEqual(
    layout.items.map((item) => item.id),
    ["a-lower", "z-upper"],
  );
});
