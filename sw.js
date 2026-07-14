const VERSION = 'skyline-vr-fable-1.0.0';
const CORE = ['./', './index.html', './styles.css', './bundle.js', './game.js', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './vendor/three.module.min.js', './vendor/three.core.min.js'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(CORE)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('skyline-vr') && key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Network-first is intentional: every GitHub upload should appear without an old game being trapped in cache.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const cache = await caches.open(VERSION);
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        if (event.request.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
        return Response.error();
      }
    })()
  );
});
