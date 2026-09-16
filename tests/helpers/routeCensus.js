// tests/helpers/routeCensus.js
//
// Le recensement des chemins que l'app monte vraiment, dérivé de l'app et non
// d'une liste recopiée : une liste tenue à la main dans un test ne voit pas la
// route qu'on vient d'ajouter, donc elle ne peut pas faire échouer la dérive
// qu'elle est censée attraper.
//
// Express ne garde pas le préfixe d'un routeur monté. `app.use("/assets", r)`
// compile le chemin dans une fermeture (`router/lib/layer.js` construit
// `this.matchers` autour de `path` sans le conserver), donc `app.router.stack`
// sait *qu'un* routeur est monté et quel est son nom, jamais sous quel
// préfixe. La seule chose qui le sache est l'appel qui l'a monté.
//
// On enregistre donc ces appels en instrumentant momentanément le prototype des
// routeurs, le temps de la construction de l'app :
//   - `Router.prototype.use`   : tous les montages, app comprise — `app.use`
//     délègue à `app.router.use` (`express/lib/application.js`) ;
//   - `Router.prototype.route` : toutes les routes, app comprise — `app.get`
//     délègue à `app.router.route`.
// Le prototype est restauré avant que le moindre handler ne tourne.
//
// L'instrumentation doit être posée *avant* le premier import de
// `src/api/server.js` : les modules de routes enregistrent leurs chemins à
// l'évaluation du module (`export const dataRouter = express.Router()` puis
// `dataRouter.get(...)`), pas dans `createApp()`. C'est pourquoi ce helper
// importe `server.js` dynamiquement et pourquoi son appelant l'appelle au
// niveau du module, avant ses `test()`.
//
// Un recensement partiel serait pire que pas de recensement : le test
// « monté ⊆ documenté » passerait à vide. D'où le contrôle de complétude en fin
// de fonction, qui compare ce qui a été enregistré au nombre de couches de
// route réellement présentes dans les piles des routeurs.

import express from "express";

/** `/weather-station/day/:date` -> `/weather-station/day/{date}`, la forme du document. */
const documentedForm = (path) => path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

/**
 * Le prototype qui porte `use` et `route` sur les routeurs d'Express.
 *
 * Il n'est pas à un niveau fixe de la chaîne (`Object.getPrototypeOf(
 * express.Router())` n'est pas `Router.prototype`) : on remonte jusqu'à celui
 * qui porte les deux méthodes. Introuvable = Express a changé de forme, et le
 * test doit le dire plutôt que rendre une liste vide.
 */
function routerPrototype() {
  let proto = Object.getPrototypeOf(express.Router());
  while (proto && !(Object.hasOwn(proto, "use") && Object.hasOwn(proto, "route"))) {
    proto = Object.getPrototypeOf(proto);
  }
  if (!proto) throw new Error("routeCensus: prototype de routeur introuvable");
  return proto;
}

/** Concatène un préfixe de montage et un chemin de route, sans slash doublé. */
function joinPath(prefix, path) {
  if (!prefix) return path;
  if (path === "/") return prefix;
  return prefix.replace(/\/+$/, "") + path;
}

/**
 * Les chemins montés par `createApp()`, en forme documentée (`{param}`) et
 * triés. Chaque chemin vient d'un montage réel : router sous son préfixe,
 * route sous le chemin de son router.
 */
export async function captureMountedPaths() {
  const proto = routerPrototype();
  const originalUse = proto.use;
  const originalRoute = proto.route;

  const mounts = [];
  const routePaths = new Map();

  proto.use = function (...args) {
    const [first, ...rest] = args;
    const isMount = typeof first !== "function";
    const prefixes = Array.isArray(first) ? first.map(String) : [isMount ? String(first) : "/"];
    const handlers = isMount ? rest : args;

    for (const handler of handlers.flat(Infinity)) {
      // Un routeur est le seul handler qui porte une pile de routes ;
      // `helmet()`, `express.json()` et les middlewares n'en ont pas.
      if (typeof handler === "function" && Array.isArray(handler.stack)) {
        for (const prefix of prefixes) mounts.push({ parent: this, prefix, child: handler });
      }
    }

    return originalUse.apply(this, args);
  };

  proto.route = function (path) {
    if (!routePaths.has(this)) routePaths.set(this, []);
    routePaths.get(this).push(path);
    return originalRoute.call(this, path);
  };

  let app;
  try {
    const { createApp } = await import("../../src/api/server.js");
    app = createApp();
  } finally {
    proto.use = originalUse;
    proto.route = originalRoute;
  }

  const children = new Map();
  for (const mount of mounts) {
    if (!children.has(mount.parent)) children.set(mount.parent, []);
    children.get(mount.parent).push(mount);
  }

  const paths = new Set();
  const walk = (router, prefix) => {
    for (const path of routePaths.get(router) ?? []) paths.add(joinPath(prefix, path));
    for (const mount of children.get(router) ?? []) walk(mount.child, joinPath(prefix, mount.prefix));
  };
  walk(app.router, "");

  // Contrôle de complétude : chaque `route(path)` enregistré a posé une couche
  // de route dans la pile de son routeur. Si les deux nombres divergent,
  // l'instrumentation a raté des enregistrements et la liste est partielle.
  const routers = new Set([app.router, ...routePaths.keys()]);
  for (const mount of mounts) {
    routers.add(mount.parent);
    routers.add(mount.child);
  }
  const layers = [...routers].reduce(
    (total, router) => total + (router.stack ?? []).filter((layer) => layer.route).length,
    0
  );
  const recorded = [...routePaths.values()].reduce((total, list) => total + list.length, 0);
  if (recorded !== layers) {
    throw new Error(
      `routeCensus: recensement incomplet (${recorded} routes enregistrées, ${layers} couches de route)`
    );
  }

  return [...paths].map(documentedForm).sort();
}
