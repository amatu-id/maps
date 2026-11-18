// Amatu Maps · SPBU / rest area / SPKLU dataset (data/poi, built weekly from OSM by a GitHub Action) and
// matching against a route: which stations the route passes, how far along, on which side of the road.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U, G = AM.G;
  const BASE = 'data/poi/';
  const BR = [
    { n: 'SPBU', c: '#5f6368', t: '#fff', s: 'S' },
    { n: 'Pertamina', c: '#e1251b', t: '#fff', s: 'P', c2: '#0a5ca8' },
    { n: 'Shell', c: '#fbce07', t: '#dd1d21', s: 'S' },
    { n: 'BP', c: '#009b3a', t: '#fff', s: 'bp' },
    { n: 'Vivo', c: '#1d4f91', t: '#fff', s: 'V' },
    { n: 'TotalEnergies', c: '#ed0000', t: '#fff', s: 'T' },
    { n: 'Mobil', c: '#0d3b8c', t: '#fff', s: 'M' },
    { n: 'Petronas', c: '#00a19c', t: '#fff', s: 'P' },
    { n: 'Pertashop', c: '#0a5ca8', t: '#fff', s: 'ps' },
    { n: 'AKR', c: '#1b7a3a', t: '#fff', s: 'A' },
    { n: 'Eceran', c: '#8d6e63', t: '#fff', s: 'e' },
  ];
  const FL = [[1, '24 jam'], [2, 'Pertalite'], [4, 'Pertamax'], [8, 'Turbo/RON 95+'], [16, 'Solar/Diesel'], [32, 'LPG/BBG'], [64, 'Toilet'], [128, 'ATM'], [256, 'Toko'], [512, 'Angin'], [1024, 'Cuci']];
  let idxP = null;
  const cells = new Map();

  async function index() {
    if (!idxP) idxP = U.json(BASE + 'index.json', { timeout: 12000 }).catch(e => { idxP = null; throw e; });
    return idxP;
  }
  async function cell(k) {
    if (!cells.has(k)) cells.set(k, U.json(BASE + k + '.json', { timeout: 15000 }).catch(e => { cells.delete(k); throw e; }));
    return cells.get(k);
  }
  const key = (lng, lat) => Math.floor(lat) + '_' + Math.floor(lng);
  function rows(c, kinds) {
    const out = [];
    if (kinds.includes('f')) for (const r of c.f || []) out.push({ k: 'f', lat: r[0], lng: r[1], b: r[2], name: r[3], fl: r[4], id: r[5], no: r[6], oh: r[7] });
    if (kinds.includes('r')) for (const r of c.r || []) out.push({ k: 'r', lat: r[0], lng: r[1], b: -1, name: r[2], fl: r[3], id: r[4] });
    if (kinds.includes('c')) for (const r of c.c || []) out.push({ k: 'c', lat: r[0], lng: r[1], b: -2, name: r[2], fl: r[3], id: r[4] });
    return out;
  }
  async function load(keys, kinds) {
    const idx = await index();
    const want = [...keys].filter(k => idx.cells[k]);
    const got = await Promise.all(want.map(k => cell(k).catch(() => null)));
    return got.filter(Boolean).flatMap(c => rows(c, kinds));
  }

  const P = AM.P = {
    BR, FL,
    brand: b => b === -1 ? { n: 'Rest area', c: '#6a1b9a', t: '#fff', s: 'R' } : b === -2 ? { n: 'SPKLU', c: '#00897b', t: '#fff', s: 'E' } : BR[b] || BR[0],
    title(p) {
      if (p.k === 'r') return p.name || 'Rest area';
      if (p.k === 'c') return p.name ? (/spklu|charging|pln/i.test(p.name) ? p.name : 'SPKLU ' + p.name) : 'SPKLU';
      const b = P.brand(p.b);
      if (p.name) return /^(spbu|pertashop|shell|bp|vivo)/i.test(p.name) ? p.name : (p.b > 0 && !p.name.toLowerCase().includes(b.n.toLowerCase()) ? b.n + ' · ' + p.name : p.name);
      return p.b > 0 ? (p.b === 8 || p.b === 10 ? b.n : 'SPBU ' + b.n) + (p.no ? ' ' + p.no : '') : 'SPBU' + (p.no ? ' ' + p.no : '');
    },
    tags: p => FL.filter(([bit]) => p.fl & bit).map(f => f[1]),
    async meta() { try { return await index(); } catch (e) { return null; } },
    // all rows inside a bbox [w, s, e, n]
    async inBox(bb, kinds = ['f']) {
      const keys = new Set();
      for (let la = Math.floor(bb[1]); la <= Math.floor(bb[3]); la++) for (let lo = Math.floor(bb[0]); lo <= Math.floor(bb[2]); lo++) keys.add(la + '_' + lo);
      if (keys.size > 12) return [];
      const all = await load(keys, kinds);
      return all.filter(p => p.lng >= bb[0] && p.lng <= bb[2] && p.lat >= bb[1] && p.lat <= bb[3]);
    },
    // stations along the route within `radius` m: [{…row, s (m from start), d (m from road), side 1 left / -1 right, pt}]
    // A route that passes the same place twice (there and back) lists it once per pass.
    async along(route, radius = 150, kinds = ['f', 'r', 'c']) {
      const { coords, cum } = route;
      const keys = new Set(), pad = radius / 111000 + 0.002;
      for (let i = 0; i < coords.length; i++) {
        const [lng, lat] = coords[i];
        keys.add(key(lng, lat));
        keys.add(key(lng + pad, lat)); keys.add(key(lng - pad, lat)); keys.add(key(lng, lat + pad)); keys.add(key(lng, lat - pad));
      }
      let all;
      try { all = await load(keys, kinds); }
      catch (e) { e.noData = true; throw e; }
      return P.match(route, all, radius);
    },
    match(route, all, radius) {
      const { coords, cum } = route;
      // grid of route segments (≈ 1 km cells) → candidate segments per station
      const g = 0.01, grid = new Map(), [kx, ky] = G.kxy(coords[0][1]);
      const padLat = radius / ky, padLng = radius / kx;
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i], b = coords[i + 1];
        const x0 = Math.floor((Math.min(a[0], b[0]) - padLng) / g), x1 = Math.floor((Math.max(a[0], b[0]) + padLng) / g);
        const y0 = Math.floor((Math.min(a[1], b[1]) - padLat) / g), y1 = Math.floor((Math.max(a[1], b[1]) + padLat) / g);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const k = x * 100000 + y; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i);
        }
      }
      const out = [];
      for (const p of all) {
        const segs = grid.get(Math.floor(p.lng / g) * 100000 + Math.floor(p.lat / g));
        if (!segs) continue;
        const pt = [p.lng, p.lat], hits = [];
        for (const i of segs) {
          const n = G.nearest(coords, cum, pt, i, i + 1);
          if (n.d <= radius) hits.push(n);
        }
        if (!hits.length) continue;
        hits.sort((a, b) => a.s - b.s);
        // group hits into passes (gaps > 1.5 km along the route) and keep the closest point of each pass
        let grp = [hits[0]];
        const flush = () => {
          const best = grp.reduce((a, b) => (b.d < a.d ? b : a));
          const a = coords[best.i], b = coords[best.i + 1];
          out.push(Object.assign({}, p, { s: best.s, d: best.d, side: G.side(a, b, pt), pt: best.pt }));
        };
        for (let j = 1; j < hits.length; j++) {
          if (hits[j].s - hits[j - 1].s > 1500) { flush(); grp = []; }
          grp.push(hits[j]);
        }
        flush();
      }
      out.sort((a, b) => a.s - b.s);
      // same station mapped twice (node + area) a few metres apart
      return out.filter((p, i) => !out.slice(Math.max(0, i - 3), i).some(q => q.k === p.k && Math.abs(q.s - p.s) < 60 && G.dist([q.lng, q.lat], [p.lng, p.lat]) < 70));
    },
  };
})();
