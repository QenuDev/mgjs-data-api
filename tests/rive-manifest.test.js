// tests/rive-manifest.test.js
//
// Résolution de tous les fichiers Rive du manifest.
//
// Le piège que ces tests verrouillent : le jeu ne range pas ses .riv au même
// endroit. `pets.riv` et `avatar.riv` sont dans le bundle `default`, mais
// `decor.riv`, `currency.riv`, `giftbox.riv` et `thought-bubble.riv` ont chacun
// **leur propre bundle**. Une résolution qui ne regarde que `default` — ce que
// faisait la version d'origine — en rate les deux tiers sans rien signaler.
//
// La résolution se vérifie hors ligne, contre la capture figée du jeu (version
// 1192, cf. `tests/fixtures/README.md`) : c'est elle qui porte les huit `.riv`
// et leurs bundles respectifs. La dérive du manifest réel est surveillée par
// les tests du bas, qui n'ont de sens qu'avec le réseau.
//
// Usage: node --test tests/rive-manifest.test.js
//        MG_LIVE_ASSETS=1 npm run test:live   (ajoute la surveillance du manifest réel)

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { resolveRiveAssets, resolveRiveUrl } from "../src/assets/sprites/riveManifest.js";
import { resolvePetsRiveUrl } from "../src/assets/sprites/exportPetsFromRive.js";
import { fixtureBaseUrl, stopFixtureServer } from "./helpers/game-fixtures.js";
import { SKIP_LIVE_MANIFEST } from "./helpers/live-assets.js";

describe("rive manifest resolution (fixture)", () => {
  let baseUrl = null;
  let assets = [];

  before(async () => {
    baseUrl = await fixtureBaseUrl();
    assets = await resolveRiveAssets({ baseUrl });
  });

  it("finds Rive files across every bundle, not just `default`", () => {
    assert.ok(assets.length >= 2, "no Rive file resolved at all");

    const keys = assets.map((a) => a.key);
    assert.ok(keys.includes("pets"), "pets.riv not resolved");

    // `decor` vit dans son propre bundle : c'est lui qui prouve qu'on ne se
    // limite plus à `default`. La fixture le contient, donc l'assertion est
    // ferme — un `decor` manquant doit casser ici, pas passer sous silence.
    const decor = assets.find((a) => a.key === "decor");
    assert.ok(decor, "decor.riv not resolved");
    assert.notEqual(decor.bundle, "default", "decor.riv is expected outside the default bundle");
  });

  it("resolves every file the manifest declares, from either `src` form", () => {
    // Le manifest de la v1192 déclare ses sources en descripteurs
    // `{ src, resolution }`, pas en chaînes. Une résolution qui ne lit que les
    // chaînes ne trouve plus rien ; celle qui n'en lit qu'une partie en perd
    // silencieusement la moitié — c'est le défaut qui a vidé `resolveRiveAssets()`
    // à partir de la v1150. La fixture est figée : les huit clés sont un
    // attendu ferme, pas une observation.
    assert.deepEqual(
      assets.map((a) => a.key),
      ["avatar", "currency", "decor", "emotes", "giftbox", "pets", "streak", "thought-bubble"]
    );
  });

  it("keys files by name, not by alias", () => {
    // Les URL sont versionnées par hash (`pets.<hash>.riv`) et les alias sont
    // renommables côté jeu : la clé doit venir du nom de fichier.
    for (const asset of assets) {
      assert.match(asset.url, /\.riv$/);
      assert.ok(!asset.key.includes("."), `key '${asset.key}' still carries a hash or extension`);
      assert.ok(asset.src.includes(asset.key), `key '${asset.key}' does not match src ${asset.src}`);
    }
  });

  it("returns one entry per file", () => {
    const keys = assets.map((a) => a.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate keys resolved");
  });

  it("resolves a single file by key", async () => {
    const url = await resolveRiveUrl("pets", { baseUrl });
    assert.match(url, /\/runtime-assets\/pets\.[0-9a-f]+\.riv$/);
    assert.equal(await resolveRiveUrl("does-not-exist", { baseUrl }), null);
  });

  it("keeps the pets resolver working through the generic one", async () => {
    // C'est ce que consomment l'export des PNG et celui des animations.
    const pets = await resolvePetsRiveUrl(baseUrl);
    assert.equal(pets, await resolveRiveUrl("pets", { baseUrl }));
  });
});

// --- Le manifest réel a-t-il bougé sous la fixture ? -----------------------
//
// Sans ça, une fixture périmée resterait verte pendant que le jeu déplace ses
// .riv. Ces tests ne jugent pas la version (elle change toutes les semaines) :
// ils vérifient qu'aucun fichier épinglé n'a disparu et que `pets.riv` répond
// toujours à la même forme d'URL.
//
// Le `skip` est sur chaque `it` et non sur la suite : cette suite n'a pas de
// `before`, donc rien ne part sur le réseau quand ils sont sautés.

describe("live manifest drift", () => {
  it("still lists every Rive file the fixture pinned", { skip: SKIP_LIVE_MANIFEST }, async () => {
    const fixture = await resolveRiveAssets({ baseUrl: await fixtureBaseUrl() });
    const live = await resolveRiveAssets({});

    const liveKeys = new Set(live.map((a) => a.key));
    const missing = fixture.map((a) => a.key).filter((key) => !liveKeys.has(key));
    assert.deepEqual(missing, [], "Rive files disappeared from the live manifest");
  });

  it("still serves pets.riv under /runtime-assets", { skip: SKIP_LIVE_MANIFEST }, async () => {
    const url = await resolvePetsRiveUrl();
    assert.match(url, /\/runtime-assets\/pets\.[0-9a-f]+\.riv$/);
  });
});

after(async () => {
  await stopFixtureServer();
});
