// Amatu Maps · turn-by-turn navigation: GPS snapping, banner, Indonesian voice, re-routing,
// live distance to the next SPBU, adaptive ETA, simulation, trip log.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U, G = AM.G, R = AM.R, P = AM.P, D = AM.D, M = AM.M;
  const $ = U.$, esc = U.esc, ic = U.ic;
  const A = () => AM.A, DIR = () => AM.DIR, PV = () => AM.PV;
  const QUIET = [7, 8, 22];                   // "continue" manoeuvres are shown but not spoken

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

  const N = AM.N = {
    on: false, route: null, s: 0, sim: false, follow: true,
    start(route, o = {}) {
      if (!route) return U.toast('Belum ada rute');
      if (N.on) N.stop(false, true);
      const st = A().st;
      if (!o.sim && !st.user && !navigator.geolocation) return U.toast('GPS tidak tersedia di perangkat ini. Coba “Simulasi”.');
      Object.assign(N, {
        on: true, route, sim: !!o.sim, s: 0, idx: 0, mi: 1, off: 0, t0: Date.now(), trav: 0, last: null, spoken: {}, spSaid: {}, rerouting: false, lastRR: 0,
        arrived: false, legBase: 0, leg: 0, follow: true, speed: 0, heading: null, simRate: 1, simPaused: false, simT: 0, lastTrav: 0, paceS0: null, paceT0: null, fac: route.fac || 1,
        startName: DIR().pts[0] ? DIR().pts[0].name : '', endName: DIR().pts[DIR().pts.length - 1] ? DIR().pts[DIR().pts.length - 1].name : '', pts: DIR().pts.slice()
      });
      document.body.classList.add('nav');
      $('#nav').hidden = false; $('#navSheet').hidden = true;
      $('#navSpeed').hidden = false; $('#navSim').hidden = !N.sim;
      if (U.mobile()) document.documentElement.style.setProperty('--sh-h', '0px');
      N.voiceBtn();
      N.wake();
      M.setRoutes([route], 0); M.showTags([], 0); M.setTrav(null);
      DIR().showSpbu();
      const map = A().map;
      N.onDrag = e => { if (e.originalEvent && N.on) { N.follow = false; $('#nRecenter').hidden = false; } };
      map.on('dragstart', N.onDrag); map.on('rotatestart', N.onDrag); map.on('pitchstart', N.onDrag);
      const first = route.man[0];
      speak((first ? first.text : 'Mulai') + (route.man[1] ? '. Lalu ' + lower(route.man[1].text) : '') + '. Perkiraan tiba pukul ' + U.clock(Date.now() + route.time * N.fac * 1000).replace('.', ' lewat ') + '.', true);
      if (N.sim) { N.simSetup(); N.simTick(); }
      else {
        A().locate({ watch: true, quiet: true }).catch(() => U.toast('Izinkan akses lokasi untuk navigasi, atau gunakan Simulasi', { kind: 'bad' }));
        if (st.user) N.fix({ ll: st.user, acc: st.acc, heading: st.heading, speed: st.speed, t: Date.now() });
        else { const p = route.coords[0]; N.camera(p, G.bearing(route.coords[0], route.coords[1] || p), 0, true); N.ui(); }
      }
    },
    stop(arrived, silent) {
      if (!N.on) return;
      N.on = false;
      clearTimeout(N.simTimer);
      const map = A().map;
      map.off('dragstart', N.onDrag); map.off('rotatestart', N.onDrag); map.off('pitchstart', N.onDrag);
      document.body.classList.remove('nav', 'thn');
      $('#nav').hidden = true;
      if (N.lock) { N.lock.release().catch(() => { }); N.lock = null; }
      try { speechSynthesis.cancel(); } catch (e) { /* */ }
      M.setTrav(null);
      if (M.meEl) M.meEl.classList.remove('nav');
      const el = (Date.now() - N.t0) / 1000;
      if (N.trav > 200 && !silent) {
        const f = D.estimate(N.trav, N.route.mode, false);
        D.pushTrip({ id: U.uid(), t: N.t0, from: N.startName, to: N.endName, mode: N.route.mode, dist: Math.round(N.trav), time: Math.round(N.sim ? N.simT : el), liters: f ? +f.liters.toFixed(2) : 0, cost: f ? Math.round(f.cost) : 0, sim: N.sim || undefined, arrived: !!arrived });
      }
      map.stop(); map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); map.jumpTo({ pitch: 0, bearing: 0 });
      if (DIR().route()) { DIR().draw(true); PV().layout(); if (PV().is('dir')) PV().refresh('body'); }
      A().afterNav();
    },
    // ---------- one position fix ----------
    fix(p) {
      if (!N.on || !N.route || N.arrived) return;
      const r = N.route, n0 = r.coords.length;
      let n = G.nearest(r.coords, r.cum, p.ll, Math.max(0, N.idx - 4), Math.min(n0 - 1, N.idx + 400));
      if (n.d > 50) { const g = G.nearest(r.coords, r.cum, p.ll); if (g.d + 15 < n.d) n = g; }
      const tol = Math.max(30, Math.min(75, (p.acc || 15) * 1.4));
      const onRoute = n.d <= tol;
      N.off = onRoute ? 0 : N.off + 1;
      if (onRoute || N.sim) {
        const prevS = N.s;
        if (n.s >= N.s - 40) { N.s = n.s; N.idx = n.i; }
        if (N.s > prevS) N.trav += N.s - prevS;
      } else if (N.last) N.trav += Math.min(200, G.dist(N.last.ll, p.ll));
      if (N.paceS0 == null && (p.speed > 2 || N.s > 50)) { N.paceS0 = N.s; N.paceT0 = N.sim ? N.simT : Date.now() / 1000; }
      // heading: GPS course when moving, else the road
      const at = G.at(r.coords, r.cum, N.s);
      let hd = isFinite(p.heading) && p.speed > 1.5 ? p.heading : null;
      if (hd == null && N.last && G.dist(N.last.ll, p.ll) > 4) hd = G.bearing(N.last.ll, p.ll);
      if (onRoute && (hd == null || Math.abs(G.angDiff(hd, at.brg)) < 50)) hd = at.brg;
      if (hd != null) N.heading = hd;
      N.speed = isFinite(p.speed) && p.speed >= 0 ? p.speed : N.last ? G.dist(N.last.ll, p.ll) / Math.max(0.5, (p.t - N.last.t) / 1000) : 0;
      N.last = { ll: p.ll, t: p.t };
      const show = onRoute ? at.pt : p.ll;
      M.showMe(show, N.heading != null ? N.heading : 0, { nav: true });
      if (N.follow) N.camera(show, N.heading, N.speed);
      if (N.off >= 3 && !N.sim && (p.acc || 0) < 60) N.reroute(p);
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
    camera(ll, hd, v, instant) {
      const map = A().map, H = map.getContainer().clientHeight;
      const z = v < 7 ? 17.4 : v < 14 ? 16.8 : v < 22 ? 16.1 : 15.4;
      map.easeTo({ center: ll, bearing: hd != null ? hd : map.getBearing(), pitch: 55, zoom: z, padding: { top: Math.round(H * 0.42), bottom: 90, left: 0, right: 0 }, duration: instant || U.reduced() ? 0 : N.sim ? 950 / N.simRate : 1000, easing: t => t });
    },
    recenter() { N.follow = true; $('#nRecenter').hidden = true; if (N.last) N.camera(N.route ? G.at(N.route.coords, N.route.cum, N.s).pt : N.last.ll, N.heading, N.speed); },
    overview() {
      N.follow = false; $('#nRecenter').hidden = false;
      const r = N.route, rest = G.slice(r.coords, r.cum, N.s, r.dist);
      A().map.easeTo({ pitch: 0, bearing: 0, duration: 300 });
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
      const now = N.sim ? N.simT : Date.now() / 1000;
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
      const d = r.cum[m.bi] - N.s, v = N.speed || 10;
      const far = v > 22 ? 2000 : v > 14 ? 1000 : 500, near = v > 22 ? 600 : v > 14 ? 350 : 180, now = Math.max(30, v * 3.5);
      const key = N.mi + ':' + r.id, said = N.spoken[key] || 0;
      const quiet = QUIET.includes(m.type);
      const after = r.man[N.mi + 1], soon = after && r.cum[after.bi] - r.cum[m.bi] < 120 && !QUIET.includes(after.type) ? ', lalu ' + lower(after.text) : '';
      if (!quiet) {
        if (d <= now && said < 3) { N.spoken[key] = 3; speak(m.text + soon); }
        else if (d <= near && d > now * 1.5 && said < 2) { N.spoken[key] = 2; speak(sayDist(d) + lower(m.text)); }
        else if (d <= far && d > near * 1.6 && said < 1 && (m.bi === 0 || r.cum[m.bi] - r.cum[r.man[N.mi - 1].bi] > far)) { N.spoken[key] = 1; speak(sayDist(d) + lower(m.text)); }
      }
      // next SPBU announcement (±1 km ahead, once per station)
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
      $('#navTop .nt-ic').innerHTML = ic(m ? m.ic : 'tarr');
      $('#nDist').textContent = U.dist(Math.max(0, d));
      $('#nText').textContent = m ? m.text : 'Menuju tujuan';
      const after = m && r.man[N.mi + 1], th = $('#nThen');
      const showThen = after && r.cum[after.bi] - r.cum[m.bi] < 300;
      th.hidden = !showThen; document.body.classList.toggle('thn', !!showThen);
      if (showThen) th.innerHTML = 'Lalu ' + ic(after.ic) + '<span>' + esc(after.text) + '</span>';
      const rem = N.remaining();
      $('#nTime').textContent = U.dur(rem.time);
      $('#nRest').textContent = U.dist(rem.dist) + ' · tiba ' + U.clock(Date.now() + rem.time * 1000 * (N.sim ? 1 / N.simRate : 1));
      $('#navSpeed b').textContent = Math.round((N.speed || 0) * 3.6);
      // next SPBU pill: live distance + time + side
      const sp = N.spbuAhead()[0], pill = $('#navSpbu');
      if (sp && sp.s - N.s < 150000) {
        const ds = sp.s - N.s, tt = (R.timeAt(r, sp.s) - R.timeAt(r, N.s)) * rem.f, b = P.brand(sp.b);
        pill.hidden = false;
        pill.innerHTML = '<span class="brand" style="background:' + b.c + ';color:' + b.t + '">' + esc(b.s) + '</span><span class="nsx"><b>' + esc(P.title(sp)) + '</b><span>SPBU berikutnya · sisi ' + (sp.side > 0 ? 'kiri' : 'kanan') + ' · ±' + U.dur(tt) + '</span></span><span class="nsd">' + U.dist(ds) + '</span>';
      } else pill.hidden = true;
      if (!$('#navSheet').hidden) N.sheet(true);
    },
    sheet(refresh) {
      const sh = $('#navSheet');
      if (!refresh) { sh.hidden = !sh.hidden; if (sh.hidden) return; }
      const r = N.route, rem = N.remaining(), list = N.spbuAhead().slice(0, 12);
      const f = D.estimate(rem.dist, r.mode, false);
      const y = sh.scrollTop;
      sh.innerHTML = '<div class="pbar"><div class="tt">' + U.dur(rem.time) + ' · ' + U.dist(rem.dist) + '</div><button class="ib" data-a="hide">' + ic('chevd') + '</button></div>' +
        '<div class="acts"><button class="act" data-a="ov"><i>' + ic('layers') + '</i>Ringkasan</button><button class="act' + (D.cfg.voice ? ' on' : '') + '" data-a="voice"><i>' + ic(D.cfg.voice ? 'vol' : 'mute') + '</i>Suara</button>' +
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
      const t = N.sim ? N.simT : (Date.now() - N.t0) / 1000, f = D.estimate(N.trav, N.route.mode, false);
      clearTimeout(N.simTimer);
      U.modal('Anda telah tiba', '<p><b>' + esc(N.endName || 'Tujuan') + '</b></p><p>' + U.dist(N.trav) + ' dalam ' + U.dur(t) + (f ? '<br>BBM terpakai ±' + U.liter(f.liters) + ' (' + U.rp(f.cost) + ')' : '') + '</p>',
        [{ label: 'Simpan lokasi parkir', fn: () => { A().savePark(); return true; } }, { label: 'Selesai', kind: 'pri' }]).then(() => N.stop(true));
    },
    async reroute(p) {
      if (N.rerouting || Date.now() - N.lastRR < 9000) return;
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
        N.route = nr; N.s = 0; N.idx = 0; N.mi = 1; N.off = 0; N.spoken = {};
        DIR().routes = [nr]; DIR().ri = 0;
        M.setRoutes([nr], 0);
        P.along(nr, D.cfg.radius || 150).then(l => { nr.spbu = l; DIR().showSpbu(); N.ui(); }).catch(() => DIR().spbuFallback(nr, D.cfg.radius || 150).then(l => { nr.spbu = l; DIR().showSpbu(); }).catch(() => { }));
        N.fix(p);
      } catch (e) { U.toast('Gagal menghitung ulang rute — periksa sinyal', { kind: 'bad', key: 'rr' }); }
      N.rerouting = false;
    },
    // ---------- wake lock ----------
    async wake() {
      try { if ('wakeLock' in navigator && document.visibilityState === 'visible') N.lock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
    },
    // ---------- simulation ----------
    simSetup() {
      const box = $('#navSim');
      box.innerHTML = '<button data-sp="p" title="Jeda">' + ic('pause') + '</button>' + [1, 2, 4, 8, 16].map(x => '<button data-sp="' + x + '" class="' + (x === N.simRate ? 'on' : '') + '">' + x + '×</button>').join('');
      box.onclick = e => {
        const b = e.target.closest('[data-sp]'); if (!b) return;
        if (b.dataset.sp === 'p') { N.simPaused = !N.simPaused; b.innerHTML = ic(N.simPaused ? 'play' : 'pause'); if (!N.simPaused) N.simTick(); return; }
        N.simRate = +b.dataset.sp; box.querySelectorAll('[data-sp]').forEach(x => x.classList.toggle('on', x === b));
      };
    },
    simTick() {
      clearTimeout(N.simTimer);
      if (!N.on || !N.sim || N.simPaused) return;
      const r = N.route, i = G.idx(r.cum, N.s), j = Math.min(r.cum.length - 1, i + 1);
      const v = U.clamp((r.cum[j] - r.cum[i]) / Math.max(0.2, r.tcum[j] - r.tcum[i]), 3, 33) / (N.fac || 1);
      const dt = 1;
      N.simT += dt;
      const s = Math.min(r.dist, N.s + v * dt);
      const at = G.at(r.coords, r.cum, s);
      N.fix({ ll: at.pt, acc: 5, heading: at.brg, speed: v, t: Date.now() });
      if (N.on && !N.arrived) N.simTimer = setTimeout(N.simTick, 1000 / N.simRate);
    },
  };
  // controls
  $('#nExit').onclick = () => N.ask();
  $('#nRecenter').onclick = () => N.recenter();
  $('#nMore').onclick = () => N.sheet();
  $('#nSum').onclick = () => N.sheet();
  $('#nVoice').onclick = () => { D.cfg.voice = !D.cfg.voice; D.saveCfg(); N.voiceBtn(); if (D.cfg.voice) speak('Suara aktif', true); else try { speechSynthesis.cancel(); } catch (e) { /* */ } };
  $('#navSpbu').onclick = () => { $('#navSheet').hidden = true; N.sheet(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && N.on && !N.lock) N.wake(); });
})();
