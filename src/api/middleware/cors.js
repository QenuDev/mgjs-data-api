// src/api/middleware/cors.js

import cors from "cors";
import { config } from "../../config/index.js";

/**
 * Middleware CORS.
 * Configure les headers Cross-Origin Resource Sharing.
 *
 * `exposedHeaders` : un `fetch()` cross-origin ne laisse lire au client que les
 * en-têtes « safelisted » (Content-Type, Cache-Control…) ; tout en-tête
 * applicatif doit être publié ici. Sans cette liste, un navigateur reçoit
 * `X-Game-Version` (la version du jeu que la réponse décrit) et `ETag` (dont
 * dépendent les `304` de `/data`) sans pouvoir les lire — la réponse arrive,
 * l'information non.
 *
 * Publier n'est pas autoriser : `allowedHeaders` reste la liste des en-têtes que
 * le client peut *envoyer*, et elle ne bouge pas.
 */
export const corsMiddleware = cors({
  origin: config.cors.origin,
  methods: ["GET", "HEAD", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"],
  exposedHeaders: ["X-Game-Version", "ETag"],
  credentials: false,
  maxAge: 86400, // 24h preflight cache
});
