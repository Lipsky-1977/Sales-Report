const APP_VERSION = '3.3.0';
const CACHE_NAME = `second-gravity-sales-v${APP_VERSION}`;
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.svg',
  './icon-512.svg',
  './Logo.png',
  './assets/css/v3-ui.css',
  './assets/js/app.bundle.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isNavigation = event.request.mode === 'navigate';
  const isCoreAsset = sameOrigin && CORE_ASSETS.some(asset => url.pathname.endsWith(asset.replace('./', '/')) || asset === './');

  if (isNavigation || isCoreAsset) {
    event.respondWith(networkFirst(event.request, './index.html'));
    return;
  }
  if (sameOrigin) {
    event.respondWith(networkFirst(event.request));
    return;
  }
});

async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      return response;
    }
    throw new Error('Response not OK');
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallback) return caches.match(fallback);
    return new Response('Offline', { status: 503 });
  }
}
