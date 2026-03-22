// Service Worker: cache shell, network-only for streams/api
const CACHE_NAME = 'lil-play-v1';
const SHELL_URLS = ['/', '/admin'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Don't pre-cache shell since it requires site token
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always network-only for: api, stream, admin api
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/stream/') ||
    url.pathname.startsWith('/admin/api/') ||
    url.pathname.startsWith('/admin/login') ||
    url.pathname.startsWith('/admin/logout')
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for shell pages
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
