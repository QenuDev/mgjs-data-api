// src/docs/contract.js
//
// Source unique du contrat public : le document déclaré dans `openapi.yaml` et
// les faits que l'instance en cours sert réellement (`/schema.json`,
// `/data/version`). Le document et la route lisent le même fichier, donc ils ne
// peuvent pas annoncer deux versions différentes du contrat.
//
// Ce que le document déclare (version du contrat, capacités, catégories de
// données) est statique ; ce que seule l'instance sait (version du jeu dont les
// données et les sprites ont été construits, date de construction) est rempli
// à chaque réponse depuis le disque, jamais depuis un appel réseau.
//
// Le document déclaré est lu *à la demande* (`./load.js`) : un `openapi.yaml`
// absent ou cassé ne fait plus échouer l'import du module, donc l'app démarre
// et le défaut est rapporté par la première requête qui lit le contrat.

import { config } from "../config/index.js";
import { getCacheStats, getCachedBundleVersion } from "../core/game/cache.js";
import { getStoredVersionInfoCached } from "../core/game/versionStorage.js";
import { loadOpenApiDocument } from "./load.js";

export { ContractDocumentError, loadOpenApiDocument } from "./load.js";

/**
 * Ce que le document déclare, en un seul accès.
 *
 * Version du contrat (nombre, pas la chaîne de l'OpenAPI), capacités et liste
 * des chemins viennent tous du même fichier ; les lire ensemble garantit qu'ils
 * ne peuvent pas décrire deux documents différents. Cette fonction est le seul
 * endroit qui appelle `loadOpenApiDocument()`, donc c'est aussi le seul endroit
 * où un document cassé se manifeste — par une `ContractDocumentError` nommée,
 * pas par un `throw` à l'import.
 */
export function declaration() {
  const document = loadOpenApiDocument();
  const contract = document["x-mg-contract"] ?? {};

  return {
    version: Number(document.info.version),
    api: contract.api,
    capabilities: [...(contract.capabilities ?? [])],
    data: [...(contract.data ?? [])],
    paths: Object.keys(document.paths ?? {}),
  };
}

/** Les chemins que le document couvre, dans son ordre. */
export function declaredPaths() {
  return declaration().paths;
}

/**
 * Version du contrat, à ne pas confondre avec la version du jeu.
 *
 * `info.version` est une chaîne dans l'OpenAPI 3.0 ; les clients comparent un
 * nombre, donc c'est la valeur numérique qui est servie par `/schema.json` et
 * `/data/version`.
 *
 * C'est une fonction et non une constante exportée : une constante serait
 * calculée à l'import du module, c'est-à-dire exactement le moment où l'on ne
 * veut plus lire le document.
 */
export function contractVersion() {
  return declaration().version;
}

const SHOP_PARAM_NAME = "shop";

/**
 * Remplace l'enum du paramètre `shop` par la liste réelle des shops du jeu,
 * pour que la doc (et le sélecteur de l'explorer) ne périme pas quand le jeu
 * en ajoute un.
 */
function withShopEnum(spec, shopTypes) {
  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const operation of Object.values(pathItem ?? {})) {
      for (const param of operation?.parameters ?? []) {
        if (param?.name === SHOP_PARAM_NAME && Array.isArray(param.schema?.enum)) {
          param.schema.enum = [...shopTypes];
        }
      }
    }
  }

  return spec;
}

/**
 * La liste `servers` du document, dérivée de la configuration.
 *
 * Le document ne nomme plus l'hôte d'un déploiement : un fork se déploie sous
 * son propre nom, et un client qui lit le contrat pour découvrir où appeler
 * doit trouver l'adresse de *cette* instance. `API_PUBLIC_URL` la donne ;
 * l'entrée localhost suit le port que le serveur écoute vraiment
 * (`PORT`, défaut 3000), pas une constante recopiée.
 */
export function buildServers() {
  const servers = [];

  if (config.api.publicUrl) {
    servers.push({ url: config.api.publicUrl, description: "Configured deployment" });
  }

  servers.push({
    url: `http://localhost:${config.server.port}`,
    description: "Local development server",
  });

  return servers;
}

/**
 * Le document tel qu'il est écrit, éventuellement avec l'enum `shop` rafraîchi.
 * Synchrone : c'est ce que le cache de `/docs/openapi.json` retient.
 */
export function buildBaseOpenApiDocument({ shopTypes } = {}) {
  const spec = structuredClone(loadOpenApiDocument());
  spec.servers = buildServers();
  if (shopTypes?.length) withShopEnum(spec, shopTypes);
  return spec;
}

/**
 * Ce que cette instance sait de la version du jeu qu'elle sert, sans aucun
 * appel réseau.
 *
 * Deux sources, dans cet ordre :
 * - le bundle en cache : la version dont `/data` extrait ses données, connue
 *   dès la première requête de données même quand aucune synchronisation de
 *   sprites n'a tourné (export coupé, `data/version.json` absent) ;
 * - l'enregistrement de construction sur disque (`data/version.json`) : la
 *   version dont les sprites/atlas sur disque ont été construits, écrite à la
 *   fin d'une synchro, avec son horodatage.
 *
 * Un hôte qui n'a encore rien fait (démarrage à froid, aucune requête de
 * données) ne sait rien : les trois champs valent `null` plutôt qu'une version
 * inventée.
 */
export async function getBuildInfo() {
  const { version: storedVersion, generatedAt } = await getStoredVersionInfoCached();
  const { bundleFetchedAt } = getCacheStats();
  const bundleVersion = getCachedBundleVersion();

  return {
    gameVersion: bundleVersion ?? storedVersion ?? null,
    // L'art sur disque vient de la synchro ; à défaut, la version servie est
    // tout ce que le process peut honnêtement annoncer.
    artVersion: storedVersion ?? bundleVersion ?? null,
    // La synchro des sprites horodate sa construction ; sans elle, le moment où
    // le bundle servi a été récupéré est la seule date vraie disponible.
    generatedAt: generatedAt ?? bundleFetchedAt ?? null,
  };
}

/**
 * Le document avec les faits de l'instance. Copie superficielle : seuls le bloc
 * de contrat et son contenu changent, pas la liste des chemins.
 */
export async function withRuntimeContract(spec) {
  const { gameVersion, artVersion, generatedAt } = await getBuildInfo();

  return {
    ...spec,
    "x-mg-contract": {
      ...(spec["x-mg-contract"] ?? {}),
      gameVersion,
      artVersion,
      generatedAt,
    },
  };
}

/**
 * Le corps de `/schema.json` : les mêmes faits que le document, plus la liste
 * des catégories de `/data` que le bundle courant permet encore de construire.
 *
 * `unavailable` vient de `getDataCoverage()` mais exprimé en noms de routes
 * (`decors`, `weather-groups`) et non en clés de cache internes.
 */
export async function buildRuntimeContract({ unavailable = {} } = {}) {
  const { gameVersion, artVersion, generatedAt } = await getBuildInfo();
  const declared = declaration();

  return {
    contract: contractVersion(),
    api: declared.api,
    capabilities: declared.capabilities,
    paths: declared.paths,
    data: declared.data.filter((category) => !(category in unavailable)),
    unavailable: Object.fromEntries(
      declared.data.filter((category) => category in unavailable).map((c) => [c, unavailable[c]])
    ),
    gameVersion,
    artVersion,
    generatedAt,
  };
}
