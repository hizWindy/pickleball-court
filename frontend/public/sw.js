// HousePickle service worker.
//
// Two caches:
//  - ASSETS keeps the hashed build files (/assets/app-3fa9c1.js). A changed file has a new name, so they never go
//    stale, and they are kept across versions: a page opened before a deploy can still load its own files.
//  - SHELL holds the app page, icons and images, and is replaced on every version bump.
//
// Pages are network-first (so a deploy shows up straight away), hashed files are cache-first, images are served
// from the cache and refreshed in the background. The booking API is never touched.
const VERSION = 'housepickle-v8';
const SHELL = `${VERSION}-shell`;
const ASSETS = 'housepickle-assets';
const MAX_ASSETS = 160;

const SHELL_FILES = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/favicon.svg',
  '/housepickle-emblem.svg',
  '/images/player-cutout-1.webp',
  '/images/player-cutout-2.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch((err) => console.warn('[SW] Pre-cache skipped:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== SHELL && key !== ASSETS) await caches.delete(key);
      }
      // Build files pile up over many deploys: drop the oldest once there are plenty.
      const assets = await caches.open(ASSETS);
      const keys = await assets.keys();
      if (keys.length > MAX_ASSETS) await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map((k) => assets.delete(k)));
      await self.clients.claim();
    })()
  );
});

/** A real, same-origin answer that isn't an error page. The server used to answer a missing image with the app page. */
const cacheable = (res) =>
  res && res.ok && res.type === 'basic' && !(res.headers.get('content-type') || '').includes('text/html');

async function put(cacheName, request, res) {
  const cache = await caches.open(cacheName);
  await cache.put(request, res);
}

async function cacheFirst(request, cacheName, mayCache = cacheable) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (mayCache(res)) put(cacheName, request, res.clone());
  return res;
}

async function networkFirst(request, fallback) {
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') put(SHELL, request, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;
    if (fallback) {
      const page = await caches.match(fallback);
      if (page) return page;
    }
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const hit = await caches.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (cacheable(res)) put(SHELL, request, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) return hit;
  return (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  // Fonts from Google: kept for good.
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, ASSETS, (res) => res && res.ok));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Availability and bookings must always be live.
  if (url.pathname.startsWith('/api/')) return;

  // Hashed build files.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }

  // The payment QR decides which account gets paid: always ask the server, use the saved one only offline.
  if (url.pathname.startsWith('/images/payment-qr')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Other images and icons: instant from the cache, refreshed in the background.
  if (/\.(?:png|jpe?g|webp|svg|ico|woff2)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Pages (the site, /admin), manifests: network first, the saved page when offline.
  event.respondWith(networkFirst(request, '/'));
});
