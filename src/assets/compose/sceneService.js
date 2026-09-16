// src/assets/compose/sceneService.js
//
// The one thing both compose routes call: a spec in, a picture and its layout out — composed once.
//
// The key is the content hash of the **normalised** spec, so this is where "two identical specs
// compose once" is true or false. Every path through here checks the cache before it draws anything,
// and the only call to `paintScene` is behind that check.

import { layOutScene } from "./sceneLayout.js";
import { paintScene } from "./scenePainter.js";
import { clearAtlasPixelCache } from "./atlasPixels.js";
import { clearArtBridgeCache } from "./artBridge.js";
import { clearScenePainterCache } from "./scenePainter.js";
import { contentKey, readScene, writeScene } from "./sceneCache.js";
import { ComposeSpecError, normalizeSpec, SPEC_VERSION } from "./spec.js";
import { getBuildInfo } from "../../docs/contract.js";

/** The version of the game data the answer was built from, or `null` when it is not known. */
async function gameVersion() {
  try {
    const info = await getBuildInfo();
    return info?.gameVersion ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a spec to `{ key, png, layout, source }`, composing only on a miss.
 *
 * `source` is `"cache"`, `"disk"` or `"composed"`, which is what the counter test and the response
 * header report. A spec the endpoint cannot draw comes back as `{ error }` rather than throwing: an
 * unknown species is a client's mistake with a name, not a server fault, and the route turns it into
 * a 400.
 */
export async function resolveScene(rawSpec) {
  let normalized;
  try {
    normalized = normalizeSpec(rawSpec);
  } catch (error) {
    if (error instanceof ComposeSpecError) return { error, status: error.status };
    throw error;
  }

  const key = contentKey(normalized);
  const cached = await readScene(key);
  if (cached !== null) {
    return { ...cached, version: await gameVersion(), spec: SPEC_VERSION };
  }

  let laid;
  try {
    laid = await layOutScene(normalized);
  } catch (error) {
    if (error instanceof ComposeSpecError) return { error, status: error.status };
    throw error;
  }
  if (laid.error !== undefined) {
    return { error: new ComposeSpecError("COMPOSE_SPEC_INVALID", laid.error), status: 400 };
  }
  const png = await paintScene({ width: laid.canvas.width, height: laid.canvas.height, layers: laid.layers });
  const layout = { ...laid.layout, key };
  const stored = await writeScene(key, png, layout);
  return { ...stored, version: await gameVersion(), spec: SPEC_VERSION };
}

/** Drop every cache a scene reads through, for a test (or a resync) that changed the data. */
export function clearSceneCaches() {
  clearArtBridgeCache();
  clearAtlasPixelCache();
  clearScenePainterCache();
}
