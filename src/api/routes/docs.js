// src/api/routes/docs.js

import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getShopTypes } from "../../services/historyQueries.js";
import {
  buildBaseOpenApiDocument,
  withRuntimeContract,
} from "../../docs/contract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const docsDir = join(__dirname, "..", "..", "docs");

// Le document et les faits de l'instance viennent de `src/docs/contract.js` :
// c'est la même source que `/schema.json`, donc les deux ne peuvent pas
// annoncer des versions de contrat différentes.
let specCache = { key: null, base: null };

async function getSpec() {
  const shopTypes = await getShopTypes();
  const key = shopTypes.join(",");
  if (specCache.key !== key) {
    specCache = { key, base: buildBaseOpenApiDocument({ shopTypes }) };
  }
  return withRuntimeContract(specCache.base);
}

// Custom interactive docs page (landing + endpoint explorer with try-it)
const docsHtml = readFileSync(join(docsDir, "index.html"), "utf8");

export const docsRouter = express.Router();

// Disable caching for docs assets/spec to avoid stale UI behind CDN caches.
docsRouter.use((_req, res, next) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// Serve OpenAPI spec as JSON (consumed by the docs page)
docsRouter.get("/openapi.json", async (_req, res) => {
  res.json(await getSpec());
});

// Serve the docs page
docsRouter.get("/", (_req, res) => {
  res.type("html").send(docsHtml);
});
