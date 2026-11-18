// Amatu Maps · turn-by-turn navigation: GPS snapping, banner, Indonesian voice, re-routing, live distance to the next
// SPBU, adaptive ETA, trip log. The arrow and the camera are drawn every frame: the position is predicted along the
// route between GPS fixes, the heading comes from the phone's compass while standing still / slow (or always, by
// setting) and from the road while driving — so the map turns with the phone in real time. Without signal it keeps
// following the saved route (map tiles from AM.O); it resumes after a reload.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U, G = AM.G, R = AM.R, P = AM.P, D = AM.D, M = AM.M, H = AM.H, O = AM.O;
  const $ = U.$, esc = U.esc, ic = U.ic;
  const A = () => AM.A, DIR = () => AM.DIR, PV = () => AM.PV;
  const QUIET = [7, 8, 22];                   // "continue" manoeuvres are shown but not spoken
  const NAVKEY = 'https://amatu-maps.local/nav.json', NAVC = 'amatu-maps-nav';

  let voices = [];
  function loadVoices() { try { voices = speechSynthesis.getVoices() || []; } catch (e) { voices = []; } }
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  function speak(text, force) {
    if ((!D.cfg.voice && !force) || !('speechSynthesis' in window) || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'id-ID'; u.rate = 1.02;
      const v = voices.find(x => /^id[-_]ID/i.test(x.lang)) || voices.find(x => /^id/i.test(x.lang) || /indones/i.test(x.name));
      if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* no TTS */ }
  }
  const sayDist = m => m >= 950 ? 'Dalam ' + U.num(Math.round(m / 100) / 10, (Math.round(m / 100) % 10) ? 1 : 0) + ' kilometer, ' : 'Dalam ' + (m >= 100 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10) + ' meter, ';
  const lower = s => s ? s[0].toLowerCase() + s.slice(1) : s;
  // Portal AMATU locks an idle app after some minutes without a touch; driving without touching the screen is not idle,
  // and offline the PIN could not even be checked. While navigating the unlock time is kept fresh like a tap does.
  function keepUnlocked() {
    try {
      const k = JSON.parse(localStorage.getItem('pt.unlock') || 'null'), s = JSON.parse(localStorage.getItem('pt.sess') || 'null');
      const pc = JSON.parse(localStorage.getItem('amatu.portal') || 'null'), v = pc && pc.idle, idle = v === 0 ? Infinity : (v || 15);
      if (k && s && k.u === s.u && Date.now() - k.at < idle * 60000) localStorage.setItem('pt.unlock', JSON.stringify({ u: k.u, at: Date.now() }));
    } catch (e) { /* no portal */ }
  }

  const N = AM.N = {
    on: false, route: null, s: 0, follow: true,
    // o: {pts (stops, for names), resume}
    start(route, o = {}) {
      if (!route) return U.toast('Belum ada rute');
      if (N.on) N.stop(false, true);
      const st = A().st;
      if (!st.user && !navigator.geolocation) return U.toast('GPS tidak tersedia di perangkat ini.');
      const pts = o.pts || DIR().pts.slice();
      Object.assign(N, {
        on: true, route, s: 0, idx: 0, mi: 1, off: 0, t0: o.t0 || Date.now(), trav: o.trav || 0, last: null, spoken: {}, spSaid: {}, rerouting: false, lastRR: 0,
        arrived: false, legBase: 0, leg: 0, follow: true, speed: 0, vs: 0, heading: null, lastTrav: 0, paceS0: null, paceT0: null, fac: route.fac || 1,
        startName: pts[0] ? pts[0].name : '', endName: pts[pts.length - 1] ? pts[pts.length - 1].name : '', pts,
        fixS: 0, fixP: 0, fixLL: null, onR: true, courseOff: false, ds: null, dll: null, dh: NaN, dz: null, useC: true, ft: 0, pos: null, offSaid: false,
      });
      document.body.classList.add('nav');
      $('#nav').hidden = false; $('#navSheet').hidden = true;
      $('#navSpeed').hidden = false;
      if (U.mobile()) document.documentElement.style.setProperty('--sh-h', '0px');
      N.voiceBtn();
      N.wake();
      M.setRoutes([route], 0); M.showTags([], 0); M.setTrav(null);
      DIR().showSpbu();
      const map = A().map;
      N.onDrag = e => { if (e.originalEvent && N.on) { N.follow = false; $('#nRecenter').hidden = false; } };
      ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart'].forEach(ev => map.on(ev, N.onDrag));
      const first = route.man[0];
      if (!o.resume) speak((first ? first.text : 'Mulai') + (route.man[1] ? '. Lalu ' + lower(route.man[1].text) : '') + '. Perkiraan tiba pukul ' + U.clock(Date.now() + route.time * N.fac * 1000).replace('.', ' lewat ') + '.', true);
      else speak('Melanjutkan navigasi ke ' + (N.endName || 'tujuan'), true);
      H.start();
      A().locate({ quiet: true }).catch(() => U.toast('Izinkan akses lokasi untuk navigasi', { kind: 'bad' }));
      const p0 = route.coords[0];
      N.fixLL = st.user || p0; N.dh = G.bearing(route.coords[0], route.coords[1] || p0);
      if (st.user && Date.now() - st.fixT < 30000) N.fix({ ll: st.user, acc: st.acc, heading: st.heading, speed: st.speed, t: Date.now() });
      else N.ui();
      // first view: one smooth move into the driving camera, then every frame follows
      const pos = N.onR ? G.at(route.coords, route.cum, N.s).pt : N.fixLL;
      N.ds = N.s; N.dz = 16.4;
      M.showMe(pos, N.dh, { nav: true });
      map.easeTo({ center: pos, bearing: H.fresh() ? H.raw : N.dh, pitch: 50, zoom: 16.4, padding: N.padding(), duration: U.reduced() ? 0 : 900 });
      N.loop();
      N.offUi(); N.offOff = O.on(() => N.offUi());
      N.keepT = setInterval(N.keep, 30000); N.keep();
      N.topT = setInterval(() => O.topUp(N.route, N.s, { sat: M.st.base === 'sat', name: N.endName, upto: 45000 }), 120000);
      O.saveRoute(route, { sat: M.st.base === 'sat', name: N.endName });
      O.persist();
      N.save();
    },
    stop(arrived, silent) {
      if (!N.on) return;
      N.on = false;
      cancelAnimationFrame(N.raf); clearInterval(N.keepT); clearInterval(N.topT);
      if (N.offOff) N.offOff();
      const map = A().map;
      ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart'].forEach(ev => map.off(ev, N.onDrag));
      document.body.classList.remove('nav', 'thn');
      $('#nav').hidden = true;
      if (N.lock) { N.lock.release().catch(() => { }); N.lock = null; }
      try { speechSynthesis.cancel(); } catch (e) { /* */ }
      M.setTrav(null);
      if (M.meEl) M.meEl.classList.remove('nav');
      const el = (Date.now() - N.t0) / 1000;
      if (N.trav > 200 && !silent) {
        const f = D.estimate(N.trav, N.route.mode, false);
        D.pushTrip({ id: U.uid(), t: N.t0, from: N.startName, to: N.endName, mode: N.route.mode, dist: Math.round(N.trav), time: Math.round(el), liters: f ? +f.liters.toFixed(2) : 0, cost: f ? Math.round(f.cost) : 0, arrived: !!arrived });
      }
      if (!silent) N.forget();
      map.stop();
      map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: U.reduced() ? 0 : 500 });
      if (DIR().route()) { DIR().draw(true); PV().layout(); if (PV().is('dir')) PV().refresh('body'); }
      A().afterNav();
    },
    // ---------- one GPS fix ----------
    fix(p) {
      if (!N.on || !N.route || N.arrived) return;
      const r = N.route, n0 = r.coords.length;
      let n = G.nearest(r.coords, r.cum, p.ll, Math.max(0, N.idx - 4), Math.min(n0 - 1, N.idx + 400));
      if (n.d > 50) { const g = G.nearest(r.coords, r.cum, p.ll); if (g.d + 15 < n.d) n = g; }
      const tol = Math.max(30, Math.min(75, (p.acc || 15) * 1.4));
      const onRoute = n.d <= tol;
      N.off = onRoute ? 0 : N.off + 1;
      if (onRoute) {
        const prevS = N.s;
        if (n.s >= N.s - 40) { N.s = n.s; N.idx = n.i; }
        if (N.s > prevS) N.trav += N.s - prevS;
      } else if (N.last) N.trav += Math.min(200, G.dist(N.last.ll, p.ll));
      if (N.paceS0 == null && (p.speed > 2 || N.s > 50)) { N.paceS0 = N.s; N.paceT0 = Date.now() / 1000; }
      // speed: GPS when given, else from the last fix
      const sp = isFinite(p.speed) && p.speed >= 0 ? p.speed : N.last ? G.dist(N.last.ll, p.ll) / Math.max(0.5, (p.t - N.last.t) / 1000) : 0;
      N.speed = sp; N.vs = N.vs ? N.vs * 0.4 + sp * 0.6 : sp;
      // course while moving: GPS heading or the way we came; on the route the road wins unless we go another way
      const at = G.at(r.coords, r.cum, N.s);
      let hd = isFinite(p.heading) && sp > 1.5 ? p.heading : null;
      if (hd == null && N.last && G.dist(N.last.ll, p.ll) > 4) hd = G.bearing(N.last.ll, p.ll);
      N.courseOff = onRoute && hd != null && Math.abs(G.angDiff(hd, at.brg)) >= 50 && sp > 2;
      if (onRoute && !N.courseOff) hd = at.brg;
      if (hd != null) N.heading = hd;
      N.last = { ll: p.ll, t: p.t };
      // animation targets (the frame loop eases toward them)
      N.fixS = N.s; N.fixP = performance.now(); N.fixLL = p.ll; N.onR = onRoute;
      if (!M.meEl || !M.meEl.classList.contains('nav')) M.showMe(onRoute ? at.pt : p.ll, isFinite(N.dh) ? N.dh : hd || 0, { nav: true });
      if (N.off >= 3 && (p.acc || 0) < 60) N.reroute(p);
      // legs / arrival
      const leg = r.legs.findIndex(l => N.s < r.cum[l.i1] - 25);
      const curLeg = leg < 0 ? r.legs.length - 1 : leg;
      if (curLeg > N.leg) { N.leg = curLeg; speak('Anda tiba di perhentian ' + (N.legBase + curLeg) + '. Melanjutkan perjalanan.'); }
      const left = r.dist - N.s, dEnd = G.dist(p.ll, r.coords[n0 - 1]);
      if (left < 25 || (dEnd < 30 && left < 200)) return N.arrive();
      N.voice();
      if (Date.now() - N.lastTrav > 2500) { N.lastTrav = Date.now(); M.setTrav(G.slice(r.coords, r.cum, 0, N.s)); DIR().prog = N.s; DIR().showSpbu(); }
      N.ui();
    },
    // ---------- every frame: arrow + camera ----------
    loop() {
      cancelAnimationFrame(N.raf);
      const step = now => { if (!N.on) return; try { N.frame(now); } catch (e) { /* keep animating */ } N.raf = requestAnimationFrame(step); };
      N.raf = requestAnimationFrame(step);
    },
    padding() {
      const map = A().map, h = map.getContainer().clientHeight;
      if (N.padH !== h) { N.padH = h; N.pad = { top: Math.round(h * 0.4), bottom: 64, left: 0, right: 0 }; }
      return N.pad;
    },
    frame(now) {
      const dt = Math.min(120, Math.max(1, now - (N.ft || now))); N.ft = now;
      const r = N.route; if (!r) return;
      // position: GPS comes once a second and a little late — run ahead along the road at the current speed
      let pos;
      if (N.onR) {
        let tgt = Math.min(r.dist, N.fixS + (N.vs > 0.8 ? N.vs : 0) * U.clamp((now - N.fixP) / 1000, 0, 1.6));
        if (N.ds == null || Math.abs(tgt - N.ds) > 300) N.ds = tgt;
        else { if (tgt < N.ds && N.ds - tgt < 25) tgt = N.ds; N.ds += (tgt - N.ds) * (1 - Math.exp(-dt / 260)); }
        pos = G.at(r.coords, r.cum, N.ds).pt;
      } else if (N.fixLL) {
        if (!N.dll || G.dist(N.dll, N.fixLL) > 300) N.dll = N.fixLL.slice();
        else { const k = 1 - Math.exp(-dt / 320); N.dll = [N.dll[0] + (N.fixLL[0] - N.dll[0]) * k, N.dll[1] + (N.fixLL[1] - N.dll[1]) * k]; }
        pos = N.dll;
      }
      if (!pos) return;
      if (N.onR) N.dll = pos.slice();
      // heading: compass while (nearly) standing still or by setting, the road ahead while driving
      const always = D.cfg.headSrc === 'compass', cf = H.fresh();
      if (N.useC) { if (!always && N.vs > 3.2) N.useC = false; } else if (always || N.vs < 1.8) N.useC = true;
      let target;
      if (N.useC && cf) target = H.raw;
      else if (N.onR && !N.courseOff) target = G.bearing(pos, G.at(r.coords, r.cum, N.ds + 25).pt);
      else target = N.heading != null ? N.heading : cf ? H.raw : N.dh;
      N.dh = H.approach(N.dh, target, dt, N.useC && cf ? 80 : 300);
      // zoom: a wider view the faster we go
      const v = N.vs || 0, zt = v < 3 ? 16.4 : v < 8 ? 16 : v < 14 ? 15.6 : v < 22 ? 15.1 : 14.6;
      N.dz = N.dz == null ? zt : N.dz + (zt - N.dz) * (1 - Math.exp(-dt / 1800));
      N.pos = pos;
      M.moveMe(pos, N.dh);
      if (N.follow && !A().busyMap()) {
        const map = A().map, c = map.getCenter();
        if (G.dist([c.lng, c.lat], pos) > 0.08 || Math.abs(H.diff(map.getBearing(), N.dh)) > 0.06 || Math.abs(map.getZoom() - N.dz) > 0.004 || Math.abs(map.getPitch() - 50) > 0.5)
          map.jumpTo({ center: pos, bearing: N.dh, zoom: N.dz, pitch: 50, padding: N.padding() });
      }
    },
    recenter() {
      N.follow = true; $('#nRecenter').hidden = true;
      if (N.pos) A().map.easeTo({ center: N.pos, bearing: N.dh, zoom: N.dz || 16.2, pitch: 50, padding: N.padding(), duration: U.reduced() ? 0 : 600 });
    },
    overview() {
      N.follow = false; $('#nRecenter').hidden = false;
      const r = N.route, rest = G.slice(r.coords, r.cum, N.s, r.dist);
      A().map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 });
      setTimeout(() => M.fit(G.bbox(rest), { maxZoom: 15, pitch: 0 }), 320);
    },
    nextMan() {
      const r = N.route;
      while (N.mi < r.man.length - 1 && r.cum[r.man[N.mi].bi] <= N.s + 3) N.mi++;
      while (N.mi > 1 && r.cum[r.man[N.mi - 1].bi] > N.s + 3) N.mi--;
      return r.man[N.mi];
    },
    remaining() {
      const r = N.route, base = r.time - R.timeAt(r, N.s);
      let f = N.fac;
      const now = Date.now() / 1000;
      if (N.paceS0 != null && N.s - N.paceS0 > 1500 && now - N.paceT0 > 120) {
        const plan = R.timeAt(r, N.s) - R.timeAt(r, N.paceS0), pace = U.clamp((now - N.paceT0) / Math.max(30, plan), 0.6, 2.5);
        const w = Math.min(0.7, (N.s - N.paceS0) / 8000);
        f = f * (1 - w) + pace * w;
      }
      return { dist: r.dist - N.s, time: base * f, f };
    },
    spbuAhead() {
      const r = N.route; if (!r.spbu) return [];
      const list = r === DIR().route() ? DIR().filtered() : r.spbu;
      return list.filter(p => p.k === 'f' && p.s > N.s + 15);
    },
    voice() {
      const r = N.route, m = N.nextMan(); if (!m) return;
      const d = r.cum[m.bi] - N.s, v = N.vs || 10;
      const far = v > 22 ? 2000 : v > 14 ? 1000 : 500, near = v > 22 ? 600 : v > 14 ? 350 : 180, now = Math.max(30, v * 3.5);
      const key = N.mi + ':' + r.id, said = N.spoken[key] || 0;
      const quiet = QUIET.includes(m.type);
      const after = r.man[N.mi + 1], soon = after && r.cum[after.bi] - r.cum[m.bi] < 120 && !QUIET.includes(after.type) ? ', lalu ' + lower(after.text) : '';
      if (!quiet) {
        if (d <= now && said < 3) { N.spoken[key] = 3; speak(m.text + soon); }
        else if (d <= near && d > now * 1.5 && said < 2) { N.spoken[key] = 2; speak(sayDist(d) + lower(m.text)); }
        else if (d <= far && d > near * 1.6 && said < 1 && (m.bi === 0 || r.cum[m.bi] - r.cum[r.man[N.mi - 1].bi] > far)) { N.spoken[key] = 1; speak(sayDist(d) + lower(m.text)); }
      }
      if (D.cfg.voiceSpbu !== false && d > near) {
        const sp = N.spbuAhead()[0];
        if (sp) {
          const ds = sp.s - N.s, k = sp.id + ':' + Math.round(sp.s);
          if (ds < Math.max(700, v * 45) && ds > 250 && !N.spSaid[k]) { N.spSaid[k] = 1; speak(P.title(sp).replace(/\d{2}\.\d{3}\.\d{2,3}/, '') + ' di sebelah ' + (sp.side > 0 ? 'kiri' : 'kanan') + ', ' + sayDist(ds).replace('Dalam ', '').replace(', ', '') + ' lagi'); }
        }
      }
    },
    // ---------- UI ----------
    ui() {
      const r = N.route; if (!r) return;
      const m = N.nextMan();
      const d = m ? r.cum[m.bi] - N.s : r.dist - N.s;
      const icn = m ? m.ic : 'tarr', txt = m ? m.text : 'Menuju tujuan';
      const box = $('#navTop .nt-main');
      if (box.dataset.k !== icn + txt) { box.dataset.k = icn + txt; box.classList.remove('chg'); void box.offsetWidth; box.classList.add('chg'); $('#navTop .nt-ic').innerHTML = ic(icn); $('#nText').textContent = txt; }
      $('#nDist').textContent = U.dist(Math.max(0, d));
      const after = m && r.man[N.mi + 1], th = $('#nThen');
      const showThen = after && r.cum[after.bi] - r.cum[m.bi] < 300;
      th.hidden = !showThen; document.body.classList.toggle('thn', !!showThen);
      if (showThen) th.innerHTML = 'Lalu ' + ic(after.ic) + '<span>' + esc(after.text) + '</span>';
      const rem = N.remaining();
      $('#nTime').textContent = U.dur(rem.time);
      $('#nRest').textContent = U.dist(rem.dist) + ' · tiba ' + U.clock(Date.now() + rem.time * 1000);
      $('#navSpeed b').textContent = Math.round((N.vs || 0) * 3.6);
      const sp = N.spbuAhead()[0], pill = $('#navSpbu');
      if (sp && sp.s - N.s < 150000) {
        const ds = sp.s - N.s, tt = (R.timeAt(r, sp.s) - R.timeAt(r, N.s)) * rem.f, b = P.brand(sp.b);
        pill.hidden = false;
        pill.innerHTML = '<span class="brand" style="background:' + b.c + ';color:' + b.t + '">' + esc(b.s) + '</span><span class="nsx"><b>' + esc(P.title(sp)) + '</b><span>SPBU berikutnya · sisi ' + (sp.side > 0 ? 'kiri' : 'kanan') + ' · ±' + U.dur(tt) + '</span></span><span class="nsd">' + U.dist(ds) + '</span>';
      } else pill.hidden = true;
      if (!$('#navSheet').hidden) N.sheet(true);
    },
    offUi() {
      const el = $('#navOff'); if (!el) return;
      const off = !O.online || !navigator.onLine;
      el.hidden = !off;
      if (off) el.innerHTML = ic('warn') + (O.isSaved(N.route && N.route.id) ? 'Offline · peta rute tersimpan' : 'Offline');
    },
    sheet(refresh) {
      const sh = $('#navSheet');
      if (!refresh) { sh.hidden = !sh.hidden; if (sh.hidden) return; }
      const r = N.route, rem = N.remaining(), list = N.spbuAhead().slice(0, 12);
      const f = D.estimate(rem.dist, r.mode, false);
      const y = sh.scrollTop;
      sh.innerHTML = '<div class="pbar"><div class="tt">' + U.dur(rem.time) + ' · ' + U.dist(rem.dist) + '</div><button class="ib" data-a="hide">' + ic('chevd') + '</button></div>' +
        '<div class="acts"><button class="act" data-a="ov"><i>' + ic('layers') + '</i>Ringkasan</button><button class="act' + (D.cfg.voice ? ' on' : '') + '" data-a="voice"><i>' + ic(D.cfg.voice ? 'vol' : 'mute') + '</i>Suara</button>' +
        '<button class="act' + (D.cfg.headSrc === 'compass' ? ' on' : '') + '" data-a="head"><i>' + ic('compass') + '</i>' + (D.cfg.headSrc === 'compass' ? 'Selalu kompas' : 'Kompas otomatis') + '</button>' +
        '<button class="act" data-a="park"><i>' + ic('parking') + '</i>Simpan parkir</button><button class="act" data-a="share"><i>' + ic('share') + '</i>Bagikan ETA</button><button class="act" data-a="end"><i style="color:var(--bad)">' + ic('x') + '</i>Akhiri</button></div>' +
        (f ? '<div class="note">' + ic('fuel') + '<span>Sisa perjalanan butuh ±<b>' + U.liter(f.liters) + '</b> (' + U.rp(f.cost) + ') · ' + esc(f.fuel.n) + ', 1:' + U.num(f.kmpl) + '</span></div>' : '') +
        '<div class="sec">' + ic('fuel') + 'SPBU di depan <small>' + (r.spbu ? N.spbuAhead().length + ' lagi' : 'memuat…') + '</small></div>' +
        (list.length ? '<div class="spl">' + list.map(p => { const ds = p.s - N.s, tt = (R.timeAt(r, p.s) - R.timeAt(r, N.s)) * rem.f, b = P.brand(p.b);
          return '<div class="sp" data-s="' + p.s + '"><div class="sk"><b>' + U.dist(ds) + '</b><small>±' + U.dur(tt) + '</small></div><span class="brand" style="background:' + b.c + ';color:' + b.t + '">' + esc(b.s) + '</span><div class="sm"><b>' + esc(P.title(p)) + '</b><span><span class="side ' + (p.side > 0 ? 'L' : 'R') + '">' + (p.side > 0 ? 'Kiri' : 'Kanan') + '</span> · tiba ' + U.clock(Date.now() + tt * 1000) + '</span></div></div>'; }).join('') + '</div>' : '<div class="empty">Tidak ada SPBU lagi di rute ini.</div>') +
        '<div class="sec">' + ic('list') + 'Langkah berikutnya</div>' + r.man.slice(N.mi, N.mi + 6).map(m => '<div class="step">' + ic(m.ic) + '<div class="stx">' + esc(m.text) + '<small>' + U.dist(r.cum[m.bi] - N.s) + ' lagi</small></div></div>').join('');
      sh.scrollTop = y;
      sh.onclick = e => {
        const b = e.target.closest('[data-a]');
        const sp = e.target.closest('.sp[data-s]');
        if (sp) { const p = r.spbu.find(x => x.s === +sp.dataset.s); if (p) { N.follow = false; $('#nRecenter').hidden = false; A().map.easeTo({ center: [p.lng, p.lat], zoom: 16, pitch: 30, duration: 700 }); sh.hidden = true; } return; }
        if (!b) return;
        const a = b.dataset.a;
        if (a === 'hide') sh.hidden = true;
        if (a === 'ov') { sh.hidden = true; N.overview(); }
        if (a === 'voice') { D.cfg.voice = !D.cfg.voice; D.saveCfg(); N.voiceBtn(); N.sheet(true); if (D.cfg.voice) speak('Suara aktif', true); }
        if (a === 'head') { H.ask(); D.cfg.headSrc = D.cfg.headSrc === 'compass' ? 'auto' : 'compass'; D.saveCfg(); N.sheet(true); U.toast(D.cfg.headSrc === 'compass' ? 'Panah & peta selalu mengikuti kompas HP' : 'Kompas saat berhenti, arah jalan saat melaju', { key: 'head' }); }
        if (a === 'park') { A().savePark(); }
        if (a === 'share') { const rm = N.remaining(); A().share('Perkiraan tiba ' + U.clock(Date.now() + rm.time * 1000), 'Saya menuju ' + N.endName + ', perkiraan tiba pukul ' + U.clock(Date.now() + rm.time * 1000) + ' (' + U.dist(rm.dist) + ' lagi). ' + A().link({ p: { name: N.endName, lng: r.coords[r.coords.length - 1][0], lat: r.coords[r.coords.length - 1][1] } })); }
        if (a === 'end') N.ask();
      };
    },
    voiceBtn() { const b = $('#nVoice'); b.innerHTML = ic(D.cfg.voice ? 'vol' : 'mute'); b.title = D.cfg.voice ? 'Suara aktif' : 'Suara mati'; },
    async ask() {
      const ok = await U.modal('Akhiri navigasi?', '<p>Perjalanan sejauh ' + U.dist(N.trav) + ' akan disimpan di Riwayat perjalanan.</p>', [{ label: 'Lanjutkan', value: false }, { label: 'Akhiri', kind: 'pri', value: true }]);
      if (ok) N.stop(false);
    },
    arrive() {
      if (N.arrived) return;
      N.arrived = true;
      speak('Anda telah tiba di tujuan' + (N.endName && N.endName !== 'Lokasi Anda' ? ', ' + N.endName : '') + '.', true);
      $('#navTop .nt-ic').innerHTML = ic('tarr');
      $('#nDist').textContent = 'Tiba';
      $('#nText').textContent = N.endName || 'Tujuan';
      const t = (Date.now() - N.t0) / 1000, f = D.estimate(N.trav, N.route.mode, false);
      N.forget();
      U.modal('Anda telah tiba', '<p><b>' + esc(N.endName || 'Tujuan') + '</b></p><p>' + U.dist(N.trav) + ' dalam ' + U.dur(t) + (f ? '<br>BBM terpakai ±' + U.liter(f.liters) + ' (' + U.rp(f.cost) + ')' : '') + '</p>',
        [{ label: 'Simpan lokasi parkir', fn: () => { A().savePark(); return true; } }, { label: 'Selesai', kind: 'pri' }]).then(() => N.stop(true));
    },
    async reroute(p) {
      if (N.rerouting || Date.now() - N.lastRR < 9000) return;
      if (!navigator.onLine || !O.online) {         // no signal: stay with the saved route instead of failing every 9 s
        N.lastRR = Date.now();
        if (!N.offSaid) { N.offSaid = true; U.toast('Offline — rute tidak bisa dihitung ulang. Kembali ke garis biru rute tersimpan.', { key: 'rr', ms: 5000 }); speak('Sinyal hilang. Kembali ke rute yang ditandai.'); }
        return;
      }
      N.rerouting = true; N.lastRR = Date.now();
      $('#nText').textContent = 'Menghitung ulang rute…';
      speak('Menghitung ulang rute');
      try {
        const rest = N.pts.slice(N.legBase + N.leg + 1).filter(Boolean);
        if (!rest.length) throw new Error('no stops');
        const pts = [{ lng: p.ll[0], lat: p.ll[1], heading: N.heading }].concat(rest.map(x => ({ lng: x.lng, lat: x.lat })));
        const rs = await R.plan(pts, { mode: N.route.mode, avoid: D.cfg.avoid, alternates: 0, timeout: 15000 });
        if (!N.on) return;
        const nr = rs[0]; nr.fac = N.fac;
        N.legBase += N.leg; N.leg = 0;
        N.route = nr; N.s = 0; N.idx = 0; N.mi = 1; N.off = 0; N.spoken = {}; N.ds = null; N.fixS = 0; N.offSaid = false;
        DIR().routes = [nr]; DIR().ri = 0;
        M.setRoutes([nr], 0);
        P.along(nr, D.cfg.radius || 150).then(l => { nr.spbu = l; DIR().showSpbu(); N.ui(); N.save(); }).catch(() => DIR().spbuFallback(nr, D.cfg.radius || 150).then(l => { nr.spbu = l; DIR().showSpbu(); }).catch(() => { }));
        O.saveRoute(nr, { sat: M.st.base === 'sat', name: N.endName });
        N.fix(p);
        N.save();
      } catch (e) { U.toast('Gagal menghitung ulang rute — periksa sinyal', { kind: 'bad', key: 'rr' }); }
      N.rerouting = false;
    },
    keep() { if (document.visibilityState === 'visible') keepUnlocked(); },
    // ---------- wake lock ----------
    async wake() {
      try { if ('wakeLock' in navigator && document.visibilityState === 'visible') N.lock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
    },
    // ---------- resume after a reload (also offline: the route lives in Cache Storage) ----------
    async save() {
      if (!N.on || !window.caches) return;
      const r = N.route;
      const data = {
        v: 1, t: Date.now(), t0: N.t0, trav: Math.round(N.trav), mode: r.mode, pts: N.pts, end: N.endName, fac: N.fac,
        r: { id: r.id, mode: r.mode, src: r.src, coords: r.coords.map(c => [+c[0].toFixed(6), +c[1].toFixed(6)]), tcum: Array.from(r.tcum, x => Math.round(x * 10) / 10),
          man: r.man, legs: r.legs, dist: r.dist, time: r.time, toll: r.toll, tollDist: r.tollDist, hw: r.hw, ferry: r.ferry, via: r.via, spbu: r.spbu || null, spbuR: r.spbuR || 0 },
      };
      try {
        const c = await caches.open(NAVC); await c.put(NAVKEY, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
        U.set('pt.maps.navt', { t: data.t, end: N.endName, id: r.id });
      } catch (e) { /* storage */ }
    },
    forget() { U.del('pt.maps.navt'); if (window.caches) caches.open(NAVC).then(c => c.delete(NAVKEY)).catch(() => { }); },
    async load() {
      try { const c = await caches.open(NAVC), r = await c.match(NAVKEY); return r ? await r.json() : null; } catch (e) { return null; }
    },
  };
  // controls
  $('#nExit').onclick = () => N.ask();
  $('#nRecenter').onclick = () => N.recenter();
  $('#nMore').onclick = () => N.sheet();
  $('#nSum').onclick = () => N.sheet();
  $('#nVoice').onclick = () => { D.cfg.voice = !D.cfg.voice; D.saveCfg(); N.voiceBtn(); if (D.cfg.voice) speak('Suara aktif', true); else try { speechSynthesis.cancel(); } catch (e) { /* */ } };
  $('#navSpbu').onclick = () => { $('#navSheet').hidden = true; N.sheet(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && N.on) { if (!N.lock) N.wake(); keepUnlocked(); } });
  addEventListener('resize', () => { N.padH = 0; });
})();
