// Amatu Maps · offline map: every map request (vector tiles, satellite, terrain, fonts, sprites) goes through the
// "amtc://" protocol, which answers from Cache Storage first and keeps what it downloads. A chosen route is saved
// along its whole length on its own (tiles of the corridor at the zooms navigation uses), so the map keeps drawing
// and the arrow keeps moving when the signal is gone. GPS needs no data.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U, G = AM.G;
  const HOST = /^https:\/\/(tiles\.openfreemap\.org|server\.arcgisonline\.com|s3\.amazonaws\.com\/elevation-tiles-prod)\//;
  const LIVE = /^https:\/\/tiles\.openfreemap\.org\/planet\/?$/;        // TileJSON: newest tile set first
  const RUN = 'amatu-maps-tiles', ROUTE = 'amatu-maps-route-', MAX_RUN = 3500, KEEP_ROUTES = 3;
  const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
  const has = typeof caches !== 'undefined' && window.isSecureContext;

  let runP = null, puts = 0, trimming = false;
  const run = () => runP || (runP = caches.open(RUN));
  async function store(url, res) {
    try {
      const c = await run(); await c.put(url, res);
      if (++puts % 200 === 0) trim();
    } catch (e) { /* quota / private mode */ }
  }
  async function trim() {
    if (trimming) return; trimming = true;
    try {
      const c = await run(), ks = await c.keys();
      if (ks.length > MAX_RUN) for (const k of ks.slice(0, ks.length - Math.round(MAX_RUN * 0.85))) await c.delete(k);
    } catch (e) { /* */ }
    trimming = false;
  }
  const read = (res, type) => type === 'json' ? res.json() : type === 'string' ? res.text() : res.arrayBuffer();
  let fails = 0, lastOk = Date.now();
  async function get(url, type, signal) {
    const live = LIVE.test(url);
    if (has && !live) { const hit = await caches.match(url).catch(() => null); if (hit) { O.hits++; return read(hit, type); } }
    try {
      const res = await fetch(url, { signal, credentials: 'omit' });
      if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
      if (has && res.status === 200) store(url, res.clone());
      fails = 0; lastOk = Date.now(); O.net(true);
      return read(res, type);
    } catch (e) {
      if (signal && signal.aborted) throw e;
      if (has && live) { const hit = await caches.match(url).catch(() => null); if (hit) return read(hit, type); }
      if (!e.status) { fails++; if (fails >= 3) O.net(false); }
      throw e;
    }
  }

  // tiles of a route corridor, nearest to `from` first: [template, zoom, half-width m, how far (m) at this detail]
  function plan(sat) {
    const vt = AM.Q.tileTpl && AM.Q.tileTpl();
    const p = [];
    // wide enough for the tilted driving camera (it sees ±1–2 km to the sides and far ahead at lower zooms)
    if (vt) [[14, 1500], [13, 2600], [12, 4200], [11, 6000], [10, 9000], [9, 14000], [8, 20000]].forEach(([z, r]) => p.push([vt, z, r, Infinity]));
    if (sat) [[17, 140, 30000], [16, 300, 90000], [15, 750, Infinity], [14, 1500, Infinity], [13, 2700, Infinity], [12, 4500, Infinity]].forEach(([z, r, far]) => p.push([SAT, z, r, far]));
    return p;
  }
  function routeTiles(r, o = {}) {
    const out = [], seen = new Set(), from = Math.max(0, o.from || 0), limit = o.limit || 4500;
    const add = (tpl, z, x, y) => { const u = tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y); if (!seen.has(u)) { seen.add(u); out.push(u); } };
    const P = plan(o.sat), step = 120, stop = Math.min(r.dist + step, o.upto ? from + o.upto : Infinity);
    for (let s = from; s <= stop && out.length < limit; s += step) {
      const p = G.at(r.coords, r.cum, Math.min(s, r.dist)).pt;
      const k = G.kxy(p[1]);
      for (const [tpl, z, R, far] of P) {
        if (s - from > far && r.dist - s > 4000) continue;               // the last 4 km (arrival) in full detail too
        const dx = R / k[0], dy = R / k[1];
        const [x0, y0] = G.tile(p[0] - dx, p[1] + dy, z), [x1, y1] = G.tile(p[0] + dx, p[1] - dy, z);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) add(tpl, z, x, y);
      }
    }
    for (const f of FONTS) add('https://tiles.openfreemap.org/fonts/' + encodeURIComponent(f) + '/0-255.pbf', 0, 0, 0);
    return out;
  }
  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
  }
  const listeners = new Set();
  const emit = U.throttle(() => listeners.forEach(f => { try { f(O.state); } catch (e) { /* */ } }), 250);

  const O = AM.O = {
    ok: has, hits: 0, online: navigator.onLine, state: null,
    // MapLibre transformRequest: map hosts → amtc:// (handled below, in the page, with the cache)
    transform(url) { return has && HOST.test(url) ? { url: 'amtc' + url.slice(5) } : undefined; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    net(up) {
      const v = up && navigator.onLine;
      if (v === O.online) return;
      O.online = v; document.body.classList.toggle('offline', !v);
      listeners.forEach(f => { try { f(O.state); } catch (e) { /* */ } });
    },
    // ---------- saved routes ----------
    list() { return U.get('pt.maps.offr', []) || []; },
    isSaved(id) { const e = O.list().find(x => x.id === id); return !!(e && e.done); },
    // save the map along route r (o: {sat, from, name}); resolves with the state. Calling it again for the same route
    // tops it up (only missing tiles are downloaded), e.g. while navigating with a signal.
    async saveRoute(r, o = {}) {
      if (!has || !r || !r.coords || r.coords.length < 2) return null;
      if (O.state && O.state.id === r.id && O.state.busy) return O.state;
      const urls = routeTiles(r, o);
      const st = O.state = { id: r.id, busy: true, n: urls.length, done: 0, got: 0, bytes: 0, fail: 0, name: o.name || '', sat: !!o.sat, t: Date.now() };
      emit();
      let c;
      try { c = await caches.open(ROUTE + r.id); } catch (e) { st.busy = false; st.err = true; emit(); return st; }
      await pool(urls, 6, async url => {
        if (O.state !== st) return;                                   // another route took over
        try {
          let hit = await c.match(url);
          if (!hit) {
            let res = await caches.match(url).catch(() => null);
            if (!res) {
              if (!navigator.onLine) throw new Error('offline');
              res = await fetch(url, { credentials: 'omit' });
              if (!res.ok) throw new Error('HTTP ' + res.status);
              st.got++;
            }
            const buf = await res.arrayBuffer();
            st.bytes += buf.byteLength;
            await c.put(url, new Response(buf, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } }));
          }
        } catch (e) { st.fail++; }
        st.done++; emit();
      });
      if (O.state !== st) return st;
      st.busy = false; st.ok = st.fail <= Math.max(3, st.n * 0.03);
      // manifest (newest first), older saved routes deleted
      let l = O.list().filter(x => x.id !== r.id);
      const prev = U.get('pt.maps.offr', []).find(x => x.id === r.id);
      l.unshift({ id: r.id, n: st.name, t: Date.now(), tiles: st.n, mb: +(((prev && prev.mb) || 0) + st.bytes / 1048576).toFixed(1), done: st.ok, sat: st.sat });
      const drop = l.slice(KEEP_ROUTES); l = l.slice(0, KEEP_ROUTES);
      U.set('pt.maps.offr', l);
      drop.forEach(x => caches.delete(ROUTE + x.id).catch(() => { }));
      emit();
      return st;
    },
    // the route being navigated: keep the next stretch saved (signal permitting)
    topUp(r, s, o = {}) {
      if (!has || !navigator.onLine || !r || (O.state && O.state.busy)) return;
      O.saveRoute(r, Object.assign({}, o, { from: Math.max(0, s - 200) }));
    },
    async usage() {
      try { const e = await navigator.storage.estimate(); return e.usage || 0; } catch (e) { return 0; }
    },
    async clear() {
      for (const k of await caches.keys()) if (k === RUN || k.startsWith(ROUTE) || k === 'amatu-maps-ov') await caches.delete(k);
      U.set('pt.maps.offr', []); runP = null; O.state = null; emit();
    },
    persist() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { }); } catch (e) { /* */ } },
  };

  if (has && window.maplibregl) {
    maplibregl.addProtocol('amtc', (params, ac) => get('https' + params.url.slice(4), params.type, ac.signal).then(data => ({ data })));
  }
  addEventListener('online', () => { fails = 0; O.net(true); });
  addEventListener('offline', () => O.net(false));
  // app shell for an offline start (index, scripts, styles); tiles stay with the protocol above
  if ('serviceWorker' in navigator && window.isSecureContext && !/[?&]nosw\b/.test(location.search)) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { }));
  }
  void lastOk;
})();
