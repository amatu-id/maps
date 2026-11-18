// Amatu Maps · app: map, search, categories, location, layers, day/night, context menu, measure, menu, settings.
(function () {
  'use strict';
  const AM = window.AM;
  const { U, G, Q, R, P, D, M, S, PV, DIR, N, AC } = AM;
  const $ = U.$, esc = U.esc, ic = U.ic;
  const LOCALE = {
    'AttributionControl.ToggleAttribution': 'Atribusi', 'AttributionControl.MapFeedback': 'Masukan peta', 'Map.Title': 'Peta',
    'NavigationControl.ResetBearing': 'Hadap utara', 'NavigationControl.ZoomIn': 'Perbesar', 'NavigationControl.ZoomOut': 'Perkecil',
    'ScaleControl.Feet': 'kaki', 'ScaleControl.Meters': 'm', 'ScaleControl.Kilometers': 'km', 'ScaleControl.Miles': 'mil', 'ScaleControl.NauticalMiles': 'nm',
  };
  const ui = U.get('pt.maps.ui', {}) || {};
  M.st = Object.assign({ base: 'map', labels: true, b3d: false, transit: false, bike: false, spbuAll: false }, ui.layers || {});
  M.st.labels = D.cfg.labels !== false;

  const A = AM.A = {
    map: null,
    st: { user: null, acc: null, heading: NaN, speed: 0, loc: 'off', watch: null, waiters: [], night: null, compass: NaN, fixT: 0 },
    center() { const c = A.map.getCenter(); return [c.lng, c.lat]; },
  };

  // ================= map =================
  async function boot() {
    let style;
    try { style = await S.load(); }
    catch (e) { $('#map').innerHTML = '<div class="empty" style="padding-top:30vh">Peta gagal dimuat. Periksa koneksi internet lalu muat ulang.</div>'; return; }
    const v = U.get('pt.maps.view', null);
    const map = A.map = new maplibregl.Map({
      container: 'map', style, center: v ? v.c : [117.8, -2.6], zoom: v ? v.z : 4.4, bearing: v ? v.b || 0 : 0, pitch: v ? v.p || 0 : 0,
      attributionControl: false, maxPitch: 70, locale: LOCALE, fadeDuration: 120, clickTolerance: 4, dragRotate: true, touchPitch: true,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Rute <a href="https://valhalla1.openstreetmap.de" target="_blank">Valhalla/FOSSGIS</a> · Cari <a href="https://photon.komoot.io" target="_blank">Photon</a>' }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 90 }), 'bottom-right');
    map.keyboard.enable();
    A.map = map;
    map.on('load', () => {
      const at = document.querySelector('.maplibregl-ctrl-attrib');
      if (at && U.mobile()) at.classList.remove('maplibregl-compact-show');
      M.init(map);
      A.theme(true);
      M.setSaved(D.cfg.savedMap);
      A.drawPark();
      chips();
      layersThumb();
      A.hash();
      A.checkKirim();
      if (!v) navigator.permissions && navigator.permissions.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') A.locate({ fly: true, quiet: true }).catch(() => { }); }).catch(() => { });
      else if (navigator.permissions) navigator.permissions.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') A.locate({ quiet: true }).catch(() => { }); }).catch(() => { });
    });
    map.on('sourcedata', e => { if (e.sourceId === 'openmaptiles') { const s = map.getSource('openmaptiles'); if (s && s.tiles && s.tiles[0]) Q.setTiles(s.tiles[0]); } });
    map.on('styleimagemissing', e => {
      if (/^(cat|fuel|sv|pin|dot)-/.test(e.id)) return M.images(map);
      if (!map.hasImage(e.id)) map.addImage(e.id, M.dotImg(), { pixelRatio: 2 });
    });
    map.on('moveend', U.debounce(() => {
      const c = map.getCenter();
      U.set('pt.maps.view', { c: [+c.lng.toFixed(6), +c.lat.toFixed(6)], z: +map.getZoom().toFixed(2), b: N.on ? 0 : +map.getBearing().toFixed(1), p: N.on ? 0 : +map.getPitch().toFixed(1) });
      if (M.st.spbuAll) spbuView();
    }, 400));
    map.on('rotate', northBtn); map.on('pitch', northBtn);
    map.on('pitchend', () => { if (M.st.base === 'terrain') S.apply(map, Object.assign({}, M.st, { night: A.st.night })); });
    map.on('click', onClick);
    map.on('contextmenu', e => { if (!U.mobile()) ctxMenu(e.lngLat, e.point); });
    longPress(map);
    ['ov-res', 'ov-sp', 'ov-along', 'ov-saved', 'ov-sv', 'ov-route-alt', 'poi_r1', 'poi_r7', 'poi_r20', 'poi_transit', 'airport'].forEach(l => {
      map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
    });
    setInterval(() => A.theme(), 60000);
  }

  // ================= day / night =================
  A.theme = (force) => {
    const map = A.map; if (!map || !map.isStyleLoaded()) { if (map) map.once('idle', () => A.theme(force)); return; }
    const mode = D.cfg.theme;
    let night;
    if (mode === 'night') night = true;
    else if (mode === 'day') night = false;
    else {
      const c = A.st.user || A.center(), t = G.sun(new Date(), c[1], c[0]), now = Date.now();
      night = t ? (now < +t.rise - 15 * 6e4 || now > +t.set + 20 * 6e4) : (new Date().getHours() < 6 || new Date().getHours() >= 18);
    }
    const ch = night !== A.st.night;
    A.st.night = night;
    if (ch || force) {
      document.documentElement.dataset.theme = night ? 'dark' : 'light';
      const mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.content = night ? '#202124' : '#ffffff';
      S.apply(map, Object.assign({}, M.st, { night }));
      M.themeOverlays(night);
    }
    const b = $('#bTheme');
    b.innerHTML = ic(night ? 'moon' : 'sun') + '<i>' + (mode === 'auto' ? 'A' : '') + '</i>';
    b.title = 'Mode ' + (mode === 'auto' ? 'otomatis (' + (night ? 'malam' : 'siang') + ' sekarang)' : night ? 'malam' : 'siang') + ' — ketuk untuk ganti';
  };
  $('#bTheme').onclick = () => {
    const order = ['auto', 'day', 'night'], cur = D.cfg.theme, nx = order[(order.indexOf(cur) + 1) % 3];
    D.cfg.theme = nx; D.saveCfg(); A.theme(true);
    U.toast(nx === 'auto' ? 'Mode otomatis: ikut matahari terbit/terbenam (' + (A.st.night ? 'malam' : 'siang') + ' sekarang)' : nx === 'day' ? 'Mode siang' : 'Mode malam', { key: 'theme' });
  };

  // ================= layers =================
  function saveUi() { U.set('pt.maps.ui', Object.assign({}, U.get('pt.maps.ui', {}), { layers: M.st })); }
  function layersThumb() {
    const c = A.center(), z = Math.max(3, Math.min(15, Math.round(A.map.getZoom()))), [x, y] = G.tile(c[0], c[1], z);
    const th = $('#bLayers .th');
    th.style.backgroundImage = M.st.base === 'sat' ? 'linear-gradient(135deg,#f1efe9,#cfe6c3 45%,#a7d3f6)' : 'url("' + S.satThumb(z, x, y) + '")';
    $('#bLayers b').innerHTML = ic('layers') + (M.st.base === 'sat' ? 'Peta' : 'Satelit');
  }
  function setBase(b) {
    M.st.base = b; saveUi();
    S.apply(A.map, Object.assign({}, M.st, { night: A.st.night }));
    M.themeOverlays(A.st.night);
    layersThumb(); if (!$('#layers').hidden) layersMenu();
  }
  $('#bLayers').onclick = e => {
    if (U.mobile() || e.detail === 0) return layersMenu(true);
    setBase(M.st.base === 'sat' ? 'map' : 'sat');
  };
  $('#bLayers').oncontextmenu = e => { e.preventDefault(); layersMenu(true); };
  let hoverT;
  $('#bLayers').onmouseenter = () => { clearTimeout(hoverT); hoverT = setTimeout(() => { if ($('#layers').hidden) layersMenu(); }, 450); };
  $('#bLayers').onmouseleave = () => clearTimeout(hoverT);
  function layersMenu(toggle) {
    const box = $('#layers');
    if (toggle && !box.hidden && !box.matches(':hover')) { box.hidden = true; return; }
    const z = Math.round(A.map.getZoom()), c = A.center(), [x, y] = G.tile(c[0], c[1], Math.max(3, Math.min(15, z)));
    const opt = (k, n, bg, icn) => '<button class="lopt' + (M.st.base === k ? ' on' : '') + '" data-b="' + k + '"><i style="' + bg + '">' + (icn ? ic(icn) : '') + '</i>' + n + '</button>';
    const det = (k, n, icn) => '<button class="lopt' + (M.st[k] ? ' on' : '') + '" data-d="' + k + '"><i>' + ic(icn) + '</i>' + n + '</button>';
    box.innerHTML = '<h4>Jenis peta</h4><div class="lgrid">' +
      opt('map', 'Default', 'background:linear-gradient(135deg,#f1efe9,#cfe6c3 45%,#a7d3f6)') + opt('sat', 'Satelit', 'background-image:url(' + S.satThumb(Math.max(3, Math.min(15, z)), Math.max(0, Math.min(2 ** Math.max(3, Math.min(15, z)) - 1, x)), y) + ')') + opt('terrain', 'Medan', 'background:linear-gradient(135deg,#d9d3c3,#9fae8c 50%,#6f7f64)', 'cube') + '</div>' +
      '<h4>Detail peta</h4><div class="lgrid">' + det('spbuAll', 'Semua SPBU', 'fuel') + det('transit', 'Transportasi', 'bus') + det('bike', 'Bersepeda', 'bike') + det('b3d', 'Gedung 3D', 'cube') + det('saved', 'Tersimpan', 'bookmark').replace('lopt' + (M.st.saved ? ' on' : ''), 'lopt' + (D.cfg.savedMap ? ' on' : '')) + det('labels', 'Label', 'text') .replace(ic('text'), ic('list')) + '</div>' +
      '<h4>Tampilan</h4><div class="seg" style="width:100%"><button style="flex:1" data-t="auto" class="' + (D.cfg.theme === 'auto' ? 'on' : '') + '">Otomatis</button><button style="flex:1" data-t="day" class="' + (D.cfg.theme === 'day' ? 'on' : '') + '">' + ic('sun') + ' Siang</button><button style="flex:1" data-t="night" class="' + (D.cfg.theme === 'night' ? 'on' : '') + '">' + ic('moon') + ' Malam</button></div>';
    box.hidden = false;
    box.onclick = e => {
      const b = e.target.closest('[data-b],[data-d],[data-t]'); if (!b) return;
      if (b.dataset.b) return setBase(b.dataset.b);
      if (b.dataset.t) { D.cfg.theme = b.dataset.t; D.saveCfg(); A.theme(true); return layersMenu(); }
      const k = b.dataset.d;
      if (k === 'saved') { D.cfg.savedMap = !D.cfg.savedMap; D.saveCfg(); M.setSaved(D.cfg.savedMap); return layersMenu(); }
      if (k === 'labels') { M.st.labels = !M.st.labels; D.cfg.labels = M.st.labels; D.saveCfg(); }
      else M.st[k] = !M.st[k];
      saveUi();
      if (k === 'b3d') { $('#b3d').classList.toggle('on', M.st.b3d); if (M.st.b3d && A.map.getPitch() < 30) A.map.easeTo({ pitch: 60, zoom: Math.max(A.map.getZoom(), 16) }); }
      if (k === 'spbuAll') { if (M.st.spbuAll) { spbuView(); if (A.map.getZoom() < 9) U.toast('Perbesar peta untuk melihat SPBU'); } else M.setSpbuView([]); }
      S.apply(A.map, Object.assign({}, M.st, { night: A.st.night }));
      layersMenu();
    };
    box.onmouseleave = () => { if (!U.mobile()) setTimeout(() => { if (!box.matches(':hover') && !$('#bLayers').matches(':hover')) box.hidden = true; }, 300); };
  }
  async function spbuView() {
    const map = A.map;
    if (!M.st.spbuAll || map.getZoom() < 8.5) { M.setSpbuView([]); return; }
    const b = map.getBounds();
    try { const l = await P.inBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], ['f', 'c', 'r']); M.setSpbuView(l.slice(0, 2500)); } catch (e) { /* dataset offline */ }
  }
  $('#b3d').onclick = () => {
    M.st.b3d = !M.st.b3d; saveUi();
    $('#b3d').classList.toggle('on', M.st.b3d);
    S.apply(A.map, Object.assign({}, M.st, { night: A.st.night }));
    A.map.easeTo({ pitch: M.st.b3d ? 60 : 0, zoom: M.st.b3d ? Math.max(A.map.getZoom(), 15.5) : A.map.getZoom(), duration: 800 });
  };
  $('#b3d').classList.toggle('on', M.st.b3d);
  function northBtn() {
    const b = $('#bNorth'), map = A.map;
    b.hidden = Math.abs(map.getBearing()) < 1 && map.getPitch() < 1;
    b.querySelector('.ic').style.transform = 'rotate(' + (-map.getBearing()) + 'deg)';
  }
  $('#bNorth').onclick = () => A.map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
  $('#bZin').onclick = () => A.map.zoomIn();
  $('#bZout').onclick = () => A.map.zoomOut();
  document.addEventListener('pointerdown', e => { const l = $('#layers'); if (!l.hidden && !l.contains(e.target) && !$('#bLayers').contains(e.target)) l.hidden = true; });

  // ================= location =================
  A.locate = (o = {}) => new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Perangkat tidak mendukung GPS'));
    if (A.st.user && Date.now() - A.st.fixT < 30000) { if (o.fly) M.fly(A.st.user, Math.max(A.map.getZoom(), 16)); return res(A.st.user); }
    A.st.waiters.push({ res, rej, o });
    if (A.st.watch == null) {
      A.st.watch = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 1500, timeout: 25000 });
      compassOn();
    }
  });
  function onPos(pos) {
    const c = pos.coords, first = !A.st.user;
    A.st.user = [c.longitude, c.latitude]; A.st.acc = c.accuracy; A.st.fixT = Date.now();
    A.st.speed = isFinite(c.speed) && c.speed != null ? c.speed : 0;
    if (isFinite(c.heading) && c.heading != null && A.st.speed > 1.5) A.st.heading = c.heading;
    const hd = A.st.speed > 1.5 && isFinite(A.st.heading) ? A.st.heading : A.st.compass;
    if (N.on) N.fix({ ll: A.st.user, acc: c.accuracy, heading: A.st.speed > 1.5 ? A.st.heading : NaN, speed: A.st.speed, t: pos.timestamp || Date.now() });
    else { M.showMe(A.st.user, hd); M.setAcc(A.st.user, c.accuracy); }
    const ws = A.st.waiters.splice(0);
    ws.forEach(w => { if (w.o.fly) M.fly(A.st.user, Math.max(A.map.getZoom(), 16)); w.res(A.st.user); });
    if (A.st.loc === 'follow' && !N.on) A.map.easeTo({ center: A.st.user, duration: 600 });
    if (first) { A.theme(); locBtn(); if (DIR.pts && !DIR.pts[0] && PV.is('dir')) { DIR.pts[0] = DIR.gps(); DIR.drawHead(); DIR.compute(); } }
    progT();
  }
  const progT = U.throttle(() => { if (DIR.route()) DIR.updateProg(); }, 1500);
  function onPosErr(err) {
    const ws = A.st.waiters.splice(0);
    const msg = err.code === 1 ? 'Akses lokasi ditolak. Izinkan lokasi untuk situs ini di pengaturan browser.' : err.code === 3 ? 'GPS belum mendapat sinyal. Coba di tempat terbuka.' : 'Lokasi tidak tersedia saat ini.';
    if (ws.some(w => !w.o.quiet)) U.toast(msg, { kind: 'bad', key: 'geo' });
    ws.forEach(w => w.rej(new Error(msg)));
    if (err.code === 1) { navigator.geolocation.clearWatch(A.st.watch); A.st.watch = null; A.st.loc = 'off'; locBtn(); }
  }
  function compassOn() {
    const h = e => {
      let hd = null;
      if (e.webkitCompassHeading != null) hd = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) hd = (360 - e.alpha) % 360;
      if (hd == null) return;
      hd = (hd + (screen.orientation ? screen.orientation.angle || 0 : 0)) % 360;
      A.st.compass = hd;
      if (A.st.user && !N.on && !(A.st.speed > 1.5)) M.showMe(A.st.user, hd);
      if (A.st.loc === 'compass' && !N.on) A.map.easeTo({ bearing: hd, duration: 200 });
    };
    if ('ondeviceorientationabsolute' in window) addEventListener('deviceorientationabsolute', h);
    else addEventListener('deviceorientation', h);
  }
  function locBtn() {
    const b = $('#bLoc'), s = A.st.loc;
    b.innerHTML = ic(s === 'compass' ? 'headup' : s === 'off' ? 'locate' : 'locon');
    b.classList.toggle('on', s !== 'off');
  }
  $('#bLoc').onclick = async () => {
    const s = A.st.loc;
    if (s === 'off' || !A.st.user) {
      A.st.loc = 'follow'; locBtn();
      if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().catch(() => { });
      try { await A.locate({ fly: true }); } catch (e) { A.st.loc = 'off'; locBtn(); }
      return;
    }
    const centered = G.dist(A.center(), A.st.user) < 30;
    if (!centered) { A.st.loc = 'follow'; M.fly(A.st.user, Math.max(A.map.getZoom(), 16)); }
    else if (s === 'follow' && U.mobile() && isFinite(A.st.compass)) { A.st.loc = 'compass'; }
    else { A.st.loc = 'follow'; A.map.easeTo({ bearing: 0, duration: 400 }); }
    locBtn();
  };
  const stopFollow = e => { if (e.originalEvent && A.st.loc !== 'off' && !N.on) { A.st.loc = 'on'; locBtn(); } };

  // ================= search =================
  const q = $('#q');
  const sac = AC.attach(q, {
    box: $('#sugg'),
    onPick: it => {
      if (it.q) { q.value = it.q; return A.search(it.q); }
      q.value = it.name;
      if (it.coord) return A.openPlace({ name: 'Titik koordinat', lng: it.lng, lat: it.lat });
      A.openPlace(it);
    },
    onEnter: v => A.search(v),
    onInput: () => { $('#bClear').hidden = !q.value; },
  });
  $('#sbox').onsubmit = e => { e.preventDefault(); sac.hide(); A.search(q.value.trim()); q.blur(); };
  $('#bClear').onclick = () => { q.value = ''; $('#bClear').hidden = true; sac.hide(); if (PV.is('results') || PV.is('place')) PV.close(); q.focus(); };
  $('#bDir').onclick = () => {
    const c = PV.cur();
    if (c && c.view === 'place') return DIR.open({ to: c.data });
    DIR.open({});
  };
  const CAT_WORDS = [[/^(spbu|pom bensin|pom|bensin|pertamina|shell|bbm|gas station)$/i, 'spbu'], [/^(restoran|resto|rumah makan|makan|warung|kuliner|restaurant)$/i, 'makan'], [/^(kafe|cafe|kopi|coffee|kedai kopi)$/i, 'kafe'],
    [/^(minimarket|indomaret|alfamart|supermarket|toko)$/i, 'mart'], [/^(atm|bank)$/i, 'atm'], [/^(masjid|musholla|mushola|musala)$/i, 'masjid'], [/^(hotel|penginapan|losmen)$/i, 'hotel'],
    [/^(rumah sakit|rs|klinik|puskesmas)$/i, 'rs'], [/^(apotek|apotik)$/i, 'apotek'], [/^(parkir|parking)$/i, 'parkir'], [/^(bengkel|tambal ban)$/i, 'bengkel'], [/^(spklu|charging|cas mobil)$/i, 'spklu'], [/^(wisata|tempat wisata)$/i, 'wisata'], [/^(toilet|wc)$/i, 'toilet']];
  A.search = async text => {
    text = (text || '').trim(); if (!text) return;
    q.value = text; $('#bClear').hidden = false;
    const c = G.parse(text, A.center());
    if (c) return A.openPlace({ name: 'Titik koordinat', lng: c[0], lat: c[1] });
    const cw = CAT_WORDS.find(([re]) => re.test(text));
    if (cw) { D.pushRecent({ q: text }); return A.searchCat(cw[1]); }
    D.pushRecent({ q: text });
    const data = { title: text, items: [], loading: true };
    PV.open('results', data, { root: true });
    try {
      const res = await Q.suggest(text, A.center(), { zoom: A.map.getZoom(), limit: 20 });
      const u = A.st.user || A.center();
      data.items = res.map(r => Object.assign(r, { dist: U.dist(G.dist(u, [r.lng, r.lat])) }));
      data.loading = false;
      if (!PV.is('results') || PV.cur().data !== data) return;
      if (res.length === 1) return A.openPlace(res[0], { replace: true });
      PV.refresh();
      if (res.length) M.fit(G.bbox(res.map(r => [r.lng, r.lat])), { maxZoom: 15 });
    } catch (e) { data.loading = false; data.err = 'Pencarian gagal. Periksa koneksi lalu coba lagi.'; PV.refresh(); }
  };
  A.searchCat = async id => {
    const cat = Q.catOf(id); if (!cat) return;
    chipsOn(id);
    const map = A.map;
    if (map.getZoom() < 11.5) { const u = A.st.user && G.dist(A.st.user, A.center()) < 60000 ? A.st.user : A.center(); map.jumpTo({ center: u, zoom: 13.5 }); }
    const b = map.getBounds(), bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], ctr = A.center(), u = A.st.user || ctr;
    const data = { title: cat.n + ' di sekitar', items: [], loading: true, cat: id };
    PV.open('results', data, { root: true });
    try {
      let items = [];
      if (id === 'spbu' || id === 'spklu') {
        const rows = await P.inBox(bounds, [id === 'spbu' ? 'f' : 'c']).catch(() => []);
        items = rows.map(p => ({ name: P.title(p), cat: id === 'spbu' ? (p.b > 0 ? 'SPBU · ' + P.brand(p.b).n : 'SPBU') : 'SPKLU', lng: p.lng, lat: p.lat, spbu: p.k === 'f' ? p : null, catId: id, d: G.dist(u, [p.lng, p.lat]), oh: p.oh, osm: p.id ? { t: p.id[0].toUpperCase(), id: p.id.slice(1) } : null }));
      }
      if (!items.length) {
        const pois = await Q.nearby(cat, ctr, bounds);
        items = pois.map(p => ({ name: p.name || cat.n, cat: Q.catLabel('amenity', p.subclass) || cat.n, lng: p.lng, lat: p.lat, catId: id, d: G.dist(u, [p.lng, p.lat]), osm: p.id ? { t: p.id[0].toUpperCase(), id: p.id.slice(1) } : null }));
      }
      if (items.length < 5 && cat.q) {          // names the tiles don't carry (unnamed bengkel/parkir): Photon text search in view
        for (const word of cat.q.split(' ').slice(0, 3)) {
          const ph = await Q.suggest(word, ctr, { bbox: bounds, limit: 15, timeout: 8000 }).catch(() => []);
          for (const r of ph) if (!items.some(x => G.dist([x.lng, x.lat], [r.lng, r.lat]) < 30)) items.push(Object.assign(r, { catId: id, d: G.dist(u, [r.lng, r.lat]) }));
          if (items.length >= 10) break;
        }
      }
      items.sort((a, b) => a.d - b.d);
      items = items.slice(0, 60);
      items.forEach(x => { x.dist = U.dist(x.d); });
      data.items = items; data.loading = false;
      if (PV.cur() && PV.cur().data === data) { PV.refresh(); if (items.length > 1) M.fit(G.bbox(items.slice(0, 20).map(x => [x.lng, x.lat])), { maxZoom: 16 }); }
    } catch (e) { data.loading = false; data.err = 'Gagal memuat tempat sekitar.'; PV.refresh(); }
  };
  function chips() {
    const box = $('#chips');
    box.innerHTML = Q.CATS.filter(c => c.id !== 'toilet').map(c => '<button class="chip" data-c="' + c.id + '">' + '<span style="color:' + c.c + ';display:flex">' + ic(c.ic) + '</span>' + esc(c.n) + '</button>').join('');
    box.onclick = e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      if (b.classList.contains('on')) { chipsOn(null); if (PV.is('results')) PV.close(); return; }
      A.searchCat(b.dataset.c);
    };
  }
  function chipsOn(id) { U.$$('#chips .chip').forEach(c => c.classList.toggle('on', c.dataset.c === id)); }
  A.nearbyPrompt = async ll => {
    const opts = Q.CATS.map(c => '<button class="chip" data-c="' + c.id + '" style="margin:4px"><span style="color:' + c.c + ';display:flex">' + ic(c.ic) + '</span>' + esc(c.n) + '</button>').join('');
    const id = await U.modal('Cari di sekitar sini', '<div style="display:flex;flex-wrap:wrap">' + opts + '</div>', [], {
      onOpen: (w, close) => w.querySelectorAll('[data-c]').forEach(b => { b.onclick = () => close(b.dataset.c); }),
    });
    if (id) { A.map.jumpTo({ center: ll, zoom: Math.max(14, A.map.getZoom()) }); A.searchCat(id); }
  };

  // ================= places =================
  A.openPlace = (p, o = {}) => {
    if (!p) return;
    const place = Object.assign({}, p);
    if (!place.name) place.name = 'Titik di peta';
    const u = A.st.user;
    if (u && !place.dist) place.dist = U.dist(G.dist(u, [place.lng, place.lat]));
    const cur = PV.cur();
    PV.open('place', place, { replace: o.replace || (cur && cur.view === 'place') });
    if (!o.nofly) M.fly([place.lng, place.lat], Math.max(A.map.getZoom(), place.spbu ? 16 : 15.5));
    if (place.name && place.name !== 'Titik di peta' && place.name !== 'Pin dijatuhkan' && place.name !== 'Titik koordinat') D.pushRecent({ name: place.name, addr: place.addr || '', lng: place.lng, lat: place.lat, cat: place.cat || '', osm: place.osm || null });
  };
  A.onPanelClosed = () => { chipsOn(null); M.showPin(null); M.setResults([]); };
  A.saveDialog = async p => {
    const near = D.near(p.lng, p.lat, 30);
    const lists = D.saved.lists.map(l => '<label class="line" style="cursor:pointer"><span style="display:flex;gap:12px;align-items:center"><span style="color:' + esc(l.c) + ';display:flex">' + ic(l.ic || 'bookmark') + '</span>' + esc(l.n) + '</span><input type="checkbox" data-l="' + esc(l.id) + '"' + (near.some(i => i.list === l.id) ? ' checked' : '') + '></label>').join('');
    const res = await U.modal('Simpan ke daftar', '<div class="set">' + lists + '</div><label class="fld">Catatan (opsional)<input id="note" maxlength="140" value="' + esc((near[0] && near[0].note) || '') + '"></label>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button class="btn sm" data-lab="home">' + ic('home') + 'Jadikan Rumah</button><button class="btn sm" data-lab="work">' + ic('work') + 'Jadikan Kantor</button></div>',
      [{ label: 'Batal', value: null }, { label: 'Simpan', kind: 'pri', fn: w => ({ lists: U.$$('input[data-l]', w).filter(i => i.checked).map(i => i.dataset.l), note: w.querySelector('#note').value.trim() }) }],
      { onOpen: (w, close) => w.querySelectorAll('[data-lab]').forEach(b => { b.onclick = () => { D.setLabel(b.dataset.lab, p); M.setSaved(D.cfg.savedMap); U.toast((b.dataset.lab === 'home' ? 'Rumah' : 'Kantor') + ' disimpan'); close(null); }; }) });
    if (!res) return;
    near.filter(i => !res.lists.includes(i.list)).forEach(i => D.delSaved(i.id));
    res.lists.forEach(l => { const ex = near.find(i => i.list === l); if (ex) { ex.note = res.note; D.saveSaved(); } else { const it = D.addSaved(l, p); it.note = res.note; D.saveSaved(); } });
    M.setSaved(D.cfg.savedMap);
    U.toast(res.lists.length ? 'Disimpan ke ' + res.lists.map(id => (D.saved.lists.find(l => l.id === id) || {}).n).join(', ') : 'Dihapus dari tersimpan');
    if (PV.is('place')) PV.refresh();
  };
  A.labelDialog = async which => {
    const n = which === 'home' ? 'Rumah' : 'Kantor', cur = D.saved[which];
    let picked = null;
    const r = await U.modal('Atur ' + n, '<label class="fld">Cari alamat ' + n.toLowerCase() + '<input id="la" placeholder="Ketik alamat atau nama tempat" value="' + esc(cur ? cur.name : '') + '"></label>' +
      (A.st.user ? '<button class="btn sm" id="useme">' + ic('locon') + 'Gunakan lokasi saya sekarang</button>' : ''),
      [cur ? { label: 'Hapus', kind: 'bad', value: 'del' } : null, { label: 'Batal', value: null }, { label: 'Simpan', kind: 'pri', fn: () => picked ? 'ok' : false }].filter(Boolean),
      { onOpen: w => {
        const inp = w.querySelector('#la');
        AC.attach(inp, { onPick: it => { picked = it; inp.value = it.name; } });
        const me = w.querySelector('#useme'); if (me) me.onclick = () => { picked = { name: 'Lokasi saya', lng: A.st.user[0], lat: A.st.user[1] }; inp.value = 'Lokasi saya'; };
      } });
    if (r === 'del') D.setLabel(which, null);
    else if (r === 'ok' && picked) {
      if (!picked.addr) { const rv = await Q.reverse([picked.lng, picked.lat]); if (rv) picked.addr = [rv.name, rv.addr].filter(Boolean).join(', '); }
      D.setLabel(which, picked);
    }
    M.setSaved(D.cfg.savedMap);
    if (PV.is('saved')) PV.refresh();
  };
  let parkMk = null;
  A.drawPark = () => {
    if (parkMk) { parkMk.remove(); parkMk = null; }
    const p = D.saved.park; if (!p || !A.map) return;
    const el = document.createElement('div'); el.className = 'mk-park'; el.textContent = 'P'; el.title = 'Lokasi parkir';
    el.onclick = e => { e.stopPropagation(); A.openPlace({ name: 'Lokasi parkir', cat: 'Parkir · ' + U.day(p.t) + ' ' + U.clock(p.t), lng: p.lng, lat: p.lat }); };
    parkMk = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(A.map);
  };
  A.savePark = async ll => {
    if (!ll) { try { ll = await A.locate({ quiet: true }); } catch (e) { return U.toast('Lokasi tidak tersedia'); } }
    D.saved.park = { lng: +ll[0].toFixed(6), lat: +ll[1].toFixed(6), t: Date.now() }; D.saveSaved(); A.drawPark();
    U.toast('Lokasi parkir disimpan', { action: { label: 'Lihat', fn: () => A.openPlace({ name: 'Lokasi parkir', cat: 'Parkir', lng: ll[0], lat: ll[1] }) } });
  };
  A.afterNav = () => { M.showMe(A.st.user, A.st.compass); if (A.st.user) M.setAcc(A.st.user, A.st.acc); };

  // ================= map click / long-press / context menu =================
  function hitBox(pt, r = 7) { return [[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]]; }
  function onClick(e) {
    const map = A.map;
    $('#ctx').hidden = true;
    if (MEAS.on) return MEAS.add([e.lngLat.lng, e.lngLat.lat]);
    if (N.on) return;
    const bx = hitBox(e.point), L = id => map.getLayer(id) ? [id] : [];
    let f = map.queryRenderedFeatures(bx, { layers: L('ov-res') })[0];
    if (f) { const d = PV.cur() && PV.cur().view === 'results' ? PV.cur().data : null; if (d && d.items[f.properties.ref]) return A.openPlace(d.items[f.properties.ref], { nofly: true }); }
    f = map.queryRenderedFeatures(bx, { layers: L('ov-sp') })[0];
    if (f && DIR.route() && DIR.route().spbu) { const list = DIR.filtered(); const p = list[f.properties.ref]; if (p) return DIR.openStation(p); }
    f = map.queryRenderedFeatures(bx, { layers: L('ov-along') })[0];
    if (f && DIR.alongList[f.properties.ref]) { const p = DIR.alongList[f.properties.ref], c = Q.catOf(DIR.along); return A.openPlace({ name: p.name || c.n, cat: c.n, lng: p.lng, lat: p.lat, osm: p.id ? { t: p.id[0].toUpperCase(), id: p.id.slice(1) } : null }); }
    f = map.queryRenderedFeatures(bx, { layers: L('ov-saved') })[0];
    if (f) {
      const ref = f.properties.ref;
      if (ref === 'home' || ref === 'work') { const s = D.saved[ref]; return A.openPlace({ name: ref === 'home' ? 'Rumah' : 'Kantor', addr: s.addr, lng: s.lng, lat: s.lat, cat: 'Tersimpan' }); }
      const it = D.saved.items.find(i => i.id === ref); if (it) return A.openPlace(Object.assign({}, it, { savedId: it.id, cat: it.cat || 'Tersimpan' }));
    }
    f = map.queryRenderedFeatures(bx, { layers: L('ov-sv') })[0];
    if (f) { const g = f.geometry.coordinates; P.inBox([g[0] - 1e-4, g[1] - 1e-4, g[0] + 1e-4, g[1] + 1e-4], ['f', 'c', 'r']).then(l => { const p = l[0]; if (p) DIR.openStation(p); }); return; }
    f = map.queryRenderedFeatures(bx, { layers: ['poi_r1', 'poi_r7', 'poi_r20', 'poi_transit', 'airport'].filter(id => map.getLayer(id)) })[0];
    if (f) {
      const pr = f.properties, g = f.geometry.coordinates, id = f.id;
      const osm = id ? { t: ['', 'N', 'W', 'R'][id % 10] || 'N', id: Math.floor(id / 10) } : null;
      const key = pr.class === 'fuel' ? 'amenity:fuel' : '';
      return A.openPlace({ name: pr['name:latin'] || pr.name || Q.catLabel('amenity', pr.subclass), cat: Q.catLabel(key ? 'amenity' : 'amenity', pr.subclass === 'muslim' ? 'mosque' : pr.subclass) || pr.class, lng: g[0], lat: g[1], osm }, { nofly: true });
    }
    f = map.queryRenderedFeatures(bx, { layers: L('ov-route-alt') })[0];
    if (f) return DIR.select(f.properties.i);
    // empty map
    if (PV.is('dir')) {
      const i = DIR.pts.findIndex(p => !p);
      if (i >= 0) { const ll = [e.lngLat.lng, e.lngLat.lat]; DIR.setPt(i, { name: G.fmtLL(ll, 5), lng: ll[0], lat: ll[1] }); Q.reverse(ll).then(r => { if (r && DIR.pts[i] && DIR.pts[i].lng === ll[0]) { DIR.pts[i].name = r.name; DIR.pts[i].addr = r.addr; DIR.drawHead(); } }); return; }
      if (U.mobile()) PV.snap('peek');
      return;
    }
    if (PV.is('place')) { PV.back(); return; }
    if (U.mobile() && !$('#panel').hidden) PV.snap('peek');
  }
  function longPress(map) {
    let t = null, start = null;
    const cv = map.getCanvasContainer();
    cv.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || N.on) { clearTimeout(t); return; }
      const tc = e.touches[0]; start = [tc.clientX, tc.clientY];
      t = setTimeout(() => {
        const r = cv.getBoundingClientRect(), pt = new maplibregl.Point(start[0] - r.left, start[1] - r.top), ll = map.unproject(pt);
        if (navigator.vibrate) navigator.vibrate(15);
        if (MEAS.on) return;
        if (PV.is('dir')) return ctxMenu(ll, pt);
        A.openPlace({ name: 'Pin dijatuhkan', lng: ll.lng, lat: ll.lat }, { nofly: true });
      }, 550);
    }, { passive: true });
    cv.addEventListener('touchmove', e => { if (start && Math.hypot(e.touches[0].clientX - start[0], e.touches[0].clientY - start[1]) > 10) clearTimeout(t); }, { passive: true });
    cv.addEventListener('touchend', () => clearTimeout(t), { passive: true });
    cv.addEventListener('touchcancel', () => clearTimeout(t), { passive: true });
    map.on('dragstart', stopFollow);
  }
  function ctxMenu(lngLat, pt) {
    const ll = [lngLat.lng, lngLat.lat], box = $('#ctx');
    const inDir = PV.is('dir') && DIR.valid();
    box.innerHTML = '<button class="cc" data-x="copy">' + ic('copy') + G.fmtLL(ll, 5) + '</button><hr>' +
      '<button data-x="what">' + ic('info') + 'Apa yang ada di sini?</button>' +
      '<button data-x="from">' + ic('tdep') + 'Rute dari sini</button><button data-x="to">' + ic('dir') + 'Rute ke sini</button>' +
      (inDir ? '<button data-x="stop">' + ic('plus') + 'Tambahkan perhentian</button>' : '') +
      '<button data-x="near">' + ic('search') + 'Cari di sekitar sini</button><button data-x="spbu">' + ic('fuel') + 'SPBU terdekat dari sini</button>' +
      '<button data-x="meas">' + ic('ruler') + 'Ukur jarak</button><hr>' +
      '<button data-x="save">' + ic('bookmark') + 'Simpan tempat</button><button data-x="park">' + ic('parking') + 'Simpan sebagai lokasi parkir</button>' +
      '<button data-x="share">' + ic('share') + 'Bagikan lokasi ini</button><button data-x="sv">' + ic('street') + 'Street View (Google)</button>';
    box.hidden = false;
    const W = innerWidth, H = innerHeight, bw = box.offsetWidth, bh = box.offsetHeight;
    const r = A.map.getContainer().getBoundingClientRect();
    box.style.left = Math.min(W - bw - 8, r.left + pt.x) + 'px';
    box.style.top = Math.min(H - bh - 8, r.top + pt.y) + 'px';
    box.onclick = e => {
      const x = e.target.closest('[data-x]'); if (!x) return;
      box.hidden = true;
      const a = x.dataset.x, pin = { name: 'Titik di peta', lng: ll[0], lat: ll[1] };
      if (a === 'copy') U.copy(G.fmtLL(ll, 6));
      if (a === 'what') A.openPlace({ name: 'Titik di peta', lng: ll[0], lat: ll[1] }, { nofly: true });
      if (a === 'from' || a === 'to' || a === 'stop') {
        const p = { name: G.fmtLL(ll, 5), lng: ll[0], lat: ll[1] };
        Q.reverse(ll).then(rv => { if (rv) { p.name = rv.name; p.addr = rv.addr; if (PV.is('dir')) DIR.drawHead(); } });
        if (PV.is('dir')) { if (a === 'from') DIR.setPt(0, p); else if (a === 'to') DIR.setPt(DIR.pts.length - 1, p); else { DIR.pts.splice(DIR.pts.length - 1, 0, p); DIR.drawHead(); DIR.compute(); } }
        else DIR.open(a === 'from' ? { from: p } : { to: p });
      }
      if (a === 'near') A.nearbyPrompt(ll);
      if (a === 'spbu') { A.map.jumpTo({ center: ll, zoom: Math.max(13.5, A.map.getZoom()) }); A.searchCat('spbu'); }
      if (a === 'meas') MEAS.start(ll);
      if (a === 'save') A.saveDialog(pin);
      if (a === 'park') A.savePark(ll);
      if (a === 'share') A.share('Lokasi', A.link({ p: pin }));
      if (a === 'sv') window.open('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + ll[1] + ',' + ll[0], '_blank', 'noopener');
    };
  }
  document.addEventListener('pointerdown', e => { const c = $('#ctx'); if (!c.hidden && !c.contains(e.target)) c.hidden = true; }, true);

  // ================= measure =================
  const MEAS = A.measure = {
    on: false, pts: [], closed: false,
    start(ll) {
      MEAS.on = true; MEAS.pts = ll ? [ll] : []; MEAS.closed = false;
      A.map.getCanvas().style.cursor = 'crosshair';
      if (U.mobile() && !$('#panel').hidden) PV.snap('peek');
      MEAS.draw();
    },
    add(ll) { MEAS.pts.push(ll); MEAS.draw(); },
    draw() {
      M.setMeasure(MEAS.pts, MEAS.closed && MEAS.pts.length > 2);
      const box = $('#measure');
      const d = G.length(MEAS.closed && MEAS.pts.length > 2 ? MEAS.pts.concat([MEAS.pts[0]]) : MEAS.pts);
      const area = MEAS.closed && MEAS.pts.length > 2 ? G.area(MEAS.pts) : 0;
      box.hidden = false;
      box.innerHTML = '<span style="color:var(--acc);display:flex">' + ic('ruler') + '</span><div class="mt"><b>' + (MEAS.pts.length < 2 ? 'Klik peta untuk menambah titik' : U.dist(d)) + '</b><small>' +
        (area ? 'Luas ' + (area > 1e6 ? U.num(area / 1e6, 2) + ' km²' : area > 1e4 ? U.num(area / 1e4, 2) + ' ha (' + U.num(Math.round(area)) + ' m²)' : U.num(Math.round(area)) + ' m²') + ' · ' : '') + MEAS.pts.length + ' titik</small></div>' +
        '<button class="ib" data-m="undo" title="Hapus titik terakhir">' + ic('back') + '</button>' + (MEAS.pts.length > 2 ? '<button class="ib' + (MEAS.closed ? ' acc' : '') + '" data-m="close" title="Tutup bentuk (luas)">' + ic('cube') + '</button>' : '') + '<button class="ib" data-m="x" title="Selesai">' + ic('x') + '</button>';
      box.onclick = e => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        if (b.dataset.m === 'undo') { MEAS.pts.pop(); MEAS.draw(); }
        if (b.dataset.m === 'close') { MEAS.closed = !MEAS.closed; MEAS.draw(); }
        if (b.dataset.m === 'x') MEAS.stop();
      };
    },
    stop() { MEAS.on = false; MEAS.pts = []; M.setMeasure([]); $('#measure').hidden = true; A.map.getCanvas().style.cursor = ''; },
  };

  // ================= menu / settings / help =================
  $('#bMenu').onclick = () => {
    const dr = $('#drawer'), m = dr.querySelector('.dr-in');
    const S0 = D.saved;
    m.innerHTML = '<div class="dr-logo">' + ic('dir', '') + 'Amatu Maps</div>' +
      '<button class="dr-i" data-d="saved">' + ic('bookmark') + 'Tersimpan<small>' + S0.items.length + '</small></button>' +
      '<button class="dr-i" data-d="recent">' + ic('history') + 'Terbaru</button>' +
      '<button class="dr-i" data-d="trips">' + ic('car') + 'Riwayat perjalanan<small>' + D.trips().length + '</small></button>' +
      '<button class="dr-i" data-d="park">' + ic('parking') + (S0.park ? 'Lokasi parkir' : 'Simpan lokasi parkir') + '</button>' +
      (S0.home ? '<button class="dr-i" data-d="home">' + ic('home') + 'Rute ke Rumah</button>' : '') + (S0.work ? '<button class="dr-i" data-d="work">' + ic('work') + 'Rute ke Kantor</button>' : '') +
      '<div class="dr-sep"></div>' +
      '<button class="dr-i" data-d="meas">' + ic('ruler') + 'Ukur jarak</button>' +
      '<button class="dr-i" data-d="fuel">' + ic('fuel') + 'Kendaraan & harga BBM</button>' +
      '<button class="dr-i" data-d="set">' + ic('gear') + 'Setelan</button>' +
      '<button class="dr-i" data-d="share">' + ic('share') + 'Bagikan peta ini</button>' +
      '<button class="dr-i" data-d="help">' + ic('info') + 'Bantuan & tentang</button>' +
      '<div class="dr-foot">Peta © OpenMapTiles © OpenStreetMap · OpenFreeMap<br>Citra satelit © Esri · Elevasi AWS Terrain Tiles<br>Rute Valhalla (FOSSGIS) · Pencarian Photon · Cuaca Open-Meteo</div>';
    dr.hidden = false;
    dr.onclick = e => {
      if (e.target === dr) { dr.hidden = true; return; }
      const b = e.target.closest('[data-d]'); if (!b) return;
      dr.hidden = true;
      const d = b.dataset.d;
      if (d === 'saved' || d === 'recent' || d === 'trips') PV.open(d, {}, { root: true, snap: 'full' });
      if (d === 'park') { if (D.saved.park) A.openPlace({ name: 'Lokasi parkir', cat: 'Parkir · ' + U.day(D.saved.park.t) + ' ' + U.clock(D.saved.park.t), lng: D.saved.park.lng, lat: D.saved.park.lat }); else A.savePark(); }
      if (d === 'home' || d === 'work') { const s = D.saved[d]; DIR.open({ to: { name: d === 'home' ? 'Rumah' : 'Kantor', addr: s.addr, lng: s.lng, lat: s.lat } }); }
      if (d === 'meas') MEAS.start();
      if (d === 'fuel') settings('fuel');
      if (d === 'set') settings();
      if (d === 'share') { const c = A.center(); A.share('Peta', A.link({ view: [c[1], c[0], A.map.getZoom()] })); }
      if (d === 'help') help();
    };
  };
  async function settings(focus) {
    const c = JSON.parse(JSON.stringify(D.cfg));
    const seg = (k, opts) => '<div class="seg" data-seg="' + k + '">' + opts.map(([v, n]) => '<button data-v="' + v + '" class="' + (String(c[k]) === String(v) ? 'on' : '') + '">' + n + '</button>').join('') + '</div>';
    const sw = (path, on) => '<button class="sw' + (on ? ' on' : '') + '" data-sw="' + path + '"></button>';
    const veh = (k, n) => {
      const v = c.veh[k];
      return '<h4>' + n + '</h4><div class="fgrid"><label class="fld">Perbandingan BBM (1 liter : km)<input data-v="veh.' + k + '.kmpl" inputmode="decimal" value="' + U.num(v.kmpl, v.kmpl % 1 ? 1 : 0) + '"></label>' +
        '<label class="fld">Jenis BBM<select data-v="veh.' + k + '.fuel">' + c.fuels.map(f => '<option value="' + esc(f.id) + '"' + (f.id === v.fuel ? ' selected' : '') + '>' + esc(f.n) + '</option>').join('') + '</select></label>' +
        '<label class="fld">Kapasitas tangki (L)<input data-v="veh.' + k + '.tank" inputmode="decimal" value="' + U.num(v.tank || 0) + '"></label>' +
        '<label class="fld">Contoh<input disabled value="100 km ≈ ' + U.num(100 / v.kmpl, 1) + ' L"></label></div>';
    };
    const fuels = () => '<div class="fuels" id="fuels">' + c.fuels.map((f, i) => '<div class="fu"><input data-fn="' + i + '" value="' + esc(f.n) + '"' + (f.sub ? ' title="BBM bawaan"' : '') + '><input data-fp="' + i + '" inputmode="numeric" value="' + U.num(f.p) + '">' +
      (f.sub ? '<span></span>' : '<button class="ib" data-fdel="' + i + '" title="Hapus">' + ic('trash') + '</button>') + '</div>').join('') + '</div><button class="btn sm" id="addfuel">' + ic('plus') + 'Tambah jenis BBM</button>';
    const meta = await P.meta();
    const body = '<div class="set">' +
      '<h4>Tampilan</h4><div class="line"><span>Mode siang / malam<small>Otomatis mengikuti matahari terbit & terbenam di lokasi Anda</small></span>' + seg('theme', [['auto', 'Otomatis'], ['day', 'Siang'], ['night', 'Malam']]) + '</div>' +
      '<h4>Rute</h4><div class="line"><span>Kendaraan default</span>' + seg('mode', [['car', 'Mobil'], ['moto', 'Motor']]) + '</div>' +
      '<div class="line"><span>Hindari jalan tol (mobil)<small>Motor selalu tanpa tol</small></span>' + sw('avoid.toll', c.avoid.toll) + '</div>' +
      '<div class="line"><span>Hindari jalan raya</span>' + sw('avoid.highway', c.avoid.highway) + '</div>' +
      '<div class="line"><span>Hindari feri</span>' + sw('avoid.ferry', c.avoid.ferry) + '</div>' +
      '<div class="line"><span>Perkiraan kepadatan<small>Belum ada data lalu lintas langsung gratis; estimasi menyesuaikan jam</small></span><select class="opt" data-v="traffic">' +
      [['auto', 'Otomatis (jam sibuk)'], ['off', 'Tanpa penyesuaian'], ['lancar', 'Lancar ×0,9'], ['normal', 'Normal ×1'], ['padat', 'Padat ×1,3'], ['macet', 'Macet ×1,6']].map(([v, n]) => '<option value="' + v + '"' + (c.traffic === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></div>' +
      '<div id="sfuel">' + veh('car', 'Mobil') + veh('moto', 'Motor') + '<h4>Harga BBM per liter (bisa diubah)</h4>' + fuels() + '</div>' +
      '<h4>SPBU di rute</h4><div class="line"><span>Jarak maksimum SPBU dari jalan</span><select class="opt" data-v="radius">' + [50, 100, 150, 300, 500, 1000].map(m => '<option value="' + m + '"' + (+c.radius === m ? ' selected' : '') + '>' + U.dist(m) + '</option>').join('') + '</select></div>' +
      '<div class="line"><span>Tampilkan SPBU di rute pada peta</span>' + sw('spbuMap', c.spbuMap) + '</div>' +
      '<h4>Navigasi</h4><div class="line"><span>Panduan suara</span>' + sw('voice', c.voice) + '</div><div class="line"><span>Umumkan SPBU di depan (±1 km)</span>' + sw('voiceSpbu', c.voiceSpbu !== false) + '</div>' +
      '<h4>Data</h4><div class="line"><span>Data SPBU OpenStreetMap<small>' + (meta ? U.num(meta.n.f) + ' SPBU · ' + U.num(meta.n.r) + ' rest area · ' + U.num(meta.n.c) + ' SPKLU · diperbarui ' + esc(meta.v) + ' (otomatis tiap minggu)' : 'belum dimuat') + '</small></span></div>' +
      '<div class="line" data-clr="recent"><span>Hapus riwayat pencarian</span>' + ic('trash') + '</div><div class="line" data-clr="trips"><span>Hapus riwayat perjalanan</span>' + ic('trash') + '</div></div>';
    const res = await U.modal(focus === 'fuel' ? 'Kendaraan & harga BBM' : 'Setelan', body, [{ label: 'Batal', value: null }, { label: 'Simpan', kind: 'pri', value: 'ok' }], {
      cls: 'wide',
      onOpen: w => {
        if (focus === 'fuel') setTimeout(() => w.querySelector('#sfuel').scrollIntoView({ block: 'start' }), 50);
        const setPath = (path, val) => { const ks = path.split('.'); let o = c; while (ks.length > 1) o = o[ks.shift()]; o[ks[0]] = val; };
        w.addEventListener('click', e => {
          const sg = e.target.closest('[data-seg] [data-v]'); if (sg) { const k = sg.parentNode.dataset.seg; c[k] = sg.dataset.v; sg.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === sg)); }
          const s = e.target.closest('[data-sw]'); if (s) { s.classList.toggle('on'); setPath(s.dataset.sw, s.classList.contains('on')); }
          const fd = e.target.closest('[data-fdel]'); if (fd) { const id = c.fuels[+fd.dataset.fdel].id; c.fuels.splice(+fd.dataset.fdel, 1); ['car', 'moto'].forEach(k => { if (c.veh[k].fuel === id) c.veh[k].fuel = 'bensin'; }); w.querySelector('#fuels').outerHTML = fuels().split('<button class="btn sm" id="addfuel">')[0]; }
          if (e.target.closest('#addfuel')) { c.fuels.push({ id: 'f' + U.uid(), n: 'BBM baru', p: 12000 }); w.querySelector('#fuels').outerHTML = fuels().split('<button class="btn sm" id="addfuel">')[0]; }
          const cl = e.target.closest('[data-clr]'); if (cl) { if (cl.dataset.clr === 'recent') D.clearRecent(); else U.set(D.K.trips, []); U.toast('Riwayat dihapus'); }
        });
        w.addEventListener('input', e => {
          const t = e.target;
          if (t.dataset.v && t.dataset.v.startsWith('veh.')) { const n = t.tagName === 'SELECT' ? t.value : U.parse(t.value); if (t.tagName === 'SELECT' || n > 0) setPath(t.dataset.v, n); }
          else if (t.dataset.v === 'traffic') c.traffic = t.value;
          else if (t.dataset.v === 'radius') c.radius = +t.value;
          if (t.dataset.fn != null) c.fuels[+t.dataset.fn].n = t.value.trim() || 'BBM';
          if (t.dataset.fp != null) { const n = U.parse(t.value); if (n >= 0) c.fuels[+t.dataset.fp].p = n; }
        });
        w.addEventListener('change', e => { if (e.target.tagName === 'SELECT' && e.target.dataset.v) e.target.dispatchEvent(new Event('input', { bubbles: true })); });
      },
    });
    if (res !== 'ok') return;
    const radiusCh = +c.radius !== +D.cfg.radius, avoidCh = JSON.stringify(c.avoid) !== JSON.stringify(D.cfg.avoid);
    D.cfg = Object.assign(D.cfg, c); D.saveCfg();
    A.theme(true);
    if (DIR.route()) {
      DIR.routes.forEach(r => { r.fac = R.factor(r.mode, DIR.depart || new Date(), D.cfg.traffic); if (radiusCh) r.spbu = null; });
      if (avoidCh) { DIR.other = {}; DIR.compute(true); } else { if (radiusCh) DIR.loadSpbu(); DIR.showSpbu(); }
      if (PV.is('dir')) { DIR.drawHead(); PV.refresh('body'); }
    }
    U.toast('Setelan disimpan');
  }
  A.settings = settings;
  function help() {
    U.modal('Amatu Maps', '<div class="set" style="font-size:13.5px;line-height:1.55">' +
      '<p><b>Cari</b> tempat, alamat, koordinat (−7.43, 110.21), Plus Code, atau tempel link Google Maps. Ketuk kategori untuk tempat di sekitar.</p>' +
      '<p><b>Rute</b> mobil (default), motor (otomatis tanpa tol), jalan kaki, sepeda; sampai 10 titik, rute alternatif, hindari tol/jalan raya/feri, pilih jam berangkat. Seret pin untuk mengubah titik.</p>' +
      '<p><b>SPBU di rute</b>: semua SPBU yang dilewati rute, km ke berapa, sisi kiri/kanan, jarak real-time dari posisi Anda, perkiraan tiba di SPBU, merek & jenis BBM bila tercatat. Bisa dijadikan perhentian.</p>' +
      '<p><b>Estimasi BBM</b>: perbandingan km per liter (mobil 1:10, motor 1:40 bisa diubah) × jarak, harga Bensin Rp10.000 & Solar Rp6.800 per liter bisa diubah atau ditambah, pulang-pergi, cek isi tangki.</p>' +
      '<p><b>Navigasi</b> suara bahasa Indonesia, hitung ulang otomatis saat salah jalan, ETA menyesuaikan kecepatan Anda, pengumuman SPBU di depan, riwayat perjalanan & biaya BBM. Coba “Simulasi” tanpa bergerak.</p>' +
      '<p><b>Lainnya</b>: mode siang/malam otomatis, satelit, medan 3D, gedung 3D, transportasi, jalur sepeda, ukur jarak & luas, simpan tempat & daftar, Rumah/Kantor, lokasi parkir, kirim tempat/rute ke HP (akun Portal AMATU), bagikan, cetak, cuaca & ketinggian.</p>' +
      '<p class="mut"><b>Keterbatasan</b>: belum ada lalu lintas langsung, ulasan/foto tempat, jadwal transportasi umum, dan foto Street View sendiri (dibuka di Google) karena datanya tidak tersedia gratis. Data peta & SPBU dari OpenStreetMap — sebagian tempat mungkin belum terpetakan.</p>' +
      '<p class="mut">Pintasan: <b>/</b> cari · <b>Esc</b> tutup · klik kanan peta untuk menu.</p></div>', [{ label: 'Tutup', kind: 'pri' }], { cls: 'wide' });
  }

  // ================= share / links / print =================
  A.link = o => {
    const base = location.origin + location.pathname;
    if (o.p) return base + '#p=' + o.p.lat.toFixed(6) + ',' + o.p.lng.toFixed(6) + (o.p.name ? '&n=' + encodeURIComponent(o.p.name) : '');
    if (o.dir) return base + '#dir=' + o.dir.filter(Boolean).map(p => p.lat.toFixed(5) + ',' + p.lng.toFixed(5)).join(';') + '&m=' + (o.mode || 'car') + '&n=' + encodeURIComponent(o.dir.filter(Boolean).map(p => p.gps ? '' : (p.name || '').replace(/\|/g, ' ')).join('|'));
    if (o.view) return base + '#@' + o.view[0].toFixed(5) + ',' + o.view[1].toFixed(5) + ',' + o.view[2].toFixed(1) + 'z';
    return base;
  };
  A.share = async (title, url) => {
    if (navigator.share && U.mobile()) { try { await navigator.share({ title: title + ' — Amatu Maps', text: /^https?:/.test(url) ? title : url, url: /^https?:/.test(url) ? url : undefined }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    U.copy(url);
  };
  A.hash = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return;
    const prm = new URLSearchParams(h.replace(/^@/, 'at='));
    try {
      if (prm.get('p')) { const [la, lo] = prm.get('p').split(',').map(Number); A.openPlace({ name: prm.get('n') || 'Titik di peta', lng: lo, lat: la }); }
      else if (prm.get('dir')) {
        const names = (prm.get('n') || '').split('|');
        const pts = prm.get('dir').split(';').map((s, i) => { const [la, lo] = s.split(',').map(Number); return { name: names[i] || G.fmtLL([lo, la], 5), lng: lo, lat: la }; });
        DIR.open({ from: pts[0], to: pts[pts.length - 1], mode: prm.get('m') || 'car' });
        if (pts.length > 2) { DIR.pts = pts; DIR.drawHead(); DIR.compute(true); }
      } else if (prm.get('q')) A.search(prm.get('q'));
      else if (prm.get('at')) { const m = /(-?[\d.]+),(-?[\d.]+),([\d.]+)z?/.exec(prm.get('at')); if (m) A.map.jumpTo({ center: [+m[2], +m[1]], zoom: +m[3] }); }
    } catch (e) { /* bad link */ }
    history.replaceState(null, '', location.pathname + location.search);
  };
  addEventListener('hashchange', () => A.hash());
  A.print = async () => {
    const r = DIR.route(); if (!r) return;
    const map = A.map;
    M.fit(r.bbox, { duration: 0 });
    await new Promise(res => map.once('idle', res));
    const img = await new Promise(res => { map.once('render', () => { try { res(map.getCanvas().toDataURL('image/jpeg', 0.85)); } catch (e) { res(null); } }); map.triggerRepaint(); });
    const f = D.estimate(r.dist, r.mode), t = r.time * (r.fac || 1), dep = DIR.depart || new Date();
    $('#print').innerHTML = '<h1>' + esc((DIR.pts[0] || {}).name || '') + ' → ' + esc((DIR.pts[DIR.pts.length - 1] || {}).name || '') + '</h1>' +
      '<div>' + esc(R.MODES[r.mode].n) + ' · ' + U.dist(r.dist) + ' · ' + U.dur(t) + ' · tiba ±' + U.clock(+dep + t * 1000) + (r.via ? ' · melalui ' + esc(r.via) : '') + (r.toll ? ' · lewat tol ' + U.dist(r.tollDist) : '') + '</div>' +
      (f ? '<div>BBM ±' + U.liter(f.liters) + ' (' + esc(f.fuel.n) + ' 1:' + U.num(f.kmpl) + ') · ' + U.rp(f.cost) + (f.pp ? ' pulang-pergi' : '') + '</div>' : '') + (img ? '<img src="' + img + '">' : '') +
      (r.spbu && r.spbu.length ? '<h2>SPBU di sepanjang rute (' + r.spbu.filter(p => p.k === 'f').length + ')</h2><table>' + r.spbu.map(p => '<tr><td>km ' + U.num(p.s / 1000, 1) + '</td><td>' + esc(P.title(p)) + '</td><td>' + (p.side > 0 ? 'kiri' : 'kanan') + '</td><td>' + esc(P.tags(p).join(', ')) + '</td></tr>').join('') + '</table>' : '') +
      '<h2>Langkah</h2><table>' + r.man.map(m => '<tr><td>' + esc(m.text) + '</td><td>' + (m.len ? U.dist(m.len) : '') + '</td></tr>').join('') + '</table>' +
      '<p style="color:#666;font-size:10px">Amatu Maps · ' + new Date().toLocaleString('id-ID') + ' · data © OpenStreetMap</p>';
    setTimeout(() => print(), 120);
  };

  // ================= other devices of the account =================
  A.checkKirim = () => {
    const k = U.get(D.K.kirim, null);
    if (!k || !k.t || k.dev === D.dev() || k.t <= U.get('pt.maps.seen', 0) || Date.now() - k.t > 2 * 864e5) return;
    const b = $('#banner');
    const what = k.type === 'route' ? 'Rute: ' + (k.pts || []).filter(Boolean).map(p => p.name).join(' → ') : 'Tempat: ' + (k.p ? k.p.name : '');
    b.innerHTML = '<span style="color:var(--acc);display:flex">' + ic('send') + '</span><div class="bt"><b>Dikirim dari perangkat lain</b><small>' + esc(what) + '</small></div><button class="btn sm pri" data-k="open">Buka</button><button class="ib" data-k="x">' + ic('x') + '</button>';
    b.hidden = false;
    b.onclick = e => {
      const x = e.target.closest('[data-k]'); if (!x) return;
      U.set('pt.maps.seen', k.t); b.hidden = true;
      if (x.dataset.k !== 'open') return;
      if (k.type === 'place' && k.p) A.openPlace(k.p);
      if (k.type === 'route' && k.pts) {
        const pts = k.pts.map(p => p && p.gps ? null : p);
        DIR.open({ from: pts[0] || undefined, to: pts[pts.length - 1], mode: k.mode });
        if (pts.length > 2) { DIR.pts = pts.map((p, i) => p || (i === 0 ? DIR.gps() : null)); DIR.drawHead(); DIR.compute(true); }
      }
    };
  };
  D.onChange(key => {
    if (!A.map) return;
    M.setSaved(D.cfg.savedMap); A.drawPark(); A.theme(true);
    if (!key || key === D.K.kirim) A.checkKirim();
    const c = PV.cur();
    if (c && ['saved', 'list', 'recent', 'trips'].includes(c.view)) PV.refresh();
    if (c && c.view === 'dir' && DIR.route()) DIR.fuelUpdate($('#pv'));
  });

  // ================= keyboard / resize / online =================
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); q.focus(); q.select(); }
    if (e.key === 'Escape') {
      if (!$('#ctx').hidden) { $('#ctx').hidden = true; return; }
      if (MEAS.on) return MEAS.stop();
      if (!$('#layers').hidden) { $('#layers').hidden = true; return; }
      if (!$('#drawer').hidden) { $('#drawer').hidden = true; return; }
      if (document.querySelector('.mwrap')) return;
      if (typing) { document.activeElement.blur(); return; }
      if (!N.on && !$('#panel').hidden) PV.back();
    }
  });
  $('#bPanel').onclick = () => { document.body.classList.toggle('pclosed'); PV.layout(); setTimeout(() => A.map.resize(), 220); };
  let lastMob = U.mobile();
  addEventListener('resize', U.debounce(() => {
    const mob = U.mobile();
    if (mob !== lastMob) { lastMob = mob; if (PV.cur()) PV.render(); if (!mob) { const dt = $('#dtop'); if (dt) dt.remove(); if (PV.is('dir')) DIR.drawHead(); } else if (PV.is('dir')) DIR.drawHead(); }
    PV.layout();
  }, 150));
  addEventListener('offline', () => U.toast('Anda sedang offline — peta yang sudah dibuka tetap tampil', { key: 'net' }));
  addEventListener('online', () => U.toast('Kembali online', { key: 'net', ms: 1500 }));

  boot();
})();
