// src/config/index.js

// Les valeurs admises pour `SPRITES_PROFILE`. `data` est un profil de service :
// il ne produit ni ne sert d'images, il republie les données du jeu.
const SPRITE_PROFILES = ["full", "data"];

/**
 * Profil de l'instance, choisi par `SPRITES_PROFILE`.
 *
 * `full` (défaut) : le watcher de version peut exporter les sprites et les
 * boucles d'animation, et les routes d'images les servent.
 *
 * `data` : rien de tout ça. Une seconde instance ne sert que `/data/*`,
 * `/live/*` et `/stats/*` ; elle ne démarre ni export de sprites ni export
 * d'animations, et les routes d'images répondent 503 (`SPRITES_PROFILE`)
 * plutôt que de servir un dossier absent ou périmé.
 *
 * Le profil ne peut pas être déduit : `VERSION_WATCH_ENABLED=false` coupe le
 * seul appelant de `checkSpritesOnStartup()` (`src/services/spriteSync.js:478`)
 * et `PET_ANIMATIONS_ENABLED=false` l'export d'animations, mais ces deux
 * interrupteurs disent « ne produis pas », pas « ne sers pas ». Un opérateur qui
 * laisse un `sprites_dump/` monté sur l'instance de données se ferait servir des
 * images de la version précédente par des routes qui répondent 200. Le
 * contradictoire est donc refusé au démarrage, pas corrigé en silence.
 *
 * Le watcher est *obligatoirement* coupé, et c'est aussi la bonne moitié de la
 * règle pour la cohérence de version. `data/version.json` ne dit pas « la
 * version du jeu » : il dit « la version dont les données **et les sprites** sur
 * disque ont été construits » (`src/core/game/versionStorage.js:28-33`), il est
 * écrit à la fin d'une synchro d'atlas (`saveVersion`), et c'est lui qui épingle
 * `/data/*` à la version servie quand le watcher tourne. Une instance qui ne
 * rend pas d'images n'a rien à y écrire : la laisser écrire ce fichier ferait
 * avancer un enregistrement sans les pixels qui vont avec, et épinglerait
 * `/data` à une version dont l'art n'existe pas sur cet hôte. Watcher coupé, il
 * n'y a ni écriture ni épingle, et `/data` suit le bundle qu'elle sert.
 */
function readSpritesProfile(env) {
  const profile = (env.SPRITES_PROFILE || "full").trim().toLowerCase();

  if (!SPRITE_PROFILES.includes(profile)) {
    throw new Error(
      `SPRITES_PROFILE must be one of: ${SPRITE_PROFILES.join(", ")} (got ${JSON.stringify(env.SPRITES_PROFILE)})`
    );
  }

  if (profile === "data") {
    const conflicting = [];
    if (env.VERSION_WATCH_ENABLED !== "false") conflicting.push("VERSION_WATCH_ENABLED=false");
    if (env.PET_ANIMATIONS_ENABLED !== "false") conflicting.push("PET_ANIMATIONS_ENABLED=false");
    if (conflicting.length) {
      throw new Error(
        `SPRITES_PROFILE=data does not export sprites: set ${conflicting.join(" and ")} (or drop SPRITES_PROFILE)`
      );
    }
  }

  return profile;
}

const spritesProfile = readSpritesProfile(process.env);

/**
 * Configuration centralisée de l'API.
 * Valeurs par défaut overridées par les variables d'environnement.
 */
export const config = {
  // Serveur HTTP
  server: {
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST || "0.0.0.0",
  },

  // URL publique de cette instance, telle qu'un client doit l'appeler. Elle
  // n'a pas de défaut : le document OpenAPI ne nomme plus l'hôte d'un
  // déploiement en particulier, il rapporte celui qui est configuré ici.
  api: {
    publicUrl: (process.env.API_PUBLIC_URL || "").trim().replace(/\/+$/, ""),
  },

  // Cache
  cache: {
    bundleTTL: Number(process.env.CACHE_BUNDLE_TTL) || 5 * 60 * 1000, // 5 min
    manifestTTL: Number(process.env.CACHE_MANIFEST_TTL) || 10 * 60 * 1000, // 10 min
  },

  // Rate limiting
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== "false",
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 min
    max: Number(process.env.RATE_LIMIT_MAX) || 60, // 60 req/min
  },

  // CORS
  cors: {
    enabled: process.env.CORS_ENABLED !== "false",
    origin: process.env.CORS_ORIGIN || "*",
  },

  // Game (Magic Garden)
  game: {
    origin: process.env.GAME_ORIGIN || "https://magicgarden.gg",
    pageUrl: process.env.GAME_PAGE_URL || "https://magicgarden.gg/r/test",
  },

  // API officielle du jeu (`/platform/v1/*`), source des données live.
  platform: {
    // Cadence de base du polling. L'amont répond `public, max-age=30` :
    // descendre plus bas ne donne pas de données plus fraîches. Le poller se
    // réveille de toute façon pile sur les échéances `nextRestockAt`.
    pollInterval: Number(process.env.PLATFORM_POLL_INTERVAL) || 15 * 1000,
    // Cadence resserrée le temps qu'un restock annoncé apparaisse en amont.
    fastPollInterval: Number(process.env.PLATFORM_FAST_POLL_INTERVAL) || 5 * 1000,
    // Plafond du backoff exponentiel quand l'API officielle est injoignable.
    maxBackoff: Number(process.env.PLATFORM_MAX_BACKOFF) || 60 * 1000,
    timeout: Number(process.env.PLATFORM_TIMEOUT) || 8 * 1000,
    userAgent: process.env.PLATFORM_USER_AGENT || "MG-API/2.1 (+https://mg-api.ariedam.fr)",
  },

  // Récupération du bundle du jeu (page -> index.js -> chunks -> data).
  // Chaque requête de cette chaîne alimente `/data/*` à froid : sans plafond,
  // un amont qui accepte la connexion sans jamais répondre suspend la requête
  // du client indéfiniment, et le pool de requêtes avec elle.
  bundle: {
    // Large : les chunks pèsent quelques Mo et l'amont peut être lent, mais
    // fini. Un dépassement est une erreur nommée, pas une attente sans fin.
    timeout: Number(process.env.BUNDLE_TIMEOUT) || 20 * 1000,
  },

  // Surveillance de la version du jeu : remplace les codes de fermeture
  // WebSocket 4700/4710, qui étaient jusqu'ici notre signal de mise à jour.
  versionWatch: {
    enabled: process.env.VERSION_WATCH_ENABLED !== "false",
    interval: Number(process.env.VERSION_WATCH_INTERVAL) || 60 * 1000,
    // Un redémarrage après resync garantit un état propre (pm2 relance). Les
    // caches sont tous indexés par version et se régénèrent seuls, donc c'est
    // désactivable si l'on préfère ne pas couper les flux SSE en cours.
    restartAfterSync: process.env.VERSION_WATCH_RESTART !== "false",
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
    // Opt-in, pas « NODE_ENV !== production » : pino-pretty est une
    // devDependency, et un transport configuré mais absent fait échouer pino au
    // chargement du logger — donc au démarrage, avant toute liaison de port. Un
    // déploiement fait avec `npm ci --omit=dev` n'a aucune raison de payer ce
    // piège pour une décoration de sortie ; celui qui la veut la demande.
    pretty: process.env.LOG_PRETTY === "true",
  },

  // Sprites (export & serving)
  sprites: {
    // `SPRITES_PROFILE` : `full` (défaut) ou `data`. Le profil se lit ici, et
    // `profile` le rapporte pour que les routes répondent sans avoir à
    // reconstruire la règle.
    profile: spritesProfile,
    // Vrai profil `data` : les routes d'images répondent 503, elles ne
    // retombent pas sur le disque.
    routesEnabled: spritesProfile === "full",
    exportDir: process.env.SPRITES_EXPORT_DIR || "./sprites_dump",
    // L'URL publique de ce serveur, si elle diffère de celle qu'un client a
    // utilisée pour l'atteindre (CDN devant, proxy qui réécrit le Host). Vide
    // veut dire "celle de la requête" : chaque route qui construit une URL
    // absolue demande l'origine au client plutôt que d'en inventer une, et un
    // serveur lancé sur un autre port qu'un client interroge ne peut plus lui
    // répondre une adresse où personne n'écoute.
    baseUrl: (process.env.SPRITES_BASE_URL || "").replace(/\/+$/, ""),
  },

  // Le bake des cultures, `BAKE=1`. Éteint par défaut : allumé, la synchro de
  // version rend chaque *type de culture* portant chacun de ses 90 ensembles de
  // mutations atteignables dans un fichier (6 210 fichiers, 100 à 250 Mo
  // mesurés) et publie un manifeste de ce qui existe. Éteint, rien n'est écrit
  // et le chemin à froid compose les images déjà exportées — le disque ne
  // grandit que du cache de scènes. Jamais une plante entière : l'espace d'une
  // plante est 90^slots, pas 90 (docs/mgjs-community-api-plan.md §3.1).
  bake: {
    enabled: process.env.BAKE === "1",
    // Racine des fichiers rendus. Vide => `<SPRITES_EXPORT_DIR>/baked`, pour
    // qu'un opérateur n'ait qu'un volume à persister.
    dir: (process.env.BAKE_DIR || "").trim() || null,
  },

  // Animations de pets (boucles WebP/GIF rendues depuis rive/pets.riv).
  // Ces fichiers pèsent ~1 Mo par espèce et coûtent quelques minutes de CPU à
  // (re)générer : c'est un travail de fond, déclenché quand le .riv change.
  animations: {
    enabled: process.env.PET_ANIMATIONS_ENABLED !== "false",
    // WebP d'abord : alpha 8 bits et ~2x plus compact que le GIF. Ajouter
    // "gif" double le volume sur disque.
    formats: (process.env.PET_ANIMATIONS_FORMATS || "webp")
      .split(",")
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean),
    // Hauteur voulue du sujet (pas du canvas) : c'est ce qui rend les espèces
    // comparables entre elles.
    height: Number(process.env.PET_ANIMATIONS_HEIGHT) || 256,
    // Niveau de near-lossless du WebP (1-100). Plus bas = plus compact et plus
    // approximatif ; 20 rend une erreur maximale de 8/255, invisible à l'œil.
    // Ce n'est pas une qualité lossy : voir encodeAnimation pour pourquoi le
    // lossy est inadapté à ces aplats vectoriels.
    quality: Number(process.env.PET_ANIMATIONS_QUALITY) || 20,
    // Clips exportés, parmi ceux déclarés dans exportPetAnimations.js.
    clips: (process.env.PET_ANIMATIONS_CLIPS || "idle,walk,eat,sleep")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  },

  // History (SQLite persistence of shops/weather)
  history: {
    enabled: process.env.HISTORY_ENABLED !== "false",
    dbPath: process.env.HISTORY_DB_PATH || "./data/history.sqlite",
    // Append-only NDJSON safety-net logs (one file per UTC month).
    eventsEnabled: process.env.HISTORY_EVENTS_ENABLED !== "false",
    eventsDir: process.env.HISTORY_EVENTS_DIR || "./data/events",
  },
};
