// src/api/routes/schema.js

import express from "express";
import { asyncHandler } from "../middleware/index.js";
import { buildRuntimeContract } from "../../docs/contract.js";
import { DATA_CATEGORIES, getDataCoverage } from "./data.js";

export const schemaRouter = express.Router();

const SCHEMA_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=30";

/**
 * GET /schema.json
 *
 * Le contrat tel que cette instance le sert maintenant : version du contrat,
 * liste des chemins, capacités, catégories de `/data` que le bundle courant
 * permet encore de construire, version du jeu dont les données et les sprites
 * ont été construits, et quand. Pas d'auth, JSON simple, cacheable une minute.
 *
 * C'est le document qu'un client lit avant de faire confiance à l'URL ;
 * `/docs/openapi.json` reste la vue humaine et outillée, générée du même
 * `openapi.yaml`.
 */
schemaRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    // `/health` expose déjà les catégories cassées par clé de cache ; le
    // contrat parle en noms de routes (`decors`, `weather-groups`).
    const { unavailable } = getDataCoverage();
    const unavailableRoutes = {};
    for (const { route, cacheKey } of DATA_CATEGORIES) {
      if (cacheKey in unavailable) unavailableRoutes[route] = unavailable[cacheKey];
    }

    res.set("Cache-Control", SCHEMA_CACHE_CONTROL);
    res.json(await buildRuntimeContract({ unavailable: unavailableRoutes }));
  })
);
