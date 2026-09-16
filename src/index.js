// src/index.js
// Main entry point for MG API

import { config } from "./config/index.js";
import { logger } from "./logger/index.js";
import { startApiServer, waitForListening, exitOnListenFailure } from "./api/server.js";
import { startHistoryRecorder, stopHistoryRecorder } from "./services/index.js";
import { startLivePoller, stopLivePoller } from "./services/livePoller.js";
import { startVersionWatcher, stopVersionWatcher } from "./services/spriteSync.js";

// =====================
// 1) Start API Server
// =====================

// `app.listen` rend la main avant que le socket soit lié : un port déjà pris
// (EADDRINUSE) arrive sur le serveur sous forme d'événement `'error'` *après*
// l'évaluation de ce module. Mesuré sur ce point d'entrée, avec un socket qui
// tient le port : les services de fond démarraient, « MG API ready » était
// journalisé, et le message d'échec arrivait ensuite — les deux ensemble.
//
// Rien de tout ça n'est donc lancé au niveau du module. `waitForListening`
// résout quand le serveur écoute vraiment et rejette quand il n'a pas pu se
// lier ; c'est ce rejet qui décide, et le handler d'échec du serveur écrit la
// ligne qui nomme le port avant de sortir en 1.
const { server } = startApiServer({
  port: config.server.port,
  onListenError: (err, context) => {
    exitOnListenFailure(err, context);
  },
});

waitForListening(server)
  .then(() => {
    // =====================
    // 2) Live data from the game's official API
    // =====================
    //
    // Les shops et la météo viennent de `/platform/v1/{shops,weather}` : plus
    // besoin de rejoindre une room du jeu en WebSocket pour les lire.

    startLivePoller();

    // Suit la version du jeu pour resynchroniser les sprites après une mise à
    // jour (ce que signalaient auparavant les codes de fermeture WebSocket
    // 4700/4710).
    startVersionWatcher();

    // =====================
    // 3) History recorder (SQLite persistence of shops/weather)
    // =====================

    if (config.history.enabled) {
      try {
        startHistoryRecorder();
      } catch (err) {
        logger.error({ error: err?.message }, "Failed to start history recorder");
      }
    }

    logger.info({ port: server.address()?.port ?? config.server.port }, "MG API ready");
  })
  .catch(() => {
    // Le handler du serveur a déjà écrit le message et appelé `process.exit(1)`
    // (il est branché avant cette promesse, dans l'ordre d'abonnement) ; ici on
    // ne fait que consommer le rejet pour qu'il ne remonte pas en
    // `unhandledRejection` si ce handler est remplacé par un test.
  });

// =====================
// 4) Graceful Shutdown
// =====================

function shutdown() {
  logger.info("Shutting down...");

  try {
    stopHistoryRecorder();
  } catch {
    // Ignore
  }

  try {
    stopLivePoller();
  } catch {
    // Ignore
  }

  try {
    stopVersionWatcher();
  } catch {
    // Ignore
  }

  try {
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  } catch {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// =====================
// Export for external use
// =====================

export { server };
