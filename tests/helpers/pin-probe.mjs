// tests/helpers/pin-probe.mjs
//
// Sonde pour le verrou de version, lancée comme **processus à part**.
//
// Elle part d'un état « le jeu a bougé (l'amont annonce 1191), la synchro n'a
// pas rattrapé (data/version.json dit 1190) » et imprime ce que le cache du
// bundle sert alors. Un processus séparé est nécessaire : le verrou dépend de
// `VERSION_WATCH_ENABLED`, lue par `config` à l'import, donc la branche
// « watcher coupé » ne peut pas être rejouée dans le processus du test.
//
// L'amont factice est celui du parent (`GAME_ORIGIN`) ; c'est le parent qui
// compte les requêtes, et qui sait ainsi si le bundle de la nouvelle version a
// été téléchargé ou seulement ignoré.
//
// Sortie : une ligne JSON sur stdout, lue par tests/data-single-version.test.js.

const { getMainBundle, getCacheStats, getCachedBundleVersion } = await import(
  "../../src/core/game/cache.js"
);
const { getStoredVersionCached } = await import("../../src/core/game/versionStorage.js");

// Une requête de données suffit à déclencher la résolution du bundle.
await getMainBundle();

process.stdout.write(
  `${JSON.stringify({
    stored: await getStoredVersionCached(),
    served: getCachedBundleVersion(),
    hasBundle: getCacheStats().hasBundleCached,
  })}\n`
);
