// src/api/routes/data.js

import express from "express";
import { asyncHandler } from "../middleware/index.js";
import { gameDataService } from "../../services/index.js";
import { getCacheStats } from "../../core/game/cache.js";
import { contractVersion, getBuildInfo } from "../../docs/contract.js";
import { ENGINE_SIGNATURE, eraAt } from "../../core/weather/index.js";
import { logger } from "../../logger/index.js";
import { getTransformedPlants, enrichPlantsWithPurchasable } from "../../services/plantTransformer.js";
import { getTransformedPets } from "../../services/petTransformer.js";
import { getTransformedDecor } from "../../services/decorTransformer.js";
import {
  transformDataWithSprites,
  transformWeathersWithSprites,
} from "../../services/dataTransformer.js";
import { resolveSpritePathsDeep } from "../../utils/spritePathResolver.js";
import { applyCacheHeaders, buildWeakEtag, isFresh } from "../../utils/httpCache.js";
import {
  jsonToCsv, combinedJsonToCsv, sendCsv,
  jsonToTsv, combinedJsonToTsv, sendTsv,
} from "../../utils/csvConverter.js";

export const dataRouter = express.Router();

// =====================
// Game Data (from bundle)
// =====================

const DATA_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=60";

/**
 * Les faits de provenance d'une réponse : la version du jeu dont le corps est
 * construit, la version du contrat que ce corps respecte, et quand.
 *
 * La version de jeu est celle du bundle dont le corps est extrait, et à défaut
 * celle de l'enregistrement de build (`data/version.json`). Une seule valeur par
 * réponse, lue une fois, et c'est la même qui part dans le `?v=` des sprites,
 * dans l'ETag, dans le corps et dans l'en-tête `X-Game-Version` : une réponse ne
 * peut donc annoncer ni deux versions, ni une version dans le corps et une autre
 * en en-tête.
 *
 * Avant, le `?v=` venait de l'enregistrement de build
 * (`getStoredVersionCached()`) pendant que le corps était extrait du bundle en
 * cache, qui se rafraîchit de son côté : mesuré en direct, `/health` publiait le
 * bundle en **1191** pendant que `/data/*` portait `?v=1190` dans la même
 * fenêtre, et rien dans la réponse ne disait laquelle des deux la décrivait.
 *
 * `getBuildInfo()` est la même dérivation que `/data/version` et `/schema.json`,
 * et le cache du bundle ne dépasse plus la version enregistrée par la synchro
 * (voir `heldBundleVersion`), donc les deux sources coïncident : le corps, son
 * `?v=` et `/health` annoncent la même version.
 */
async function getProvenance() {
  const { gameVersion, generatedAt } = await getBuildInfo();
  return { gameVersion, contract: contractVersion(), generatedAt };
}

/** Le nom du bloc de provenance ajouté aux corps de `/data/*`. */
export const META_KEY = "_meta";

/** L'en-tête qui porte la version du jeu sur chaque réponse de `/data`. */
export const GAME_VERSION_HEADER = "X-Game-Version";

/**
 * Où poser le bloc de provenance dans un corps de `/data/*`.
 *
 * Les corps de `/data/*` sont les données du jeu **keyées par nom** : leurs clés
 * sont des entités (`Carrot`, `Gold`, `StoneBirdbath`), et un nom peut être
 * n'importe quoi — y compris `gameVersion`, `contract` ou `version`. Trois
 * champs ajoutés à la racine seraient donc trois façons d'écraser une plante, et
 * trois fausses entités pour un client qui itère le corps.
 *
 * Le bloc vit donc sous une seule clé réservée, préfixée d'un underscore : les
 * clés du jeu sont les identifiants du bundle et n'en portent pas. Le jour où
 * cela deviendrait faux, la clé recule (`__meta`) plutôt que d'écraser une
 * entité — le jeu ne perd jamais une entrée, et le cas est signalé.
 */
function metaKeyFor(body) {
  let key = META_KEY;
  while (Object.hasOwn(body, key)) key = `_${key}`;
  return key;
}

/**
 * Le corps de `/data/*` tel qu'il part : les données du jeu inchangées, plus le
 * bloc de provenance. Copie superficielle : le bloc est par réponse, jamais mis
 * en cache avec les données.
 */
function withProvenance(body, provenance) {
  const key = metaKeyFor(body);

  if (key !== META_KEY) {
    logger.error(
      { key, reserved: META_KEY },
      "Game data occupies the reserved metadata key, provenance moved to a deeper one"
    );
  }

  return { ...body, [key]: provenance };
}

/**
 * Les capacités n'ont pas de transformer à elles, mais elles portent bien des
 * sprites : la tuile d'activation des célestes vit au fond de
 * `baseParameters.activationSprite`.
 */
const getAbilitiesWithSprites = (spriteVersion) =>
  gameDataService
    .getAbilities()
    .then((data) => resolveSpritePathsDeep(data, { version: spriteVersion }));

/**
 * Groupes de scheduling météo (durée, créneaux, drop table pondérée).
 *
 * Cette table venait du bundle jusqu'à la v1141 du jeu (2026-09-11). Cette
 * version a sorti le scheduler du client : il ne reste dans les chunks que
 * `durationMinutes`, les créneaux et les drop tables ont disparu partout. La
 * source est donc désormais le registre d'ères de la station météo — même
 * forme, mais **modélisée à la main** et validée contre l'historique enregistré
 * (`/weather-station/accuracy`) au lieu d'être lue dans le jeu.
 */
function getWeatherGroups() {
  return eraAt(Date.now())?.groups ?? {};
}

const transformedCache = {
  bundleUrl: null,
  spriteVersion: null,
  values: new Map(),
  pending: new Map(),
  failures: new Map(),
};

/**
 * Vide le cache des données transformées.
 *
 * Il se purge tout seul quand la version du jeu ou le bundle changent, ce qui
 * couvre les mises à jour. Mais l'export des animations de pets se termine
 * **longtemps après** (une cinquantaine de minutes dans un processus fils) :
 * sans purge explicite, `/data/pets` continuerait de servir la réponse mise en
 * cache pendant l'export, donc sans les nouvelles boucles.
 */
export function clearTransformedDataCache() {
  transformedCache.values.clear();
  transformedCache.pending.clear();
  transformedCache.failures.clear();
}

function syncBundleCache(spriteVersion = null) {
  const bundleUrl = getCacheStats().bundleUrl;
  const nextVersion = spriteVersion || null;

  if (bundleUrl && transformedCache.bundleUrl !== bundleUrl) {
    transformedCache.bundleUrl = bundleUrl;
    clearTransformedDataCache();
  }

  if (nextVersion && transformedCache.spriteVersion !== nextVersion) {
    transformedCache.spriteVersion = nextVersion;
    clearTransformedDataCache();
  }

  return bundleUrl;
}

/**
 * Note une catégorie que le bundle courant ne permet plus de construire.
 *
 * Une catégorie qui casse ne doit pas emporter `/data` en entier, mais elle ne
 * doit pas non plus disparaître en silence : c'est exactement ce qui s'est
 * passé quand la v1141 a retiré le scheduler météo du jeu. On la loggue une
 * fois par bundle, et `/health` en expose la liste.
 */
function recordCategoryFailure(key, error) {
  const message = error?.message || String(error);
  if (transformedCache.failures.get(key) === message) return;

  transformedCache.failures.set(key, message);
  logger.warn(
    { category: key, bundleUrl: transformedCache.bundleUrl, err: message },
    "Data category unavailable on the current bundle, omitted from /data"
  );
}

/**
 * Couverture des catégories de `/data` pour `/health` : une entrée dans
 * `unavailable` = le jeu a bougé sous un extracteur.
 */
export function getDataCoverage() {
  return {
    categories: CATEGORY_DEFS.length,
    unavailable: Object.fromEntries(transformedCache.failures),
  };
}

async function getOrBuildCached(key, spriteVersion, builder) {
  syncBundleCache(spriteVersion);

  if (transformedCache.values.has(key)) {
    return transformedCache.values.get(key);
  }

  if (transformedCache.pending.has(key)) {
    return transformedCache.pending.get(key);
  }

  const promise = (async () => {
    const data = await builder();
    const bundleUrl = syncBundleCache(spriteVersion);
    if (bundleUrl) {
      transformedCache.values.set(key, data);
    }
    return data;
  })();

  transformedCache.pending.set(key, promise);

  try {
    return await promise;
  } finally {
    if (transformedCache.pending.get(key) === promise) {
      transformedCache.pending.delete(key);
    }
  }
}

/**
 * Composant de fraîcheur supplémentaire pour les clés qui ne viennent pas (que)
 * du bundle. `weatherGroups` sort du registre d'ères : son ETag doit suivre le
 * registre, sinon un client garderait sa réponse au-delà d'un ajout d'ère.
 */
const ETAG_EXTRA = {
  weatherGroups: ENGINE_SIGNATURE,
  all: ENGINE_SIGNATURE,
};

function buildDataEtag(key, spriteVersion) {
  const bundleUrl = syncBundleCache(spriteVersion);
  if (!bundleUrl) return null;
  return buildWeakEtag("data", key, bundleUrl, spriteVersion || "", ETAG_EXTRA[key] || "");
}

/**
 * L'en-tête qui dit la version du jeu, sur chaque réponse de `/data`.
 *
 * Il part avant tout le reste, y compris sur un `304` : un proxy qui revalide
 * doit apprendre quelque chose, et un client ne doit jamais avoir à lire un
 * `?v=` dans une URL pour savoir ce qu'il vient de recevoir.
 *
 * Sans version connue (démarrage à froid, ni bundle ni enregistrement), il n'y a
 * rien d'honnête à annoncer : l'en-tête est alors absent plutôt que vide.
 */
function setGameVersionHeader(res, gameVersion) {
  if (gameVersion) res.set(GAME_VERSION_HEADER, String(gameVersion));
}

function maybeNotModified(req, res, key, spriteVersion) {
  const etag = buildDataEtag(key, spriteVersion);
  setGameVersionHeader(res, spriteVersion);
  if (!etag) return false;
  if (!transformedCache.values.has(key)) return false;

  if (isFresh(req, etag)) {
    applyCacheHeaders(res, { etag, cacheControl: DATA_CACHE_CONTROL });
    res.status(304).end();
    return true;
  }

  return false;
}

function setDataCacheHeaders(res, key, spriteVersion) {
  const etag = buildDataEtag(key, spriteVersion);
  setGameVersionHeader(res, spriteVersion);
  applyCacheHeaders(res, { etag, cacheControl: DATA_CACHE_CONTROL });
}

// Get all data
dataRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;

    const data = await getAllData(spriteVersion);

    setDataCacheHeaders(res, "all", spriteVersion);
    res.json(withProvenance(withEnrichedPlants(data), provenance));
  })
);

/**
 * GET /data/version
 *
 * La version du jeu que cette instance sert, la version du contrat, et quand.
 * `mg.js` demande déjà ce chemin (`DEFAULT_REMOTE_PATHS.version`) ; l'hôte amont
 * répond 404.
 *
 * Les faits viennent de `getBuildInfo()` — le bundle actuellement en cache
 * d'abord (la version dont `/data` extrait ses données), l'enregistrement de
 * construction `data/version.json` ensuite (la version des sprites sur disque) —
 * jamais d'un appel à `/platform/v1/version` : un client veut savoir ce que cet
 * hôte sert, pas ce que le jeu est à cet instant. Démarrage à froid, sans
 * bundle ni synchro : les trois champs valent `null`, ce qui est la vérité.
 */
dataRouter.get(
  "/version",
  asyncHandler(async (_req, res) => {
    const { gameVersion, artVersion, generatedAt } = await getBuildInfo();

    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=30");
    setGameVersionHeader(res, gameVersion);
    // Ce corps **est** le bloc de provenance (`gameVersion`, `artVersion`,
    // `contract`, `generatedAt`) : le répéter sous `_meta` serait se citer.
    res.json({
      gameVersion,
      artVersion,
      contract: contractVersion(),
      generatedAt,
    });
  })
);

dataRouter.get(
  "/plants",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;

    const data = await getOrBuildCached("plants", spriteVersion, () =>
      getTransformedPlants({ spriteVersion })
    );
    setDataCacheHeaders(res, "plants", spriteVersion);
    res.json(withProvenance(enrichPlantsWithPurchasable(data), provenance));
  })
);

dataRouter.get(
  "/pets",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;
    if (maybeNotModified(req, res, "pets", spriteVersion)) return;

    const transformed = await getOrBuildCached("pets", spriteVersion, () =>
      getTransformedPets({ spriteVersion })
    );
    setDataCacheHeaders(res, "pets", spriteVersion);
    res.json(withProvenance(transformed, provenance));
  })
);

dataRouter.get(
  "/items",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;
    if (maybeNotModified(req, res, "items", spriteVersion)) return;

    const transformed = await getOrBuildCached("items", spriteVersion, () =>
      gameDataService.getItems().then((data) =>
        transformDataWithSprites(data, "items", { spriteVersion })
      )
    );
    setDataCacheHeaders(res, "items", spriteVersion);
    res.json(withProvenance(transformed, provenance));
  })
);

dataRouter.get(
  "/decors",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;
    if (maybeNotModified(req, res, "decor", spriteVersion)) return;

    const transformed = await getOrBuildCached("decor", spriteVersion, () =>
      getTransformedDecor({ spriteVersion })
    );
    setDataCacheHeaders(res, "decor", spriteVersion);
    res.json(withProvenance(transformed, provenance));
  })
);

dataRouter.get(
  "/eggs",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;
    if (maybeNotModified(req, res, "eggs", spriteVersion)) return;

    const transformed = await getOrBuildCached("eggs", spriteVersion, () =>
      gameDataService.getEggs().then((data) =>
        transformDataWithSprites(data, "eggs", { spriteVersion })
      )
    );
    setDataCacheHeaders(res, "eggs", spriteVersion);
    res.json(withProvenance(transformed, provenance));
  })
);

dataRouter.get(
  "/abilities",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;
    if (maybeNotModified(req, res, "abilities", spriteVersion)) return;

    const data = await getOrBuildCached(
      "abilities",
      spriteVersion,
      () => getAbilitiesWithSprites(spriteVersion)
    );
    setDataCacheHeaders(res, "abilities", spriteVersion);
    res.json(withProvenance(data, provenance));
  })
);

dataRouter.get(
  "/mutations",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;
    if (maybeNotModified(req, res, "mutations", spriteVersion)) return;

    const transformed = await getOrBuildCached("mutations", spriteVersion, () =>
      gameDataService.getMutations().then((data) =>
        transformDataWithSprites(data, "mutations", { spriteVersion })
      )
    );
    setDataCacheHeaders(res, "mutations", spriteVersion);
    res.json(withProvenance(transformed, provenance));
  })
);

dataRouter.get(
  "/weathers",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;
    if (maybeNotModified(req, res, "weathers", spriteVersion)) return;

    const transformed = await getOrBuildCached("weathers", spriteVersion, () =>
      gameDataService.getWeathers().then((data) =>
        transformWeathersWithSprites(data, { spriteVersion })
      )
    );
    setDataCacheHeaders(res, "weathers", spriteVersion);
    res.json(withProvenance(transformed, provenance));
  })
);

dataRouter.get(
  "/weather-groups",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;
    if (maybeNotModified(req, res, "weatherGroups", spriteVersion)) return;

    const data = await getOrBuildCached("weatherGroups", spriteVersion, () =>
      getWeatherGroups()
    );
    setDataCacheHeaders(res, "weatherGroups", spriteVersion);
    res.json(withProvenance(data, provenance));
  })
);

dataRouter.get(
  "/enums",
  asyncHandler(async (req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;
    if (maybeNotModified(req, res, "enums", spriteVersion)) return;

    const data = await getOrBuildCached("enums", spriteVersion, () =>
      gameDataService.getEnums()
    );
    setDataCacheHeaders(res, "enums", spriteVersion);
    res.json(withProvenance(data, provenance));
  })
);

// =====================
// CSV & TSV endpoints
// =====================

const FORMAT_CONFIG = {
  csv: { convert: jsonToCsv, convertCombined: combinedJsonToCsv, send: sendCsv },
  tsv: { convert: jsonToTsv, convertCombined: combinedJsonToTsv, send: sendTsv },
};

// Category definitions: [routeName, cacheKey, builder(spriteVersion)]
const CATEGORY_DEFS = [
  ["plants", "plants", (sv) => getTransformedPlants({ spriteVersion: sv })],
  ["pets", "pets", (sv) => getTransformedPets({ spriteVersion: sv })],
  ["items", "items", (sv) => gameDataService.getItems().then((d) => transformDataWithSprites(d, "items", { spriteVersion: sv }))],
  ["decors", "decor", (sv) => getTransformedDecor({ spriteVersion: sv })],
  ["eggs", "eggs", (sv) => gameDataService.getEggs().then((d) => transformDataWithSprites(d, "eggs", { spriteVersion: sv }))],
  ["abilities", "abilities", (sv) => getAbilitiesWithSprites(sv)],
  ["mutations", "mutations", (sv) => gameDataService.getMutations().then((d) => transformDataWithSprites(d, "mutations", { spriteVersion: sv }))],
  ["weathers", "weathers", (sv) => gameDataService.getWeathers().then((d) => transformWeathersWithSprites(d, { spriteVersion: sv }))],
  ["weather-groups", "weatherGroups", () => getWeatherGroups()],
  ["enums", "enums", () => gameDataService.getEnums()],
];

/**
 * Les catégories servies sous `/data` : nom de route et clé de cache de la
 * construction. Source unique pour l'inscription des routes, `/schema.json` et
 * le bloc `x-mg-contract` du document.
 */
export const DATA_CATEGORIES = CATEGORY_DEFS.map(([route, cacheKey]) => ({
  route,
  cacheKey,
}));

/**
 * Construit toutes les catégories (partagé par `/data` et les racines
 * `.csv`/`.tsv`).
 *
 * `allSettled` et pas `all` : une catégorie que le jeu vient de casser est
 * omise de la réponse au lieu de faire tomber l'agrégat. Le résultat partiel se
 * met en cache comme un autre — l'échec est lié au bundle courant, donc il se
 * réévalue au prochain changement de version.
 */
async function getAllData(spriteVersion) {
  return getOrBuildCached("all", spriteVersion, async () => {
    const results = await Promise.allSettled(
      CATEGORY_DEFS.map(([, cacheKey, builder]) =>
        getOrBuildCached(cacheKey, spriteVersion, () => builder(spriteVersion))
      )
    );

    const obj = {};
    CATEGORY_DEFS.forEach(([, cacheKey], i) => {
      const result = results[i];
      if (result.status === "fulfilled") obj[cacheKey] = result.value;
      else recordCategoryFailure(cacheKey, result.reason);
    });
    return obj;
  });
}

/**
 * `purchasable` est dérivé des shops : on ne l'applique que si la catégorie
 * `plants` a bien pu être construite.
 */
function withEnrichedPlants(data) {
  if (!data.plants) return data;
  return { ...data, plants: enrichPlantsWithPurchasable(data.plants) };
}

// Root handlers: GET /data.csv and GET /data.tsv (mounted at app level in server.js)
function makeRootHandler(fmt) {
  const { convertCombined, send } = FORMAT_CONFIG[fmt];
  return asyncHandler(async (_req, res) => {
    const provenance = await getProvenance();
    const spriteVersion = provenance.gameVersion;
    const data = await getAllData(spriteVersion);
    setDataCacheHeaders(res, "all", spriteVersion);
    send(res, convertCombined(withEnrichedPlants(data)), `data.${fmt}`);
  });
}

export const dataCsvRootHandler = makeRootHandler("csv");
export const dataTsvRootHandler = makeRootHandler("tsv");

// Register per-category routes for each format
for (const fmt of ["csv", "tsv"]) {
  const { convert, send } = FORMAT_CONFIG[fmt];

  for (const [routeName, cacheKey, builder] of CATEGORY_DEFS) {
    dataRouter.get(
      `/${routeName}.${fmt}`,
      asyncHandler(async (_req, res) => {
        const provenance = await getProvenance();
        const spriteVersion = provenance.gameVersion;
        let data = await getOrBuildCached(cacheKey, spriteVersion, () => builder(spriteVersion));
        if (cacheKey === "plants") data = enrichPlantsWithPurchasable(data);
        setDataCacheHeaders(res, cacheKey, spriteVersion);
        send(res, convert(data), `${routeName}.${fmt}`);
      })
    );
  }
}
