/* GharSe service worker — hand-rolled, no build-step dependency.
 * Strategy:
 *  - navigations: network-first, offline fallback to /offline
 *  - static assets & images: stale-while-revalidate
 *  - API calls: network only (never cache orders/payments)
 */
const VERSION = 'gharse-v1';
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icon.svg', '/placeholder-dish.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) return; // network only

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)),
      ),
    );
    return;
  }

  // stale-while-revalidate for same-origin static assets + remote images
  if (
    url.origin === self.location.origin ||
    url.hostname === 'images.unsplash.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const fetched = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fetched;
      }),
    );
  }
});
