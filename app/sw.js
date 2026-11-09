// Offline-Fähigkeit: App-Dateien aus dem Cache, Daten immer zuerst frisch aus dem Netz.
const VERSION = 'puls-v4.3.1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'engine.js', 'charts.js', 'crypto.js', 'demo.js', 'coach.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'fonts/barlow-condensed-latin-500-normal.woff2', 'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2', 'fonts/barlow-condensed-latin-800-normal.woff2',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' – nie eine alte Kopie aus dem Browser-Zwischenspeicher übernehmen
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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

  // App-Dateien: Netz zuerst und immer beim Server nachfragen (no-cache), offline aus dem Cache
  e.respondWith(
    fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
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

// Benachrichtigungen (vom Garmin-Abruf in GitHub Actions geschickt)
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: 'Puls', body: e.data?.text() || '' };
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Puls', {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: data.tag || 'puls',
      data: { url: data.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope)) return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
