// tests/compose-paint.test.js
//
// Le rastériseur : ce qu'il dessine, et la couleur qu'il mélange. Ce que ce fichier prouve, et pourquoi
// chaque preuve peut échouer :
//
//   * **un brin de patch est dessiné une seule fois.** La disposition donne à une culture une *frame* et,
//     dessous, sa *picture* (`layers[].nested`). Le composeur poussait les deux : la même art au même
//     rectangle, donc chaque bord anti-aliasé composité deux fois — la frange grise — et la couleur de
//     mutation diluée par une copie non teintée. La preuve est une égalité d'octets : la même culture,
//     à la même place et à la même taille, déclarée `kind: "crop"` (aucune frame, donc rien à doubler)
//     et déclarée `kind: "patch"` d'un seul brin, doit composer **la même image** ;
//   * **la teinture est celle du shader du jeu**, pas un mélange de luminosité. Le fragment shader de
//     `resources-D_3Zwcn-.js` écrit `mix(c.rgb, uColor * c.a, uAlpha)` et rend `c.a` inchangé : le
//     rastériseur doit donner exactement ces octets, y compris sur un pixel à demi transparent, où le
//     `* c.a` se voit (l'ancien mélange CSS `color` y donnait une autre valeur).
//
// Hors ligne : `installOfflineGame()` sert l'atlas et le bundle capturés.

process.env.LOG_LEVEL = "silent";
process.env.CORS_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.COMPOSE_CACHE_DIR = new URL("./fixtures/compose-cache-paint/", import.meta.url).pathname;
process.env.COMPOSE_CACHE_MAX = "4";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import sharp from "sharp";

import { installOfflineGame, plantFixture } from "./helpers/offlineGame.js";
import { startTestApp } from "./helpers/httpApp.js";

const CACHE_DIR = new URL("./fixtures/compose-cache-paint/", import.meta.url);

await installOfflineGame({ version: 1192 });

const { gameDataService } = await import("../src/services/gameData.js");
const PLANTS = await plantFixture();
gameDataService.getPlants = async () => PLANTS;

const { SPEC_VERSION } = await import("../src/assets/compose/spec.js");
const { REFERENCE_TILE_PX } = await import("@mg.js/art");
const { initSprites } = await import("../src/assets/sprites/sprites.js");
const { clearScenePainterCache, washedPng } = await import("../src/assets/compose/scenePainter.js");
const { materialPng } = await import("../src/assets/compose/materials.js");
const { clearSceneCaches } = await import("../src/assets/compose/sceneService.js");

await initSprites();

async function cleanCache() {
  await fs.rm(CACHE_DIR, { recursive: true, force: true });
  clearSceneCaches();
  clearScenePainterCache();
}

/** La spec d'une seule culture de trèfle sur une tuile, nue ou portant des mutations. */
function oneClover({ kind = "crop", size = 100, at, mutations = [], id = "one" } = {}) {
  const item =
    kind === "patch"
      ? { id, kind, species: "Clover", at: { column: 1, row: 0 }, crops: [{ size, mutations, ...(at === undefined ? {} : { at }) }] }
      : { id, kind, species: "Clover", at: { column: 1, row: 0 }, size, mutations };
  return {
    spec: SPEC_VERSION,
    canvas: { fit: "content", padding: 0 },
    background: { kind: "tiles", ground: "Dirt_A", columns: 3, rows: 1 },
    items: [item],
  };
}

async function compose(api, spec) {
  const response = await api.get("/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (response.status !== 200) assert.fail(`${response.status} ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

test("un brin de patch est dessiné une seule fois : la même image qu'une culture nue identique", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Même espèce, même taille, même place : la culture nue dit où l'ancre tombe, le brin de patch passe
  // par la frame *et* par sa picture. Rien ne doit les distinguer dans l'image.
  const bare = await compose(api, oneClover({ kind: "crop" }));
  const sprig = await compose(api, oneClover({ kind: "patch", at: { x: 0, y: 0 } }));

  const [bareMeta, sprigMeta] = await Promise.all([sharp(bare).metadata(), sharp(sprig).metadata()]);
  assert.equal(sprigMeta.width, bareMeta.width, "les deux canevas ont la même largeur");
  assert.equal(sprigMeta.height, bareMeta.height, "les deux canevas ont la même hauteur");

  if (!bare.equals(sprig)) {
    const [a, b] = await Promise.all([
      sharp(bare).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(sprig).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    let differing = 0;
    let worst = 0;
    for (let index = 0; index < a.data.length; index += 1) {
      const delta = Math.abs(a.data[index] - b.data[index]);
      if (delta > 0) differing += 1;
      if (delta > worst) worst = delta;
    }
    assert.fail(
      `le brin de patch n'est pas la même image que la culture nue : ${differing} octets diffèrent, écart maximal ${worst} (un dessin doublé décale les bords demi-transparents)`,
    );
  }
});

/** La boîte des pixels opaques d'une image, en coordonnées image. */
async function alphaBox(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const box = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] > 8) {
        if (x < box.minX) box.minX = x;
        if (y < box.minY) box.minY = y;
        if (x > box.maxX) box.maxX = x;
        if (y > box.maxY) box.maxY = y;
      }
    }
  }
  return box;
}

test("un brin tourné est tourné : l'art occupe le rectangle tourné, et le canevas le contient", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // Sans fond : tout pixel opaque est l'art, donc la boîte des pixels est celle de l'art, et elle se
  // compare à la rotation que le jeu applique (`i.angle = n.rotationDegrees`, horaire sur un canevas y
  // vers le bas) sans passer par ce que la disposition rapporte d'elle-même.
  const degrees = 30;
  const spec = {
    spec: SPEC_VERSION,
    canvas: { fit: "content", padding: 0 },
    items: [
      {
        id: "turned",
        kind: "patch",
        species: "Clover",
        at: { column: 1, row: 0 },
        crops: [{ size: 100, at: { x: 0, y: 0, rotation: degrees } }],
      },
    ],
  };
  const layout = await (await api.get("/compose?format=layout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec),
  })).json();
  const png = await compose(api, spec);

  const crop = layout.items[0].crops[0];
  const pivot = { x: (1 + 0.5) * REFERENCE_TILE_PX, y: (0 + 0.5) * REFERENCE_TILE_PX };
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    [crop.scene.x, crop.scene.y],
    [crop.scene.x + crop.scene.width, crop.scene.y],
    [crop.scene.x, crop.scene.y + crop.scene.height],
    [crop.scene.x + crop.scene.width, crop.scene.y + crop.scene.height],
  ].map(([x, y]) => {
    const dx = x - pivot.x;
    const dy = y - pivot.y;
    return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  });
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const want = {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };

  // Le canevas est le rectangle tourné (le fond est absent, l'union ne contient que l'art).
  assert.ok(
    Math.abs(layout.canvas.width - want.width) <= 2 && Math.abs(layout.canvas.height - want.height) <= 2,
    `canevas ${layout.canvas.width}x${layout.canvas.height}, rectangle tourné attendu ${want.width.toFixed(1)}x${want.height.toFixed(1)} — l'union doit tenir compte de la rotation, sinon le brin est coupé`,
  );

  const box = await alphaBox(png);
  const origin = layout.canvas.origin;
  const measured = {
    left: box.minX - origin.x,
    top: box.minY - origin.y,
    width: box.maxX - box.minX + 1,
    height: box.maxY - box.minY + 1,
  };
  for (const [axis, delta] of [["left", 3], ["top", 3], ["width", 4], ["height", 4]]) {
    assert.ok(
      Math.abs(measured[axis] - want[axis]) <= delta,
      `${axis} de l'art tourné : ${measured[axis].toFixed(1)} au lieu de ${want[axis].toFixed(1)} (rotation ${degrees}° about ${pivot.x},${pivot.y})`,
    );
  }
  // Et l'art occupe bien le rectangle tourné, pas celui d'avant la rotation : 30° sur un art de
  // 174x254 change la boîte de plusieurs dizaines de pixels dans les deux sens.
  assert.ok(
    Math.abs(measured.width - crop.scene.width) > 10 || Math.abs(measured.height - crop.scene.height) > 10,
    "l'image n'est pas celle d'un art non tourné",
  );
});

test("la teinture d'une mutation est celle du shader du jeu, pas un mélange de luminosité", async () => {
  // Le shader : `finalColor = vec4(mix(c.rgb, uColor * c.a, uAlpha), c.a)`. Un pixel opaque et un pixel
  // à demi transparent, sur une art de deux pixels, avec un lavage connu — les deux termes qui comptent
  // sont `uColor * c.a` (le pixel transparent tire vers la moitié de la couleur, pas vers la couleur) et
  // l'alpha rendu inchangé.
  const pixels = Buffer.from([200, 100, 50, 255, 200, 100, 50, 128]);
  const source = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
  const wash = "rgba(255, 0, 0, 0.5)";
  const out = await washedPng(source, [wash]);
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 2);
  assert.equal(info.channels, 4);

  // L'attendu est écrit en 0..255, avec un octet de tolérance : le shader calcule en 0..1 et l'arrondi
  // d'un demi-octet (`227,5`) tombe d'un côté ou de l'autre selon l'ordre des opérations flottantes.
  const shader = (base, colour, alpha, pixelAlpha) => base * (1 - alpha) + colour * pixelAlpha * alpha;

  for (const [index, pixelAlpha] of [1, 128 / 255].entries()) {
    const offset = index * 4;
    for (const [channel, base, colour] of [
      [0, 200, 255],
      [1, 100, 0],
      [2, 50, 0],
    ]) {
      const actual = data[offset + channel];
      const expected = shader(base, colour, 0.5, pixelAlpha);
      assert.ok(
        Math.abs(actual - expected) <= 1,
        `canal ${channel} du pixel ${index} : ${actual}, attendu ${expected.toFixed(2)} (shader : mix(c.rgb, uColor * c.a, uAlpha))`,
      );
    }
    assert.equal(data[offset + 3], index === 0 ? 255 : 128, `le shader rend l'alpha de l'art inchangé (pixel ${index})`);
  }

  // Le pixel à demi transparent est celui où les deux formules divergent le plus, et c'est là que le
  // `* c.a` du shader se voit : vert = 100 x 0,5 + 0 x 0,502 x 0,5 = 50. Le mélange CSS `color` (celui
  // du chemin de *bake*, `spriteComposer.js`) aurait gardé la luminosité de l'art et donné 82 ici, et
  // 228 au rouge au lieu de 164.
  assert.ok(Math.abs(data[5] - 50) <= 1, `vert du pixel à demi transparent : ${data[5]}, attendu 50`);
  assert.ok(Math.abs(data[4] - 164) <= 1, `rouge du pixel à demi transparent : ${data[4]}, attendu 164`);
  assert.ok(Math.abs(data[4] - 228) > 10, "le rouge n'est pas celui du mélange de luminosité (228)");
});
/** La luminosité du jeu : `surface_material_luma`, `dot(color, (0.3, 0.59, 0.11))`. */
const gameLuma = (rgb) => (0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]) / 255;

/** Un art synthétique d'un pixel par couleur donnée, à la taille qui place les coordonnées voulues. */
async function artOf(colours) {
  const raw = Buffer.from(colours.flatMap(([r, g, b]) => [r, g, b, 255]));
  return sharp(raw, { raw: { width: colours.length, height: 1, channels: 4 } }).png().toBuffer();
}

test("un Rainbow remplace la couleur de l'art à la luminosité de l'art, le long de l'axe du jeu", async () => {
  // Le shader : `set_luminosity(surface_rainbow_color(t), surface_material_luma(base))` avec
  // `t = dot(axis, coord - 0.5) + 0.5` et `axis = (cos 40°, sin 40°)`. Deux pixels de l'art, l'un sombre
  // et vert, l'autre gris clair, à deux endroits de l'axe : la couleur change, la luminosité non.
  const base = [
    [90, 140, 90],
    [200, 200, 200],
  ];
  const out = await materialPng(await artOf(base), "Rainbow");
  const { data } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const seen = [];
  for (const [index, colour] of base.entries()) {
    const offset = index * 4;
    const got = [data[offset], data[offset + 1], data[offset + 2]];
    seen.push(got.join(","));
    assert.ok(
      Math.abs(gameLuma(got) - gameLuma(colour)) <= 2,
      `pixel ${index} : la luminosité du jeu doit être conservée, ${gameLuma(got).toFixed(3)} au lieu de ${gameLuma(colour).toFixed(3)}`,
    );
    assert.ok(
      got.some((channel, c) => Math.abs(channel - colour[c]) > 20),
      `pixel ${index} : la couleur de l'art doit être remplacée, pas gardée (${got.join(",")})`,
    );
    assert.equal(data[offset + 3], 255, `pixel ${index} : l'alpha de l'art revient inchangé`);
  }
  assert.notEqual(seen[0], seen[1], "les deux pixels sont à des endroits différents de l'axe 40° : pas la même teinte");
});

test("un Gold passe l'art dans le matériau or du jeu et laisse l'encre noire noire", async () => {
  const base = [
    [128, 128, 128],
    [4, 4, 4],
  ];
  const out = await materialPng(await artOf(base), "Gold");
  const { data } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const mid = [data[0], data[1], data[2]];
  assert.ok(mid[0] > mid[1] && mid[1] > mid[2], `le gris moyen devient de l'or : ${mid.join(",")}`);
  assert.ok(mid[0] > 200 && mid[2] < 60, `l'or est chaud et clair : ${mid.join(",")}`);

  // « Protect only genuine near-black ink » : `1 - smoothstep(0.025, 0.09, luma)` vaut 1 sous luma 0,025,
  // donc le pixel d'encre garde 94 % de sa propre couleur.
  const ink = [data[4], data[5], data[6]];
  assert.ok(ink.every((channel) => channel < 20), `l'encre reste noire : ${ink.join(",")}`);
  assert.equal(data[7], 255, "l'alpha de l'art revient inchangé");
});

test("une culture Rainbow garde la luminosité de l'art et change la teinte, pixel à pixel", async (t) => {
  await cleanCache();
  const api = await startTestApp();
  t.after(async () => {
    await api.close();
    await cleanCache();
  });

  // `Rainbow` n'a ni sprite ni lavage : la seule différence entre les deux images est le matériau, donc
  // les comparer pixel à pixel est exact, et c'est la propriété du shader qu'on regarde — la teinte
  // change, la luminosité non.
  const bare = await compose(api, oneClover({ kind: "crop" }));
  const rainbow = await compose(api, oneClover({ kind: "crop", mutations: ["Rainbow"] }));
  const [bareRaw, rainbowRaw] = await Promise.all([
    sharp(bare).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rainbow).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.equal(rainbowRaw.info.width, bareRaw.info.width, "mêmes dimensions");
  assert.equal(rainbowRaw.info.height, bareRaw.info.height, "mêmes dimensions");

  let compared = 0;
  let bareWarm = 0;
  let rainbowWarm = 0;
  let worstLuma = 0;
  let worstChannel = 0;
  for (let index = 0; index < bareRaw.data.length; index += 4) {
    if (bareRaw.data[index + 3] < 250 || rainbowRaw.data[index + 3] < 250) continue;
    const before = [bareRaw.data[index], bareRaw.data[index + 1], bareRaw.data[index + 2]];
    const after = [rainbowRaw.data[index], rainbowRaw.data[index + 1], rainbowRaw.data[index + 2]];
    compared += 1;
    worstLuma = Math.max(worstLuma, Math.abs(gameLuma(after) - gameLuma(before)));
    worstChannel = Math.max(worstChannel, ...after.map((channel, c) => Math.abs(channel - before[c])));
    // Le trèfle est vert et blanc : rien de rouge dedans. Le dégradé, lui, passe par le rouge et le
    // magenta sur une bonne part de son axe — c'est la teinte que le matériau apporte.
    if (before[0] > before[1] + 40 && before[0] > before[2] + 40) bareWarm += 1;
    if (after[0] > after[1] + 40 && after[0] > after[2] + 40) rainbowWarm += 1;
  }
  assert.ok(compared > 2000, `assez de pixels opaques pour comparer (${compared})`);
  assert.ok(
    rainbowWarm > compared * 0.02 && bareWarm < compared * 0.01,
    `le Rainbow apporte des teintes que l'art n'a pas : ${rainbowWarm} pixels chauds contre ${bareWarm} avant, sur ${compared}`,
  );
  assert.ok(worstChannel > 60, `la teinte change franchement quelque part (pire écart de canal ${worstChannel})`);
  assert.ok(worstLuma * 255 <= 6, `la luminosité du jeu est conservée partout (pire écart ${(worstLuma * 255).toFixed(1)}/255)`);
});
