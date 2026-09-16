// src/core/game/cache.js

import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";
import { fetchMainBundle } from "./bundle/resolver.js";
import { clearEnumCaches } from "./bundle/sandbox.js";
import { clearSpriteMappingCache } from "./bundle/spriteMapping.js";
import { fetchGameVersion } from "./version.js";

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
 * Récupère le bundle main.js avec cache.
 */
export async function getMainBundle() {
  const now = Date.now();
  const expired = !cache.mainJs || now - cache.fetchedAt > config.cache.bundleTTL;

  if (!expired) {
    return { mainUrl: cache.mainUrl, mainJs: cache.mainJs, indexJs: cache.indexJs, uiColorsSources: cache.uiColorsSources, abilityTextSource: cache.abilityTextSource };
  }

  // Évite les requêtes concurrentes
  if (cache.pending) {
    return cache.pending;
  }

  cache.pending = (async () => {
    try {
      const version = await fetchGameVersion();
      const pageUrl = `${config.game.origin}/version/${version}/index.html`;
      const { mainUrl, mainJs, indexJs, uiColorsSources, abilityTextSource } = await fetchMainBundle(pageUrl);

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

      return { mainUrl, mainJs, indexJs, uiColorsSources, abilityTextSource };
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
