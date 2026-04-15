const CACHE_NAME = 'handl-shell-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js',
  '/automerge.js',
  '/manifest.json',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isShellAsset =
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname === '/main.js' ||
    url.pathname === '/style.css' ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/automerge.js' ||
    url.pathname.startsWith('/vendor/automerge/');
  if (isShellAsset) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
