// tests/contract-servers.test.js
//
// La liste `servers` du document est construite, pas écrite : un fork se
// déploie sous son propre nom, donc le document doit rapporter l'adresse de
// *cette* instance et non celle du déploiement d'origine. Le port local suit
// `PORT`, pas une constante recopiée — sinon un client qui lit le contrat pour
// découvrir où appeler se trompe de port, ce qui est exactement ce que
// `http://localhost:3000` faisait pendant que nginx proxifiait vers 3002.
//
// Les variables sont posées avant l'import dynamique de l'app : `config` les lit
// une fois, au chargement du module (`tests/helpers/httpApp.js` explique le
// reste).

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.API_PUBLIC_URL = "https://api.example.test/";
process.env.PORT = "3210";

import test from "node:test";
import assert from "node:assert/strict";
import { startTestApp } from "./helpers/httpApp.js";

test("les serveurs annoncés viennent de la configuration de cette instance", async () => {
  const app = await startTestApp();
  try {
    const response = await app.get("/docs/openapi.json");
    assert.equal(response.status, 200);
    const spec = await response.json();

    assert.deepEqual(spec.servers, [
      { url: "https://api.example.test", description: "Configured deployment" },
      { url: "http://localhost:3210", description: "Local development server" },
    ]);
  } finally {
    await app.close();
  }
});

test("le document ne nomme plus l'hôte du déploiement d'origine", async () => {
  const app = await startTestApp();
  try {
    // Le fichier `openapi.yaml` n'a plus de bloc `servers` du tout : s'il en
    // restait un, il serait écrasé à la réponse et personne ne le verrait — donc
    // c'est la réponse qu'on interroge, pas le fichier.
    const spec = await (await app.get("/docs/openapi.json")).json();
    assert.equal(
      JSON.stringify(spec).includes("ariedam"),
      false,
      "le contrat ne doit nommer aucun déploiement en particulier"
    );
  } finally {
    await app.close();
  }
});

test("rien de ce que cette instance envoie ne se présente comme le déploiement d'origine", async () => {
  // Le document OpenAPI n'est pas le seul endroit qui nommait cet hôte : le
  // `User-Agent` par défaut le nommait aussi, donc chaque requête à l'API du jeu
  // se présentait comme le service de quelqu'un d'autre. C'est la même famille de
  // défaut que le bloc `servers` (item 14) et que les URLs de sprites (item 23) :
  // une instance ne doit nommer qu'elle-même. La liste blanche du proxy, qui le
  // nommait également, est testée dans `proxy-own-origin.test.js`.
  const { config } = await import("../src/config/index.js");
  assert.equal(
    config.platform.userAgent.includes("ariedam"),
    false,
    `l'agent envoyé au jeu ne doit nommer aucun déploiement : ${config.platform.userAgent}`
  );
  assert.match(
    config.platform.userAgent,
    /^mgjs-data-api\//,
    "et il nomme cette instance, pour que l'amont sache qui l'interroge"
  );
});
