// tests/ktx2-sprites.test.js
//
// Integration tests for the KTX2 sprite pipeline.
// Verifies that KTX2 atlas images from the game can be decoded and cropped correctly.
//
// Tout ce qui peut être vérifié hors ligne l'est : la métadonnée — manifest,
// rects de frames, `meta.image` — vient d'une capture figée du jeu servie en
// local par `tests/helpers/game-fixtures.js`. Seul le décodage des binaires
// KTX2 (1 à 5 Mo pièce) demande le réseau, et se saute en nommant ce qu'il
// faut : `MG_LIVE_ASSETS=1 npm run test:live`, voir la section Testing du
// README.
//
// Usage: node --test tests/ktx2-sprites.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { decodeKTX2, isKTX2 } from "../src/assets/ktx2Decoder.js";
import { getBundleByName, extractJsonFiles, loadManifest } from "../src/assets/manifest.js";
import { getBaseUrl } from "../src/assets/assets.js";
import { initSprites, lookupSprite } from "../src/assets/sprites/sprites.js";
import {
  FIXTURE_VERSION,
  fixtureAssetPath,
  readFixtureAtlases,
  readFixtureJson,
  stopFixtureServer,
  useFixtureOrigin,
} from "./helpers/game-fixtures.js";
import { SKIP_KTX2_ATLAS } from "./helpers/live-assets.js";

const FETCH_TIMEOUT = 30_000;

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.json();
}

/**
 * Les atlas que le jeu publie **maintenant**, résolus comme `initSprites()` les
 * résout : les JSON du bundle `default`, puis les `meta.related_multi_packs`
 * de chacun. Rien n'est épinglé : ni la version, ni les hashes de contenu.
 */
async function readLiveAtlases() {
  const baseUrl = await getBaseUrl();
  assert.ok(baseUrl, "the game's version endpoint did not answer");

  const manifest = await loadManifest({ baseUrl });
  const bundle = getBundleByName(manifest, "default");
  assert.ok(bundle, "live manifest has no `default` bundle");

  const ordered = [];
  const seen = new Set();
  const add = (src) => {
    if (src && !seen.has(src)) {
      seen.add(src);
      ordered.push(src);
    }
  };

  for (const src of extractJsonFiles(bundle)) {
    add(src);
    const dir = src.includes("/") ? src.replace(/[^/]+$/, "") : "";
    const atlas = await fetchJson(new URL(src, baseUrl));
    for (const related of atlas?.meta?.related_multi_packs ?? []) {
      if (typeof related === "string") add(dir + related);
    }
  }

  return Promise.all(
    ordered.map(async (src) => {
      const json = await fetchJson(new URL(src, baseUrl));
      return {
        src,
        json,
        // `meta.image` est relatif au dossier de l'atlas (`../../../../runtime-assets/…`) :
        // on le résout contre l'URL du JSON, comme le fait `src/`.
        imageUrl: new URL(json.meta.image, new URL(src, baseUrl)).toString(),
      };
    })
  );
}

function cropBoxOf(frameData) {
  const { frame, rotated } = frameData;
  // Une frame pivotée est stockée h x w et remise d'aplomb par un rotate(270).
  return { width: rotated ? frame.h : frame.w, height: rotated ? frame.w : frame.h };
}

async function cropFrame(decoded, frameData) {
  const { frame } = frameData;
  const { width, height } = cropBoxOf(frameData);
  return sharp(decoded.rgba, {
    raw: { width: decoded.width, height: decoded.height, channels: 4 },
  })
    .extract({ left: frame.x, top: frame.y, width, height })
    .png()
    .toBuffer();
}

// ─── isKTX2 helper ───────────────────────────────────────────────────

describe("isKTX2", () => {
  it("returns true for .ktx2 paths", () => {
    assert.equal(isKTX2("atlases/sprites-0.ktx2"), true);
    assert.equal(isKTX2("https://example.com/file.KTX2"), true);
  });

  it("returns false for non-ktx2 paths", () => {
    assert.equal(isKTX2("atlases/sprites-0.webp"), false);
    assert.equal(isKTX2("atlases/sprites-0.png"), false);
    assert.equal(isKTX2("atlases/sprites-0.json"), false);
  });

  it("returns false for non-string inputs", () => {
    assert.equal(isKTX2(null), false);
    assert.equal(isKTX2(undefined), false);
    assert.equal(isKTX2(123), false);
  });
});

// ─── Manifest and atlas metadata (offline fixture) ───────────────────

describe(`manifest and atlas metadata (fixture v${FIXTURE_VERSION})`, () => {
  let manifest;

  before(async () => {
    manifest = await readFixtureJson(fixtureAssetPath("manifest.json"));
  });

  it("has a default bundle", () => {
    assert.ok(getBundleByName(manifest, "default"), "default bundle must exist");
  });

  it("declares the full-resolution atlas JSON, and each one only once", () => {
    // Le manifest ne liste plus d'images `.ktx2` : le jeu les sert
    // content-hashées sous `/runtime-assets/`, et ce sont les atlas JSON qui
    // les référencent par `meta.image` (0 des 207 sources de la v1192 ne finit
    // en `.ktx2`). Ce qu'il déclare encore, ce sont les JSON — en 1x et 2x —
    // dont on ne garde que le 2x, sinon les mêmes frames seraient ingérées
    // deux fois.
    assert.deepEqual(extractJsonFiles(getBundleByName(manifest, "default")), [
      "atlases/sprites-2x-0.json",
      "atlases/tiles-2x.json",
      "atlases/weather-2x.json",
    ]);
  });

  it("makes every atlas JSON point at a .ktx2 image", async () => {
    // Ex-« atlas JSONs reference .ktx2 in meta.image », étendu aux six atlas —
    // les trois multi-packs de sprites compris — au lieu du seul sprites-0.
    const atlases = await readFixtureAtlases();
    assert.ok(atlases.length >= 6, `expected the multi-packs too, got ${atlases.length} atlases`);

    for (const { src, json } of atlases) {
      const image = json.meta?.image;
      assert.ok(image, `${src} declares no meta.image`);
      assert.equal(isKTX2(image), true, `${src} meta.image is not KTX2: ${image}`);
      // Exprimé relativement au dossier de l'atlas : le recoller à la base à la
      // main donne une URL fausse (`/version/<v>/assets/atlases/runtime-assets/…`).
      assert.match(image, /^\.{2}\//, `${src} meta.image is not relative to the atlas: ${image}`);
    }
  });

  it("resolves a frame's atlas image through the production path", async () => {
    // On passe par le chemin de production (`initSprites()` -> entrée d'atlas
    // -> image) plutôt que de recoller `meta.image` à la main : c'est cette
    // résolution-là que consomme le décodeur.
    const restore = await useFixtureOrigin();
    try {
      await initSprites();

      const frame = lookupSprite("weather/AmberMoonAnimation");
      assert.ok(frame, "weather frame missing from the atlas");
      assert.equal(isKTX2(frame.url), true, `atlas image is not KTX2: ${frame.url}`);

      // Depuis la v1150 environ l'image n'est plus sous `/version/<v>/assets/` :
      // elle est content-hashée à la racine, donc partagée entre versions. Une
      // résolution qui n'en sort pas produit un 404, pas une erreur.
      const url = new URL(frame.url);
      assert.match(url.pathname, /^\/runtime-assets\/weather-2x\.[0-9a-f]+\.ktx2$/);
    } finally {
      restore();
    }
  });
});

// ─── Atlas frame geometry (offline fixture) ──────────────────────────

describe(`atlas frame geometry (fixture v${FIXTURE_VERSION})`, () => {
  let atlases = [];

  before(async () => {
    atlases = await readFixtureAtlases();
  });

  it("declares frames for every atlas", () => {
    for (const { src, json } of atlases) {
      assert.ok(Object.keys(json.frames ?? {}).length > 0, `${src} declares no frame`);
    }
  });

  it("keeps every frame inside the atlas it is declared in", () => {
    // C'est la moitié « métadonnée » du pipeline de découpe : un rect qui
    // déborde fait échouer `sharp.extract()`, et un atlas recadré côté jeu sans
    // que les frames suivent doit casser ici, pas au premier rendu.
    for (const { src, json } of atlases) {
      const { w, h } = json.meta.size;
      assert.ok(w > 0 && h > 0, `${src} declares no usable meta.size`);

      for (const [key, data] of Object.entries(json.frames)) {
        const frame = data.frame;
        assert.ok(frame, `${src}: ${key} declares no rect`);
        assert.ok(
          frame.x >= 0 && frame.y >= 0 && frame.w > 0 && frame.h > 0,
          `${src}: ${key} has a degenerate rect ${JSON.stringify(frame)}`
        );

        const { width, height } = cropBoxOf(data);
        assert.ok(
          frame.x + width <= w && frame.y + height <= h,
          `${src}: ${key} overflows ${w}x${h} (rect ${frame.x},${frame.y} ${width}x${height})`
        );
      }
    }
  });
});

// ─── KTX2 input validation (offline) ─────────────────────────────────

describe("decodeKTX2 input validation", () => {
  it("rejects invalid KTX2 data", async () => {
    const garbage = Buffer.from("not a real ktx2 file");
    await assert.rejects(() => decodeKTX2(garbage), /KTX2/);
  });
});

// ─── KTX2 decoding (live binaries) ───────────────────────────────────

describe(
  "decodeKTX2 (live atlas binary)",
  { skip: SKIP_KTX2_ATLAS, timeout: FETCH_TIMEOUT * 4 },
  () => {
    let atlases = [];
    let weather = null;
    let decoded = null;

    before(async () => {
      atlases = await readLiveAtlases();
      weather = atlases.find((a) => a.src.endsWith("weather-2x.json")) ?? null;
      assert.ok(weather, "weather atlas not found in the live manifest");
      decoded = await decodeKTX2(await fetchBuffer(weather.imageUrl));
    });

    it("decodes a KTX2 file to RGBA with the dimensions the atlas declares", () => {
      // La taille attendue vient de l'atlas JSON, pas d'une constante : un
      // 4096 codé en dur ne décrit plus l'atlas que le jeu publie.
      const { w, h } = weather.json.meta.size;

      assert.equal(decoded.width, w, "decoded width must match meta.size.w");
      assert.equal(decoded.height, h, "decoded height must match meta.size.h");
      assert.ok(Buffer.isBuffer(decoded.rgba), "rgba must be a Buffer");
      assert.equal(
        decoded.rgba.byteLength,
        decoded.width * decoded.height * 4,
        "RGBA buffer size must match width * height * 4"
      );
    });

    it("decoded RGBA contains actual pixel data (not all zeros)", () => {
      const nonZero = decoded.rgba.some((byte) => byte > 0);
      assert.ok(nonZero, "RGBA data must contain non-zero pixels");
    });

    it("accepts Uint8Array input", async () => {
      const uint8 = new Uint8Array(await fetchBuffer(weather.imageUrl));
      const result = await decodeKTX2(uint8);
      assert.equal(result.width, weather.json.meta.size.w);
      assert.ok(result.rgba.byteLength > 0);
    });

    it("decodes the largest atlas the game publishes", async () => {
      // Ex-« decodes the largest atlas (4096px) » : la plus grande texture est
      // désormais celle que le manifest décrit, quelle que soit sa taille.
      const largest = atlases.reduce((a, b) =>
        b.json.meta.size.w * b.json.meta.size.h > a.json.meta.size.w * a.json.meta.size.h ? b : a
      );

      const result = await decodeKTX2(await fetchBuffer(largest.imageUrl));

      assert.equal(result.width, largest.json.meta.size.w, `${largest.src} width`);
      assert.equal(result.height, largest.json.meta.size.h, `${largest.src} height`);
      assert.equal(result.rgba.byteLength, result.width * result.height * 4);
    });
  }
);

// ─── Sprite crop from the live KTX2 atlas ────────────────────────────

describe(
  "sprite crop from live KTX2 atlas",
  { skip: SKIP_KTX2_ATLAS, timeout: FETCH_TIMEOUT * 4 },
  () => {
    let weather = null;
    let decoded = null;

    before(async () => {
      const atlases = await readLiveAtlases();
      weather = atlases.find((a) => a.src.endsWith("weather-2x.json")) ?? null;
      assert.ok(weather, "weather atlas not found in the live manifest");
      decoded = await decodeKTX2(await fetchBuffer(weather.imageUrl));
    });

    it("can crop a single frame from decoded RGBA atlas", async () => {
      const frameKeys = Object.keys(weather.json.frames);
      assert.ok(frameKeys.length > 0, "atlas must have frames");

      const firstKey = frameKeys[0];
      const frameData = weather.json.frames[firstKey];
      const { width, height } = cropBoxOf(frameData);

      const cropped = await cropFrame(decoded, frameData);
      assert.ok(cropped.byteLength > 0, "cropped PNG must have data");

      const metadata = await sharp(cropped).metadata();
      assert.equal(metadata.width, width, "cropped width must match the frame rect");
      assert.equal(metadata.height, height, "cropped height must match the frame rect");
    });

    it("can crop multiple frames without errors", async () => {
      const frameKeys = Object.keys(weather.json.frames).slice(0, 5);
      for (const key of frameKeys) {
        const buf = await cropFrame(decoded, weather.json.frames[key]);
        assert.ok(buf.byteLength > 0, `crop of ${key} must produce data`);
      }
    });

    it("handles rotated frames correctly (w/h swap + rotate 270)", async (t) => {
      const rotatedEntry = Object.entries(weather.json.frames).find(([, data]) => data.rotated);

      if (!rotatedEntry) {
        // Ni la fixture ni le jeu ne déclarent de frame pivotée : le test
        // passerait sans rien mesurer, donc il le dit au lieu de mentir.
        t.skip("no rotated frame in the live weather atlas - nothing to restore");
        return;
      }

      const [key, frameData] = rotatedEntry;
      const { frame } = frameData;
      const { width, height } = cropBoxOf(frameData);

      const cropped = await sharp(decoded.rgba, {
        raw: { width: decoded.width, height: decoded.height, channels: 4 },
      })
        .extract({ left: frame.x, top: frame.y, width, height })
        .rotate(270)
        .png()
        .toBuffer();

      const metadata = await sharp(cropped).metadata();
      assert.equal(metadata.width, frame.w, `rotated frame ${key} width after rotation`);
      assert.equal(metadata.height, frame.h, `rotated frame ${key} height after rotation`);
    });
  }
);

// Le serveur de fixtures est unref(), mais on ferme proprement.
after(async () => {
  await stopFixtureServer();
});
