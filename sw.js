// Service worker : rend l'app lançable hors ligne.
// Il ne s'occupe que des ressources de même origine — coque et instantané du
// modèle. Les API externes passent directement par le réseau, et leurs données
// sont mises en cache côté application (localStorage), avec leur horodatage.

const CACHE = 'leman-shell-v5';

const SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'sources.js',
  'bath.js',
  'lakemap.js',
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

// Réseau d'abord, cache en secours — pour la coque comme pour les données.
//
// Le cache d'abord serait plus rapide, mais il a fait servir une version périmée
// de l'app pendant des heures sur un appareil déjà installé : l'utilisateur voyait
// un ancien code incapable de lire les données publiées, sans aucun moyen de le
// savoir. Sur une app dont tout l'intérêt est d'afficher une valeur à jour, la
// fraîcheur passe avant les quelques dizaines de millisecondes gagnées — et le
// cache continue d'assurer le lancement hors ligne.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // API : réseau direct

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        // Navigation hors ligne vers une URL non cachée : on rend la page d'accueil.
        return request.mode === 'navigate' ? caches.match('index.html') : Response.error();
      }))
  );
});
