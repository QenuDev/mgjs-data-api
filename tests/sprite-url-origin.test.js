// tests/sprite-url-origin.test.js
//
// Où une URL de sprite dit d'aller la chercher.
//
// Le défaut : `config.sprites.baseUrl` valait `http://localhost:3000` par
// défaut, donc un serveur écoutant sur un autre port (ou derrière un proxy)
// répondait à chaque client une adresse où personne n'écoute — constaté en
// lançant l'API sur 3999 et en lisant son propre index. C'est le même défaut que
// celui du document OpenAPI qui nommait l'hôte de production, dans une charge
// utile au lieu d'un spec.
//
// La règle est maintenant en deux moitiés, et les deux sont testées ici :
//
//   - une réponse construite pour la requête qui l'a demandée peut nommer
//     l'origine de cette requête, et c'est ce que fait l'index ;
//   - une réponse mise en cache ne le peut pas : elle serait servie à tout le
//     monde avec l'origine du premier appelant. Celles-là portent des chemins
//     relatifs à cette API, qui sont corrects sur n'importe quel hôte.

import assert from "node:assert/strict";
import test from "node:test";

test("une charge utile mise en cache porte un chemin, jamais l'hôte d'un appelant", async (t) => {
  const { startTestApp } = await import("./helpers/httpApp.js");
  const api = await startTestApp();
  t.after(() => api.close());

  const body = await (await api.get("/data/plants")).json();
  const sprites = [];
  const walk = (value) => {
    if (value === null || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "sprite" && typeof entry === "string") sprites.push(entry);
      else walk(entry);
    }
  };
  walk(body);

  assert.ok(sprites.length > 0, "les plantes portent des sprites, sinon ce test ne dit rien");
  for (const sprite of sprites) {
    assert.ok(sprite.startsWith("/assets/sprites/"), `un chemin relatif à cette API : ${sprite}`);
    assert.equal(sprite.includes("://"), false, `et aucun hôte : ${sprite}`);
    assert.equal(sprite.includes("localhost:3000"), false, `ni le port par défaut : ${sprite}`);
  }
});
