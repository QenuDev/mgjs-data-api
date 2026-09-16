# Fixtures du jeu

Copies figées de ce que `magicgarden.gg` sert, pour que la suite tourne **sans
réseau** et ne casse plus quand le jeu change de version.

## Provenance

Tout vient de la version **1192**, capturée le 2026-09-16 :

```bash
V=1192
B=https://magicgarden.gg/version/$V/assets
D=tests/fixtures/game/version/$V/assets

mkdir -p "$D/atlases"
curl -s -A "Mozilla/5.0" "$B/manifest.json" -o "$D/manifest.json"
for f in weather-2x sprites-2x-0 sprites-2x-1 sprites-2x-2 sprites-2x-3 tiles-2x; do
  curl -s -A "Mozilla/5.0" "$B/atlases/$f.json" -o "$D/atlases/$f.json"
done
curl -s -A "Mozilla/5.0" https://magicgarden.gg/platform/v1/version \
  -o tests/fixtures/game/platform/v1/version.json
```

L'endpoint de version est ce que lit `src/assets/assets.js` : sa réponse doit
correspondre au dossier capturé, sinon les URL que `src/` construit ne tombent
plus sur les fixtures.

| Fichier | Taille | sha256 (16) | Ce qu'il porte |
|---|---|---|---|
| `platform/v1/version.json` | 24 o | `7425cd6a894b9bf6` | `{"version":"1192"}` |
| `version/1192/assets/manifest.json` | 35 Ko | `5392d461af987233` | 10 bundles, 207 sources, les 8 `.riv`, **0** `.ktx2` |
| `atlases/weather-2x.json` | 1,2 Ko | `bf40871467f5f8d0` | 5 frames de météo, 2312×2480 |
| `atlases/sprites-2x-0.json` | 33 Ko | `333266fa2518bb19` | 127 frames, 4044×4088, `related_multi_packs` |
| `atlases/sprites-2x-1.json` | 25 Ko | `f807800f06521144` | 100 frames, 4060×4092 |
| `atlases/sprites-2x-2.json` | 32 Ko | `9e8f6487843fc534` | 128 frames, 4088×4008 |
| `atlases/sprites-2x-3.json` | 57 Ko | `15dd07e7dcad1277` | 228 frames, 3288×3272 |
| `atlases/tiles-2x.json` | 12 Ko | `32474985a30aaab2` | 58 frames de tuiles, 3456×3328 |

Deux points qui expliquent la forme de la capture :

- **Les six atlas JSON, multi-packs compris.** `sprites-2x-0.json` déclare
  `meta.related_multi_packs` : `sprites-2x-1..3.json`. Les quatre packs sont là
  ensemble pour que le test « les pets ne sont plus dans les atlas » balaie tout
  l'atlas, pas la tranche qui l'arrange.
- **Aucune image dans le manifest.** Le manifest ne liste plus de `.ktx2` : les
  textures sont servies content-hashées sous `/runtime-assets/`, et ce sont les
  atlas JSON qui les référencent, par `meta.image` — un chemin *relatif au
  dossier de l'atlas* (`../../../../runtime-assets/weather-2x.<hash>.ktx2`).

Le contenu de ces fichiers est identique, octet pour octet, à une capture de la
version 1190 : entre les deux, seuls les chemins versionnés ont bougé, pas les
assets. C'est attendu — le manifest ne référence que des URL content-hashées.

## Ce qui n'est **pas** là

Les binaires. Un atlas KTX2 pèse 1 à 5 Mo et `pets.riv` 2,4 Mo : quatre
mégaoctets dans le dépôt pour vérifier un décodage, non. Les tests concernés se
sautent en le disant, avec la variable à passer pour les relancer
(`MG_LIVE_ASSETS=1 npm run test:live`) — voir la section Testing du README.

## Re-capturer

Quand le jeu bouge, on **ajoute** une version, on ne réécrit pas celle-ci : les
assertions figées pointent une version précise. Copier le dossier
`version/<nouvelle>/`, mettre à jour `FIXTURE_VERSION` dans
`tests/helpers/game-fixtures.js`, et suivre le même chemin pour
`platform/v1/version.json`. Les commandes ci-dessus suffisent.

Un fichier qui disparaît du jeu n'est pas une raison de réécrire la fixture : le
test de dérive (gated derrière `MG_LIVE_ASSETS=1`) est là pour le signaler.

## Le bake des cultures (`bake/`)

Même version 1192. Deux payloads, capturés non pas à la main mais en exécutant
l'extracteur du dépôt — celui du serveur, donc :

```bash
node tests/fixtures/bake/capture.mjs
```

(il lui faut le réseau : le bundle du jeu et ses chunks).

| Fichier | Taille | Ce qu'il porte |
|---|---|---|
| `bake/mutations.json` | 2,5 Ko | les 11 mutations, chacune avec son `group` : `Growth` (Gold, Rainbow), `Hydro` (Wet, Chilled, Frozen, Thunderstruck, Thundercharged), `Lunar` (Dawnlit, Ambershine, Dawncharged, Ambercharged) |
| `bake/plants.json` | 55 Ko | les 69 espèces de plantes, avec pour chacune `plant.harvestType`, `plant.sprite` et `crop.sprite` — l'art sur lequel ses mutations sont dessinées |

C'est ce que le bake énumère : le produit des catégories (2+1)×(5+1)×(4+1) = **90
ensembles**, × 69 types de culture = **6 210 images**. Le script imprime ces
nombres, et la table `species → art`, à chaque capture : une version du jeu qui
change la forme de l'un ou de l'autre se voit dans le diff de la capture.
