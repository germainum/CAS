// Service worker : rend l'app lançable hors ligne.
// Il ne met en cache que la coque de l'application (même origine).
// Les données météo/hydro passent par le réseau et sont mises en cache
// côté application (localStorage), avec leur horodatage.

const CACHE = 'leman-shell-v2';

const SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'sources.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll échoue en bloc : on tolère un fichier manquant.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // API : réseau direct

  // Données du modèle : réseau d'abord, sinon le dernier instantané en cache.
  // Les servir depuis le cache en priorité figerait la température affichée.
  if (url.pathname.endsWith('/data/model.json')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || Response.error()))
    );
    return;
  }

  // Coque : réponse immédiate depuis le cache, mise à jour en arrière-plan.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => cached || caches.match('index.html'));
      return cached || network;
    })
  );
});
