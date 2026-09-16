// src/api/server.js

import express from "express";
import helmet from "helmet";

import { config } from "../config/index.js";
import { logger } from "../logger/index.js";

import {
  corsMiddleware,
  apiLimiter,
  requestLogger,
  errorHandler,
} from "./middleware/index.js";

import {
  dataRouter, dataCsvRootHandler, dataTsvRootHandler,
  liveRouter, liveCsvRootHandler, liveTsvRootHandler,
  healthRouter, docsRouter, schemaRouter, assetsRouter, statsRouter,
  weatherStationRouter,
} from "./routes/index.js";

/**
 * Crée l'application Express avec tous les middlewares.
 */
export function createApp() {
  const app = express();

  // Trust proxy (Nginx)
  app.set("trust proxy", 1);

  // =====================
  // Security & Global Middlewares
  // =====================

  // Helmet pour les headers de sécurité
  app.use(helmet({
    contentSecurityPolicy: false, // API JSON, pas de HTML
  }));

  // CORS
  if (config.cors.enabled) {
    app.use(corsMiddleware);
  }

  // Rate limiting
  if (config.rateLimit.enabled) {
    app.use(apiLimiter);
  }

  // Request logging
  app.use(requestLogger);

  // JSON parsing
  app.use(express.json());

  // =====================
  // Routes
  // =====================

  // Health check (pas de rate limit)
  app.use("/health", healthRouter);

  // Le contrat public servi à plat, pour les clients : /docs est la vue humaine.
  app.use("/schema.json", schemaRouter);

  // API Documentation (Swagger UI)
  app.use("/docs", docsRouter);

  // Data routes (static game data + assets)
  app.get("/data.csv", dataCsvRootHandler);
  app.get("/data.tsv", dataTsvRootHandler);
  app.use("/data", dataRouter);

  // Live routes (shops & weather snapshots + SSE)
  app.get("/live.csv", liveCsvRootHandler);
  app.get("/live.tsv", liveTsvRootHandler);
  app.use("/live", liveRouter);

  // Assets routes (cosmetics, audios, etc.)
  app.use("/assets", assetsRouter);

  // Stats routes (aggregated history)
  app.use("/stats", statsRouter);

  // Weather station (deterministic forecast: present + upcoming + accuracy)
  app.use("/weather-station", weatherStationRouter);

  // Root endpoint
  app.get("/", (_req, res) => {
    res.json({
      name: "MG API",
      version: "2.0.0",
      description: "Unofficial Magic Garden API",
      endpoints: {
        data: "/data",
        live: "/live",
        health: "/health",
        docs: "/docs",
      },
    });
  });

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Endpoint not found",
      },
    });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

/**
 * L'adresse qu'un `listen` a effectivement obtenue, ou celle qu'il visait.
 *
 * `server.address()` vaut `null` quand la liaison a échoué, donc un message
 * d'échec doit retomber sur la valeur demandée : c'est celle-là que l'opérateur
 * doit changer.
 */
function boundAddress(server, fallback) {
  const bound = server.address();
  if (bound && typeof bound === "object") {
    return { address: bound.address, port: bound.port };
  }
  return fallback;
}

/**
 * Message d'un échec de liaison, avec l'adresse et le port.
 *
 * `EADDRINUSE` est la seule erreur de démarrage qu'un opérateur peut corriger
 * en changeant une variable : le message doit donc la nommer, avec la valeur
 * exacte à changer, plutôt que de laisser Node imprimer `:::3000` sans dire
 * quoi en faire.
 */
export function listenFailureMessage(err, { address, port }) {
  if (err?.code === "EADDRINUSE") {
    return (
      `Cannot start the API server: address ${address}:${port} is already in use (EADDRINUSE). ` +
      `Another process is already listening there. Set PORT to a free port, or stop that process.`
    );
  }
  return `Cannot start the API server on ${address}:${port}: ${err?.code ?? "error"} ${err?.message ?? ""}`.trim();
}

/**
 * Ce que fait le process quand le serveur ne peut pas se lier.
 *
 * Par défaut : une ligne lisible sur stderr puis `process.exit(1)`, parce que
 * c'est ce qu'un superviseur (docker, pm2) doit voir pour redémarrer ou
 * signaler. Sans handler `'error'`, exprès : un `'error'` non écouté est fatal
 * et sort en 1, mais avec un nom de fichier Node et sans nommer le port. Le
 * handler ci-dessous est posé à la place, jamais en plus.
 *
 * `process.exit` est appelé immédiatement, sans `setTimeout` : `console.error`
 * écrit sur un descripteur de fichier de façon synchrone pour un terminal et
 * pour un pipe, et attendre ne rendrait la main à la boucle d'événements que
 * pour laisser partir les lignes que `src/index.js` a déjà journalisées — dont
 * un « MG API ready » qui n'a jamais été vrai.
 *
 * Exporté pour que les tests puissent vérifier le message sans tuer le
 * process de test.
 */
export function exitOnListenFailure(err, context = {}) {
  const { server, port = config.server.port, host = config.server.host } = context;
  const fallback = { address: host, port };
  const where = server ? boundAddress(server, fallback) : fallback;

  console.error(listenFailureMessage(err, where));
  process.exit(1);
}

/**
 * Démarre le serveur API.
 *
 * `onListenError` est injectable pour les tests : le défaut termine le process,
 * ce qu'un test ne peut pas observer autrement qu'en le lançant dans un
 * sous-process.
 */
export function startApiServer({ port = config.server.port, onListenError = exitOnListenFailure } = {}) {
  const app = createApp();

  const server = app.listen(port);

  // Le callback est posé séparément d'`app.listen` : Express 5 passe le dernier
  // argument à `server.once('error', done)` *et* à `'listening'`, donc un
  // `app.listen(port, cb)` rapporte « démarré » même quand la liaison a échoué.
  // Un unhandled `'error'` est fatal : la seule ligne journalisée avant la
  // sortie serait alors celle qui annonce un démarrage qui n'a pas eu lieu.
  server.on("listening", () => {
    logger.info({ port: server.address()?.port ?? port }, "API server started");
  });

  server.on("error", (err) => {
    onListenError(err, { server, port, host: config.server.host });
  });

  return { app, server };
}
