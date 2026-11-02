// Fleet Film service worker
// Network-first: when online, users always get the latest files from the server.
// The cache is only used as an offline fallback, so no one gets stuck on an old version.
const CACHE = 'fleetfilm-v2';
const LEGACY_CACHES = ['fleetfilm-v1']; // old cache-first worker that trapped users on stale files
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/updater.js',
  './js/display.js',
  './version.json',
  './js/firebase-config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './img/FFLogo.png',
  './img/FFIcon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .catch(() => {})            // never block install on a missing asset
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const hadLegacy = keys.some(k => LEGACY_CACHES.includes(k));
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // Pages loaded by the old worker don't know how to update themselves, so reload them once.
    if (hadLegacy) {
      const wins = await self.clients.matchAll({ type: 'window' });
      wins.forEach(w => { try { w.navigate(w.url); } catch {} });
    }
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // Firebase, TMDB etc. go straight to network
  if (url.pathname.endsWith('/version.json')) return;   // always live

  e.respondWith((async () => {
    try {
      // 'no-cache' revalidates with the server instead of trusting the browser's HTTP cache
      const fresh = await fetch(req, { cache: 'no-cache' });
      if (fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw new Error('offline');
    }
  })());
});
