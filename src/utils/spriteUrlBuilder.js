/**
 * Sprite URL builder utility
 * Builds URLs for sprites based on category and name
 */

import { config } from "../config/index.js";

/**
 * L'origine à mettre dans une URL absolue : celle que le client a utilisée.
 *
 * `config.sprites.baseUrl` gagne quand il est renseigné — c'est le seul cas où
 * l'URL publique diffère vraiment de celle que le serveur voit, un CDN ou un
 * proxy devant lui. Sinon c'est l'origine de la requête, ce qui est correct sur
 * n'importe quel hôte, port ou nom de proxy, sans configuration.
 *
 * @param {import("express").Request} req
 * @returns {string} Une origine sans slash final, ou "" si la requête n'en dit rien
 */
export function requestOrigin(req) {
  if (config.sprites.baseUrl) return config.sprites.baseUrl;
  const host = typeof req?.get === "function" ? req.get("host") : null;
  if (!host) return "";
  return `${req.protocol}://${host}`;
}

/**
 * Build sprite URL for a given category and sprite name
 * @param {string} category - Sprite category (plants, seeds, tallPlants, etc.)
 * @param {string} spriteName - Sprite filename (without .png)
 * @param {Object} options - Options
 * @param {string} options.baseUrl - Base URL for sprites (defaults to config)
 * @param {boolean} options.absolute - Whether to return absolute URL (default: true)
 * @param {string|null} options.version - Optional version for cache-busting
 * @returns {string} Sprite URL
 */
function buildSpriteUrl(category, spriteName, options = {}) {
  const { baseUrl = config.sprites.baseUrl, absolute = true, version = null } = options;

  if (!spriteName) {
    return null;
  }

  const relativePath = `/assets/sprites/${category}/${spriteName}.png`;
  const query = version ? `?v=${encodeURIComponent(version)}` : "";
  const pathWithQuery = `${relativePath}${query}`;

  if (absolute && baseUrl) {
    // Remove trailing slash from baseUrl if present
    const cleanBaseUrl = baseUrl.replace(/\/$/, "");
    return `${cleanBaseUrl}${pathWithQuery}`;
  }

  return pathWithQuery;
}

/**
 * Build multiple sprite URLs at once
 * @param {Array<{category: string, spriteName: string}>} sprites - Array of sprite info
 * @param {Object} options - Options (same as buildSpriteUrl)
 * @returns {string[]} Array of sprite URLs
 */
function buildSpriteUrls(sprites, options = {}) {
  return sprites.map(({ category, spriteName }) => buildSpriteUrl(category, spriteName, options));
}

/**
 * Build sprite URL object with multiple formats
 * @param {string} category - Sprite category
 * @param {string} spriteName - Sprite filename
 * @returns {Object} Object with different URL formats
 */
function buildSpriteUrlObject(category, spriteName, options = {}) {
  if (!spriteName) {
    return {
      absolute: null,
      relative: null,
      category: null,
      name: null,
    };
  }

  return {
    absolute: buildSpriteUrl(category, spriteName, { ...options, absolute: true }),
    relative: buildSpriteUrl(category, spriteName, { ...options, absolute: false }),
    category,
    name: spriteName,
  };
}

/**
 * Build the URL of a rendered animation loop (WebP/GIF).
 *
 * Même forme que les sprites, une dimension de plus : une espèce a plusieurs
 * clips (`idle`, `walk`…), chacun disponible dans un ou plusieurs formats.
 * Le nom de fichier reste plat (`Chicken_idle.webp`) pour que Nginx puisse
 * servir le dossier directement, comme il le fait pour les PNG.
 *
 * @param {string} category - Catégorie d'animation (pets)
 * @param {string} name - Nom de l'artboard (ex: Chicken, FireHorseActive)
 * @param {string} clip - Identifiant du clip (idle, walk, eat, sleep)
 * @param {string} format - webp | gif
 * @param {Object} options - Mêmes options que buildSpriteUrl
 * @returns {string|null} Animation URL
 */
function buildAnimationUrl(category, name, clip, format, options = {}) {
  const { baseUrl = config.sprites.baseUrl, absolute = true, version = null } = options;

  if (!name || !clip || !format) {
    return null;
  }

  const relativePath = `/assets/animations/${category}/${name}_${clip}.${format}`;
  const query = version ? `?v=${encodeURIComponent(version)}` : "";
  const pathWithQuery = `${relativePath}${query}`;

  if (absolute && baseUrl) {
    return `${baseUrl.replace(/\/$/, "")}${pathWithQuery}`;
  }

  return pathWithQuery;
}

export {
  buildSpriteUrl,
  buildSpriteUrls,
  buildSpriteUrlObject,
  buildAnimationUrl,
};
