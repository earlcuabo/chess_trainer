// Offline support: network first so updates show up right away, falling back
// to the cached copy when there is no connection.
const CACHE = 'chess-trainer-v2';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'data/openings.json',
  'src/app.js',
  'src/drill.js',
  'src/freeplay.js',
  'src/line.js',
  'src/queue.js',
  'src/srs.js',
  'src/storage.js',
  'vendor/chess.js/chess.js',
  'vendor/chessground/chessground.min.js',
  'vendor/chessground/chessground.base.css',
  'vendor/chessground/chessground.brown.css',
  'vendor/chessground/chessground.cburnett.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? Response.error())),
  );
});
