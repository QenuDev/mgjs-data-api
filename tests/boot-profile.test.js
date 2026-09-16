// tests/boot-profile.test.js
//
// `SPRITES_PROFILE=data` : une seconde instance qui republie `/data/*`,
// `/live/*` et `/stats/*` sans jamais lancer l'export de sprites ni celui des
// boucles d'animation — donc sans le pic CPU que le watchdog de synchro
// (`src/services/spriteSync.js:215`, `process.exit(1)` au bout de 15 min)
// existe pour rattraper.
//
// Ce que le test mesure, dans l'ordre où l'opérateur le vit :
//   1. le process démarre là où le profil `full` ferait tourner le watcher ;
//   2. `/data` est servi à partir du bundle, sans rien exporter ;
//   3. les routes d'images rendent 503 `SPRITES_PROFILE`, pas 200 depuis un
//      disque laissé par une version précédente.
//
// Le serveur tourne dans un sous-process parce que `config` se lit une fois au
// chargement du module : un profil ne se change pas en cours de route. Le
// parent est le client HTTP ; le sous-process sert.

process.env.LOG_LEVEL = "silent";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Un amont local minimal : version, page, index.js, chunk de données.
// ---------------------------------------------------------------------------

const VERSION = "1192";
const INDEX_PATH = `/version/${VERSION}/assets/index-abc.js`;
const DATA_PATH = `/version/${VERSION}/assets/data-abc.js`;

const INDEX_JS =
  'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/data-abc.js"])))=>i.map(i=>d[i]);';
const DATA_JS = "export const secondsToHatch={Carrot:1};";

async function startFakeGame() {
  const server = http.createServer((req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };

    if (req.url === "/platform/v1/version") {
      return send(200, "application/json", JSON.stringify({ version: VERSION }));
    }
    if (req.url === `/version/${VERSION}/index.html`) {
      return send(
        200,
        "text/html",
        `<!doctype html><script type="module" src="${INDEX_PATH}"></script>`
      );
    }
    if (req.url === INDEX_PATH) return send(200, "application/javascript", INDEX_JS);
    if (req.url === DATA_PATH) return send(200, "application/javascript", DATA_JS);

    send(404, "text/plain", `no ${req.url}`);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin,
    pageUrl: `${origin}/version/${VERSION}/index.html`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// ---------------------------------------------------------------------------
// Le serveur sous profil `data`.
// ---------------------------------------------------------------------------

const CHILD_SCRIPT = `
import ${JSON.stringify(join(REPO_ROOT, "src/index.js"))};
import { startApiServer } from ${JSON.stringify(join(REPO_ROOT, "src/api/server.js"))};
import { config } from ${JSON.stringify(join(REPO_ROOT, "src/config/index.js"))};

const { server } = startApiServer({ port: 0 });
server.on("error", (err) => {
  process.stderr.write("CHILD ERROR " + err.message + "\\n");
  process.exit(1);
});
server.on("listening", () => {
  process.stdout.write("READY " + server.address().port + " profile=" + config.sprites.profile + "\\n");
});
`;

async function startProfileServer(env) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", CHILD_SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const port = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`le serveur n'a pas démarré en 30 s\n${buffer}\n${stderr}`));
    }, 30_000);

    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const match = /READY (\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`le serveur est sorti (code ${code})\n${buffer}\n${stderr}`));
    });
  });

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5_000).unref();
      });
    },
  };
}

/** Un `sprites_dump/` laissé là par une instance `full` : le piège à éviter. */
async function withSprityDump(fn) {
  const dir = await mkdtemp(join(tmpdir(), "mg-sprites-"));
  try {
    await mkdir(join(dir, "sprite", "plants"), { recursive: true });
    await writeFile(join(dir, "sprite", "plants", "Carrot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("le profil data démarre, sert /data, et refuse les routes d'images", async (t) => {
  const game = await startFakeGame();
  t.after(() => game.close());

  await withSprityDump(async (exportDir) => {
    const api = await startProfileServer({
      SPRITES_PROFILE: "data",
      VERSION_WATCH_ENABLED: "false",
      PET_ANIMATIONS_ENABLED: "false",
      HISTORY_ENABLED: "false",
      CORS_ENABLED: "false",
      RATE_LIMIT_ENABLED: "false",
      LOG_LEVEL: "silent",
      SPRITES_EXPORT_DIR: exportDir,
      GAME_ORIGIN: game.origin,
      GAME_PAGE_URL: game.pageUrl,
    });
    t.after(() => api.close());

    // 1. Les données du jeu sont servies, extraites du bundle de l'amont.
    const data = await fetch(`${api.baseUrl}/data`);
    assert.equal(data.status, 200);
    const payload = await data.json();
    assert.ok("plants" in payload, `réponse /data inattendue : ${JSON.stringify(payload).slice(0, 200)}`);

    // 2. `/data/version` reste la vérité de l'instance : le bundle a été
    //    récupéré, donc la version du jeu est connue — sans aucune synchro.
    //    `artVersion` n'est pas asserté ici : il peut suivre le bundle quand
    //    aucun enregistrement de construction n'existe, ce qui est le cas dans
    //    ce process. Le test d'interaction ci-dessous couvre ce champ.
    const version = await (await fetch(`${api.baseUrl}/data/version`)).json();
    assert.equal(version.gameVersion, VERSION);
    assert.equal(version.contract, 1);

    // 3. Les routes d'images : 503 nommé, jamais 200 depuis le disque.
    for (const path of [
      "/assets/sprites",
      "/assets/sprites/plants/Carrot.png",
      "/assets/sprites/composed?key=sprite/plants/Carrot",
      "/assets/animations",
      "/assets/rive",
    ]) {
      const res = await fetch(`${api.baseUrl}${path}`);
      assert.equal(res.status, 503, `${path} doit répondre 503, vu ${res.status}`);

      const body = await res.json();
      assert.equal(body.error.code, "SPRITES_PROFILE");
      assert.equal(body.error.details.profile, "data");
      assert.match(body.error.message, /SPRITES_PROFILE=data/);
    }

    // 4. Ce qui n'est pas une image n'est pas concerné : le catalogue dérivé du
    //    bundle et le contrat restent servis.
    //
    //    Ce que ce test vérifie ici est que le profil ne *refuse* pas la route, pas
    //    qu'elle réponde 200 : `/assets/sprite-data` est dérivé du bundle du jeu, donc
    //    hors ligne elle ne peut pas répondre 200 et cela n'a rien à voir avec le
    //    profil. Le statut est donc lu pour son code d'erreur, et seul un refus
    //    SPRITES_PROFILE fait échouer le test.
    const spriteData = await fetch(`${api.baseUrl}/assets/sprite-data`);
    assert.notEqual(spriteData.status, 503, "/assets/sprite-data n'est pas une route d'image");
    const spriteDataBody = await spriteData.json().catch(() => null);
    assert.notEqual(
      spriteDataBody?.error?.code,
      "SPRITES_PROFILE",
      "le profil data ne doit pas refuser une route qui ne rend aucune image"
    );

    const schema = await (await fetch(`${api.baseUrl}/schema.json`)).json();
    assert.equal(schema.contract, 1);
  });
});

test("le profil full (défaut) sert toujours les routes d'images", async (t) => {
  const game = await startFakeGame();
  t.after(() => game.close());

  await withSprityDump(async (exportDir) => {
    const api = await startProfileServer({
      VERSION_WATCH_ENABLED: "false",
      PET_ANIMATIONS_ENABLED: "false",
      HISTORY_ENABLED: "false",
      CORS_ENABLED: "false",
      RATE_LIMIT_ENABLED: "false",
      LOG_LEVEL: "silent",
      SPRITES_EXPORT_DIR: exportDir,
      GAME_ORIGIN: game.origin,
      GAME_PAGE_URL: game.pageUrl,
    });
    t.after(() => api.close());

    const sprites = await fetch(`${api.baseUrl}/assets/sprites`);
    assert.equal(sprites.status, 200);
    const catalog = await sprites.json();
    assert.equal(catalog.count, 1);
    assert.deepEqual(
      catalog.sprites.plants.map((entry) => entry.name),
      ["Carrot"]
    );

    const png = await fetch(`${api.baseUrl}/assets/sprites/plants/Carrot.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get("content-type"), "image/png");
  });
});

// ---------------------------------------------------------------------------
// L'interaction avec la cohérence de version.
//
// `data/version.json` — « la version dont les données et les sprites sur disque
// ont été construits » — est écrit à la fin d'une synchro d'atlas
// (`src/services/spriteSync.js:308,347`), et sert d'épingle à `/data/*` quand le
// watcher tourne. Le profil `data` ne rend pas d'images et coupe le watcher : il
// n'écrit donc jamais cet enregistrement, et rien n'épingle `/data`.
// ---------------------------------------------------------------------------

/** Le chemin du fichier de version, tel que `versionStorage.js` le calcule. */
const VERSION_FILE = join(REPO_ROOT, "data", "version.json");

/** Écrit un enregistrement de version périmé, et rend de quoi restaurer l'état. */
async function withStaleVersionRecord(version, fn) {
  const { readFile, writeFile, mkdir } = await import("node:fs/promises");
  const previous = await readFile(VERSION_FILE, "utf8").catch(() => null);

  await mkdir(dirname(VERSION_FILE), { recursive: true });
  await writeFile(
    VERSION_FILE,
    JSON.stringify({ version, lastUpdated: "2020-01-01T00:00:00.000Z" }, null, 2)
  );

  try {
    return await fn();
  } finally {
    if (previous === null) await rm(VERSION_FILE, { force: true });
    else await writeFile(VERSION_FILE, previous);
  }
}

test("le profil data refuse VERSION_WATCH_ENABLED=true au démarrage", async () => {
  // La combinaison qui produirait l'échec décrit : le watcher tourne, rien ne
  // rend de pixels, mais l'enregistrement de version avance quand même et
  // épingle `/data` à une version dont l'art n'existe pas sur cet hôte.
  const { code, stderr } = await runConfigChild({
    SPRITES_PROFILE: "data",
    VERSION_WATCH_ENABLED: "true",
    PET_ANIMATIONS_ENABLED: "false",
  });

  assert.equal(code, 1, `sortie attendue 1, observée ${code}\n${stderr}`);
  assert.match(stderr, /SPRITES_PROFILE=data does not export sprites/);
  assert.match(stderr, /VERSION_WATCH_ENABLED=false/);
});

test("sans le watcher, le profil data ne s'épingle pas à l'enregistrement de version", async (t) => {
  const game = await startFakeGame();
  t.after(() => game.close());

  // Un `data/version.json` d'une version plus ancienne que celle de l'amont :
  // c'est ce qu'un opérateur trouve sur un volume repris d'une autre instance.
  await withStaleVersionRecord("1150", async () => {
    await withSprityDump(async (exportDir) => {
      const api = await startProfileServer({
        SPRITES_PROFILE: "data",
        VERSION_WATCH_ENABLED: "false",
        PET_ANIMATIONS_ENABLED: "false",
        HISTORY_ENABLED: "false",
        CORS_ENABLED: "false",
        RATE_LIMIT_ENABLED: "false",
        LOG_LEVEL: "silent",
        SPRITES_EXPORT_DIR: exportDir,
        GAME_ORIGIN: game.origin,
        GAME_PAGE_URL: game.pageUrl,
      });

      try {
        const data = await (await fetch(`${api.baseUrl}/data`)).json();
        assert.ok("plants" in data);

        // `/data/version` distingue les deux faits : ce que le jeu est (le
        // bundle servi) et ce qui a été construit sur disque (rien ici).
        const version = await (await fetch(`${api.baseUrl}/data/version`)).json();
        assert.equal(
          version.gameVersion,
          VERSION,
          "les données servies viennent du bundle de l'amont, pas de l'enregistrement périmé"
        );
        assert.notEqual(
          version.gameVersion,
          "1150",
          "l'enregistrement périmé ne doit pas épingler /data quand le watcher est coupé"
        );

        // Et cet enregistrement n'a pas bougé : le profil n'écrit pas de version.
        const { readFile } = await import("node:fs/promises");
        const record = JSON.parse(await readFile(VERSION_FILE, "utf8"));
        assert.equal(record.version, "1150", "le profil data ne doit rien écrire sur disque");
        assert.equal(record.lastUpdated, "2020-01-01T00:00:00.000Z");
      } finally {
        await api.close();
      }
    });
  });
});

/** Lance un import de `src/config` seul et rend la sortie du process. */
function runConfigChild(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const { config } = await import(${JSON.stringify(join(REPO_ROOT, "src/config/index.js"))});
         console.log(JSON.stringify({ profile: config.sprites.profile }));`,
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ...env, LOG_LEVEL: "silent" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------
// Où les URLs de l'index envoient le client.
// ---------------------------------------------------------------------------

/**
 * Le défaut : `config.sprites.baseUrl` valait `http://localhost:3000` par
 * défaut, donc un serveur écoutant ailleurs répondait à chaque client une
 * adresse où personne n'écoute — constaté en lançant l'API sur 3999. Une
 * réponse construite pour la requête qui l'a demandée peut nommer l'origine de
 * cette requête ; c'est le cas de cet index, et c'est ce qui est testé ici. Le
 * port est éphémère, donc une constante ne peut pas le produire.
 */
test("l'index des sprites renvoie l'origine qui a été appelée", async (t) => {
  const game = await startFakeGame();
  t.after(() => game.close());

  await withSprityDump(async (exportDir) => {
    const api = await startProfileServer({
      VERSION_WATCH_ENABLED: "false",
      PET_ANIMATIONS_ENABLED: "false",
      HISTORY_ENABLED: "false",
      CORS_ENABLED: "false",
      RATE_LIMIT_ENABLED: "false",
      LOG_LEVEL: "silent",
      SPRITES_EXPORT_DIR: exportDir,
      GAME_ORIGIN: game.origin,
      GAME_PAGE_URL: game.pageUrl,
    });
    t.after(() => api.close());

    const catalog = await (await fetch(`${api.baseUrl}/assets/sprites`)).json();
    const urls = Object.values(catalog.sprites).flat().map((entry) => entry.url);
    assert.ok(urls.length > 0, "l'index a des entrées, sinon rien ci-dessous ne dit quoi que ce soit");

    const origin = new URL(api.baseUrl).origin;
    for (const url of urls) {
      assert.equal(new URL(url).origin, origin, `l'URL pointe sur l'hôte appelé : ${url}`);
    }
    assert.equal(catalog.baseUrl, origin, "et la réponse dit la même origine que ses URLs");
    assert.equal(
      urls.some((url) => url.includes("localhost:3000")),
      false,
      "aucune URL ne nomme le port par défaut"
    );
  });
});

/**
 * L'autre moitié : le seul cas où l'URL publique diffère vraiment de celle que
 * le serveur voit — un CDN, ou un proxy qui réécrit le `Host`. Elle gagne, et
 * son slash final est normalisé plutôt que doublé.
 */
test("SPRITES_BASE_URL gagne sur l'origine de la requête", async (t) => {
  const game = await startFakeGame();
  t.after(() => game.close());

  await withSprityDump(async (exportDir) => {
    const api = await startProfileServer({
      VERSION_WATCH_ENABLED: "false",
      PET_ANIMATIONS_ENABLED: "false",
      HISTORY_ENABLED: "false",
      CORS_ENABLED: "false",
      RATE_LIMIT_ENABLED: "false",
      LOG_LEVEL: "silent",
      SPRITES_EXPORT_DIR: exportDir,
      GAME_ORIGIN: game.origin,
      GAME_PAGE_URL: game.pageUrl,
      SPRITES_BASE_URL: "https://cdn.example/",
    });
    t.after(() => api.close());

    const catalog = await (await fetch(`${api.baseUrl}/assets/sprites`)).json();
    const urls = Object.values(catalog.sprites).flat().map((entry) => entry.url);
    assert.ok(urls.length > 0, "l'index a des entrées");

    for (const url of urls) {
      assert.equal(new URL(url).origin, "https://cdn.example", `l'URL publique configurée : ${url}`);
      assert.equal(url.includes("//assets"), false, `et le slash final n'est pas doublé : ${url}`);
    }
    assert.equal(catalog.baseUrl, "https://cdn.example", "la réponse annonce l'URL publique, pas celle de la requête");
  });
});
