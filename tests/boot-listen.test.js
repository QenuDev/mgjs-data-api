// tests/boot-listen.test.js
//
// Un port déjà pris est le premier échec de démarrage qu'un opérateur rencontre
// (deux instances, un `docker compose up` lancé deux fois, un `npm start` resté
// en vie). Il doit produire une ligne qui nomme l'adresse et le port — pas un
// `'error'` non écouté, et surtout pas un « API server started » suivi d'un
// process qui ne sert rien.
//
// Pourquoi un sous-process : le handler par défaut termine le process
// (`process.exit(1)`), ce qui est justement le comportement à mesurer. Un test
// qui appellerait `startApiServer` avec ce défaut tuerait le lanceur de tests.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";

import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startApiServer, listenFailureMessage } from "../src/api/server.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Lie un port libre, rend { port, close }. */
async function occupyPort() {
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "0.0.0.0", resolve);
  });
  return {
    port: blocker.address().port,
    close: () => new Promise((resolve) => blocker.close(resolve)),
  };
}

/**
 * Le script du sous-process.
 *
 * `mode: "entrypoint"` lance le vrai `src/index.js`, comme le fait un
 * conteneur : c'est son ordre de sortie que l'opérateur lit. Le port occupé est
 * passé en `PORT`, donc le point d'entrée ne peut pas se lier ; ce qu'il
 * journalise avant l'échec part sur un pipe, que Node écrit de façon
 * synchrone et dans l'ordre — la même garantie qu'un collecteur de conteneur.
 *
 * `mode: "noisy"` reproduit l'ancien appel, `app.listen(port, cb)` sans
 * `'error'` : sur Express 5 le callback est *aussi* branché sur `'error'`, donc
 * il s'exécute et annonce « started » alors que la liaison a échoué.
 */
function childScript(mode) {
  if (mode === "entrypoint") return null;

  return `
import express from "express";
const port = Number(process.env.PORT);
console.error("CHECK: binding on port " + port);
const app = express();
app.get("/", (_q, res) => res.end("x"));
app.listen(port, () => console.error("CHECK: API server started"));
`;
}

async function runChild(mode = "entrypoint", busyPort) {
  const script = childScript(mode);
  const evalMode = script !== null;
  const args = evalMode
    ? ["--input-type=module", "--eval", script]
    : [join(REPO_ROOT, "src", "index.js")];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(busyPort),
        NODE_ENV: "production",
        LOG_LEVEL: "info",
        CORS_ENABLED: "false",
        RATE_LIMIT_ENABLED: "false",
        VERSION_WATCH_ENABLED: "false",
        PET_ANIMATIONS_ENABLED: "false",
        HISTORY_ENABLED: "false",
        GAME_ORIGIN: "http://127.0.0.1:1",
        GAME_PAGE_URL: "http://127.0.0.1:1/r/test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`child did not fail on a taken port in time\n${stdout}${stderr}`));
    }, 20_000);

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("un port pris nomme l'adresse et le port dans le message d'échec", () => {
  const err = Object.assign(new Error("listen EADDRINUSE: address already in use :::3000"), {
    code: "EADDRINUSE",
  });
  const message = listenFailureMessage(err, { address: "0.0.0.0", port: 3000 });

  assert.match(message, /0\.0\.0\.0:3000/);
  assert.match(message, /EADDRINUSE/);
  assert.match(message, /already in use/i);
  assert.match(message, /PORT/, "le message doit dire quelle variable changer");
});

test("un port pris appelle onListenError au lieu d'un 'error' non écouté", async (t) => {
  const taken = await occupyPort();
  t.after(() => taken.close());

  const seen = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("aucun échec signalé en 10 s")), 10_000);
    const { server } = startApiServer({
      port: taken.port,
      onListenError: (err, context) => {
        clearTimeout(timer);
        resolve({ err, context, address: server.address(), listenerCount: server.listenerCount("error") });
      },
    });
  });

  assert.equal(seen.err.code, "EADDRINUSE");
  assert.equal(seen.context.port, taken.port);
  assert.equal(seen.address, null, "la liaison doit avoir échoué, pas abouti ailleurs");
  assert.equal(
    seen.listenerCount,
    1,
    "un seul handler 'error' : le process ne doit pas finir avec un événement non écouté"
  );
});

test("le process sort en 1 avec un message lisible quand le port est pris", async (t) => {
  const taken = await occupyPort();
  t.after(() => taken.close());

  // Le vrai point d'entrée : ce que fait un conteneur.
  const { code, stderr } = await runChild("entrypoint", taken.port);

  assert.equal(code, 1, `sortie attendue 1, observée ${code}\n${stderr}`);
  assert.match(stderr, /EADDRINUSE/);
  assert.match(stderr, new RegExp(`:${taken.port}\\b`), "le message doit nommer le port occupé");
  assert.match(stderr, /PORT/);

  // Rien de ce que `src/index.js` journalise après son `startApiServer` ne doit
  // partir : mesuré avant ce correctif, « MG API ready » sortait à côté du
  // message d'échec, parce que le logger écrit de façon asynchrone.
  assert.doesNotMatch(
    stderr,
    /MG API ready/,
    "un port pris ne doit pas être suivi d'un « MG API ready »"
  );
  assert.doesNotMatch(
    stderr,
    /Version watcher/,
    "aucun service de fond ne doit démarrer sur un port que personne n'écoute"
  );
});

test("le démarrage ne journalise plus « started » quand la liaison a échoué", async (t) => {
  // L'ancien appel `app.listen(port, cb)` : le callback sert aussi de handler
  // `'error'`, donc il affiche « started » sur un port que le process
  // n'occupe pas. C'est la ligne qui a fait croire au démarrage.
  const noisy = await occupyPort();
  t.after(() => noisy.close());
  const before = await runChild("noisy", noisy.port);
  assert.equal(before.code, 0, `sortie attendue 0 pour cette reproduction, observée ${before.code}`);
  assert.match(before.stderr, /CHECK: API server started/);

  const fixed = await occupyPort();
  t.after(() => fixed.close());
  const after = await runChild("entrypoint", fixed.port);
  assert.equal(after.code, 1);
  assert.doesNotMatch(
    after.stderr,
    /API server started/,
    "la version corrigée ne doit annoncer un démarrage que sur 'listening'"
  );
});
