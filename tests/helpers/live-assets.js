// tests/helpers/live-assets.js
//
// Ce que `npm test` ne peut pas vérifier hors ligne, et comment le dire.
//
// Les binaires du jeu n'ont pas leur place dans le dépôt : un atlas KTX2 pèse
// 1 à 5 Mo et `pets.riv` 2,4 Mo. Les tests qui en dépendent se sautent donc
// **en nommant ce qui manque** — `node --test` affiche le motif, et le README
// dit comment les relancer avec le réseau.
//
// Chaque constante est la valeur à passer à `node:test` :
//   describe("…", { skip: SKIP_PETS_RIVE }, () => { … })
//   it("…", { skip: SKIP_LIVE_MANIFEST }, () => { … })
// soit un motif (affiché en `# SKIP …`), soit `false` quand `MG_LIVE_ASSETS=1`.
//
// **Un `skip` posé sur un `it` ne dispense pas le `before` de sa suite de
// tourner.** Une suite qui télécharge dans son `before` doit donc porter le
// `skip` elle-même, sinon elle part sur le réseau même avec tous ses `it`
// sautés. Sur un `it`, le `skip` est réservé aux suites dont le `before` ne
// touche à rien (voir les tests de dérive plus bas).
//
// Un test qui se contente de passer sans rien vérifier ne vaut rien : ces
// motifs sont là pour que l'absence de vérification soit visible, pas pour
// faire taire un échec.

export const LIVE_ASSETS = process.env.MG_LIVE_ASSETS === "1";

const HOWTO = 'run `MG_LIVE_ASSETS=1 npm run test:live` with network access';

function skipUnlessLive(needs) {
  return LIVE_ASSETS ? false : `${needs} - ${HOWTO}`;
}

export const SKIP_PETS_RIVE = skipUnlessLive(
  "needs the live rive/pets.riv (~2.4 MB) to load artboards and render pet loops"
);

export const SKIP_DECOR_RIVE = skipUnlessLive(
  "needs the live rive/decor.riv (~1 MB) to load the decor artboards"
);

export const SKIP_KTX2_ATLAS = skipUnlessLive(
  "needs a live KTX2 atlas image (1-5 MB) from /runtime-assets to decode and crop"
);

export const SKIP_LIVE_MANIFEST = skipUnlessLive(
  "needs the live manifest to check the pinned fixture has not gone stale"
);
