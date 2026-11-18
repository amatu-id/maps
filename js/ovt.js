// Amatu Maps · Overture Maps places: business listings (Meta, Microsoft, … — CDLA-Permissive-2.0) that OpenStreetMap
// lacks, e.g. companies and shops Google shows. Read straight from Overture's PMTiles archive with HTTP range
// requests (CDN in Jakarta, CORS open): header → directories → only the z14 tiles around the search point.
// Tiles are kept in Cache Storage, so a searched area also works offline and costs no data the second time.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U, G = AM.G;
  const STAC = 'https://stac.overturemaps.org/catalog.json';
  const CACHE = 'amatu-maps-ov', KEY = 'https://ov.amatu.local/';
  const Z = 14;
  const hasCache = typeof caches !== 'undefined' && window.isSecureContext;

  // ---------- release (the archive URL changes every month; old releases expire after 60 days) ----------
  let relP = null;
  function release(force) {
    if (relP && !force) return relP;
    relP = (async () => {
      const c = U.get('pt.maps.ov', null);
      if (c && c.url && !force && Date.now() - c.t < 3 * 864e5) return c.url;
      try {
        const cat = await U.json(STAC, { timeout: 9000 });
        const rel = cat.latest || ((cat.links || []).find(l => l.latest) || {}).title;
        if (!rel) throw new Error('no release');
        let url = 'https://tiles.overturemaps.org/' + String(rel).split(' ')[0] + '/places.pmtiles';
        try {
          const pc = await U.json('https://stac.overturemaps.org/' + rel + '/places/catalog.json', { timeout: 9000 });
          const l = (pc.links || []).find(x => x.rel === 'pmtiles'); if (l && /^https:/.test(l.href)) url = l.href;
        } catch (e) { /* the default path */ }
        U.set('pt.maps.ov', { url, t: Date.now() });
        return url;
      } catch (e) { if (c && c.url) return c.url; relP = null; throw e; }
    })();
    return relP;
  }

  // ---------- bytes ----------
  async function gunzip(u8) {
    if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return u8;
    const ds = new DecompressionStream('gzip');
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
  }
  let ovCache = null;
  const cache = () => ovCache || (ovCache = hasCache ? caches.open(CACHE).catch(() => null) : Promise.resolve(null));
  async function cget(k) { const c = await cache(); if (!c) return null; const r = await c.match(KEY + k).catch(() => null); return r ? new Uint8Array(await r.arrayBuffer()) : null; }
  async function cput(k, u8) { const c = await cache(); if (c) c.put(KEY + k, new Response(u8)).catch(() => { }); }
  let bytesIn = 0, netFails = 0, offUntil = 0;
  // Range is a CORS-safelisted header (no preflight — Overture's CDN answers OPTIONS with 403). If a browser fails
  // anyway, stop trying for a while: the search keeps working with OpenStreetMap alone.
  async function range(url, off, len, signal) {
    if (Date.now() < offUntil) throw new Error('overture paused');
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 15000);
    if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=' + off + '-' + (off + len - 1) }, signal: ac.signal, credentials: 'omit' });
      if (r.status !== 206) { ac.abort(); const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }   // never read a 20 GB 200
      const b = new Uint8Array(await r.arrayBuffer()); bytesIn += b.length; netFails = 0; return b;
    } catch (e) {
      if (!e.status && !ac.signal.aborted && navigator.onLine && ++netFails >= 4) { offUntil = Date.now() + 10 * 60000; netFails = 0; }
      throw e;
    } finally { clearTimeout(tm); }
  }

  // ---------- PMTiles v3 ----------
  function u64(b, o) { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); return v.getUint32(o, true) + v.getUint32(o + 4, true) * 4294967296; }
  function dir(buf) {
    let p = 0;
    const v = () => { let r = 0, s = 1, x; do { x = buf[p++]; r += (x & 0x7f) * s; s *= 128; } while (x >= 0x80); return r; };
    const n = v(), ids = new Float64Array(n), rl = new Uint32Array(n), len = new Float64Array(n), off = new Float64Array(n);
    let last = 0;
    for (let i = 0; i < n; i++) { last += v(); ids[i] = last; }
    for (let i = 0; i < n; i++) rl[i] = v();
    for (let i = 0; i < n; i++) len[i] = v();
    for (let i = 0; i < n; i++) { const o = v(); off[i] = o === 0 && i > 0 ? off[i - 1] + len[i - 1] : o - 1; }
    return { ids, rl, len, off, n };
  }
  function tileId(z, x, y) {
    let acc = 0; for (let t = 0; t < z; t++) acc += Math.pow(4, t);
    const n = Math.pow(2, z); let d = 0, tx = x, ty = y;
    for (let s = n / 2; s >= 1; s /= 2) {
      const rx = (tx & s) > 0 ? 1 : 0, ry = (ty & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      if (ry === 0) { if (rx === 1) { tx = s - 1 - tx; ty = s - 1 - ty; } const t = tx; tx = ty; ty = t; }
    }
    return acc + d;
  }
  let archP = null;   // Promise<{url, rel, h, root}>
  function archive() {
    if (archP) return archP;
    archP = (async () => {
      const url = await release();
      const rel = url.split('/').slice(-2, -1)[0] || 'x';
      let hb = await cget(rel + '/h');
      if (!hb) { hb = await range(url, 0, 16384); cput(rel + '/h', hb); }
      if (hb[0] !== 0x50 || hb[7] !== 3) throw new Error('not pmtiles v3');
      const h = { rootOff: u64(hb, 8), rootLen: u64(hb, 16), leafOff: u64(hb, 40), dataOff: u64(hb, 56) };
      const rb = h.rootOff + h.rootLen <= hb.length ? hb.subarray(h.rootOff, h.rootOff + h.rootLen) : await range(url, h.rootOff, h.rootLen);
      return { url, rel, h, root: dir(await gunzip(rb)) };
    })();
    archP.catch(() => { archP = null; });
    return archP;
  }
  // an expired release answers 403/404: look up the newest one and start over
  function expired(e) { if (e && (e.status === 403 || e.status === 404 || e.status === 410)) { archP = null; leaves.clear(); tiles.clear(); release(true).catch(() => { }); } }
  const leaves = new Map();
  async function leaf(a, off, len, signal) {
    const k = a.rel + '/l' + off;
    if (leaves.has(k)) return leaves.get(k);
    const p = (async () => {
      let b = await cget(k);
      if (!b) { b = await range(a.url, a.h.leafOff + off, len, signal); cput(k, b); }
      return dir(await gunzip(b));
    })();
    leaves.set(k, p); p.catch(() => leaves.delete(k));
    return p;
  }
  async function locate(a, id, signal) {
    let d = a.root;
    for (let depth = 0; depth < 4; depth++) {
      let lo = 0, hi = d.n - 1, k = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (d.ids[m] <= id) { k = m; lo = m + 1; } else hi = m - 1; }
      if (k < 0) return null;
      if (d.rl[k] === 0) { d = await leaf(a, d.off[k], d.len[k], signal); continue; }
      return id < d.ids[k] + d.rl[k] ? { off: d.off[k], len: d.len[k] } : null;
    }
    return null;
  }

  // ---------- one z14 tile → compact places ----------
  const tiles = new Map();              // "x/y" → Promise<[place]>
  function decodeTile(raw, x, y) {
    const d = AM.MVT.decode(raw, ['place']), out = [];
    for (const f of d.place || []) {
      const p = f.props, name = p['@name'] || '';
      if (!name || p.operating_status === 'permanently_closed') continue;
      const conf = +p.confidence || 0;
      if (conf < 0.3) continue;
      const ll = AM.MVT.toLngLat(Z, x, y, f.x, f.y);
      out.push({ name, nn: normName(name), conf, lng: ll[0], lat: ll[1], cat: p.basic_category || '', p });
    }
    return out;
  }
  function tile(x, y, signal) {
    const k = x + '/' + y;
    if (tiles.has(k)) return tiles.get(k);
    const p = (async () => {
      const a = await archive();
      const ck = a.rel + '/t/' + k;
      let raw = await cget(ck);
      if (!raw) {
        if (!navigator.onLine) throw new Error('offline');
        try {
          const e = await locate(a, tileId(Z, x, y), signal);
          if (!e) { cput(ck, new Uint8Array(0)); return []; }
          raw = await range(a.url, a.h.dataOff + e.off, e.len, signal);
        } catch (er) { expired(er); throw er; }
        cput(ck, raw);
      }
      if (!raw.length) return [];
      return decodeTile(await gunzip(raw), x, y);
    })();
    tiles.set(k, p);
    p.catch(() => tiles.delete(k));
    if (tiles.size > 300) tiles.delete(tiles.keys().next().value);
    return p;
  }

  // ---------- text matching ----------
  const STOP = new Set(['pt', 'cv', 'ud', 'tbk', 'pd', 'fa', 'koperasi', 'persero', 'the', 'dan', 'di', 'ke', 'jl', 'jln', 'jalan', 'no', 'kota', 'kab', 'kabupaten']);
  function normName(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function qTokens(q) {
    const all = normName(q).split(' ').filter(Boolean);
    const core = all.filter(t => !STOP.has(t));
    return core.length ? core : all;
  }
  function lev1(a, b) {                 // edit distance ≤ 1 (one typo)
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, e = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++e > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return e + (a.length - i) + (b.length - j) <= 1;
  }
  // 0…1: how well the query tokens are covered by the words of a name (last token may be a prefix — typing)
  function score(nn, qt, typing) {
    if (!qt.length) return 0;
    const nt = nn.split(' ');
    let s = 0;
    for (let i = 0; i < qt.length; i++) {
      const t = qt[i], last = i === qt.length - 1;
      if (nt.includes(t)) s += 1;
      else if (nt.some(w => w.startsWith(t)) && (last && typing || t.length >= 4)) s += 0.9;
      else if (t.length >= 4 && nt.some(w => w.length >= 4 && lev1(w, t))) s += 0.75;
      else if (t.length >= 3 && nn.replace(/ /g, '').includes(t)) s += 0.6;    // "hadagraha" / glued words
    }
    return s / qt.length;
  }

  // ---------- labels ----------
  const CAT = {
    restaurant: 'Restoran', casual_eatery: 'Rumah makan', fast_food_restaurant: 'Makanan cepat saji', cafe: 'Kafe', coffee_shop: 'Kedai kopi', bakery: 'Toko roti',
    food_truck_stand: 'Warung', food_and_beverage_store: 'Toko makanan', grocery_store: 'Toko kelontong', convenience_store: 'Minimarket', supermarket: 'Supermarket',
    department_store: 'Toserba', shopping_mall: 'Mal', shopping: 'Belanja', clothing_store: 'Toko pakaian', fashion_and_apparel_store: 'Toko pakaian', electronics_store: 'Toko elektronik',
    mobile_phone_store: 'Toko HP', hardware_store: 'Toko bangunan', building_supply_store: 'Toko bangunan', furniture_store: 'Toko mebel', pharmacy: 'Apotek', drugstore: 'Apotek',
    hospital: 'Rumah sakit', clinic: 'Klinik', doctor: 'Dokter', dentist: 'Dokter gigi', health_care: 'Kesehatan', school: 'Sekolah', college_university: 'Kampus', education: 'Pendidikan',
    mosque: 'Masjid', church: 'Gereja', place_of_worship: 'Tempat ibadah', religious_organization: 'Organisasi keagamaan', bank: 'Bank', atm: 'ATM', financial_service: 'Jasa keuangan',
    hotel: 'Hotel', accommodation: 'Penginapan', guest_house: 'Penginapan', gas_station: 'SPBU', auto_repair: 'Bengkel', automotive_service: 'Bengkel / jasa otomotif',
    auto_dealer: 'Dealer kendaraan', car_dealer: 'Dealer mobil', motorcycle_dealer: 'Dealer motor', car_wash: 'Cuci kendaraan', parking: 'Parkir', travel_service: 'Agen perjalanan',
    building_or_construction_service: 'Jasa konstruksi', construction_service: 'Jasa konstruksi', contractor: 'Kontraktor', real_estate_service: 'Properti', real_estate: 'Properti',
    professional_service: 'Jasa profesional', business_service: 'Jasa bisnis', manufacturer: 'Pabrik', industrial_company: 'Perusahaan industri', office: 'Kantor', corporate_office: 'Kantor perusahaan',
    government_office: 'Kantor pemerintah', public_service: 'Layanan publik', police_station: 'Kantor polisi', post_office: 'Kantor pos', event_or_party_service: 'Jasa acara',
    beauty_salon: 'Salon', personal_care_and_beauty_store: 'Toko kecantikan', barber_shop: 'Pangkas rambut', laundry_service: 'Laundry', sports_and_fitness_venue: 'Olahraga',
    gym: 'Pusat kebugaran', stadium_arena: 'Gelanggang', park: 'Taman', amusement_park: 'Taman hiburan', movie_theater: 'Bioskop', tourist_attraction: 'Wisata', museum: 'Museum',
    historic_site: 'Situs bersejarah', sculpture_statue: 'Monumen', non_alcoholic_beverage_venue: 'Kedai minuman', bar: 'Bar', toys_and_games_store: 'Toko mainan',
    printing_service: 'Percetakan', internet_service_provider: 'Penyedia internet', telecommunications: 'Telekomunikasi', transportation: 'Transportasi', bus_station: 'Terminal bus',
    train_station: 'Stasiun', airport: 'Bandara', logistics_service: 'Logistik', shipping_service: 'Jasa pengiriman', agriculture: 'Pertanian', farm: 'Pertanian',
  };
  function catLabel(c) { return CAT[c] || (c ? c.replace(/_/g, ' ').replace(/^./, x => x.toUpperCase()) : 'Tempat usaha'); }
  function iconOf(c) {
    if (/restaurant|eatery|food|bakery|warung/.test(c)) return 'food';
    if (/cafe|coffee|beverage/.test(c)) return 'cafe';
    if (/hotel|accommodation|guest/.test(c)) return 'bed';
    if (/hospital|clinic|doctor|dentist|health/.test(c)) return 'hosp';
    if (/pharmacy|drug/.test(c)) return 'pill';
    if (/bank|atm|financ/.test(c)) return 'bank';
    if (/store|shop|mall|market/.test(c)) return 'cart';
    if (/mosque|church|worship|religio/.test(c)) return 'mosque';
    if (/school|college|univers|educat/.test(c)) return 'school';
    if (/gas_station/.test(c)) return 'fuel';
    if (/auto|car_|motor|repair/.test(c)) return 'wrench';
    if (/parking/.test(c)) return 'parking';
    if (/bus|train|airport|transport|travel/.test(c)) return 'bus';
    if (/park|attraction|museum|historic|statue|amusement/.test(c)) return 'camera';
    return 'work';
  }
  const J = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  // full details of a hit (JSON fields parsed only for the places shown)
  function place(h) {
    const p = h.p, ad = (J(p.addresses) || [])[0] || {}, ph = J(p.phones) || [], web = J(p.websites) || [], so = J(p.socials) || [];
    const addr = [ad.freeform, ad.locality, ad.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    return {
      name: h.name, cat: catLabel(h.cat), ic: iconOf(h.cat), lng: h.lng, lat: h.lat, addr, src: 'ov', conf: h.conf,
      ov: { id: p.id || '', phone: ph[0] || '', web: web[0] || '', fb: so.find(s => /facebook/.test(s)) || '', ig: so.find(s => /instagram/.test(s)) || '', cat: h.cat, pc: ad.postcode || '' },
    };
  }

  // ---------- search ----------
  function ringTiles(ll, r0, r1) {
    const [cx, cy] = G.tile(ll[0], ll[1], Z), out = [];
    for (let r = r0; r <= r1; r++) {
      if (r === 0) { out.push([cx, cy, 0]); continue; }
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([cx + dx, cy + dy, r]);
    }
    return out;
  }
  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
  }
  const OV = AM.OV = {
    catLabel, iconOf, score, qTokens, normName,
    stats: () => ({ bytes: bytesIn, tiles: tiles.size }),
    // q → places sorted by match then distance. refs: [[lng,lat]…] (first = main). o: {rings, typing, signal, onUpdate, limit}
    async search(q, refs, o = {}) {
      const qt = qTokens(q);
      if (!qt.length || !refs.length || qt.join('').length < 3) return [];
      const rings = o.rings != null ? o.rings : 3, typing = !!o.typing, lim = o.limit || 12;
      const ref = refs[0], seen = new Set(), hits = [];
      const plan = ringTiles(ref, 0, rings);
      for (const r2 of refs.slice(1)) if (G.dist(r2, ref) > 4000) plan.push(...ringTiles(r2, 0, Math.min(1, rings)).map(t => [t[0], t[1], t[2] + 1]));
      const look = list => {
        for (const h of list) {
          const s = score(h.nn, qt, typing);
          if (s < 0.74) continue;
          const k = h.nn + '|' + h.lng.toFixed(4) + h.lat.toFixed(4);
          if (seen.has(k)) continue; seen.add(k);
          const d = Math.min(...refs.map(r => G.dist(r, [h.lng, h.lat])));
          const exact = h.nn === qt.join(' ') || h.nn.replace(/^(pt|cv|ud) /, '') === qt.join(' ');
          hits.push({ h, s, d, rank: s * 100 + (exact ? 12 : 0) + h.conf * 8 - Math.log2(1 + d / 400) * 4 - Math.max(0, h.nn.split(' ').length - qt.length) * 1.5 });
        }
      };
      const out = () => hits.slice().sort((a, b) => b.rank - a.rank).slice(0, lim).map(x => Object.assign(place(x.h), { d: x.d, score: x.s }));
      // always look ±6 km (typing) / ±8.5 km (search) around the point; farther only while nothing (or little) matched
      let strong = 0;
      const minRing = typing ? 2 : 3;
      for (const step of [...new Set(plan.map(t => t[2]))].sort((a, b) => a - b)) {
        if (o.signal && o.signal.aborted) break;
        if (step > minRing && strong >= (typing ? 3 : 1)) break;
        const batch = plan.filter(t => t[2] === step);
        await pool(batch, 6, async ([x, y]) => {
          if (o.signal && o.signal.aborted) return;
          try { look(await tile(x, y)); } catch (e) { /* offline / blocked tile */ }   // (no abort: a tile once asked for is kept)
        });
        strong = hits.filter(x => x.s >= 0.99).length;
        if (o.onUpdate && hits.length) o.onUpdate(out());
        if (strong >= 6) break;
      }
      return out();
    },
    // warm the tiles around a point (the search box got focus): only ones not cached yet, in the background
    warm(ll, rings = 1) { if (!navigator.onLine) return; ringTiles(ll, 0, rings).forEach(([x, y]) => tile(x, y).catch(() => { })); },
  };
})();
