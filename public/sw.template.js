/* PadosiPlate service worker — hand-rolled, no build-step framework dependency.
 *
 * Cache name is stamped at build time from package.json's version plus a
 * fresh build id (see scripts/gen-sw.mjs, run by the "prebuild" npm
 * script) into the generated public/sw.js — this file is the source of
 * truth, public/sw.js is a build artifact (gitignored). Every deploy gets
 * its own cache name, so activate() always sweeps every older one: no
 * manual cache-busting, no stale assets surviving a release.
 *
 * Strategy:
 *  - navigations (HTML) & /api/* GET calls: network-first — always try the
 *    network, and only fall back to the last cached copy (or the offline
 *    shell, for navigations) when the network is unreachable. Mutating
 *    requests (POST/PUT/etc.) are never intercepted, so orders/payments
 *    always hit the network directly.
 *  - static assets & remote images: cache-first — instant repeat loads;
 *    a new build's cache-bust is what picks up changes, not per-request
 *    revalidation.
 */
const VERSION = '__SW_CACHE_VERSION__';
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

// Lets the page (src/components/sw-register.tsx) force this worker to take
// over immediately once the visitor accepts the "Update available" prompt,
// instead of waiting for every open tab to close on its own.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' || url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    url.origin === self.location.origin ||
    url.hostname === 'images.unsplash.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return (await cache.match(OFFLINE_URL)) || Response.error();
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}
