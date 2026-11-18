// Amatu Maps · service worker: the app itself (page, scripts, styles, SPBU data) for a start without signal.
// Map tiles are cached by js/offline.js (Cache Storage), not here. Built by build.sh (version + file list).
const V = 'b0a522680b73', SHELL = 'amatu-maps-shell-' + V, EXT = 'amatu-maps-ext', DATA = 'amatu-maps-data';
const FILES = ["./","./index.html","./vendor/maplibre-gl.css?v=b0a522680b73","./app.css?v=b0a522680b73","./vendor/maplibre-gl.js?v=b0a522680b73","./js/util.js?v=b0a522680b73","./js/geo.js?v=b0a522680b73","./js/heading.js?v=b0a522680b73","./js/mvt.js?v=b0a522680b73","./js/style.js?v=b0a522680b73","./js/search.js?v=b0a522680b73","./js/ovt.js?v=b0a522680b73","./js/links.js?v=b0a522680b73","./js/offline.js?v=b0a522680b73","./js/route.js?v=b0a522680b73","./js/poi.js?v=b0a522680b73","./js/store.js?v=b0a522680b73","./js/mapui.js?v=b0a522680b73","./js/panels.js?v=b0a522680b73","./js/nav.js?v=b0a522680b73","./js/app.js?v=b0a522680b73"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('amatu-maps-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});
function timeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
async function netFirst(req, cacheName, ms, fallback) {
  try {
    const res = await timeout(fetch(req), ms);
    if (res && res.ok) { const c = res.clone(); caches.open(cacheName).then(ca => ca.put(req, c)).catch(() => { }); }
    return res;
  } catch (e) {
    const hit = await caches.match(req, { ignoreSearch: true }) || (fallback && await fallback());
    if (hit) return hit;
    throw e;
  }
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  const base = new URL('./', self.registration.scope).pathname;          // /maps/
  if (req.mode === 'navigate') {
    if (!u.pathname.startsWith(base)) return;
    e.respondWith(netFirst(req, SHELL, 7000, () => caches.match(base + 'index.html', { ignoreSearch: true })));
    return;
  }
  if (u.pathname === '/amatu.js') { e.respondWith(netFirst(req, EXT, 7000)); return; }
  if (!u.pathname.startsWith(base)) return;
  if (u.pathname.startsWith(base + 'data/')) {                            // SPBU data: newest when online, saved copy offline
    e.respondWith(netFirst(req, DATA, 8000));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok && u.search.includes('v=')) { const c = res.clone(); caches.open(SHELL).then(ca => ca.put(req, c)).catch(() => { }); }
    return res;
  })));
});
