# Fixtures d'art

Découpages figés du bundle du jeu, **un par version**, pour que les tests d'art
tournent hors ligne et ne dépendent pas de la version que le jeu sert ce
jour-là.

## Pourquoi deux, et pas une

Une seule fixture est exactement ce qui a laissé `npm test` vert pendant que
`/data/art` répondait **500** contre le jeu. Le 2026-09-16 le jeu est passé de
**1176** à **1192** et a renommé le champ qui porte le lavage de récolte :

```
1176  Wet:{filters:new To({color:`rgb(50, 180, 200)`,alpha:.25}), …}
1192  Wet:{colorOverlay:{color:3323080,alpha:.25}, …}
```

Le prédicat ne connaissait que `filters`, la fixture ne portait que 1176, et la
suite ne pouvait donc pas voir que la forme servie n'était plus lue. Les deux
découpages vivent ici, `tests/art-tables.test.js` les exerce tous les deux, et
`tests/art-versions.test.js` exige qu'il existe un découpage pour la version que
`tests/helpers/game-fixtures.js` fige (`FIXTURE_VERSION`) — c'est ce test qui
rend une version servie non couverte impossible à ignorer.

## Provenance

Tout vient des captures du bundle déjà présentes dans l'espace de travail :

| Version | Capture | Atlas témoins |
|---|---|---|
| `1176` | `mgafk-pi/json/bundle-1176-0/` | `tests/fixtures/game/version/1192/assets/atlases/` |
| `1192` | `mgafk-pi/json/bundle-1192-0/` | `tests/fixtures/game/version/1192/assets/atlases/` |

C'est la même capture 1176 que celle qui a produit `mg.js/packages/art/data/1176.json`,
et la même capture 1192 que celle qui a produit `mg.js/packages/art/data/1192.json`
(paquet frère, même jeu lu deux fois) : les deux extractions doivent pouvoir se
comparer table par table, et c'est ce qu'elles font dans
`tests/art-versions.test.js`.

Régénération :

```bash
node scripts/makeArtFixture.mjs /home/james/Documents/dsh_workspaces/MG/mgafk-pi/json/bundle-1176-0
node scripts/makeArtFixture.mjs /home/james/Documents/dsh_workspaces/MG/mgafk-pi/json/bundle-1192-0
```

Le script **découpe, il ne réécrit pas**. Chaque tranche est la valeur verbatim
d'un déclarateur, copiée octet pour octet depuis le chunk ; deux choses seulement
sont rétablies autour d'elle pour que le découpage reste du JavaScript valide :
le `var ` d'un déclarateur qui était au milieu d'une chaîne (`var J={…},mo={…}`)
et le `;` qui ferme l'instruction. `CUTS.json` (écrit par le même script) porte
les intervalles, les empreintes, et l'endroit exact où la valeur verbatim a été
écrite dans la fixture ; `tests/art-versions.test.js` relit ces intervalles et
relance le script pour comparer, octet pour octet, la fixture commitée à ce que
la capture découpe.

## Les fichiers

### 1176

| Fichier | Octets | sha256 (16) | Chunk du jeu |
|---|---|---|---|
| `LayoutMotionController-CwhDlPns.js` | 7 607 | `cd04c45d85de7cc7` | `LayoutMotionController-CwhDlPns.js` |
| `quinoaPredictionAtoms-ptrrFeF6.js` | 62 760 | `8257aaa2bfab1f24` | `quinoaPredictionAtoms-ptrrFeF6.js` |

### 1192

| Fichier | Octets | sha256 (16) | Chunk du jeu |
|---|---|---|---|
| `BakedRoundedRect-lGFgQzh1.js` | 24 516 | `95144e6dad501d63` | `BakedRoundedRect-lGFgQzh1.js` |
| `resources-D_3Zwcn-.js` | 7 420 | `d3b03a963392c360` | `resources-D_3Zwcn-.js` |
| `worldDepthSortKey-BXUHHrP0.js` | 38 999 | `eeb16bf367102129` | `worldDepthSortKey-BXUHHrP0.js` |

Les noms sont ceux des chunks réels, empreinte de contenu comprise, pour que la
fixture se lise comme la capture dont elle vient — et parce que la provenance
publiée par `/data/art` nomme le fichier du chunk lu. En 1192 le chunk d'art
n'est plus `LayoutMotionController` mais `resources`, et la table des noms de
sprite n'est plus dans le chunk de données mais dans `BakedRoundedRect` : trois
fichiers, pas deux.

## Les tranches

### 1176

| Chunk | Déclaration | Intervalle | Octets | sha256 (16) | Ce qu'elle porte |
|---|---|---|---|---|---|
| `quinoaPredictionAtoms-ptrrFeF6.js` | `E` | 820107–843858 | 23751 | `4672d9a85963a0d7` | table des noms de sprite |
| `quinoaPredictionAtoms-ptrrFeF6.js` | `U` | 937741–938793 | 1052 | `b160bf7f3a62d989` | table des mutations |
| `quinoaPredictionAtoms-ptrrFeF6.js` | `V` | 901973–936353 | 34380 | `da94d7dd34641340` | table des plantes |
| `quinoaPredictionAtoms-ptrrFeF6.js` | `ri` | 849511–852133 | 2622 | `5374fd0a7dc8f1a3` | table des œufs (signature `secondsToHatch`) |
| `quinoaPredictionAtoms-ptrrFeF6.js` | `B` | 901614–901681 | 67 | `d31ff6d26402f67b` | enum des types de récolte |
| `quinoaPredictionAtoms-ptrrFeF6.js` | `Pa` | 901682–901766 | 84 | `91779375067fb700` | enum des types de récolte (avec `Patch`) |
| `LayoutMotionController-CwhDlPns.js` | `J` | 34033–34074 | 41 | `dd3ee78ae847f3f2` | le défaut tout-faux des drapeaux d'affichage |
| `LayoutMotionController-CwhDlPns.js` | `mo` | 34075–37799 | 3724 | `f23bf6500015c470` | table des drapeaux d'affichage |
| `LayoutMotionController-CwhDlPns.js` | `jo` | 41070–42469 | 1399 | `d4798903cb9b7739` | table d'art des mutations |
| `LayoutMotionController-CwhDlPns.js` | `Wo` | 45115–45121 | 6 | `2af88c722bc74230` | plafond d'échelle |
| `LayoutMotionController-CwhDlPns.js` | `qo` | 45553–45557 | 4 | `94a03de41af4609e` | multiplicateur de décalque haut |
| `LayoutMotionController-CwhDlPns.js` | `Ko` | 45483–45552 | 69 | `eec080b429a535a9` | ensemble des mutations superposées |
| `LayoutMotionController-CwhDlPns.js` | `Uo` | 44639–45114 | 475 | `d804033c486c11ad` | table des ancres |
| `LayoutMotionController-CwhDlPns.js` | `Ho` | 44575–44639 | 64 | `4b6b754e22f4609a` | sélecteur d'override par partie |
| `LayoutMotionController-CwhDlPns.js` | `Jo` | 45558–46212 | 654 | `038926f28d291349` | la fonction qui place les icônes de mutation |
| `LayoutMotionController-CwhDlPns.js` | `Go` | 45122–45483 | 361 | `8f4890908db2160f` | la fonction de placement |

### 1192

| Chunk | Déclaration | Intervalle | Octets | sha256 (16) | Ce qu'elle porte |
|---|---|---|---|---|---|
| `worldDepthSortKey-BXUHHrP0.js` | `H` | 614139–615191 | 1052 | `74ccca2655454918` | table des mutations |
| `worldDepthSortKey-BXUHHrP0.js` | `k` | 50898–85278 | 34380 | `5afa90a1f2c38b4e` | table des plantes (écrite `I` dans le chunk, lue `k` par le chunk d'art) |
| `worldDepthSortKey-BXUHHrP0.js` | `Rt` | 6233–8855 | 2622 | `9ea368c65227cd5a` | table des œufs (signature `secondsToHatch`) |
| `worldDepthSortKey-BXUHHrP0.js` | `F` | 50539–50606 | 67 | `4fd97aa526930f27` | enum des types de récolte |
| `worldDepthSortKey-BXUHHrP0.js` | `Rn` | 50607–50691 | 84 | `d1fe960d25523427` | enum des types de récolte (avec `Patch`) |
| `resources-D_3Zwcn-.js` | `F` | 11122–11163 | 41 | `7814afb8e637a2fc` | le défaut tout-faux des drapeaux d'affichage |
| `resources-D_3Zwcn-.js` | `I` | 11164–14887 | 3723 | `b12669e012566145` | table des drapeaux d'affichage |
| `resources-D_3Zwcn-.js` | `xn` | 15155–16354 | 1199 | `f0fe4b48244cb411` | table d'art des mutations (`colorOverlay`) |
| `resources-D_3Zwcn-.js` | `En` | 17170–17176 | 6 | `803dafcef9c1ee4a` | plafond d'échelle |
| `resources-D_3Zwcn-.js` | `kn` | 17610–17614 | 4 | `74ca25134d187274` | multiplicateur de décalque haut |
| `resources-D_3Zwcn-.js` | `On` | 17540–17609 | 69 | `7d49c4f557d2805d` | ensemble des mutations superposées |
| `resources-D_3Zwcn-.js` | `Tn` | 16694–17169 | 475 | `f35fe30fc2ace5f1` | table des ancres |
| `resources-D_3Zwcn-.js` | `wn` | 16630–16694 | 64 | `bf09a3587bbaabeb` | sélecteur d'override par partie |
| `resources-D_3Zwcn-.js` | `An` | 17615–18311 | 696 | `3c0febca5aee5f0e` | la fonction qui place les icônes de mutation |
| `resources-D_3Zwcn-.js` | `Dn` | 17177–17540 | 363 | `7c61d839f8a74b62` | la fonction de placement |
| `BakedRoundedRect-lGFgQzh1.js` | `Nn` | 42884–66636 | 23752 | `faeecc4135ad4832` | table des noms de sprite |

En 1192 la fonction de placement lit la table des plantes sous le nom `k`, qui
est une **liaison d'import** (`k` vient de `worldDepthSortKey`, où la table est
écrite `I`). Le découpage écrit la valeur verbatim **sous le nom que le
consommateur emploie**, et `CUTS.json` porte l'alias (`aliasOf`) : c'est une
liaison, jamais une valeur, et `tests/art-versions.test.js` vérifie que les deux
tables extraites sont identiques.

La valeur n'est écrite **qu'une fois, sous `k`**, et pas sous les deux noms : la
même table sous deux noms ferait deux candidats pour le prédicat de la table des
plantes, et l'extraction refuse deux candidats — c'est son comportement voulu, et
donc une raison de ne pas les produire. Les autres entrées de 1192 gardent le nom
de leur chunk (`H`, `Rn`, `xn`, `Dn`…), parce que c'est celui que le consommateur
emploie aussi.

`ri` (la table des œufs 1176) et `Rt` (la même en 1192) ne sont lues par aucun
prédicat d'art : elles sont coupées parce qu'elles portent `secondsToHatch`, la
signature par laquelle `fetchMainBundle` reconnaît le chunk de données. Sans
elles, le découpage ne serait pas un bundle que le résolveur du fork sait lire,
et le test de route qui sert ces fichiers sur une boucle locale ne pourrait pas
exister.

## Ce que la fixture n'est pas

Ce n'est pas le jeu complet, et ce n'est pas non plus un bundle : les tranches
sont posées les unes après les autres, sans les autres déclarations du chunk. Un
prédicat qui aurait besoin d'autre chose que de ces formes échoue — c'est
justement ce qu'un test de forme doit faire, et c'est ce qui rend la fixture
utile plutôt que commode.

Les frames de sprite, elles, ne viennent **pas** d'ici : les tests d'art
confirment les chemins contre les atlas **1192** déjà figés sous
`tests/fixtures/game/version/1192/assets/atlases/`. C'est volontaire — un
invariant qui ne compare une table qu'à elle-même ne prouve rien, et 1176 comme
1192 servent 109 frames `sprite/plant/*`, les mêmes.

## La règle de décodage du lavage de 1192

1192 écrit la couleur du lavage comme un entier `0xRRGGBB` packé, là où 1176
écrivait une chaîne `rgb(...)`. La règle n'est pas une lecture des nombres :
c'est celle du jeu, dans le code qui consomme ces lavages
(`quinoaAssetResolver-CVtuXws2.js`, fonction `xn()` de la capture 1192), qui
refuse un entier hors de `[0, 0xFFFFFF]` — « Material color overlays require an
RGB color and finite alpha » — et dépaquette en
`(c & 255) << 16 | c & 65280 | c >>> 16 & 255`, soit
`rgb(c >>> 16 & 255, c >>> 8 & 255, c & 255)`. Sous cette règle les neuf
couleurs de 1192 se décodent octet pour octet dans les neuf chaînes de 1176, et
la table d'art des mutations est identique entre les deux versions — c'est ce
que `tests/art-versions.test.js` mesure.
