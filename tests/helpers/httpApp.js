// tests/helpers/httpApp.js
//
// Démarre l'app Express sur un port éphémère pour les tests de routes.
//
// Rien de plus que `createApp()` + `listen(0)` : les services de fond (poller
// live, watcher de version, recorder d'historique) ne sont lancés que par
// `src/index.js`, donc les tests n'héritent ni de l'export de sprites ni du
// polling. L'import de `src/api/server.js` est dynamique pour que l'appelant
// puisse poser les variables d'environnement avant que `config` ne les lise.

export async function startTestApp() {
  const { createApp } = await import("../../src/api/server.js");
  const app = createApp();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    app,
    server,
    baseUrl,
    get: (path, init) => fetch(`${baseUrl}${path}`, init),
    async close() {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}
