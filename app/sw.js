// Offline-Fähigkeit: App-Dateien aus dem Cache, Daten immer zuerst frisch aus dem Netz.
const VERSION = 'puls-v2.0.0';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'engine.js', 'charts.js', 'crypto.js', 'demo.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.endsWith('/data.enc.json')) {
    // Netz zuerst, sonst letzter Stand
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(new Request(url.pathname), copy));
          }
          return res;
        })
        .catch(() => caches.match(new Request(url.pathname)).then((r) => r || Response.error())),
    );
    return;
  }

  // App-Dateien: Netz zuerst (damit Updates sofort ankommen), offline aus dem Cache
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
