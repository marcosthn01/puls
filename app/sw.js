// Schneller Start: App-Dateien sofort aus dem Speicher (im Hintergrund aufgefrischt),
// Daten zuerst aus dem Netz – aber höchstens 2,5 s warten, sonst erst der letzte Stand.
// Neue Versionen kommen über eine neue VERSION: Installieren lädt alles frisch, die App lädt sich einmal neu.
const VERSION = 'puls-v5.9.1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'engine.js', 'charts.js', 'crypto.js', 'demo.js', 'coach.js', 'hud.js', 'training.js', 'lifestyle.js', 'sport.js',
  'infekt.js', 'widget.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'fonts/barlow-condensed-latin-500-normal.woff2', 'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2', 'fonts/barlow-condensed-latin-800-normal.woff2',
];
const DATA_WAIT_MS = 2500;

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

/** Gespeicherte Antwort, markiert als „älterer Stand“ (die App lädt dann gleich nochmal). */
async function stale(res) {
  const headers = new Headers(res.headers);
  headers.set('x-puls-stale', '1');
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

function dataResponse(e, url) {
  const key = new Request(url.pathname);
  const net = fetch(e.request, { cache: 'no-store' }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(key, copy));
    }
    return res;
  });
  e.waitUntil(net.then(() => {}, () => {})); // Netz im Hintergrund zu Ende laden, auch nach der Antwort
  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => {
      if (!done) {
        done = true;
        resolve(res);
      }
    };
    const fromCache = async () => {
      const cached = await caches.match(key);
      if (cached) finish(await stale(cached));
      return !!cached;
    };
    const timer = setTimeout(fromCache, DATA_WAIT_MS);
    net.then(
      (res) => {
        clearTimeout(timer);
        finish(res);
      },
      async () => {
        clearTimeout(timer);
        if (!(await fromCache())) finish(Response.error());
      },
    );
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.endsWith('/data.enc.json')) {
    e.respondWith(dataResponse(e, url));
    return;
  }

  // App-Dateien: sofort aus dem Speicher, im Hintergrund beim Server nachfragen
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const net = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          // Aufrufe aus dem Widget (?tab=…, ?log=…) nicht einzeln speichern
          caches.open(VERSION).then((c) => c.put(url.search && e.request.mode === 'navigate' ? url.origin + url.pathname : e.request, copy));
        }
        return res;
      });
      if (cached) {
        e.waitUntil(net.then(() => {}, () => {}));
        return cached;
      }
      return net.catch(() => (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    }),
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
        if (c.url.startsWith(self.registration.scope)) {
          c.postMessage({ type: 'open', url });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
