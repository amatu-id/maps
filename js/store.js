// Amatu Maps · settings, fuel maths, saved places, recent, trip history, "send to my other device".
// localStorage maps.* is synced between the account's devices by /amatu.js; pt.* keys stay on this device.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U;
  const K = { cfg: 'maps.cfg', saved: 'maps.saved', recent: 'maps.recent', trips: 'maps.trips', kirim: 'maps.kirim' };

  const DEF_FUELS = [
    { id: 'bensin', n: 'Bensin (Pertalite)', p: 10000, sub: true },
    { id: 'solar', n: 'Solar (Biosolar)', p: 6800, sub: true },
  ];
  const DEF = () => ({
    v: 1, theme: 'auto', mode: 'car', avoid: { toll: false, highway: false, ferry: false },
    veh: { car: { n: 'Mobil', kmpl: 10, fuel: 'bensin', tank: 40 }, moto: { n: 'Motor', kmpl: 40, fuel: 'bensin', tank: 4 } },
    fuels: DEF_FUELS.map(f => Object.assign({}, f)),
    pp: false, voice: true, traffic: 'auto', radius: 150, spbuMap: true, savedMap: true, labels: true, headSrc: 'auto',
  });
  function merge(a, b) {
    for (const k in b) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) a[k] = merge(a[k] && typeof a[k] === 'object' ? a[k] : {}, b[k]);
      else if (b[k] !== undefined) a[k] = b[k];
    }
    return a;
  }
  const DEF_LISTS = [
    { id: 'fav', n: 'Favorit', ic: 'heart', c: '#e8453c' },
    { id: 'want', n: 'Ingin dikunjungi', ic: 'flag', c: '#188038' },
    { id: 'star', n: 'Berbintang', ic: 'star', c: '#f9ab00' },
  ];

  const D = AM.D = {
    K,
    cfg: null, saved: null,
    load() {
      const c = U.get(K.cfg, null);
      D.cfg = merge(DEF(), c || {});
      if (!Array.isArray(D.cfg.fuels) || !D.cfg.fuels.length) D.cfg.fuels = DEF_FUELS.map(f => Object.assign({}, f));
      for (const f of DEF_FUELS) if (!D.cfg.fuels.find(x => x.id === f.id)) D.cfg.fuels.push(Object.assign({}, f));
      const s = U.get(K.saved, null) || {};
      D.saved = { lists: Array.isArray(s.lists) && s.lists.length ? s.lists : DEF_LISTS.map(l => Object.assign({}, l)), items: Array.isArray(s.items) ? s.items : [], home: s.home || null, work: s.work || null, park: s.park || null };
    },
    saveCfg() { U.set(K.cfg, D.cfg); },
    saveSaved() { U.set(K.saved, D.saved); },
    fuel(id) { return D.cfg.fuels.find(f => f.id === id) || D.cfg.fuels[0]; },
    veh(mode) { return D.cfg.veh[mode === 'moto' ? 'moto' : 'car']; },
    // fuel estimate for a distance (m) in a mode → {kmpl, liters, cost, fuel, km, pp}
    estimate(distM, mode, pp = D.cfg.pp) {
      if (mode !== 'car' && mode !== 'moto') return null;
      const v = D.veh(mode), f = D.fuel(v.fuel), km = distM / 1000 * (pp ? 2 : 1);
      const liters = km / Math.max(0.1, v.kmpl);
      return { veh: v, kmpl: v.kmpl, fuel: f, km, liters, cost: liters * f.p, pp };
    },
    // ---------- saved places ----------
    near(lng, lat, m = 25) { return D.saved.items.filter(i => AM.G.dist([i.lng, i.lat], [lng, lat]) < m); },
    addSaved(list, pl) {
      const it = { id: U.uid(), list, name: pl.name || 'Tempat', addr: pl.addr || '', lng: +pl.lng.toFixed(6), lat: +pl.lat.toFixed(6), cat: pl.cat || '', osm: pl.osm || null, t: Date.now(), note: '' };
      D.saved.items.unshift(it); D.saveSaved(); return it;
    },
    delSaved(id) { D.saved.items = D.saved.items.filter(i => i.id !== id); D.saveSaved(); },
    setLabel(which, pl) { D.saved[which] = pl ? { name: pl.name, addr: pl.addr || '', lng: +pl.lng.toFixed(6), lat: +pl.lat.toFixed(6), t: Date.now() } : null; D.saveSaved(); },
    // ---------- recent ----------
    recent() { return U.get(K.recent, []); },
    pushRecent(e) {
      const l = D.recent().filter(x => !(x.name === e.name && Math.abs(x.lng - e.lng) < 1e-4 && Math.abs(x.lat - e.lat) < 1e-4) && !(e.q && x.q === e.q));
      l.unshift(Object.assign({ t: Date.now() }, e));
      U.set(K.recent, l.slice(0, 40));
    },
    clearRecent() { U.set(K.recent, []); },
    // ---------- trips ----------
    trips() { return (U.get(K.trips, []) || []).filter(t => !t.sim); },     // (old simulated drives are not real trips)
    pushTrip(t) { const l = U.get(K.trips, []) || []; l.unshift(t); U.set(K.trips, l.slice(0, 300)); },
    delTrip(id) { U.set(K.trips, D.trips().filter(t => t.id !== id)); },
    // ---------- send route/place to the other devices of this account ----------
    send(payload) { U.set(K.kirim, Object.assign({ t: Date.now(), from: navigator.userAgent.slice(0, 60), dev: D.dev() }, payload)); },
    dev() { let d = U.get('pt.maps.dev', null); if (!d) { d = U.uid(); U.set('pt.maps.dev', d); } return d; },
    // remote change (other device / other tab): amatu.js fires StorageEvent + amatu:change
    onChange(cb) {
      const keys = Object.values(K);
      const run = U.debounce(k => { D.load(); cb(k); }, 250);
      addEventListener('storage', e => { if (!e.key || keys.includes(e.key)) run(e.key); });
      addEventListener('amatu:change', e => { const ks = (e.detail && (e.detail.keys || e.detail.k)) || []; if (!ks.length || [].concat(ks).some(k => keys.some(x => String(k).includes(x)))) run(null); });
    },
  };
  D.load();
})();
