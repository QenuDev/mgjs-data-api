// tests/logger-fallback.test.js
//
// `pino-pretty` est une devDependency. Le logger la sélectionnait via
// `NODE_ENV !== "production"`, donc une image construite avec
// `npm ci --omit=dev` et démarrée sans NODE_ENV=production mourait *au
// chargement du module logger* : pino lève quand la cible d'un `transport`
// n'est pas installée, et ce `throw` est au niveau du module, avant `listen`.
//
// Ce test construit l'environnement qui produit cette panne — `src/` copié hors
// du dépôt, `node_modules` lié sans `pino-pretty` — et vérifie qu'un log part
// quand même, en JSON.

process.env.LOG_LEVEL = "silent";

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_NODE_MODULES = join(REPO_ROOT, "node_modules");

const PROBE = `
import { logger } from "./src/logger/index.js";
logger.info({ marker: "probe" }, "boot log line");
await new Promise((resolve) => setTimeout(resolve, 300));
`;

/**
 * Un dépôt minimal hors de la racine du vrai : `src/` copié, `node_modules`
 * lié paquet par paquet *sauf* pino-pretty.
 *
 * La copie est nécessaire parce que la résolution Node remonte les dossiers
 * parents : sous `.worktrees/api-profile/`, `pino-pretty` reste trouvable via
 * `node_modules` du checkout principal même si on l'omet du dossier local. Sous
 * le répertoire temporaire, il ne l'est pas.
 */
async function withOmitDevSandbox(fn) {
  const dir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "mg-omit-dev-"));
  try {
    await cp(join(REPO_ROOT, "src"), join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "node_modules"), { recursive: true });

    for (const entry of await readdir(SOURCE_NODE_MODULES)) {
      if (entry === "pino-pretty" || entry.startsWith(".")) continue;
      const target = join(SOURCE_NODE_MODULES, entry);
      if (!existsSync(target)) continue;
      await symlink(target, join(dir, "node_modules", entry), "dir").catch(() => {});
    }

    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Lance la sonde dans le bac à sable et rend { code, stdout, stderr }. */
function runProbe(dir, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", PROBE], {
      cwd: dir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("sans pino-pretty, un LOG_PRETTY demandé journalise du JSON au lieu de mourir", async () => {
  const { code, stdout, stderr } = await withOmitDevSandbox((dir) =>
    runProbe(dir, { LOG_PRETTY: "true", LOG_LEVEL: "info" })
  );

  assert.equal(code, 0, `le process doit démarrer, code observé ${code}\n${stderr}`);

  const lines = stdout.trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 2, `deux lignes attendues (avertissement + log), vu : ${stdout}`);

  // Chaque ligne est un objet JSON : c'est ce qu'un agrégateur de conteneur
  // attend, et ce que la sortie colorée de pino-pretty n'est pas.
  const records = lines.map((line) => JSON.parse(line));

  const warning = records.find((l) => /LOG_PRETTY is set/.test(l.msg ?? ""));
  assert.ok(warning, "l'avertissement doit nommer LOG_PRETTY et le transport manquant");
  assert.equal(warning.level, 40);

  const logged = records.find((l) => l.msg === "boot log line");
  assert.ok(logged, "la ligne applicative doit être émise");
  assert.equal(logged.marker, "probe");
  // Du JSON brut, pas la sortie colorée : la ligne commence par `{`.
  assert.ok(stdout.trim().startsWith("{"), `sortie non-JSON : ${stdout}`);
});

test("sans LOG_PRETTY, le défaut est du JSON même quand pino-pretty est installé", async () => {
  const { code, stdout } = await withOmitDevSandbox((dir) =>
    runProbe(dir, { LOG_PRETTY: "", LOG_LEVEL: "info" })
  );

  assert.equal(code, 0);
  const logged = JSON.parse(stdout.trim().split("\n").find((l) => l.includes("boot log line")));
  assert.equal(logged.marker, "probe");
});
