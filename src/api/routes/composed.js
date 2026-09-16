// src/api/routes/composed.js
import express from "express";
import { asyncHandler, Errors } from "../middleware/index.js";
import { resolveComposedSprite } from "../../assets/sprites/spriteComposer.js";
import { buildWeakEtag, isFresh, applyCacheHeaders } from "../../utils/httpCache.js";

export const composedRouter = express.Router();

const COMPOSED_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=3600";

/** The box header's shape: `x,y,width,height` in picture pixels, one place, parseable. */
function boxHeader(box) {
  return `${box.x},${box.y},${box.width},${box.height}`;
}

/**
 * GET /assets/sprites/composed
 *   ?key=sprite/tallplant/Cactus
 *   &mutations=Rainbow,Wet,Amberlit   (order-insensitive, deduplicated server-side)
 *   &format=layout                    (the box without the picture)
 *
 * Returns a pre-composed PNG with mutations applied: the canvas is the tight union of the
 * crop's own art and every layer drawn over it, and the art sits inside it at the rectangle
 * `X-MG-Sprite-Box: x,y,width,height` states — where that art is, in picture pixels, so a
 * caller can place the picture on a tile. The one layer still cut is the tall-plant overlay,
 * which the game itself masks to the crop body's own texture (`src/assets/sprites/cropBox.js`
 * states the convention and the evidence).
 *
 * `?format=layout` answers the same box as JSON instead of the picture, for a caller
 * that only needs to place one it already has — and so the box can be asserted as
 * numbers, without decoding a PNG.
 *
 * 404 only when the base key does not exist in the atlas.
 * Unknown mutation ids are silently ignored.
 *
 * When a bake is enabled (`BAKE=1`, docs/mgjs-community-api-plan.md §3.1) a set it produced
 * is one file read; a set it did not is composed once, kept under the bake's own naming
 * scheme and added to its manifest, so the answer is the same either way and the first
 * request is the only one that costs a composition.
 */
composedRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const key = String(req.query.key || "").trim();
    if (!key) throw Errors.badRequest("Missing required query param: key");

    // Sanitize key: must look like sprite/<category>/<name>, weather/<name> or
    // tile/<name>. Upstream asset names occasionally contain spaces (e.g.
    // "Rectangle 81"), so the allow-list includes a literal space. Lookup is
    // dict-based (no filesystem), so path-traversal isn't a concern.
    if (!/^[\w/\-. ]+$/.test(key)) throw Errors.badRequest("Invalid key format");

    const rawMutations = String(req.query.mutations || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const layoutOnly = String(req.query.format || "").toLowerCase() === "layout";

    const etag = buildWeakEtag("composed", key, rawMutations.sort().join(","), layoutOnly ? "layout" : "png");
    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: COMPOSED_CACHE_CONTROL });
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      return res.status(304).end();
    }

    const composed = await resolveComposedSprite(key, rawMutations);
    if (!composed) throw Errors.notFound(`Sprite not found: ${key}`);

    applyCacheHeaders(res, { etag, cacheControl: COMPOSED_CACHE_CONTROL });
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("X-MG-Sprite-Box", boxHeader(composed.box));

    if (layoutOnly) {
      return res.status(200).json({
        key,
        mutations: rawMutations,
        box: composed.box,
      });
    }

    res.type("image/png").send(composed.buffer);
  })
);
