// src/docs/load.js
//
// Lecture du document de contrat (`src/docs/openapi.yaml`), à la demande.
//
// Le fichier est versionné dans le dépôt et lu par un chemin relatif au module
// (`import.meta.url`), donc un conteneur bâti sur le dépôt l'a toujours. Ce qui
// n'allait pas, c'était *quand* : le lire au chargement du module faisait de
// chaque défaut du document — fichier absent d'une image partielle, YAML
// cassé — un échec d'import. En ESM, l'échec est au link time : `createApp()`
// n'est jamais atteint, donc l'API entière est injoignable, `/health` compris,
// et le seul signal est une stack de Node au démarrage.
//
// Ici la lecture est une fonction mémoïsée : le premier appelant paie la
// lecture, un document invalide lève une `ContractDocumentError` nommée, et
// c'est le handler de la route qui la rapporte — avec un statut et un code — à
// la première requête qui a besoin du contrat.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import YAML from "yamljs";

/** Chemin par défaut : le document vit à côté de ce module. */
export const DEFAULT_OPENAPI_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "openapi.yaml"
);

/**
 * Le document déclaré est inutilisable : absent, illisible, YAML invalide, ou
 * sans les deux clés dont le contrat dépend.
 *
 * `code` est stable : c'est ce que la réponse HTTP rapporte, et ce qu'un
 * opérateur peut chercher dans les journaux.
 */
export class ContractDocumentError extends Error {
  constructor(message, { path, cause } = {}) {
    super(message, { cause });
    this.name = "ContractDocumentError";
    this.code = "CONTRACT_DOCUMENT_INVALID";
    this.path = path;
  }
}

// Chargé une fois par process, et seulement si quelqu'un le demande.
let cached = null;

/**
 * Le document OpenAPI déclaré, validé quant à ses deux clés de contrat.
 *
 * @param {{ path?: string, reload?: boolean }} [options]
 */
export function loadOpenApiDocument({ path = DEFAULT_OPENAPI_PATH, reload = false } = {}) {
  if (cached && !reload && cached.path === path) return cached.document;

  let document;
  try {
    document = YAML.load(path);
  } catch (err) {
    throw new ContractDocumentError(
      `Cannot read the contract document at ${path}: ${err?.message ?? String(err)}`,
      { path, cause: err }
    );
  }

  const contract = document?.["x-mg-contract"] ?? {};
  if (document?.info?.version == null || contract.api == null) {
    throw new ContractDocumentError(
      "openapi.yaml must declare info.version and x-mg-contract.api: the contract version is what a client checks before it trusts this host",
      { path }
    );
  }

  cached = { path, document };
  return document;
}
