// Amatu Maps · map overlays: route lines, SPBU icons, result pins, saved places, accuracy circle, markers,
// day/night + base map state, measure tool geometry.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U, G = AM.G;
  const FC = f => ({ type: 'FeatureCollection', features: f || [] });
  const PT = (c, p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: p || {} });
  const LN = (c, p) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: p || {} });

  // draw one sprite symbol (#i-<id>) onto a canvas
  function glyph(ctx, id, x, y, s, col, lw = 2) {
    const sym = document.getElementById('i-' + id);
    if (!sym) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.fillStyle = col;
    for (const el of sym.children) {
      const fill = el.getAttribute('fill'), stroke = el.getAttribute('stroke'), tr = el.getAttribute('transform');
      ctx.save();
      if (tr) { const m = /rotate\((-?[\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(tr); if (m) { ctx.translate(+m[2], +m[3]); ctx.rotate(+m[1] * Math.PI / 180); ctx.translate(-m[2], -m[3]); } }
      let p = null;
      if (el.tagName === 'path') p = new Path2D(el.getAttribute('d'));
      else if (el.tagName === 'circle') { p = new Path2D(); p.arc(+el.getAttribute('cx'), +el.getAttribute('cy'), +el.getAttribute('r'), 0, Math.PI * 2); }
      else if (el.tagName === 'rect') {
        p = new Path2D(); const rx = +(el.getAttribute('rx') || 0), x0 = +el.getAttribute('x'), y0 = +el.getAttribute('y'), w = +el.getAttribute('width'), h = +el.getAttribute('height');
        if (p.roundRect) p.roundRect(x0, y0, w, h, rx); else p.rect(x0, y0, w, h);
      }
      if (p) {
        if (fill && fill !== 'none') { ctx.fillStyle = fill === 'currentColor' ? col : fill; ctx.fill(p); }
        if (stroke !== 'none') ctx.stroke(p);
      }
      ctx.restore();
    }
    ctx.restore();
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const x = c.getContext('2d'); x.scale(2, 2); return [c, x]; }
  function add(map, id, c) { const x = c.getContext('2d'); if (map.hasImage(id)) map.removeImage(id); map.addImage(id, x.getImageData(0, 0, c.width, c.height), { pixelRatio: 2 }); }

  function pinImg(fill, stroke, inner, g) {
    const [c, x] = canvas(28, 44);
    x.beginPath(); x.moveTo(14, 42); x.bezierCurveTo(14, 42, 1.5, 25, 1.5, 14); x.arc(14, 14, 12.5, Math.PI, 0); x.bezierCurveTo(26.5, 25, 14, 42, 14, 42); x.closePath();
    x.fillStyle = fill; x.fill(); x.strokeStyle = stroke; x.lineWidth = 1.4; x.stroke();
    if (g) glyph(x, g, 6.5, 6.5, 15, '#fff', 2.3);
    else { x.beginPath(); x.arc(14, 14, 5, 0, Math.PI * 2); x.fillStyle = inner; x.fill(); }
    return c;
  }
  function circImg(fill, g, label, txt = '#fff', d = 26) {
    const [c, x] = canvas(d + 4, d + 4), r = d / 2;
    x.beginPath(); x.arc(r + 2, r + 2, r, 0, Math.PI * 2); x.fillStyle = fill; x.fill(); x.lineWidth = 2; x.strokeStyle = '#fff'; x.stroke();
    if (label) { x.fillStyle = txt; x.font = '700 ' + (label.length > 1 ? 10.5 : 13) + 'px -apple-system, Roboto, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, r + 2, r + 2.5); }
    else if (g) glyph(x, g, r + 2 - d * 0.31, r + 2 - d * 0.31, d * 0.62, txt, 2.2);
    return c;
  }

  const M = AM.M = {
    dotImg() { if (!M._dot) { const [c, x] = canvas(14, 14); x.beginPath(); x.arc(7, 7, 4.6, 0, Math.PI * 2); x.fillStyle = '#8d939a'; x.fill(); x.lineWidth = 1.6; x.strokeStyle = '#fff'; x.stroke(); M._dot = x.getImageData(0, 0, c.width, c.height); } return M._dot; },
    map: null, st: { night: false, base: 'map', labels: true, b3d: false, transit: false, bike: false },
    images(map) {
      add(map, 'pin-red', pinImg('#ea4335', '#b31412', '#b31412'));
      add(map, 'pin-sel', pinImg('#ea4335', '#a50e0e', '#7a0b0b'));
      const [c, x] = canvas(14, 14); x.beginPath(); x.arc(7, 7, 5.2, 0, Math.PI * 2); x.fillStyle = '#ea4335'; x.fill(); x.lineWidth = 1.6; x.strokeStyle = '#fff'; x.stroke(); add(map, 'dot-red', c);
      AM.Q.CATS.forEach(k => add(map, 'cat-' + k.id, pinImg(k.c, 'rgba(0,0,0,.25)', null, k.ic)));
      AM.P.BR.forEach((b, i) => add(map, 'fuel-' + i, circImg(b.c, 'fuel', null, b.t)));
      add(map, 'fuel-r', circImg('#6a1b9a', null, 'R'));
      add(map, 'fuel-c', circImg('#00897b', 'ev'));
      add(map, 'fuel-x', circImg('#9aa0a6', 'fuel'));
      for (const [id, ic, col] of [['fav', 'heart', '#e8453c'], ['want', 'flag', '#188038'], ['star', 'star', '#f9ab00'], ['home', 'home', '#1a73e8'], ['work', 'work', '#8d5a2b'], ['other', 'bookmark', '#5f6368']])
        add(map, 'sv-' + id, circImg(col, ic, null, '#fff', 22));
    },
    init(map) {
      M.map = map;
      M.images(map);
      const b = AM.S.beforeId;
      const src = id => map.getSource(id) || map.addSource(id, { type: 'geojson', data: FC() });
      ['ov-route', 'ov-trav', 'ov-acc', 'ov-meas', 'ov-sv', 'ov-along', 'ov-sp', 'ov-saved', 'ov-res'].forEach(src);
      const W = (a, c) => ['interpolate', ['linear'], ['zoom'], 6, a, 12, a + c * .5, 18, a + c * 2];
      const L = (o, before) => { if (!map.getLayer(o.id)) map.addLayer(o, before); };
      L({ id: 'ov-acc', type: 'fill', source: 'ov-acc', paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.12 } }, b);
      L({ id: 'ov-acc-l', type: 'line', source: 'ov-acc', paint: { 'line-color': '#1a73e8', 'line-opacity': 0.35, 'line-width': 1 } }, b);
      L({ id: 'ov-route-altc', type: 'line', source: 'ov-route', filter: ['==', ['get', 'sel'], 0], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#7c9bd6', 'line-width': W(6, 5) } }, b);
      L({ id: 'ov-route-alt', type: 'line', source: 'ov-route', filter: ['==', ['get', 'sel'], 0], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#bccef8', 'line-width': W(4, 4) } }, b);
      L({ id: 'ov-route-c', type: 'line', source: 'ov-route', filter: ['all', ['==', ['get', 'sel'], 1], ['!=', ['get', 'walk'], 1]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1557b0', 'line-width': W(7, 5) } }, b);
      L({ id: 'ov-route-l', type: 'line', source: 'ov-route', filter: ['all', ['==', ['get', 'sel'], 1], ['!=', ['get', 'walk'], 1]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#4285f4', 'line-width': W(4.5, 4) } }, b);
      L({ id: 'ov-route-w', type: 'line', source: 'ov-route', filter: ['all', ['==', ['get', 'sel'], 1], ['==', ['get', 'walk'], 1]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': W(5, 4), 'line-dasharray': [0.1, 1.9] } }, b);
      L({ id: 'ov-trav', type: 'line', source: 'ov-trav', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#9aa0a6', 'line-width': W(4.5, 4) } }, b);
      L({ id: 'ov-meas-l', type: 'line', source: 'ov-meas', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#202124', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
      L({ id: 'ov-meas-p', type: 'circle', source: 'ov-meas', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#202124', 'circle-stroke-width': 2 } });
      L({ id: 'ov-sv', type: 'symbol', source: 'ov-sv', minzoom: 9, layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 14, 0.85], 'icon-allow-overlap': ['step', ['zoom'], false, 13, true],
        'text-field': ['step', ['zoom'], '', 14, ['get', 'title']], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 9 },
        paint: { 'text-color': '#c5221f', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } });
      L({ id: 'ov-along', type: 'symbol', source: 'ov-along', layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.8, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 13, ['get', 'title']], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 0.2], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#3c4043', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } });
      L({ id: 'ov-sp', type: 'symbol', source: 'ov-sp', layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 12, 0.85, 16, 1], 'icon-allow-overlap': true, 'symbol-sort-key': ['get', 'ord'],
        'text-field': ['step', ['zoom'], '', 10, ['get', 'lbl']], 'text-font': ['Noto Sans Bold'], 'text-size': 11.5, 'text-offset': [0, 1.25], 'text-anchor': 'top', 'text-optional': true, 'text-allow-overlap': false },
        paint: { 'text-color': ['case', ['==', ['get', 'past'], 1], '#80868b', '#137333'], 'text-halo-color': '#fff', 'text-halo-width': 1.6, 'icon-opacity': ['case', ['==', ['get', 'past'], 1], 0.45, 1] } });
      L({ id: 'ov-saved', type: 'symbol', source: 'ov-saved', minzoom: 5, layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.9, 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 12, ['get', 'title']], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#3c4043', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } });
      L({ id: 'ov-res', type: 'symbol', source: 'ov-res', layout: { 'icon-image': ['get', 'icon'], 'icon-anchor': ['case', ['==', ['get', 'dot'], 1], 'center', 'bottom'], 'icon-allow-overlap': true, 'symbol-sort-key': ['get', 'ord'],
        'text-field': ['get', 'title'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-anchor': 'left', 'text-offset': [1.1, -1.4], 'text-optional': true, 'text-max-width': 11 },
        paint: { 'text-color': '#c5221f', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
    },
    // night text halos for our symbol layers
    themeOverlays(night) {
      const map = M.map, halo = night ? '#111822' : '#ffffff';
      [['ov-sv', night ? '#f28b82' : '#c5221f'], ['ov-along', night ? '#e8eaed' : '#3c4043'], ['ov-saved', night ? '#e8eaed' : '#3c4043'], ['ov-res', night ? '#f28b82' : '#c5221f']].forEach(([id, col]) => {
        if (!map.getLayer(id)) return;
        map.setPaintProperty(id, 'text-color', col); map.setPaintProperty(id, 'text-halo-color', halo);
      });
      if (map.getLayer('ov-sp')) { map.setPaintProperty('ov-sp', 'text-halo-color', halo); map.setPaintProperty('ov-sp', 'text-color', ['case', ['==', ['get', 'past'], 1], '#80868b', night ? '#81c995' : '#137333']); }
      if (map.getLayer('ov-route-l')) {
        map.setPaintProperty('ov-route-alt', 'line-color', night ? '#5b6b8c' : '#bccef8');
        map.setPaintProperty('ov-route-altc', 'line-color', night ? '#3a465e' : '#7c9bd6');
        map.setPaintProperty('ov-route-c', 'line-color', night ? '#2a5fb8' : '#1557b0');
        map.setPaintProperty('ov-meas-l', 'line-color', night ? '#e8eaed' : '#202124');
        map.setPaintProperty('ov-meas-p', 'circle-stroke-color', night ? '#e8eaed' : '#202124');
        map.setPaintProperty('ov-meas-p', 'circle-color', night ? '#202124' : '#fff');
      }
    },
    data(id, fc) { const s = M.map && M.map.getSource(id); if (s) s.setData(fc || FC()); },
    setRoutes(routes, sel) {
      const f = [];
      routes.forEach((r, i) => { if (i !== sel) f.push(LN(r.coords, { i, sel: 0 })); });
      if (routes[sel]) f.push(LN(routes[sel].coords, { i: sel, sel: 1, walk: routes[sel].mode === 'walk' ? 1 : 0 }));
      M.data('ov-route', FC(f));
    },
    setTrav(coords) { M.data('ov-trav', coords && coords.length > 1 ? FC([LN(coords)]) : FC()); },
    // on-route stations; prog = metres travelled (labels show distance left), null = from the start
    setSpbu(list, prog) {
      M.data('ov-sp', FC((list || []).map((p, i) => {
        const left = p.s - (prog || 0), past = prog != null && left < -40;
        const lbl = prog != null ? (past ? '' : U.dist(left)) : 'km ' + U.num(p.s / 1000, p.s < 10000 ? 1 : 0);
        return PT([p.lng, p.lat], { ref: i, icon: p.k === 'r' ? 'fuel-r' : p.k === 'c' ? 'fuel-c' : 'fuel-' + (p.b >= 0 ? p.b : 0), lbl, past: past ? 1 : 0, ord: past ? 1000 + i : i });
      })));
    },
    setResults(list, sel) {
      const many = list.length > 12;
      M.data('ov-res', FC(list.map((r, i) => PT([r.lng, r.lat], { ref: i, title: i === sel ? '' : r.name, icon: r.catId ? 'cat-' + r.catId : many && i !== sel ? 'dot-red' : 'pin-red', dot: !r.catId && many && i !== sel ? 1 : 0, ord: i }))));
    },
    setAlong(list, cat) { M.data('ov-along', FC((list || []).map((p, i) => PT([p.lng, p.lat], { ref: i, title: p.name || cat.n, icon: 'cat-' + cat.id })))); },
    setSaved(on) {
      const D = AM.D, f = [];
      if (on) {
        D.saved.items.forEach(it => f.push(PT([it.lng, it.lat], { ref: it.id, title: it.name, icon: 'sv-' + (['fav', 'want', 'star'].includes(it.list) ? it.list : 'other') })));
        if (D.saved.home) f.push(PT([D.saved.home.lng, D.saved.home.lat], { ref: 'home', title: 'Rumah', icon: 'sv-home' }));
        if (D.saved.work) f.push(PT([D.saved.work.lng, D.saved.work.lat], { ref: 'work', title: 'Kantor', icon: 'sv-work' }));
      }
      M.data('ov-saved', FC(f));
    },
    setSpbuView(list) {
      M.data('ov-sv', FC((list || []).map((p, i) => PT([p.lng, p.lat], { ref: i, title: AM.P.title(p), icon: p.k === 'c' ? 'fuel-c' : p.k === 'r' ? 'fuel-r' : 'fuel-' + (p.b >= 0 ? p.b : 0) }))));
    },
    setAcc(ll, m) { M.data('ov-acc', ll && m > 8 ? FC([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [G.circle(ll, m)] }, properties: {} }]) : FC()); },
    setMeasure(pts, closed) {
      const f = pts.map(p => PT(p));
      if (pts.length > 1) f.push(LN(closed ? pts.concat([pts[0]]) : pts));
      M.data('ov-meas', FC(f));
    },
    // ---------- HTML markers ----------
    pin: null,
    showPin(ll) {
      if (!ll) { if (M.pin) M.pin.remove(); M.pin = null; return; }
      if (!M.pin) {
        const el = document.createElement('div'); el.className = 'mk-pin';
        el.innerHTML = '<svg viewBox="0 0 28 44"><path d="M14 42S1.5 25 1.5 14a12.5 12.5 0 0 1 25 0C26.5 25 14 42 14 42z" fill="#ea4335" stroke="#a50e0e" stroke-width="1.4"/><circle cx="14" cy="14" r="5" fill="#7a0b0b"/></svg>';
        M.pin = new maplibregl.Marker({ element: el, anchor: 'bottom' });
      }
      M.pin.setLngLat(ll).addTo(M.map);
    },
    wpMarkers: [],
    showWps(pts, onDrag) {
      M.wpMarkers.forEach(m => m.remove()); M.wpMarkers = [];
      const n = pts.length;
      pts.forEach((p, i) => {
        if (!p || (p.gps && i === 0)) return;
        let el;
        if (i === n - 1) { el = document.createElement('div'); el.className = 'mk-pin'; el.innerHTML = '<svg viewBox="0 0 28 44"><path d="M14 42S1.5 25 1.5 14a12.5 12.5 0 0 1 25 0C26.5 25 14 42 14 42z" fill="#ea4335" stroke="#a50e0e" stroke-width="1.4"/><circle cx="14" cy="14" r="5" fill="#7a0b0b"/></svg>'; }
        else { el = document.createElement('div'); el.className = 'mk-wp' + (i > 0 ? ' mid' : ''); if (i > 0) el.textContent = i; }
        el.title = p.name || '';
        const mk = new maplibregl.Marker({ element: el, anchor: i === n - 1 ? 'bottom' : 'center', draggable: true }).setLngLat([p.lng, p.lat]).addTo(M.map);
        mk.on('dragend', () => { const ll = mk.getLngLat(); onDrag(i, [ll.lng, ll.lat]); });
        M.wpMarkers.push(mk);
      });
    },
    tagMarkers: [],
    showTags(routes, sel, onPick) {
      M.tagMarkers.forEach(m => m.remove()); M.tagMarkers = [];
      if (!routes.length) return;
      const main = routes[sel];
      routes.forEach((r, i) => {
        let at;
        if (i === sel) at = G.at(r.coords, r.cum, r.dist * 0.5).pt;
        else {                                  // where the alternative is farthest from the chosen route
          let best = -1;
          for (let s = r.dist * 0.15; s < r.dist * 0.85; s += r.dist / 40) {
            const p = G.at(r.coords, r.cum, s).pt, d = G.nearest(main.coords, main.cum, p).d;
            if (d > best) { best = d; at = p; }
          }
        }
        if (!at) return;
        const el = document.createElement('div');
        el.className = 'mk-tag' + (i === sel ? ' on' : '');
        el.innerHTML = U.esc(U.dur(r.time * (r.fac || 1))) + (r.toll ? '<small>tol</small>' : '');
        el.onclick = e => { e.stopPropagation(); onPick(i); };
        M.tagMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat(at).addTo(M.map));
      });
    },
    clearRoute() { M.setRoutes([], 0); M.setSpbu([]); M.setAlong([]); M.setTrav(null); M.showWps([], () => { }); M.showTags([], 0); },
    me: null, meEl: null,
    showMe(ll, heading, o = {}) {
      if (!ll) { if (M.me) M.me.remove(); M.me = null; return; }
      if (!M.me) {
        const el = M.meEl = document.createElement('div'); el.className = 'mk-me';
        el.innerHTML = '<div class="cone"></div><div class="dot"></div><svg class="arw" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="#fff" opacity=".96"/><path d="M22 7 33 34 22 28 11 34z" fill="#1a73e8" stroke="#1557b0" stroke-width="1.2" stroke-linejoin="round"/></svg>';
        M.me = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(ll).addTo(M.map);
      }
      M.me.setLngLat(ll);
      M.meEl.classList.toggle('nav', !!o.nav);
      M.meEl.classList.toggle('hd', isFinite(heading) && !o.nav);
      M.meEl.classList.toggle('stale', !!o.stale);
      M.me.setRotation(isFinite(heading) ? heading : 0);
      if (o.nav) M.me.setPitchAlignment('map');
    },
    // padding that keeps the panel / sheet / search box clear
    pad(extra = 0) {
      const mob = U.mobile(), panel = !document.getElementById('panel').hidden && !document.body.classList.contains('pclosed');
      if (mob) { const sh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sh-h')) || 0; return { top: 120 + extra, bottom: Math.min(innerHeight * 0.6, sh) + 30 + extra, left: 36 + extra, right: 36 + extra }; }
      return { top: 90 + extra, bottom: 60 + extra, left: (panel ? 408 : 0) + 60 + extra, right: 80 + extra };
    },
    fit(bb, o = {}) {
      if (!bb) return;
      const map = M.map, p = M.pad();
      const w = map.getContainer().clientWidth - p.left - p.right, h = map.getContainer().clientHeight - p.top - p.bottom;
      if (w < 80 || h < 80) { map.easeTo({ center: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], zoom: Math.min(o.maxZoom || 15, map.getZoom()) }); return; }
      map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: p, maxZoom: o.maxZoom || 16, duration: U.reduced() ? 0 : (o.duration != null ? o.duration : 700), bearing: o.keepBearing ? map.getBearing() : 0, pitch: o.pitch != null ? o.pitch : (map.getPitch() > 40 && !AM.N.on ? 0 : map.getPitch()) });
    },
    fly(ll, z, o = {}) {
      const map = M.map, p = M.pad();
      const off = [(p.left - p.right) / 2, (p.top - p.bottom) / 2];
      const far = map.getBounds && !map.getBounds().contains(ll);
      const opt = { center: ll, zoom: z != null ? z : Math.max(map.getZoom(), 15), offset: off, duration: U.reduced() ? 0 : 800 };
      if (far && map.getZoom() < 9) map.flyTo(opt); else map.easeTo(opt);
      void o;
    },
  };
})();
