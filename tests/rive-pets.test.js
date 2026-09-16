// tests/rive-pets.test.js
//
// Integration tests for the Rive pet sprite pipeline.
//
// Le jeu a sorti les pets des atlas TexturePacker : `sprite/pet/*` ne contient
// plus que les œufs, et chaque créature est un artboard de `rive/pets.riv`.
//
// Ce qui se vérifie hors ligne l'est : la présence du `.riv` dans le manifest
// et l'absence des créatures dans les atlas, contre la capture figée du jeu
// (version 1192, cf. `tests/fixtures/README.md`). Le reste — charger les
// artboards, rasteriser, comparer deux poses — a besoin du vrai `pets.riv`
// (2,4 Mo) et se saute en le disant : `MG_LIVE_ASSETS=1 npm run test:live`.
//
// Usage: node --test tests/rive-pets.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { resolvePetsRiveUrl } from "../src/assets/sprites/exportPetsFromRive.js";
import { resolveRiveUrl } from "../src/assets/sprites/riveManifest.js";
import { loadRiveFile, renderArtboardToPng } from "../src/assets/sprites/riveRenderer.js";
import { initSprites, lookupSprite } from "../src/assets/sprites/sprites.js";
import { fixtureBaseUrl, stopFixtureServer, useFixtureOrigin } from "./helpers/game-fixtures.js";
import { SKIP_PETS_RIVE } from "./helpers/live-assets.js";

const FETCH_TIMEOUT = 30_000;
const PET_STATE_MACHINE = "Pet State Machine";

// Espèces présentes depuis longtemps : si l'une disparaît des artboards, c'est
// que le format a encore bougé et que l'export doit être revu.
const EXPECTED_PETS = ["Bat", "Chicken", "Horse", "ThunderWolf"];

// ─── Manifest et atlas (hors ligne, fixture) ─────────────────────────

describe("pets in the manifest and the atlases (fixture)", () => {
  it("is listed in the manifest, under /runtime-assets", async () => {
    const url = await resolveRiveUrl("pets", { baseUrl: await fixtureBaseUrl() });
    assert.ok(url, "pets .riv not found in the manifest");
    assert.match(url, /\/runtime-assets\/pets\.[0-9a-f]+\.riv$/);
  });

  it("no longer finds pet creatures in the sprite atlases", async () => {
    // Garde-fou : si le jeu remet les pets dans l'atlas, l'export Rive devient
    // redondant et ce test le signale. Les quatre packs de sprites sont dans la
    // fixture, donc la recherche balaie tout l'atlas et pas une tranche.
    const restore = await useFixtureOrigin();
    try {
      await initSprites();

      assert.equal(lookupSprite("sprite/pet/Chicken"), null);
      assert.ok(lookupSprite("sprite/pet/CommonEgg"), "eggs should still be in the atlas");
    } finally {
      restore();
    }
  });
});

// ─── Bornes de lecture (hors ligne, aucune dépendance) ───────────────

describe("Rive file bounds", () => {
  it("bounds a Rive file it cannot read instead of hanging", async () => {
    // `rive.load()` ne rejette pas sur un format inconnu, il ne résout jamais.
    // Non borné, ça fait tomber la sync dans son timeout, qui tue le process.
    const notRive = Buffer.concat([Buffer.from("RIVE"), Buffer.alloc(4096, 7)]);

    await assert.rejects(
      () => loadRiveFile(notRive, { timeoutMs: 3000 }),
      (err) => /timed out|no file|Rive/i.test(err.message)
    );
  });
});

// ─── Avec le vrai pets.riv ───────────────────────────────────────────
//
// Le `skip` est sur la suite, pas sur ses `it` : un `skip` posé sur un `it` ne
// dispense pas le `before` de tourner, donc la suite téléchargerait quand même.

describe(
  "pets Rive asset (live .riv)",
  { skip: SKIP_PETS_RIVE, timeout: FETCH_TIMEOUT * 4 },
  () => {
    let riveUrl = null;
    let riveFile = null;
    let artboardNames = [];

    before(async () => {
      riveUrl = await resolvePetsRiveUrl();
      // Le manifest vient d'être lu : une URL absente est un échec, pas une
      // raison de passer sous silence.
      assert.ok(riveUrl, "pets.riv not found in the live manifest");

      const res = await fetch(riveUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        redirect: "follow",
      });
      assert.ok(res.ok, `Rive download failed (${res.status})`);

      const loaded = await loadRiveFile(Buffer.from(await res.arrayBuffer()));
      riveFile = loaded.file;
      artboardNames = loaded.artboardNames;
    });

    it("exposes one artboard per pet species", () => {
      for (const pet of EXPECTED_PETS) {
        assert.ok(artboardNames.includes(pet), `missing artboard: ${pet}`);
      }
    });

    it("renders an artboard to a non-empty PNG", async () => {
      const rendered = await renderArtboardToPng(riveFile, "Chicken", {
        stateMachineName: PET_STATE_MACHINE,
      });

      assert.ok(rendered, "render returned nothing");
      assert.ok(rendered.width > 0 && rendered.height > 0);

      const { info } = await sharp(rendered.buffer)
        .trim({ threshold: 1 })
        .png()
        .toBuffer({ resolveWithObject: true });

      // Un canvas resté transparent se rogne jusqu'à disparaître : c'est le
      // symptôme d'une frame Rive non validée (cf. resolveAnimationFrame).
      assert.ok(info.width > 1 && info.height > 1, "rendered sprite is empty");
    });

    it("centres every pet on the artboard axis, like the game does", async () => {
      // Le cadrage du jeu symétrise autour de l'axe de l'artboard (doc-rive.md
      // §3), donc l'ancre horizontale vaut 0.5 par construction. Un rognage
      // serré des deux côtés la ferait dériver dès qu'une queue dépasse.
      for (const pet of EXPECTED_PETS) {
        const rendered = await renderArtboardToPng(riveFile, pet, {
          stateMachineName: PET_STATE_MACHINE,
        });

        assert.equal(rendered.anchor.x, 0.5, `${pet} is not centred`);
        assert.equal(rendered.width % 1, 0);
        assert.ok(rendered.height > 1, `${pet} rendered empty`);
      }
    });

    it("keeps flying pets wider than tall", async () => {
      // Garde-fou de pose : ailes repliées, la chauve-souris devient plus haute
      // que large. La frame d'atlas d'origine faisait 312x157.
      const rendered = await renderArtboardToPng(riveFile, "Bat", {
        stateMachineName: PET_STATE_MACHINE,
      });

      assert.ok(
        rendered.width > rendered.height * 1.2,
        `Bat should be wider than tall, got ${rendered.width}x${rendered.height}`
      );
    });

    it("renders the weather-active variant differently from the base pose", async () => {
      const base = await renderArtboardToPng(riveFile, "ThunderWolf", {
        stateMachineName: PET_STATE_MACHINE,
      });
      const active = await renderArtboardToPng(riveFile, "ThunderWolf", {
        stateMachineName: PET_STATE_MACHINE,
        inputs: { thunder: true },
        pose: "widest",
        settleSeconds: 4,
      });

      assert.ok(base && active);
      assert.notEqual(
        base.buffer.toString("base64"),
        active.buffer.toString("base64"),
        "the `thunder` state machine input had no visible effect"
      );
    });

    it("fails loudly when the state machine is renamed", async () => {
      // Sans state machine l'artboard rend sa pose d'édition — un PNG valide,
      // mais avec l'ombre au sol et le pet à la mauvaise échelle. Un renommage
      // côté jeu corromprait les 28 sprites en silence.
      await assert.rejects(
        () =>
          renderArtboardToPng(riveFile, "Peacock", {
            stateMachineName: "Pet State Machine RENAMED",
          }),
        /State machine .* not found/
      );
    });
  }
);

after(async () => {
  await stopFixtureServer();
});
