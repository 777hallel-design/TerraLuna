// Offline support: app shell cached on install, data and feeds refreshed in the background.
const CACHE = 'terraluna-v2';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'js/core.js', 'js/i18n.js', 'js/ics.js', 'js/astro.js',
  'manifest.webmanifest', 'icons/icon.svg', 'data/index.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request);
    const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  }));
});
