// src/services/plantTransformer.js

import { logger } from "../logger/index.js";
import { gameDataService } from "./gameData.js";
import { liveDataService } from "./liveData.js";
import { resolveSpritePathsDeep } from "../utils/spritePathResolver.js";

/**
 * Transform a plant part (seed, plant, or crop).
 *
 * Les sprites d'une plante sont éparpillés — `sprite`, `immatureSprite`,
 * `topmostLayerSprite`, `activeState.sprite` chez les célestes — et le jeu en
 * ajoute au fil des mises à jour. On résout donc sur la valeur plutôt que sur
 * une liste de champs à tenir à jour.
 */
function transformPlantPart(partData, spriteVersion) {
  if (!partData || typeof partData !== "object") {
    return partData;
  }

  return resolveSpritePathsDeep(partData, { version: spriteVersion });
}

/**
 * Le `kind` à envoyer à `POST /compose` pour une tuile de cette espèce : `patch`, `plant` ou `crop`.
 *
 * C'est la règle du jeu, et elle n'est lisible nulle part en une fois : `harvestType: "Single"` **et** un
 * `slotCapacity` font une **patch** (une grappe de brins, dont le nombre est ce que la capacité limite) ; une
 * espèce `Single` sans capacité dont l'art de plant **est** l'art de crop n'a pas de plant à elle — la culture
 * *est* la plante — donc sa tuile est dessinée comme cette **crop** seule ; tout le reste est un **plant**, une
 * tige avec ses cultures dans ses slots.
 *
 * Elle est publiée ici parce que c'est cette API qui la fait respecter (`COMPOSE_PATCH_NOT_A_PATCH` nomme le
 * kind à envoyer, `COMPOSE_PLANT_OVER_CAPACITY` le plafond d'une espèce sans capacité) : sans ce champ, chaque
 * appelant devrait la reconstruire, et la comparaison des deux arts n'est concluante **qu'après** le test de
 * capacité — 27 espèces sur 70 partagent leurs deux arts, dont quatre vraies patches (Cattail, Clover, Daisy,
 * Snowdrop). Mesuré sur la table vivante : 5 patches, 23 crops, 6 plants Single, 35 Multiple.
 */
function speciesKind(plant, crop) {
  const harvestType = plant?.harvestType;
  if (typeof harvestType !== "string" || harvestType === "") {
    return null;
  }
  if (harvestType !== "Single") {
    return "plant";
  }
  if (Number.isInteger(plant.slotCapacity) && plant.slotCapacity > 0) {
    return "patch";
  }
  return typeof plant.sprite === "string" && plant.sprite !== "" && plant.sprite === crop?.sprite
    ? "crop"
    : "plant";
}

/**
 * Transform a complete plant entry (seed, plant, crop).
 */
function transformPlant(plantData, spriteVersion) {
  if (!plantData || typeof plantData !== "object") {
    return plantData;
  }

  const transformed = {};

  if (plantData.seed) {
    transformed.seed = transformPlantPart(plantData.seed, spriteVersion);
  }

  if (plantData.plant) {
    transformed.plant = transformPlantPart(plantData.plant, spriteVersion);
  }

  if (plantData.crop) {
    transformed.crop = transformPlantPart(plantData.crop, spriteVersion);
  }

  // Le kind se lit sur les arts **résolus**, pas sur les clés du bundle : c'est la même image que le jeu
  // compare, et c'est elle que l'appelant enverra.
  const kind = speciesKind(transformed.plant, transformed.crop);
  if (kind !== null && transformed.plant) {
    transformed.plant = { ...transformed.plant, kind };
  }

  return transformed;
}

/**
 * Enrichit les plantes transformées avec le flag `purchasable` sur chaque seed.
 * Compare les clés des plantes avec les species listées dans le shop.
 * Si les données du shop ne sont pas disponibles, `purchasable` vaut null.
 */
export function enrichPlantsWithPurchasable(plants) {
  const shopSpecies = liveDataService.getShopSeedSpecies();

  const enriched = {};
  for (const [key, plant] of Object.entries(plants)) {
    if (!plant.seed) {
      enriched[key] = plant;
      continue;
    }

    enriched[key] = {
      ...plant,
      seed: {
        ...plant.seed,
        purchasable: shopSpecies ? shopSpecies.has(key) : null,
      },
    };
  }

  return enriched;
}

/**
 * Get transformed plants with sprite URLs.
 */
export async function getTransformedPlants(options = {}) {
  const { spriteVersion = null } = options;
  try {
    const plants = await gameDataService.getPlants();

    if (!plants || Object.keys(plants).length === 0) {
      logger.warn("No plants data available");
      return {};
    }

    const transformed = {};
    for (const [key, value] of Object.entries(plants)) {
      transformed[key] = transformPlant(value, spriteVersion);
    }

    logger.debug(
      { count: Object.keys(transformed).length },
      "Plants data transformed with sprites"
    );

    return transformed;
  } catch (err) {
    logger.error({ error: err.message }, "Error retrieving plants");
    return {};
  }
}
