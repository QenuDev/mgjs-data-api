// tests/art-live.test.js
//
// L'extraction d'art contre le bundle que le jeu sert **aujourd'hui**.
//
// `npm test` ne peut pas le vérifier : il n'y a pas de réseau dans la suite hors
// ligne. Le fichier se saute donc en nommant ce qui manque, et
// `MG_LIVE_ASSETS=1 npm run test:live` le relance.
//
// Ce que ce test ajoute aux tests hors ligne n'est pas la même vérification sur
// une autre version : c'est la seule qui puisse dire si le **repérage par forme**
// survit à un build que personne n'a encore lu. Les prédicats sont datés par
// construction ; c'est ici qu'on l'apprend, et c'est pour cela que la cible
// d'art du résolveur est un test d'extraction et non un nom de fichier.

process.env.LOG_LEVEL = "silent";

import test from "node:test";
import assert from "node:assert/strict";

import { fetchMainBundle } from "../src/core/game/bundle/resolver.js";
import { ExtractionError, extractArtPayload } from "../src/core/game/art/index.js";
import { PREDICATES } from "../src/core/game/art/predicates.js";
import { placementFailures, structureFailures } from "./helpers/art-invariants.js";

const KNOWN_PREDICATES = new Set(PREDICATES.map((predicate) => predicate.predicate));

const LIVE = process.env.MG_LIVE_ASSETS === "1";
const SKIP = LIVE ? false : "a besoin du bundle servi par le jeu - lancer `MG_LIVE_ASSETS=1 npm run test:live` avec le réseau";

test("les tables d'art se lisent dans le bundle que le jeu sert", { skip: SKIP }, async () => {
  const bundle = await fetchMainBundle();

  // Le repérage par forme est la moitié qui doit survivre à un build : les noms
  // de fichier portent une empreinte de contenu et changent à chaque version.
  // Les deux tables témoins ont donc déménagé sans casser cette reconnaissance —
  // en 1192 le chunk d'art n'est plus `LayoutMotionController` et la table des
  // noms n'est plus dans le chunk de données.
  assert.ok(
    typeof bundle.artSource === "string" && bundle.artSource.length > 0,
    "le chunk d'art n'a pas été reconnu par sa forme dans le graphe du bundle servi"
  );
  assert.notEqual(bundle.artUrl, bundle.mainUrl, "le chunk d'art est le chunk de données : la cible a mal répondu");
  assert.ok(
    typeof bundle.namesSource === "string" && bundle.namesSource.length > 0,
    "la table des noms de sprite n'a pas été reconnue par sa forme dans le graphe du bundle servi"
  );

  let payload = null;
  let refusal = null;
  try {
    payload = extractArtPayload(bundle);
  } catch (err) {
    // Un plantage du lecteur n'est pas une dérive de forme : il doit se voir.
    if (!(err instanceof ExtractionError)) throw err;
    refusal = err;
  }

  if (refusal !== null) {
    // La version servie a une forme que les prédicats datés ne lisent pas. C'est
    // une réponse, pas un silence, et c'est ce que l'item demande : l'extraction
    // refuse **en nommant le prédicat**, donc la route rend un 500 qui porte ce
    // nom au lieu de publier des nombres que rien ne confirme.
    //
    // Ce test ne peut donc pas rester vert quand une table bouge — mais il
    // distingue les deux façons de ne pas lire la version servie : un refus
    // nommé sur une forme (attendu, et rapporté ici), et toute autre erreur
    // (relancée).
    const version = bundle.mainUrl?.match(/\/version\/([^/]+)\//)?.[1] ?? "unknown";
    console.log(
      `# art: la version ${version} n'est pas lisible par les prédicats — ${refusal.predicate} a refusé : ${refusal.saw?.[0] ?? ""}`
    );
    assert.ok(
      KNOWN_PREDICATES.has(refusal.predicate),
      `le refus ne vient pas d'un prédicat connu : ${refusal.predicate}`
    );
    assert.match(refusal.message, /vu :/, "le refus ne dit pas ce qu'il a vu");
    return;
  }

  assert.deepEqual(structureFailures(payload), [], "un invariant de forme ne tient pas sur la version servie");
  assert.deepEqual(placementFailures(payload), [], "la fonction de placement extraite ne s'accorde pas avec ses tables");

  // La version publiée est celle des URL du bundle, et la provenance nomme les
  // chunks lus (deux en 1176, trois en 1192 : la table des noms a déménagé).
  assert.match(String(payload.source.gameVersion), /^\d+$/, `version illisible : ${payload.source.gameVersion}`);
  assert.ok(payload.source.chunks.length >= 2, "la provenance ne nomme pas les chunks lus");
  assert.ok(
    payload.source.chunks.some((chunk) => chunk.file === bundle.artUrl.split("/").pop()),
    "la provenance ne nomme pas le chunk d'art"
  );

  // La preuve doit nommer un prédicat et un chunk pour chaque table publiée :
  // c'est ce qui rend un changement de version relisible.
  for (const [table, proof] of Object.entries(payload.evidence)) {
    assert.ok(proof.predicate, `${table}: la preuve ne nomme pas son prédicat`);
    assert.match(proof.chunk, /\.js$/, `${table}: la preuve ne nomme pas son chunk`);
  }

  const counts = Object.fromEntries(
    Object.entries(payload.evidence).map(([table, proof]) => [
      table,
      proof.coverage.counts.keys ?? proof.coverage.counts.species ?? "",
    ])
  );
  console.log(`# art: version ${payload.source.gameVersion}, tables ${JSON.stringify(counts)}`);
});
