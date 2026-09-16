// tests/rive-manifest-shapes.test.js
//
// Le manifeste du jeu a changé de forme entre la v1100 et la v1150. Jusqu'à la
// v1100 un `src` est une chaîne :
//
//     ["rive/pets.riv", "rive/pets"] -> src: ["/runtime-assets/pets.4d7f.riv"]
//
// À partir de la v1150 (toujours vrai en v1192) c'est un descripteur :
//
//     ["rive/pets.riv", "rive/pets"] -> src: [
//       { src: "/runtime-assets/pets.4d7f0a8499fd9d7da9f8.riv", progressSize: 2499.67 }
//     ]
//
// `riveManifest.js` ne lisait que les chaînes (`typeof s === "string"`), donc
// depuis la v1150 `resolveRiveAssets()` renvoyait `[]` : aucun `.riv` n'était
// même téléchargé, et les tests d'animation échouaient sur un artboard `null`
// qui ressemblait à un asset manquant plutôt qu'à une forme non lue.
//
// Ce test couvre les deux formes dans le même manifeste, parce que la forme
// ancienne est ce que renvoie une version épinglée et que ce module doit lire
// les deux. Il est hors ligne : le manifeste est servi par un serveur local.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.LOG_LEVEL = "silent";

const MANIFEST = {
  bundles: [
    {
      name: "default",
      assets: [
        // Forme courante : descripteur multi-résolution.
        {
          alias: ["rive/pets.riv", "rive/pets"],
          src: [
            { src: "/runtime-assets/pets.4d7f0a8499fd9d7da9f8.riv", progressSize: 2499.67 },
          ],
        },
        // Forme ancienne : chaîne nue.
        {
          alias: ["rive/decor.riv", "rive/decor"],
          src: ["/runtime-assets/decor.0123456789abcdef.riv"],
        },
        // Un asset sans .riv du tout, pour vérifier qu'on ne le ramasse pas.
        { alias: ["atlases/sprites.json"], src: ["/version/1192/assets/atlases/sprites-2x-0.json"] },
      ],
    },
  ],
};

async function withManifest(run) {
  const server = http.createServer((request, response) => {
    if (request.url === "/manifest.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(MANIFEST));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("un src en descripteur est lu comme un src en chaîne", async () => {
  const { resolveRiveAssets } = await import("../src/assets/sprites/riveManifest.js");

  await withManifest(async (baseUrl) => {
    const assets = await resolveRiveAssets({ baseUrl });
    const keys = assets.map((asset) => asset.key);

    assert.deepEqual(
      keys,
      ["decor", "pets"],
      "les deux formes doivent être trouvées ; aucune ne doit être ignorée"
    );

    const pets = assets.find((asset) => asset.key === "pets");
    assert.equal(pets.src, "/runtime-assets/pets.4d7f0a8499fd9d7da9f8.riv");
    assert.equal(pets.bundle, "default");
    assert.ok(pets.url.endsWith("/runtime-assets/pets.4d7f0a8499fd9d7da9f8.riv"));

    // Et l'atlas JSON qui vit dans le même manifeste n'est pas un .riv.
    assert.equal(
      assets.some((asset) => asset.src.endsWith(".json")),
      false
    );
  });
});

test("resolveRiveUrl trouve un .riv déclaré en descripteur", async () => {
  const { resolveRiveUrl } = await import("../src/assets/sprites/riveManifest.js");

  await withManifest(async (baseUrl) => {
    const url = await resolveRiveUrl("pets", { baseUrl });
    assert.equal(typeof url, "string");
    assert.ok(url.endsWith("/runtime-assets/pets.4d7f0a8499fd9d7da9f8.riv"));
  });
});
