// src/api/routes/compose.js
//
// `POST /compose` and `GET /compose/<key>.png` — a scene in, one picture and its layout out
// (docs/mgjs-community-api-plan.md §3.2, work items 20 to 22).
//
//   POST /compose                 body: a scene spec   -> image/png
//   POST /compose?format=layout   body: a scene spec   -> application/json, no picture encoded
//   GET  /compose/<key>.png       the content-addressed result -> the same picture, from the file
//
// The spec names things the way the game does and never in pixels (`src/assets/compose/spec.js`); the
// layout is the same boxes the picture is drawn into, so a consumer can keep its own interactivity —
// a countdown ring, a hover target, a detail dialog each need a box — and so the placement can be
// asserted as numbers without decoding a PNG.
//
// ## What a caller gets for a refusal
//
// A spec the endpoint cannot draw and a spec over a limit are both named errors, never a truncated
// scene: `COMPOSE_SPEC_INVALID`, `COMPOSE_LIMIT_EXCEEDED` (with the limit's name and what the spec
// stated) and `COMPOSE_SPEC_VERSION_UNSUPPORTED`. Truncating would silently return a wrong picture,
// which is the one failure this design exists to prevent.

import express from "express";

import { logger } from "../../logger/index.js";
import { asyncHandler, Errors, requireSpriteExport } from "../middleware/index.js";
import { buildWeakEtag, isFresh } from "../../utils/httpCache.js";
import { clearSceneCaches, resolveScene } from "../../assets/compose/sceneService.js";
import { cacheDirectory, readScene } from "../../assets/compose/sceneCache.js";
import { COMPOSE_LIMITS, SPEC_VERSION } from "../../assets/compose/spec.js";

export const composeRouter = express.Router();

/** A composed scene is content-addressed and does not change: cache it for a day. */
const COMPOSE_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=3600";

/** The body's own ceiling, so a spec is refused before it is parsed rather than after. */
const BODY_LIMIT = "256kb";

/** The key's shape: what `contentKey` produces, and nothing else a caller could invent. */
const KEY_PATTERN = /^[0-9a-f]{40}$/;

/**
 * `GET /compose` — what this endpoint takes, what it refuses, and what it costs.
 *
 * The collection of a POST-only route that has something to say about itself: the spec version, the
 * declared limits, and where the cache lives. It exists because a caller that reaches `/compose`
 * with a browser or a `GET` should be told how to use it rather than be served a 404 that reads like
 * the route is missing — and because the contract names `/compose` as the capability's path, so the
 * path answers.
 */
composeRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      spec: SPEC_VERSION,
      method: "POST",
      body: "a scene spec; see /docs/openapi.json",
      formats: ["image/png", "application/json"],
      layout: "?format=layout",
      itemKinds: ["plant", "crop"],
      limits: { ...COMPOSE_LIMITS },
      cache: { directory: cacheDirectory(), keyedBy: "sha256 of the normalised spec" },
      result: "/compose/<key>.png",
    });
  })
);

/**
 * `POST /compose` — the scene.
 *
 * `?format=layout` answers the same boxes as JSON and encodes no image at all, which is what makes
 * the placement assertable as numbers. Any other `format` is a bad request rather than a silent
 * fallback to the picture.
 */
composeRouter.post(
  "/",
  requireSpriteExport,
  express.json({ limit: BODY_LIMIT }),
  asyncHandler(async (req, res) => {
    const format = String(req.query.format ?? "")
      .trim()
      .toLowerCase();
    if (format !== "" && format !== "layout") {
      throw Errors.badRequest(`format=${JSON.stringify(req.query.format)} is not supported; omit it or use "layout"`);
    }
    if (req.body === undefined || req.body === null) {
      throw Errors.badRequest("a scene spec is required in the request body");
    }

    const resolved = await resolveScene(req.body);
    if (resolved.error !== undefined) {
      const error = resolved.error;
      logger.debug({ code: error.code, message: error.message }, "compose refused a spec");
      // The refusal carries the error's own code, its name for the limit, and what the spec stated —
      // `errorHandler` serialises an `ApiError`, and a `ComposeSpecError` is not one, so the body is
      // built from the error's own `toJSON` rather than flattened into a string.
      const body = JSON.stringify(error.toJSON());
      res.status(resolved.status ?? 400);
      res.set("Content-Type", "application/json; charset=utf-8");
      res.set("Content-Length", Buffer.byteLength(body));
      return res.end(body);
    }

    const etag = buildWeakEtag("compose", resolved.key, format === "layout" ? "layout" : "png");
    res.set("X-MG-Compose-Key", resolved.key);
    if (resolved.version !== null && resolved.version !== undefined) {
      res.set("X-MG-Game-Version", String(resolved.version));
    }
    res.set("Cache-Control", COMPOSE_CACHE_CONTROL);
    res.set("Cross-Origin-Resource-Policy", "cross-origin");

    if (isFresh(req, etag)) {
      res.set("ETag", etag);
      return res.status(304).end();
    }
    res.set("ETag", etag);

    if (format === "layout") {
      return res.status(200).json(resolved.layout);
    }
    res.type("image/png").send(resolved.png);
  })
);

/**
 * `GET /compose/<key>.png` — the composed picture, straight from the cache file.
 *
 * The key is the content hash the POST answered in `X-MG-Compose-Key`, so this is how a client or a
 * CDN links a result without posting the spec again. A key the cache does not hold is a 404 that says
 * so: the scene cannot be reconstructed from a hash, so a miss is a real miss rather than a cold
 * compose.
 */
composeRouter.get(
  // `/{key}.png`, stated as the document states it, so the route the contract declares and the route
  // the server mounts cannot drift apart — the suite compares the two lists by their own spelling.
  "/:key.png",
  requireSpriteExport,
  asyncHandler(async (req, res) => {
    const key = String(req.params.key ?? "");
    if (!KEY_PATTERN.test(key)) {
      throw Errors.badRequest(
        `compose keys are 40 hexadecimal characters, as X-MG-Compose-Key states; got ${JSON.stringify(`${key}.png`)}`
      );
    }

    const found = await readScene(key);
    if (found === null) {
      throw Errors.notFound(
        `no composed scene is cached under ${key}; POST the spec to /compose and read its X-MG-Compose-Key`
      );
    }

    res.set("X-MG-Compose-Key", key);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.type("image/png").send(found.png);
  })
);

/** The exported hook the tests use to drop every cache a scene reads through. */
export { clearSceneCaches };
