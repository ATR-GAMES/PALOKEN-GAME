// Guarda el juego en el teléfono para poder jugar VS Máquina sin conexión.
// - La página (index.html): primero red, si falla usa la copia guardada.
// - Archivos del build (con hash), fuentes y PeerJS: primero la copia guardada.
// El online (servidor de PeerJS / WebRTC) nunca pasa por aquí.
const CACHE = 'paloken';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Bangers&display=swap';
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];
const INDEX = new URL('./', self.location).href;

const localUrls = html => [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
  .map(m => new URL(m[1], INDEX).href)
  .filter(u => u.startsWith(self.location.origin));

async function cacheFonts(cache) {
  try {
    const res = await fetch(FONT_CSS);
    const css = await res.clone().text();
    await cache.put(FONT_CSS, res);
    const fonts = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(fonts.map(u => cache.match(u).then(hit => hit || cache.add(u))));
  } catch { /* sin fuentes se usa la de respaldo */ }
}

// borra versiones viejas del build que ya no usa la página actual
async function prune(cache, html) {
  const keep = new Set(localUrls(html));
  for (const req of await cache.keys()) {
    if (req.url.includes('/assets/') && !keep.has(req.url)) await cache.delete(req);
  }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch(INDEX, { cache: 'no-cache' });
    const html = await res.clone().text();
    await cache.put(INDEX, res);
    await Promise.all(localUrls(html).map(u => cache.add(u).catch(() => {})));
    await cacheFonts(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const local = url.origin === self.location.origin;
  if (!local && !CACHEABLE_HOSTS.includes(url.hostname)) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        // si la red tarda más de 4 s (señal mala) se usa la copia guardada
        const res = await Promise.race([fetch(req), new Promise(r => setTimeout(() => r(null), 4000))]);
        if (!res) throw new Error('lento');
        if (res.ok) {
          const html = await res.clone().text();
          await cache.put(INDEX, res.clone());
          prune(cache, html);
        }
        return res;
      } catch {
        return (await cache.match(INDEX, { ignoreVary: true })) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  })());
});
