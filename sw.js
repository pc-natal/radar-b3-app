// Radar B3: funciona offline com a última versão baixada; dados sempre tentam a rede primeiro.
const CACHE = 'radarb3-v1';
const BASE = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icone-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: u.pathname.includes('/data/')})));
});
