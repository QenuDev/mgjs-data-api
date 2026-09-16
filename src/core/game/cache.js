// src/core/game/cache.js

import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";
import { fetchMainBundle } from "./bundle/resolver.js";
import { clearEnumCaches } from "./bundle/sandbox.js";
import { clearSpriteMappingCache } from "./bundle/spriteMapping.js";
import { fetchGameVersion } from "./version.js";
import { getStoredVersionCached } from "./versionStorage.js";

/**
 * Cache pour le bundle et les catégories extraites.
 */
const cache = {
  mainUrl: null,
  mainJs: null,
  indexJs: null,
  uiColorsSources: null,
  abilityTextSource: null,
  fetchedAt: 0,
  categories: new Map(),
  pending: null,
};

/**
 * Ce qu'un appelant reçoit du bundle : une copie des références en cache, jamais
 * le cache lui-même.
 */
function bundleSnapshot() {
  return {
    mainUrl: cache.mainUrl,
    mainJs: cache.mainJs,
    indexJs: cache.indexJs,
    uiColorsSources: cache.uiColorsSources,
    abilityTextSource: cache.abilityTextSource,
  };
}

/**
 * La version dont on garde le bundle alors que le jeu a déjà bougé.
 *
 * `data/version.json` est la référence : c'est la version dont les sprites et
 * les atlas sur disque ont été produits, donc celle que les `?v=` des réponses
 * publient. Ces fichiers sont servis `immutable` pendant un an (nginx,
 * `Cache-Control: public, max-age=31536000, immutable`) : un `?v=` qui change
 * alors que les octets ne changent pas — ou l'inverse — est un cache
 * empoisonné, pas un détail cosmétique.
 *
 * L'écart mesuré : `/health` publiait `cache.bundleUrl` en version **1191**
 * pendant que `/data/*` portait `?v=1190`, parce que le bundle se rafraîchit
 * tout seul (TTL de 5 min) pendant que la synchro des sprites, elle, tourne
 * encore. Tant que cette synchro doit rattraper la nouvelle version, on sert
 * donc le bundle de la version enregistrée : `/health`, `/data/*` et les `?v=`
 * annoncent alors la même version, et c'est celle dont le corps a réellement
 * été extrait.
 *
 * Le verrou ne s'applique pas quand le watcher est coupé : personne ne
 * rattrapera l'enregistrement, et figer la donnée sur une version que rien ne
 * vient mettre à jour serait pire que l'écart.
 *
 * @param {string} latestVersion - version que le jeu annonce à l'instant
 * @param {string|null} storedVersion - version de l'enregistrement de build
 * @returns {string|null} la version à continuer de servir, ou null pour suivre
 *   `latestVersion`.
 */
export function heldBundleVersion(latestVersion, storedVersion) {
  if (!config.versionWatch.enabled) return null;
  if (!storedVersion || storedVersion === latestVersion) return null;
  return storedVersion;
}

/**
 * Récupère le bundle d'une version donnée, et retombe sur la dernière version
 * du jeu si l'amont ne sert plus celle qu'on voulait.
 *
 * Une version retirée en amont est le seul cas où une réponse peut encore
 * mélanger deux versions : la donnée vient alors de `latestVersion` pendant que
 * les sprites sur disque sont ceux de l'enregistrement. C'est signalé, et
 * `/data/version` publie les deux (`gameVersion` et `artVersion`), donc l'écart
 * est visible au lieu d'être silencieux.
 */
async function fetchBundleFor(servedVersion, latestVersion) {
  const pageUrl = `${config.game.origin}/version/${servedVersion}/index.html`;

  try {
    return await fetchMainBundle(pageUrl);
  } catch (err) {
    if (servedVersion === latestVersion) throw err;

    logger.error(
      { err: err?.message || String(err), servedVersion, latestVersion },
      "The built version is no longer served upstream, falling back to the latest bundle (art and data versions will differ)"
    );

    return fetchMainBundle(`${config.game.origin}/version/${latestVersion}/index.html`);
  }
}

/**
 * Récupère le bundle main.js avec cache.
 */
export async function getMainBundle() {
  const now = Date.now();
  const expired = !cache.mainJs || now - cache.fetchedAt > config.cache.bundleTTL;

  if (!expired) {
    return bundleSnapshot();
  }

  // Évite les requêtes concurrentes
  if (cache.pending) {
    return cache.pending;
  }

  cache.pending = (async () => {
    try {
      const latestVersion = await fetchGameVersion();
      const storedVersion = await getStoredVersionCached().catch(() => null);
      const heldVersion = heldBundleVersion(latestVersion, storedVersion);

      // Le bundle de la version servie est déjà en cache : y rester tant que la
      // synchro n'a pas enregistré la nouvelle version.
      if (heldVersion && getCachedBundleVersion() === heldVersion) {
        logger.warn(
          { latestVersion, servedVersion: heldVersion },
          "Game version moved ahead of the sprites built on disk, still serving the built version"
        );
        cache.fetchedAt = Date.now();
        return bundleSnapshot();
      }

      const { mainUrl, mainJs, indexJs, uiColorsSources, abilityTextSource } =
        await fetchBundleFor(heldVersion ?? latestVersion, latestVersion);

      // Si la version a changé, flush les caches
      if (cache.mainUrl && cache.mainUrl !== mainUrl) {
        logger.info({ oldUrl: cache.mainUrl, newUrl: mainUrl }, "Bundle version changed, clearing caches");
        cache.categories.clear();
        clearEnumCaches();
        clearSpriteMappingCache();
      }

      cache.mainUrl = mainUrl;
      cache.mainJs = mainJs;
      cache.indexJs = indexJs;
      cache.uiColorsSources = uiColorsSources;
      cache.abilityTextSource = abilityTextSource;
      cache.fetchedAt = Date.now();

      return bundleSnapshot();
    } finally {
      cache.pending = null;
    }
  })();

  return cache.pending;
}

/**
 * Récupère les données d'une catégorie avec cache.
 */
export async function getCategoryCached(categoryName, extractorFn) {
  const { mainUrl, mainJs, indexJs, uiColorsSources, abilityTextSource } = await getMainBundle();

  const existing = cache.categories.get(categoryName);
  if (existing && existing.mainUrl === mainUrl) {
    logger.debug({ category: categoryName }, "Category cache hit");
    return existing.data;
  }

  logger.debug({ category: categoryName }, "Category cache miss, extracting");

  const data = extractorFn(mainJs, indexJs, uiColorsSources, abilityTextSource);

  cache.categories.set(categoryName, {
    mainUrl,
    data,
    createdAt: Date.now(),
  });

  return data;
}

/**
 * Invalide tous les caches.
 */
export function invalidateAllCaches() {
  cache.mainUrl = null;
  cache.mainJs = null;
  cache.indexJs = null;
  cache.uiColorsSources = null;
  cache.abilityTextSource = null;
  cache.fetchedAt = 0;
  cache.categories.clear();
  clearEnumCaches();
  clearSpriteMappingCache();
  logger.info("All caches invalidated");
}

/**
 * Retourne les stats du cache.
 */
export function getCacheStats() {
  return {
    hasBundleCached: !!cache.mainJs,
    bundleUrl: cache.mainUrl,
    bundleFetchedAt: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    bundleAge: cache.fetchedAt ? Date.now() - cache.fetchedAt : null,
    categoriesCached: Array.from(cache.categories.keys()),
  };
}

const VERSIONED_ASSET_RE = /\/version\/([^/]+)\//;

/**
 * La version du jeu portée par l'URL d'un asset versionné
 * (`…/version/1192/assets/main-*.js`), ou null si l'URL n'en porte pas.
 */
export function gameVersionFromAssetUrl(url) {
  const match = VERSIONED_ASSET_RE.exec(String(url ?? ""));
  return match ? match[1] : null;
}

/**
 * La version du jeu dont le bundle actuellement en cache a été extrait.
 *
 * C'est la version que `/data` sert réellement, et le process la connaît dès la
 * première requête de données — avant toute synchronisation de sprites, qui
 * écrit `data/version.json` bien plus tard (ou jamais, si l'export est coupé).
 */
export function getCachedBundleVersion() {
  return gameVersionFromAssetUrl(cache.mainUrl);
}
