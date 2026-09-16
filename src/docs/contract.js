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

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import YAML from "yamljs";

import { getStoredVersionInfoCached } from "../core/game/versionStorage.js";

const docsDir = dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = join(docsDir, "openapi.yaml");

// Chargé une fois : le document est un fichier du dépôt, pas une donnée de jeu.
const declared = YAML.load(OPENAPI_PATH);
const declaredContract = declared?.["x-mg-contract"] ?? {};

if (declared?.info?.version == null || declaredContract.api == null) {
  throw new Error(
    "openapi.yaml must declare info.version and x-mg-contract.api: the contract version is what a client checks before it trusts this host"
  );
}

/**
 * Version du contrat, à ne pas confondre avec la version du jeu.
 *
 * `info.version` est une chaîne (l'OpenAPI 3.0 l'exige) ; les clients
 * comparent un nombre, donc c'est la valeur numérique qui est exportée et
 * servie par `/schema.json` et `/data/version`.
 */
export const CONTRACT_VERSION = Number(declared.info.version);

/** Les chemins que le document couvre, dans son ordre. */
export function declaredPaths() {
  return Object.keys(declared.paths ?? {});
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
 * Le document tel qu'il est écrit, éventuellement avec l'enum `shop` rafraîchi.
 * Synchrone : c'est ce que le cache de `/docs/openapi.json` retient.
 */
export function buildBaseOpenApiDocument({ shopTypes } = {}) {
  const spec = structuredClone(declared);
  if (shopTypes?.length) withShopEnum(spec, shopTypes);
  return spec;
}

/**
 * Le document avec les faits de l'instance. Copie superficielle : seuls le bloc
 * de contrat et son contenu changent, pas les 39 chemins.
 */
export async function withRuntimeContract(spec) {
  const { version, generatedAt } = await getStoredVersionInfoCached();

  return {
    ...spec,
    "x-mg-contract": {
      ...(spec["x-mg-contract"] ?? {}),
      gameVersion: version ?? null,
      artVersion: version ?? null,
      generatedAt: generatedAt ?? null,
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
  const { version, generatedAt } = await getStoredVersionInfoCached();
  const declaredData = declaredContract.data ?? [];

  return {
    contract: CONTRACT_VERSION,
    api: declaredContract.api,
    capabilities: [...(declaredContract.capabilities ?? [])],
    paths: declaredPaths(),
    data: declaredData.filter((category) => !(category in unavailable)),
    unavailable: Object.fromEntries(
      declaredData.filter((category) => category in unavailable).map((c) => [c, unavailable[c]])
    ),
    gameVersion: version ?? null,
    artVersion: version ?? null,
    generatedAt: generatedAt ?? null,
  };
}
