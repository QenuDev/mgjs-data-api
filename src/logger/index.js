// src/logger/index.js

import { createRequire } from "node:module";
import pino from "pino";
import { config } from "../config/index.js";

/**
 * `pino-pretty` est une devDependency utilisée comme transport de production.
 *
 * pino ne se rabat pas tout seul quand la cible d'un `transport` est absente :
 * il lève au chargement du logger, donc avant que le serveur ne lie un port, et
 * l'opérateur voit une erreur d'import de module là où il attendait une ligne
 * de log. La décision est donc prise ici, dans cet ordre :
 *
 * 1. `LOG_PRETTY=true` et le transport installé : sortie lisible en dev ;
 * 2. `LOG_PRETTY=true` et le transport absent (image `npm ci --omit=dev`) :
 *    JSON sur stdout, avec un avertissement — un log illisible vaut mieux
 *    qu'un process qui refuse de démarrer ;
 * 3. par défaut : JSON, ce que lit un agrégateur.
 */
const PRETTY_TARGET = "pino-pretty";

function isPrettyAvailable() {
  try {
    createRequire(import.meta.url).resolve(PRETTY_TARGET);
    return true;
  } catch {
    return false;
  }
}

const prettyRequested = config.logging.pretty === true;
const prettyInstalled = prettyRequested && isPrettyAvailable();

const transport = prettyInstalled
  ? {
      target: PRETTY_TARGET,
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    }
  : undefined;

export const logger = pino({
  level: config.logging.level,
  transport,
});

if (prettyRequested && !prettyInstalled) {
  logger.warn(
    { target: PRETTY_TARGET },
    "LOG_PRETTY is set but pino-pretty is not installed - logging plain JSON"
  );
}

// Raccourcis pour faciliter l'usage
export const log = {
  info: (msg, data) => logger.info(data, msg),
  warn: (msg, data) => logger.warn(data, msg),
  error: (msg, data) => logger.error(data, msg),
  debug: (msg, data) => logger.debug(data, msg),
};
