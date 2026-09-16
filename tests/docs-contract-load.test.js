// tests/docs-contract-load.test.js
//
// Le document de contrat (`src/docs/openapi.yaml`) était lu au chargement du
// module, et un document invalide levait à l'import. En ESM, cet échec est au
// link time : `createApp()` n'est jamais atteint, donc aucune route n'existe —
// pas même `/health` — et le seul signal est une stack Node au démarrage.
//
// Les deux autres tests de ce fichier montent l'app et la font répondre ; ce
// que l'on mesure ici, c'est que l'import réussit d'abord.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestApp } from "./helpers/httpApp.js";

async function withTempFile(contents, fn) {
  const dir = await mkdtemp(join(tmpdir(), "mg-contract-"));
  const path = join(dir, "openapi.yaml");
  await writeFile(path, contents);
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("le module de contrat s'importe même sans document lisible", async () => {
  // Même chemin que le module réel, mais le fichier n'existe pas : ce que
  // l'import ne doit plus faire, c'est lever.
  const contract = await import("../src/docs/contract.js");
  assert.equal(typeof contract.declaration, "function");
  assert.equal(typeof contract.contractVersion, "function");

  assert.throws(
    () => contract.loadOpenApiDocument({ path: "/nonexistent/openapi.yaml", reload: true }),
    (err) => {
      assert.equal(err.name, "ContractDocumentError");
      assert.equal(err.code, "CONTRACT_DOCUMENT_INVALID");
      assert.match(err.message, /Cannot read the contract document at \/nonexistent\/openapi\.yaml/);
      return true;
    }
  );
});

test("un YAML valide mais sans clés de contrat lève une erreur nommée, pas un import cassé", async () => {
  const { loadOpenApiDocument } = await import("../src/docs/load.js");

  await withTempFile("openapi: 3.0.3\ninfo:\n  title: x\n", (path) => {
    assert.throws(
      () => loadOpenApiDocument({ path, reload: true }),
      (err) => {
        assert.equal(err.name, "ContractDocumentError");
        assert.equal(err.code, "CONTRACT_DOCUMENT_INVALID");
        assert.match(err.message, /must declare info.version and x-mg-contract\.api/);
        assert.equal(err.path, path);
        return true;
      }
    );
  });

  // Un YAML syntaxiquement cassé est la même erreur, avec le chemin.
  await withTempFile("info: [unclosed\n", (path) => {
    assert.throws(
      () => loadOpenApiDocument({ path, reload: true }),
      (err) => {
        assert.equal(err.code, "CONTRACT_DOCUMENT_INVALID");
        assert.equal(err.path, path);
        return true;
      }
    );
  });
});

test("un document valide est lu une fois et mis en cache", async () => {
  const { loadOpenApiDocument } = await import("../src/docs/load.js");

  await withTempFile(
    'openapi: 3.0.3\ninfo:\n  title: x\n  version: "7"\nx-mg-contract:\n  api: 7\n',
    (path) => {
      const first = loadOpenApiDocument({ path, reload: true });
      const second = loadOpenApiDocument({ path });
      assert.equal(first, second, "le document doit être mémoïsé par chemin");
      assert.equal(first.info.version, "7");
    }
  );
});

test("l'app sert /health et le contrat quand le document est là", async (t) => {
  const api = await startTestApp();
  t.after(() => api.close());

  const health = await api.get("/health");
  assert.equal(health.status, 200);

  const { contractVersion, declaration } = await import("../src/docs/contract.js");
  assert.equal(contractVersion(), 1);
  assert.equal(declaration().api, 1);

  const schema = await (await api.get("/schema.json")).json();
  assert.equal(schema.contract, 1);
});

test("un document de contrat invalide devient un 500 nommé, pas une stack de démarrage", async (t) => {
  const express = (await import("express")).default;
  const { errorHandler } = await import("../src/api/middleware/errorHandler.js");
  const { ContractDocumentError } = await import("../src/docs/load.js");

  const app = express();
  app.get("/docs/openapi.json", () => {
    throw new ContractDocumentError("Cannot read the contract document at /app/src/docs/openapi.yaml", {
      path: "/app/src/docs/openapi.yaml",
    });
  });
  app.use(errorHandler);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  // NODE_ENV=production est le cas qui compte : c'est celui où le message d'une
  // erreur inconnue est tu. Un défaut de configuration du serveur doit rester
  // lisible, avec son code stable.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });

  const res = await fetch(`http://127.0.0.1:${server.address().port}/docs/openapi.json`);
  assert.equal(res.status, 500);

  const body = await res.json();
  assert.equal(body.error.code, "CONTRACT_DOCUMENT_INVALID");
  assert.match(body.error.message, /openapi\.yaml/);
});
