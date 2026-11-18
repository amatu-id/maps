// Amatu Maps · routing: Valhalla (FOSSGIS) with OSRM fallback, Indonesian turn-by-turn text, time along the route.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U, G = AM.G;
  const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
  const OSRM = { car: 'routed-car', moto: 'routed-car', walk: 'routed-foot', bike: 'routed-bike' };
  const MODES = {
    car: { n: 'Mobil', ic: 'car', costing: 'auto', fuel: true },
    moto: { n: 'Motor', ic: 'moto', costing: 'motorcycle', fuel: true },
    walk: { n: 'Jalan kaki', ic: 'walk', costing: 'pedestrian' },
    bike: { n: 'Sepeda', ic: 'bike', costing: 'bicycle' },
  };
  const ARAH = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];
  const arah = b => ARAH[Math.round(((b || 0) % 360) / 45) % 8];

  // first street name with letters ("26" alone is a route number)
  function street(names) {
    if (!names || !names.length) return '';
    const n = names.find(x => /[a-z]/i.test(x)) || '';
    return n.replace(/^Jalan\s/i, 'Jl. ');
  }
  function toward(sign) {
    if (!sign) return '';
    const t = (sign.exit_toward_elements || []).map(e => e.text).slice(0, 3);
    return t.join(' / ');
  }

  // Indonesian instruction for a Valhalla maneuver type
  function text(m, legCount) {
    const st = m.street ? ' ke ' + m.street : '', on = m.street ? ' di ' + m.street : '', tw = m.toward ? ' menuju ' + m.toward : '';
    switch (m.type) {
      case 1: case 2: case 3: return 'Mulai ke arah ' + arah(m.brg) + on;
      case 4: return m.leg < legCount - 1 ? 'Tiba di perhentian ' + (m.leg + 1) : 'Tiba di tujuan';
      case 5: return (m.leg < legCount - 1 ? 'Perhentian ' + (m.leg + 1) : 'Tujuan') + ' ada di sebelah kanan';
      case 6: return (m.leg < legCount - 1 ? 'Perhentian ' + (m.leg + 1) : 'Tujuan') + ' ada di sebelah kiri';
      case 7: return 'Lanjutkan, jalan berganti nama' + (m.street ? ' menjadi ' + m.street : '');
      case 8: return 'Lurus terus' + on;
      case 9: return 'Sedikit ke kanan' + st;
      case 10: return 'Belok kanan' + st;
      case 11: return 'Belok tajam ke kanan' + st;
      case 12: case 13: return 'Putar balik' + st;
      case 14: return 'Belok tajam ke kiri' + st;
      case 15: return 'Belok kiri' + st;
      case 16: return 'Sedikit ke kiri' + st;
      case 17: return 'Lurus masuk jalur' + (m.toll ? ' tol' : '') + (tw || st);
      case 18: return 'Ambil jalur kanan' + (m.toll ? ' masuk tol' : '') + (tw || st);
      case 19: return 'Ambil jalur kiri' + (m.toll ? ' masuk tol' : '') + (tw || st);
      case 20: return 'Keluar di sebelah kanan' + (m.exit ? ' (exit ' + m.exit + ')' : '') + (tw || st);
      case 21: return 'Keluar di sebelah kiri' + (m.exit ? ' (exit ' + m.exit + ')' : '') + (tw || st);
      case 22: return 'Tetap lurus' + (tw || on);
      case 23: return 'Tetap di kanan' + (tw || st);
      case 24: return 'Tetap di kiri' + (tw || st);
      case 25: return 'Bergabung' + st;
      case 37: return 'Bergabung ke kanan' + st;
      case 38: return 'Bergabung ke kiri' + st;
      case 26: return 'Masuk bundaran, ambil jalan keluar ke-' + (m.rb || 1) + st;
      case 27: return 'Keluar dari bundaran' + st;
      case 28: return 'Naik kapal feri' + (m.street ? ' (' + m.street + ')' : '');
      case 29: return 'Turun dari kapal feri' + st;
      case 40: return 'Lewati tangga' + st;
      default: return 'Lanjutkan' + on;
    }
  }
  function icon(m) {
    switch (m.type) {
      case 1: case 2: case 3: return 'tdep';
      case 4: case 5: case 6: return 'tarr';
      case 9: case 23: case 37: return 'tsr';
      case 10: return 'ttr';
      case 11: return 'tshr';
      case 12: case 13: return 'tu';
      case 14: return 'tshl';
      case 15: return 'ttl';
      case 16: case 24: case 38: return 'tsl';
      case 18: case 20: return 'trr';
      case 19: case 21: return 'trl';
      case 25: return 'tmg';
      case 26: case 27: return 'trb';
      case 28: case 29: return 'tferry';
      default: return 'tst';
    }
  }

  function build(mode, coords, mans, legs, summary, src) {
    const cum = G.cum(coords), tcum = new Float64Array(coords.length);
    for (const m of mans) {
      const a = m.bi, b = Math.max(m.ei, m.bi), L = cum[b] - cum[a];
      for (let k = a + 1; k <= b; k++) tcum[k] = tcum[a] + (L > 0 ? m.time * (cum[k] - cum[a]) / L : m.time);
    }
    for (let k = 1; k < tcum.length; k++) if (tcum[k] < tcum[k - 1]) tcum[k] = tcum[k - 1];
    let best = null, tollDist = 0;
    for (const m of mans) {
      if (m.toll) tollDist += m.len;
      if (m.street && (!best || m.len > best.len)) best = m;
    }
    mans.forEach(m => { m.text = text(m, legs.length); m.ic = icon(m); m.s = cum[m.bi]; });
    const dist = cum[cum.length - 1], time = tcum[tcum.length - 1];
    return {
      id: U.uid(), mode, src, coords, cum, tcum, dist, time, legs, man: mans,
      toll: !!summary.toll || tollDist > 0, tollDist, hw: !!summary.hw, ferry: !!summary.ferry,
      via: best ? best.street : '', bbox: G.bbox(coords)
    };
  }

  function parseValhalla(trip, mode) {
    const coords = [], mans = [], legs = [];
    trip.legs.forEach((leg, li) => {
      const shp = G.decode(leg.shape, 6), off = coords.length ? coords.length - 1 : 0;
      if (coords.length) shp.shift();
      const i0 = off;
      coords.push(...shp);
      for (const m of leg.maneuvers) {
        if (li < trip.legs.length - 1 && m.type >= 4 && m.type <= 6 && false) continue;
        mans.push({
          type: m.type, street: street(m.street_names || m.begin_street_names), len: (m.length || 0) * 1000, time: m.time || 0,
          bi: off + m.begin_shape_index, ei: off + m.end_shape_index, toll: !!m.toll, hw: !!m.highway, rb: m.roundabout_exit_count,
          exit: m.sign && m.sign.exit_number_elements ? m.sign.exit_number_elements.map(e => e.text).join('/') : '',
          toward: toward(m.sign), brg: m.bearing_after, leg: li, ferry: m.travel_type === 'ferry'
        });
      }
      legs.push({ i0, i1: coords.length - 1, dist: leg.summary.length * 1000, time: leg.summary.time });
    });
    const s = trip.summary;
    return build(mode, coords, mans, legs, { toll: s.has_toll, hw: s.has_highway, ferry: s.has_ferry }, 'valhalla');
  }

  // OSRM step → Valhalla-like maneuver type
  function osrmType(st) {
    const t = st.maneuver.type, m = st.maneuver.modifier || '';
    const turn = { 'uturn': 13, 'sharp right': 11, 'right': 10, 'slight right': 9, 'straight': 8, 'slight left': 16, 'left': 15, 'sharp left': 14 };
    if (t === 'depart') return 1;
    if (t === 'arrive') return m.includes('left') ? 6 : m.includes('right') ? 5 : 4;
    if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn') return 26;
    if (t === 'exit roundabout' || t === 'exit rotary') return 27;
    if (t === 'merge') return m.includes('left') ? 38 : m.includes('right') ? 37 : 25;
    if (t === 'on ramp') return m.includes('left') ? 19 : m.includes('right') ? 18 : 17;
    if (t === 'off ramp') return m.includes('left') ? 21 : 20;
    if (t === 'fork') return m.includes('left') ? 24 : m.includes('right') ? 23 : 22;
    if (t === 'new name') return 7;
    return turn[m] || 8;
  }
  function parseOsrm(rt, mode) {
    const coords = G.decode(rt.geometry, 6), mans = [], legs = [];
    const cum = G.cum(coords);
    let li = 0;
    for (const leg of rt.legs) {
      const i0 = mans.length ? mans[mans.length - 1].ei : 0;
      for (const st of leg.steps) {
        const p = st.maneuver.location, near = G.nearest(coords, cum, p);
        mans.push({ type: osrmType(st), street: street([st.name].filter(Boolean)), len: st.distance, time: st.duration, bi: near.i + (near.t > 0.5 ? 1 : 0), ei: 0,
          toll: /toll/.test((st.classes || []).join(',')), hw: /motorway/.test((st.classes || []).join(',')), rb: st.maneuver.exit, brg: st.maneuver.bearing_after, leg: li, exit: '', toward: st.destinations || '' });
      }
      legs.push({ i0, i1: 0, dist: leg.distance, time: leg.duration });
      li++;
    }
    mans.forEach((m, i) => { m.ei = i < mans.length - 1 ? Math.max(m.bi, mans[i + 1].bi) : coords.length - 1; });
    legs.forEach((l, i) => { l.i1 = i < legs.length - 1 ? legs[i + 1].i0 : coords.length - 1; });
    return build(mode, coords, mans, legs, { toll: mans.some(m => m.toll), hw: mans.some(m => m.hw) }, 'osrm');
  }

  const R = AM.R = {
    MODES, text, icon, arah,
    // points: [{lng, lat, heading?}] · o: {mode, avoid: {toll, highway, ferry}, alternates}
    async plan(points, o = {}) {
      const mode = o.mode || 'car', md = MODES[mode], av = o.avoid || {};
      const copt = {};
      if (mode === 'car') Object.assign(copt, { exclude_tolls: av.toll ? true : undefined, use_highways: av.highway ? 0 : undefined, use_ferry: av.ferry ? 0 : undefined });
      if (mode === 'moto') Object.assign(copt, { exclude_tolls: true, use_highways: av.highway ? 0 : undefined, use_ferry: av.ferry ? 0 : undefined, use_trails: 0 });
      if (mode === 'bike') Object.assign(copt, { bicycle_type: 'Hybrid', use_ferry: av.ferry ? 0 : undefined });
      if (mode === 'walk') Object.assign(copt, { use_ferry: av.ferry ? 0 : undefined });
      Object.keys(copt).forEach(k => copt[k] === undefined && delete copt[k]);
      const body = {
        locations: points.map((p, i) => Object.assign({ lat: +p.lat.toFixed(6), lon: +p.lng.toFixed(6), type: 'break' },
          i === 0 && isFinite(p.heading) ? { heading: Math.round(p.heading), heading_tolerance: 60 } : {}, i === 0 && p.radius ? { radius: p.radius } : {})),
        costing: md.costing, costing_options: { [md.costing]: copt },
        alternates: points.length === 2 && o.alternates !== 0 ? (o.alternates || 2) : 0,
        directions_options: { units: 'kilometers', language: 'en-US' }, id: 'amatu-maps'
      };
      try {
        const d = await U.json(VALHALLA, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, timeout: o.timeout || 25000, signal: o.signal });
        const routes = [parseValhalla(d.trip, mode)].concat((d.alternates || []).map(a => parseValhalla(a.trip, mode)));
        return routes;
      } catch (e) {
        if (o.signal && o.signal.aborted) throw e;
        let msg = '';
        try { msg = JSON.parse(e.body || '{}').error || ''; } catch (x) { /* */ }
        // a toll-free car route can be impossible (island ring roads): retry softly
        if (mode === 'car' && av.toll && /no path|no route/i.test(msg)) return R.plan(points, Object.assign({}, o, { avoid: Object.assign({}, av, { toll: false }) }));
        if (/no path|no route|outside|too far|exceeds/i.test(msg)) { const er = new Error(msg); er.user = true; throw er; }
        return R.osrm(points, mode, o);
      }
    },
    async osrm(points, mode, o = {}) {
      const prof = OSRM[mode] || OSRM.car;
      const u = 'https://routing.openstreetmap.de/' + prof + '/route/v1/driving/' + points.map(p => p.lng.toFixed(6) + ',' + p.lat.toFixed(6)).join(';') +
        '?overview=full&geometries=polyline6&steps=true' + (points.length === 2 ? '&alternatives=2' : '') + (mode === 'moto' || (o.avoid && o.avoid.toll) ? '&exclude=toll' : '');
      let d;
      try { d = await U.json(u, { timeout: 20000, signal: o.signal }); }
      catch (e) { if (/exclude/.test(u)) d = await U.json(u.replace(/&exclude=toll/, ''), { timeout: 20000, signal: o.signal }); else throw e; }
      if (!d.routes || !d.routes.length) { const er = new Error('Rute tidak ditemukan'); er.user = true; throw er; }
      return d.routes.map(r => parseOsrm(r, mode));
    },
    // seconds from the start to distance s along the route
    timeAt(r, s) {
      const i = G.idx(r.cum, s);
      if (i >= r.cum.length - 1) return r.time;
      const L = r.cum[i + 1] - r.cum[i], t = L ? (s - r.cum[i]) / L : 0;
      return r.tcum[i] + t * (r.tcum[i + 1] - r.tcum[i]);
    },
    // typical-traffic multiplier for cars/motorbikes (no live traffic data is free, so the clock does the guessing)
    factor(mode, when = new Date(), setting = 'auto') {
      if (setting === 'off' || mode === 'walk' || mode === 'bike') return 1;
      const fixed = { lancar: 0.9, normal: 1, padat: 1.3, macet: 1.6 };
      if (fixed[setting]) return fixed[setting];
      const d = when.getDay(), h = when.getHours() + when.getMinutes() / 60;
      if (h >= 21.5 || h < 5) return 0.92;
      if (d === 0) return h >= 15 && h < 19 ? 1.15 : 0.97;
      if (h >= 6.5 && h < 8.5) return 1.25;
      if (h >= 16 && h < 19) return 1.3;
      if (h >= 11.5 && h < 13.5) return 1.1;
      return 1.03;
    },
  };
})();
