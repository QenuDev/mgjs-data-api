// src/api/middleware/errorHandler.js

import { logger } from "../../logger/index.js";

/**
 * Erreur API personnalisée avec code HTTP et code d'erreur.
 */
export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

// Factory helpers pour les erreurs courantes
export const Errors = {
  notFound: (message = "Resource not found") =>
    new ApiError(404, "NOT_FOUND", message),

  badRequest: (message = "Bad request", details = null) =>
    new ApiError(400, "BAD_REQUEST", message, details),

  internal: (message = "Internal server error") =>
    new ApiError(500, "INTERNAL_ERROR", message),

  serviceUnavailable: (message = "Service temporarily unavailable") =>
    new ApiError(503, "SERVICE_UNAVAILABLE", message),

  tooManyRequests: (message = "Too many requests") =>
    new ApiError(429, "RATE_LIMITED", message),

  extraction: (category, originalError) =>
    new ApiError(
      500,
      "EXTRACTION_FAILED",
      `Failed to extract ${category} data`,
      { originalMessage: originalError?.message }
    ),
};

/**
 * Middleware de gestion d'erreurs centralisé.
 * Doit être monté en dernier sur l'app Express.
 */
export function errorHandler(err, req, res, _next) {
  // Log l'erreur
  logger.error({
    err: {
      message: err.message,
      stack: err.stack,
      code: err.code,
    },
    req: {
      method: req.method,
      path: req.path,
      query: req.query,
    },
  });

  // Erreur API connue
  if (err instanceof ApiError) {
    return res.status(err.status).json(err.toJSON());
  }

  // Défaut de configuration du serveur, pas de la requête : la réponse doit
  // porter le code stable de l'erreur pour qu'un opérateur le retrouve dans les
  // journaux, même en production où le message d'une erreur inconnue est tu.
  if (err.name === "ContractDocumentError") {
    return res.status(500).json({
      error: {
        code: err.code ?? "CONTRACT_DOCUMENT_INVALID",
        message: err.message,
      },
    });
  }

  // Erreur inconnue
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message:
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred"
          : err.message,
    },
  });
}

/**
 * Wrapper async pour les routes Express.
 * Attrape automatiquement les erreurs et les passe au middleware.
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
