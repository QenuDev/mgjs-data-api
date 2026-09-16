# Fixtures d'art

Découpage figé du bundle **1176**, pour que les tests d'art tournent hors ligne
et ne dépendent pas de la version que le jeu sert ce jour-là.

## Provenance

Tout vient de la capture du bundle 1176 déjà présente dans l'espace de travail :

```
/home/james/Documents/dsh_workspaces/MG/mgafk-pi/json/bundle-1176-0/
```

C'est la même capture que celle qui a produit `mg.js/packages/art/data/1176.json`
(paquet frère, même jeu lu deux fois) : les deux extractions doivent pouvoir se
comparer table par table, et c'est ce qu'elles font dans les tests.

Régénération :

```bash
node scripts/makeArtFixture.mjs /home/james/Documents/dsh_workspaces/MG/mgafk-pi/json/bundle-1176-0
```

Le script **découpe, il ne réécrit pas**. Chaque tranche est la valeur verbatim
d'un déclarateur, copiée octet pour octet depuis le chunk ; deux choses
seulement sont rétablies autour d'elle pour que le découpage reste du JavaScript
valide : le `var ` d'un déclarateur qui était au milieu d'une chaîne
(`var J={…},mo={…}`) et le `;` qui ferme l'instruction. `CUTS.json` (écrit par le
même script) porte les intervalles et les empreintes, et le test `aucune table
n'est trouvée par un nom minifié` les relit pour vérifier que la source
d'extraction ne cite aucun des symboles ainsi retenus.

## Les fichiers

| Fichier | Octets | sha256 (16) | Chunk du jeu |
|---|---|---|---|
| `LayoutMotionController-CwhDlPns.js` | 7 607 | `cd04c45d85de7cc7` | `LayoutMotionController-CwhDlPns.js` |
| `quinoaPredictionAtoms-ptrrFeF6.js` | 62 760 | `8257aaa2bfab1f24` | `quinoaPredictionAtoms-ptrrFeF6.js` |

Les deux noms sont ceux des chunks réels, empreinte de contenu comprise, pour que
la fixture se lise comme la capture dont elle vient — et parce que la provenance
publiée par `/data/art` nomme le fichier du chunk lu.

## Les tranches

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

`ri` (la table des œufs) n'est lue par aucun prédicat d'art : elle est coupée
parce qu'elle porte `secondsToHatch`, la signature par laquelle
`fetchMainBundle` reconnaît le chunk de données. Sans elle, le découpage ne
serait pas un bundle que le résolveur du fork sait lire, et le test de route qui
sert ces fichiers sur une boucle locale ne pourrait pas exister.

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
