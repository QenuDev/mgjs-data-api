// src/api/routes/assets.js

import express from "express";
import { asyncHandler, ApiError, Errors, requireSpriteExport } from "../middleware/index.js";
import { assetDataService } from "../../services/index.js";
import { config } from "../../config/index.js";
import { spritesRouter } from "./sprites.js";
import { composedRouter } from "./composed.js";
import { animationsRouter } from "./animations.js";
import { riveRouter } from "./rive.js";
import { applyCacheHeaders, buildWeakEtag, isFresh } from "../../utils/httpCache.js";
import { requestOrigin } from "../../utils/spriteUrlBuilder.js";

export const assetsRouter = express.Router();

// =====================
// Assets (sprite metadata, cosmetics, audio)
// =====================

const ASSETS_CACHE_CONTROL = "public, max-age=600, stale-while-revalidate=300";

// Sprite metadata (JSON list)
assetsRouter.get(
  "/sprite-data",
  asyncHandler(async (req, res) => {
    const options = {
      full: req.query.full === "1",
      search: req.query.search || "",
      cat: req.query.cat || "",
      flat: req.query.flat === "1",
    };
    const data = await assetDataService.getSprites(options);
    const etag = buildWeakEtag("assets:sprite-data", data.baseUrl, req.originalUrl);
    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
      res.status(304).end();
      return;
    }
    applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
    res.json(data);
  })
);

assetsRouter.get(
  "/cosmetics",
  asyncHandler(async (req, res) => {
    const options = {
      full: req.query.full === "1",
    };
    const data = await assetDataService.getCosmetics(options);
    const etag = buildWeakEtag("assets:cosmetics", data.baseUrl, req.originalUrl);
    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
      res.status(304).end();
      return;
    }
    applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
    res.json(data);
  })
);

assetsRouter.get(
  "/audios",
  asyncHandler(async (req, res) => {
    const data = await assetDataService.getAudio();
    const etag = buildWeakEtag("assets:audios", data.baseUrl, req.originalUrl);
    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
      res.status(304).end();
      return;
    }
    applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
    res.json(data);
  })
);

// GET /assets/proxy?url=<https-magicgarden.gg-or-own-sprite-url>
// Streams an upstream asset (cosmetic PNGs, audio mp3s, …) through this API so
// clients can fetch + download them cross-origin. Upstream magicgarden.gg
// doesn't set CORS, so the browser blocks direct fetch from third-party
// origins like the explorer page; this proxy adds the headers we need. Same
// problem for our own /assets/sprites/ — it's served straight off disk by
// nginx (see nginx.conf) with no CORS header of its own, which is why pet
// cosmetics (exported PNGs, not on magicgarden.gg) needed adding here too.
// Whitelisted to magicgarden.gg and this instance's own sprite exports - not a
// general open proxy.
//
// The second pattern used to name `mg-api.ariedam.fr`, the upstream deployment,
// and two things were wrong with that. It made our fork proxy *its own* files
// through somebody else's host — the comment above already says our sprites
// "needed adding here too", and they never were, because the pattern named a host
// we do not run. And it told every reader that the upstream deployment is ours,
// which is the same claim the spec used to make (plan item 14) and the sprite
// URLs used to make (item 23).
//
// So the game stays the fixed upstream, and everything else is derived from where
// this instance actually lives: its configured public URL, its sprite base if one
// is set, and the origin the request arrived at. The list is still explicit and
// still short — the point is that it is short for the right reason.
const GAME_ASSET_URL_RX = /^https:\/\/magicgarden\.gg\/[\w./%-]+$/i;

/** One origin's own sprite files, as a pattern, or nothing when there is no origin to allow. */
function ownSpritesRx(origin) {
  if (!origin) return [];
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [new RegExp(`^${escaped}/assets/sprites/[\\w./%-]+$`, "i")];
}

/** Every pattern one request may proxy: the game, and this instance wherever it is reachable. */
function proxyAllowed(req) {
  const host = typeof req?.get === "function" ? req.get("host") : null;
  const fromRequest = host ? `${req.protocol}://${host}` : "";
  return [
    GAME_ASSET_URL_RX,
    ...ownSpritesRx(config.api?.publicUrl),
    ...ownSpritesRx(config.sprites.baseUrl),
    ...ownSpritesRx(fromRequest),
  ];
}

/**
 * Le handler du proxy, paramétré par son `fetch`.
 *
 * `fetchImpl` est injectable parce que le comportement à mesurer — un amont qui
 * n'écrit jamais — ne s'obtient pas contre une URL réelle de la liste blanche.
 */
export function createProxyHandler({ fetchImpl = fetch } = {}) {
  return async function proxyUpstream(req, res) {
    const url = String(req.query.url || "");
    if (!url) throw Errors.badRequest("Missing required query param: url");
    if (!proxyAllowed(req).some((rx) => rx.test(url))) {
      throw Errors.badRequest("URL must be a https://magicgarden.gg/ or this instance's own sprite asset");
    }

    // Sans plafond, un amont qui accepte la connexion sans jamais répondre
    // laissait la requête du client ouverte pour toujours. Le proxy est sur le
    // chemin d'un navigateur qui attend une image : il doit rendre un 504
    // nommé plutôt que de tenir la connexion.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.platform.timeout);

    let upstream;
    try {
      upstream = await fetchImpl(url, { signal: controller.signal });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new ApiError(
          504,
          "UPSTREAM_TIMEOUT",
          `Upstream did not respond within ${config.platform.timeout} ms: ${new URL(url).host}`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) throw Errors.notFound(`Upstream HTTP ${upstream.status}`);
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("Cache-Control", "public, max-age=86400, immutable");
    res.type(contentType).send(buf);
  };
}

assetsRouter.get("/proxy", asyncHandler(createProxyHandler()));

// =====================
// Sprite files (static PNG serving)
// =====================

// Profil `data` : rien de tout ce qui suit n'est exporté sur cette instance, donc
// tout ce qui suit répond 503 au lieu de servir un dossier absent ou périmé. Un
// seul point de refus, avant les quatre routeurs.
assetsRouter.use(requireSpriteExport);

// Composed sprites (must be before /sprites to avoid :category/:name capturing "composed")
// GET /assets/sprites/composed?key=...&mutations=...
assetsRouter.use("/sprites/composed", composedRouter);

// Individual sprite PNGs: GET /assets/sprites/:category/:name.png
assetsRouter.use("/sprites", spritesRouter);

// Animated loops rendered from Rive: GET /assets/animations/:category/:name_<clip>.webp
// (distinct from the `animations` sprite category, which holds still PNGs)
assetsRouter.use("/animations", animationsRouter);

// The game's Rive files themselves: GET /assets/rive
assetsRouter.use("/rive", riveRouter);
