// ZeroNetPay service worker — caches the app shell so the PWA loads
// even with no internet (so you can receive offline payments after the
// receiver puts the phone in airplane mode).

const CACHE = 'znp-v25';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/app.js',
  '/js/api.js',
  '/js/util.js',
  '/js/store.js',
  '/js/qr.js',
  '/js/views/onboarding.js',
  '/js/views/home.js',
  '/js/views/load.js',
  '/js/views/pay.js',
  '/js/views/receive.js',
  '/js/views/history.js',
  '/js/views/settings.js',
  '/js/views/disburse.js',
  '/js/views/cashout.js',
  '/js/biometric.js',
  '/js/lock.js',
  '/js/views/lock.js',
  '/js/views/notifications.js',
  '/config.js',
  '/vendor/qrcode-generator.js',
  '/vendor/jsQR.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Use addAll, but tolerate individual misses (e.g. if PNG icons absent in dev)
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((e) => console.warn('SW skip', url, e.message)),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Network-first for API: API responses must be live and never cached.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(() => new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )));
    return;
  }

  // Cache-first for everything else (the PWA shell).
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            // Cache successful, same-origin responses for next time.
            if (res && res.ok && url.origin === location.origin) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() =>
            // Last resort: serve index.html so SPA navigations work offline.
            caches.match('/index.html'),
          ),
    ),
  );
});
