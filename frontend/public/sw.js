/* Lavio - service worker (offline-first)
 *
 * - App shell: precarga las paginas de la app y los scripts/estilos que referencian, para abrirla sin red.
 * - Paginas: red primero (siempre la version mas nueva con conexion), cache si no hay red.
 * - /_next/static/*: cache primero (nombres con hash = inmutables).
 * - Fotos (/api/uploads/*): cache primero con limite.
 * - /api/* NUNCA se cachea aqui: los datos los guarda React Query (IndexedDB) y los cambios, la cola de sincronizacion.
 * - Background Sync: al volver la red avisa a las ventanas abiertas para vaciar la cola.
 */
const VERSION = 'v23';
const SHELL = `lavio-shell-${VERSION}`;
const STATIC = 'lavio-static';
const PHOTOS = 'lavio-photos';
const MAX_PHOTOS = 150;

// Todas son paginas estaticas (sin parametros en la ruta): el detalle de orden usa /orders/detail?id=...
const ROUTES = [
  '/', '/login', '/track', '/dashboard', '/pos', '/orders', '/orders/detail', '/washer', '/services', '/clients',
  '/inventory', '/inventory/products', '/inventory/movements', '/purchases', '/suppliers', '/users', '/settings', '/cash', '/cash/session', '/finance',
  '/platform', '/platform/users', '/platform/clients', '/platform/orders', '/platform/roles', '/platform/menu',
];
const ASSETS = ['/offline.html', '/manifest.webmanifest', '/brand/lavio-mark.png', '/brand/lavio-full.png', '/icon-192.png', '/icon-512.png'];

async function warm() {
  const shell = await caches.open(SHELL);
  const stat = await caches.open(STATIC);
  await Promise.allSettled(ASSETS.map((a) => shell.add(a)));
  await Promise.allSettled(
    ROUTES.map(async (route) => {
      const res = await fetch(route, { cache: 'reload' });
      if (!res.ok || res.redirected) return;
      await shell.put(route, res.clone());
      const html = await res.text();
      const urls = [...new Set(html.match(/\/_next\/static\/[^"'\\\s)]+\.(?:js|css)/g) || [])];
      await Promise.allSettled(
        urls.map(async (u) => {
          if (await stat.match(u)) return;
          const r = await fetch(u);
          if (r.ok) await stat.put(u, r);
        }),
      );
    }),
  );
}

self.addEventListener('install', (e) => {
  e.waitUntil(warm().catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, STATIC, PHOTOS].includes(k)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'WARM') e.waitUntil(warm().catch(() => undefined));
});

self.addEventListener('sync', (e) => {
  if (e.tag === 'lavio-sync') {
    e.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'SYNC' }))),
    );
  }
});

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function photoFirst(req) {
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    if (keys.length > MAX_PHOTOS) await cache.delete(keys[0]); // descarta la mas antigua
  }
  return res;
}

async function navigate(req) {
  const cache = await caches.open(SHELL);
  const path = new URL(req.url).pathname;
  try {
    // Con red mala (lie-fi) no se espera eternamente: a los 4 s se usa la copia guardada
    const res = await withTimeout(fetch(req), 4000);
    if (res.ok && !res.redirected && ROUTES.includes(path)) cache.put(path, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(path)) || (await cache.match(req, { ignoreSearch: true }));
    return hit || (await caches.match('/offline.html')) || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) return e.respondWith(cacheFirst(req, STATIC));
  if (url.pathname.startsWith('/api/uploads/')) return e.respondWith(photoFirst(req));
  if (url.pathname.startsWith('/api/')) return; // datos: nunca desde el service worker
  if (req.mode === 'navigate') return e.respondWith(navigate(req));
  if (/\.(?:png|jpe?g|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) return e.respondWith(cacheFirst(req, SHELL));
});
