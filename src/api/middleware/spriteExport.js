// src/api/middleware/spriteExport.js

import { config } from "../../config/index.js";

/**
 * Répond 503 aux routes d'images quand cette instance ne produit pas d'images.
 *
 * Le profil `data` (`SPRITES_PROFILE=data`) ne démarre ni export de sprites ni
 * export de boucles d'animation. Ses routes d'images n'ont donc rien de vrai à
 * servir :
 *
 * - répondre 404 dirait « ce sprite n'existe pas », alors qu'il existe sur
 *   l'instance qui exporte ;
 * - servir le disque quand même servirait les images de la *version précédente*
 *   sur un hôte qui ne suit plus les mises à jour du jeu, avec un 200 et un
 *   `Cache-Control: max-age=86400` par-dessus.
 *
 * Un 503 dit exactement ce qui se passe : ce n'est pas cette instance qui rend
 * ce service, elle ne le rendra pas, et l'appelant doit demander à une autre.
 * Le corps nomme le profil et la variable qui le règle, parce qu'un client qui
 * reçoit un 503 sans explication ne peut pas décider s'il doit réessayer.
 *
 * Posé avant les routeurs d'images dans `src/api/routes/assets.js`, donc il
 * couvre `/assets/sprites`, `/assets/sprites/:category/:name`,
 * `/assets/sprites/composed`, `/assets/animations` et `/assets/rive` d'un seul
 * point.
 */
export function requireSpriteExport(req, res, next) {
  if (config.sprites.routesEnabled) return next();

  res.status(503).json({
    error: {
      code: "SPRITES_PROFILE",
      message:
        "This instance does not export sprites (SPRITES_PROFILE=data): it serves " +
        "/data, /live and /stats only. Ask an instance running SPRITES_PROFILE=full for sprite and animation files.",
      details: {
        profile: config.sprites.profile,
        path: req.originalUrl,
      },
    },
  });
}
