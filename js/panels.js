// Amatu Maps · side panel (desktop) / bottom sheet (phone), autocomplete, and the views:
// results, place, directions (routes, SPBU on the route, steps, fuel estimate), saved, recent, trips.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U, G = AM.G, Q = AM.Q, R = AM.R, P = AM.P, D = AM.D, M = AM.M, O = AM.O;
  const $ = U.$, esc = U.esc, ic = U.ic;
  const A = () => AM.A;

  // ============ panel / sheet ============
  const panel = $('#panel'), pv = $('#pv');
  const PV = AM.PV = {
    stack: [], snapState: 'half',
    cur() { return PV.stack[PV.stack.length - 1]; },
    open(view, data = {}, o = {}) {
      const prev = PV.cur();
      if (prev) { prev.scroll = pv.scrollTop; if (o.replace || o.root) PV.leave(o.root ? null : prev); }
      if (o.root) PV.stack = [];
      else if (o.replace) PV.stack.pop();
      PV.stack.push({ view, data, scroll: 0 });
      panel.hidden = false;
      document.body.classList.remove('pclosed');
      PV.render(); PV.fade();
      pv.scrollTop = 0;
      if (U.mobile()) PV.snap(o.snap || V[view].snap || 'half');
      PV.layout();
    },
    leave(entry) {
      const list = entry ? [entry] : PV.stack.slice().reverse();
      list.forEach(e => { if (V[e.view].leave) V[e.view].leave(e.data); });
    },
    back() {
      const top = PV.stack.pop();
      if (top && V[top.view].leave) V[top.view].leave(top.data);
      if (!PV.stack.length) return PV.close();
      PV.render(); PV.fade(-1);
      pv.scrollTop = PV.cur().scroll || 0;
      if (U.mobile()) PV.snap(V[PV.cur().view].snap || 'half');
      PV.layout();
    },
    close() {
      PV.leave(null);
      PV.stack = [];
      panel.hidden = true;
      document.body.classList.remove('dirmode', 'sheetfull');
      const dt = $('#dtop'); if (dt) dt.remove();
      PV.layout();
      A().onPanelClosed();
    },
    render() {
      const c = PV.cur(); if (!c) return;
      const v = V[c.view];
      pv.innerHTML = v.html(c.data);
      panel.classList.toggle('notop', !!v.notop);
      document.body.classList.toggle('dirmode', c.view === 'dir');
      if (c.view !== 'dir') { const dt = $('#dtop'); if (dt) dt.remove(); }
      if (v.mount) v.mount(pv, c.data);
    },
    refresh(part) {
      const c = PV.cur(); if (!c) return;
      const v = V[c.view];
      if (v.update) return v.update(pv, c.data, part);
      const st = pv.scrollTop; PV.render(); pv.scrollTop = st;
    },
    is: view => { const c = PV.cur(); return !!c && c.view === view && !panel.hidden; },
    fade(dir = 1) { if (U.reduced()) return; pv.classList.remove('fin', 'fback'); void pv.offsetWidth; pv.classList.add(dir < 0 ? 'fback' : 'fin'); },
    heights() {
      const H = innerHeight, top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 0;
      const dt = $('#dtop'), dtop = dt ? dt.getBoundingClientRect().bottom + 6 : top + 70;
      return { peek: Math.min(148, H * 0.26), half: Math.round(H * 0.42), full: Math.max(260, H - dtop) };
    },
    snap(s) {
      if (!U.mobile()) return;
      const h = PV.heights();
      PV.snapState = typeof s === 'number' ? 'custom' : s;
      const px = typeof s === 'number' ? s : h[s] || h.half;
      panel.style.height = px + 'px';
      document.documentElement.style.setProperty('--sh-h', (panel.hidden ? 0 : px) + 'px');
      document.body.classList.toggle('sheetfull', PV.snapState === 'full' && !$('#dtop'));
    },
    layout() {
      const mob = U.mobile(), open = !panel.hidden;
      if (mob) {
        panel.style.width = '';
        document.documentElement.style.setProperty('--pw', '0px');
        if (!open) { document.documentElement.style.setProperty('--sh-h', '0px'); document.body.classList.remove('sheetfull'); }
        else PV.snap(PV.snapState === 'custom' ? parseFloat(panel.style.height) : PV.snapState);
      } else {
        panel.style.height = '';
        document.documentElement.style.setProperty('--sh-h', '0px');
        const closed = document.body.classList.contains('pclosed');
        document.documentElement.style.setProperty('--pw', open && !closed ? 'var(--pwid)' : '0px');
        const b = $('#bPanel'); b.hidden = !open; b.classList.toggle('out', closed);
      }
    },
  };
  // Drag the sheet like a native bottom sheet: by its handle / header, and from the content too — upwards while the
  // sheet isn't full yet, downwards when the content is scrolled to the top. Height follows the finger every frame
  // and snaps with its speed (peek / half / full).
  (function sheetDrag() {
    const HEAD = '.grab, .ph, .pbar, .sumbig, .rtabs-h, .tabs, .dhead';
    let on = false, decided = false, take = false, head = false, x0 = 0, y0 = 0, h0 = 0, lastY = 0, lastT = 0, vel = 0, nh = 0, raf = 0, grabTap = false;
    const apply = () => { raf = 0; panel.style.height = nh + 'px'; document.documentElement.style.setProperty('--sh-h', nh + 'px'); };
    const begin = (x, y, target) => {
      if (!U.mobile() || panel.hidden) return false;
      if (target.closest('input, select, textarea, [contenteditable]')) return false;
      on = true; decided = false; take = false; x0 = x; y0 = lastY = y; lastT = performance.now(); vel = 0;
      h0 = panel.getBoundingClientRect().height; head = !!target.closest(HEAD); grabTap = !!target.closest('.grab');
      return true;
    };
    const move = (x, y) => {
      if (!on) return false;
      const dy = y - y0, dx = x - x0, now = performance.now();
      if (!decided) {
        if (Math.abs(dy) < 7 && Math.abs(dx) < 7) return false;
        decided = true;
        if (Math.abs(dx) > Math.abs(dy)) { on = false; return false; }        // a sideways scroller (chips, actions)
        const h = PV.heights(), full = h0 >= h.full - 4;
        take = head || (dy < 0 && !full) || (dy > 0 && pv.scrollTop <= 0);
        if (!take) { on = false; return false; }
        panel.classList.add('drag');
      }
      vel = vel * 0.55 + ((y - lastY) / Math.max(1, now - lastT)) * 0.45; lastY = y; lastT = now;
      const h = PV.heights();
      let v = h0 - dy;
      if (v > h.full) v = h.full + (v - h.full) * 0.25;                         // rubber band past the top
      nh = Math.max(64, v);
      if (!raf) raf = requestAnimationFrame(apply);
      return true;
    };
    const end = () => {
      if (!on) return;
      on = false;
      if (!take) { if (!decided && grabTap) PV.snap(PV.snapState === 'full' ? 'half' : 'full'); return; }
      panel.classList.remove('drag');
      if (raf) { cancelAnimationFrame(raf); apply(); }
      const h = PV.heights(), cur = panel.getBoundingClientRect().height;
      let pick;
      if (vel > 0.45) pick = cur > h.half + 30 ? 'half' : 'peek';
      else if (vel < -0.45) pick = cur < h.half - 30 ? 'half' : 'full';
      else pick = ['peek', 'half', 'full'].reduce((a, b) => Math.abs(h[b] - cur) < Math.abs(h[a] - cur) ? b : a);
      PV.snap(pick);
    };
    panel.addEventListener('touchstart', e => { if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY, e.target); else on = false; }, { passive: true });
    panel.addEventListener('touchmove', e => { if (on && e.touches.length === 1 && move(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault(); }, { passive: false });
    panel.addEventListener('touchend', end, { passive: true });
    panel.addEventListener('touchcancel', end, { passive: true });
    // mouse (a narrow desktop window shows the sheet too): header / handle only
    panel.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.target.closest(HEAD) && begin(e.clientX, e.clientY, e.target)) head = true; });
    addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && on) move(e.clientX, e.clientY); }, { passive: true });
    addEventListener('pointerup', e => { if (e.pointerType === 'mouse') end(); });
  })();

  // ============ autocomplete (main search box + route inputs) ============
  const AC = AM.AC = {
    attach(input, o) {
      let box = o.box || null, items = [], at = -1, req = 0, ac = null;
      const ensure = () => {
        if (!box) { box = document.createElement('div'); box.className = 'card acbox'; box.style.cssText = 'position:fixed;z-index:70;max-height:min(60vh,420px);overflow:auto;padding:6px 0;border-radius:12px;box-shadow:var(--sh2)'; document.body.appendChild(box); }
        if (!o.box) { const r = input.getBoundingClientRect(); box.style.left = Math.max(8, r.left) + 'px'; box.style.top = (r.bottom + 4) + 'px'; box.style.width = Math.max(260, Math.min(innerWidth - 16, r.width + 40)) + 'px'; }
        return box;
      };
      const hide = () => { req++; if (ac) { ac.abort(); ac = null; } if (box) { box.hidden = true; if (!o.box) { box.remove(); box = null; } } at = -1; };
      const draw = () => {
        const b = ensure();
        if (!items.length) { b.hidden = true; return; }
        b.hidden = false;
        b.innerHTML = items.map((it, i) => it.head ? '<div class="sg-h">' + esc(it.head) + '</div>' :
          '<div class="sg' + (i === at ? ' on' : '') + '" data-i="' + i + '"><span class="si">' + ic(it.ic || 'pin') + '</span><span class="st"><b>' + esc(it.name) + '</b>' + (it.addr ? '<span>' + esc(it.addr) + '</span>' : '') + '</span>' + (it.dist ? '<span class="sd">' + esc(it.dist) + '</span>' : '') + '</div>').join('');
        b.querySelectorAll('.sg').forEach(el => {
          el.onmousedown = e => e.preventDefault();
          el.onclick = () => pick(items[+el.dataset.i]);
        });
      };
      const pick = it => { if (!it || it.head) return; hide(); o.onPick(it); };
      const base = () => {
        const out = [], q = input.value.trim().toLowerCase();
        const st = A().st;
        if (o.gps && st.user && (!q || 'lokasi anda'.includes(q))) out.push({ gps: true, name: 'Lokasi Anda', ic: 'locon', lng: st.user[0], lat: st.user[1] });
        const lab = [['home', 'Rumah', 'home'], ['work', 'Kantor', 'work']];
        for (const [k, n, i] of lab) { const s = D.saved[k]; if (s && (!q || n.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q))) out.push({ name: n, addr: s.addr || s.name, ic: i, lng: s.lng, lat: s.lat }); }
        const sv = D.saved.items.filter(it => q && (it.name.toLowerCase().includes(q) || (it.addr || '').toLowerCase().includes(q))).slice(0, 3)
          .map(it => ({ name: it.name, addr: it.addr, ic: 'bookmark', lng: it.lng, lat: it.lat, osm: it.osm, cat: it.cat }));
        out.push(...sv);
        const rc = D.recent().filter(r => !q || (r.name || r.q || '').toLowerCase().includes(q)).slice(0, q ? 3 : 6)
          .map(r => r.q ? { name: r.q, ic: 'history', q: r.q } : { name: r.name, addr: r.addr, ic: 'history', lng: r.lng, lat: r.lat, osm: r.osm, cat: r.cat, ov: r.ov });
        out.push(...rc);
        return out;
      };
      const run = U.debounce(async () => {
        if (document.activeElement !== input) return;              // a search already ran / the field was left
        const q = input.value.trim(), my = ++req;
        const local = base(); at = -1;
        const ref = A().center();
        const c = G.parse(q, ref);
        if (c) local.unshift({ name: G.fmtLL(c, 6), addr: 'Koordinat', ic: 'pin', lng: c[0], lat: c[1], coord: true });
        items = local; draw();
        if (q.length < 2 || c) return;
        if (ac) ac.abort(); ac = new AbortController();
        const u = A().st.user;
        const show = res => {
          if (my !== req) return;
          const from = u || ref, sel = at >= 0 && items[at] ? items[at] : null;
          items = local.concat(res.filter(r => !local.some(l => l.name === r.name && Math.abs(l.lng - r.lng) < 2e-4)).map(r => Object.assign(r, { dist: U.dist(G.dist(from, [r.lng, r.lat])) })));
          at = sel ? items.indexOf(sel) : -1;
          draw();
        };
        try {
          const map = A().map, z = map.getZoom();
          // the map view when zoomed in, otherwise where the user is
          const main = z >= 10 || !u ? ref : u;
          const res = await Q.find(q, main, { zoom: z, user: u, typing: true, limit: 8, rings: 3, signal: ac.signal, onUpdate: show });
          show(res);
        } catch (e) { /* offline / aborted */ }
      }, 200);
      input.addEventListener('input', () => { o.onInput && o.onInput(); run(); });
      input.addEventListener('focus', () => { if (o.onFocus) o.onFocus(); run(); });
      input.addEventListener('blur', () => setTimeout(hide, 160));
      input.addEventListener('keydown', e => {
        if (!box || box.hidden) { if (e.key === 'Enter' && o.onEnter) { e.preventDefault(); o.onEnter(input.value.trim()); } return; }
        const sel = () => items.map((x, i) => x.head ? -1 : i).filter(i => i >= 0);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); const s = sel(); if (!s.length) return;
          const k = s.indexOf(at); at = s[(k + (e.key === 'ArrowDown' ? 1 : s.length - 1) + (k < 0 && e.key === 'ArrowUp' ? 1 : 0)) % s.length]; draw();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (at >= 0) pick(items[at]); else { hide(); if (o.onEnter) o.onEnter(input.value.trim()); else pick(items.find(x => !x.head)); }
        } else if (e.key === 'Escape') hide();
      });
      return { hide, run };
    },
  };

  // ============ helpers ============
  const brandBadge = p => { const b = P.brand(p.b); return '<span class="brand" style="background:' + b.c + ';color:' + b.t + '">' + esc(b.s) + '</span>'; };
  const sideTag = s => '<span class="side ' + (s > 0 ? 'L' : 'R') + '">' + (s > 0 ? 'Kiri' : 'Kanan') + '</span>';
  const fac = (mode, when) => R.factor(mode, when || new Date(), D.cfg.traffic);
  function wx(code) {
    if (code === 0) return 'Cerah'; if (code <= 2) return 'Cerah berawan'; if (code === 3) return 'Berawan'; if (code <= 48) return 'Berkabut';
    if (code <= 57) return 'Gerimis'; if (code <= 67) return 'Hujan'; if (code <= 77) return 'Salju'; if (code <= 82) return 'Hujan lokal'; return 'Badai petir';
  }

  // ============ views ============
  const V = AM.V = {};

  // ---------- results ----------
  V.results = {
    snap: 'half',
    html(d) {
      let body;
      if (d.loading && !(d.items && d.items.length)) body = '<div class="loading"><span class="spin"></span>Mencari ' + esc(d.title) + '…</div>';
      else if (d.err) body = '<div class="empty">' + esc(d.err) + '</div>';
      else if (!d.items.length) body = '<div class="empty">Tidak ada hasil untuk “' + esc(d.title) + '” di area ini.<br><small>Coba geser/perkecil peta lalu cari lagi.</small></div>';
      else body = d.items.map((r, i) => {
        const st = r.oh ? Q.ohStatus(r.oh) : null;
        return '<div class="res" data-i="' + i + '"><div class="rd"><b>' + esc(r.name || r.cat) + '</b><span>' + esc([r.cat, r.dist].filter(Boolean).join(' · ')) + '</span>' +
          (r.addr ? '<span>' + esc(r.addr) + '</span>' : '') + (st ? '<span class="' + (st.open ? 'ok' : 'bad') + '">' + esc(st.text) + '</span>' : '') +
          (r.spbu ? '<span>' + P.tags(r.spbu).map(t => '<span class="badge">' + esc(t) + '</span>').join(' ') + '</span>' : '') + '</div>' +
          '<div class="rr"><button class="ib" data-a="dir" data-i="' + i + '" title="Rute ke sini">' + ic('dir') + '</button></div></div>';
      }).join('') + (d.loading ? '<div class="loading sm"><span class="spin"></span>Mencari tempat usaha di sekitar…</div>' : '');
      return '<div class="pbar"><button class="ib" data-a="back" aria-label="Kembali">' + ic('back') + '</button><div class="tt">' + esc(d.title) + (d.items && d.items.length ? ' <small class="mut">· ' + d.items.length + '</small>' : '') + '</div>' +
        (d.cat ? '<button class="btn sm" data-a="again">' + ic('search') + 'Cari di area ini</button>' : '') + '<button class="ib" data-a="close" aria-label="Tutup">' + ic('x') + '</button></div>' + body;
    },
    mount(el, d) {
      M.setResults(d.items || [], -1);
      el.onclick = e => {
        const b = e.target.closest('[data-a]');
        if (b) {
          const a = b.dataset.a;
          if (a === 'back') return PV.back();
          if (a === 'close') return PV.close();
          if (a === 'again') return A().searchCat(d.cat);
          if (a === 'dir') { e.stopPropagation(); return DIR.open({ to: d.items[+b.dataset.i] }); }
        }
        const r = e.target.closest('.res');
        if (r) A().openPlace(d.items[+r.dataset.i], { from: 'results' });
      };
      el.onmouseover = e => { const r = e.target.closest('.res'); if (r) M.setResults(d.items, +r.dataset.i); };
    },
    leave() { M.setResults([]); },
  };

  // ---------- place ----------
  V.place = {
    snap: 'half',
    html(p) {
      const saved = D.near(p.lng, p.lat, 30).length > 0 || (p.savedId && D.saved.items.some(i => i.id === p.savedId));
      const sp = p.spbu;
      const rows = [];
      if (p.addr) rows.push('<div class="row">' + ic('pin') + '<div class="rt">' + esc(p.addr) + '</div></div>');
      else rows.push('<div class="row" data-r="addr">' + ic('pin') + '<div class="rt mut">Mencari alamat…</div></div>');
      if (sp) {
        const b = P.brand(sp.b), tags = P.tags(sp);
        rows.push('<div class="row">' + ic('fuel') + '<div class="rt"><b>' + esc(b.n) + '</b>' + (sp.no ? ' · No. ' + esc(sp.no) : '') + (tags.length ? '<small>' + esc(tags.join(' · ')) + '</small>' : '<small>Jenis BBM belum tercatat di OpenStreetMap</small>') + '</div></div>');
        if (sp.oh) rows.push(ohRow(sp.oh));
      }
      if (p.ov) {
        const o = p.ov, link = (u, icn, label, sub) => '<a class="row click" target="_blank" rel="noopener" href="' + esc(u) + '">' + ic(icn) + '<div class="rt">' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div></a>';
        if (o.phone) rows.push('<a class="row click" href="tel:' + esc(o.phone.replace(/[^\d+]/g, '')) + '">' + ic('phone') + '<div class="rt">' + esc(o.phone.replace(/^\+62/, '0')) + '<small>Telepon</small></div></a>');
        if (o.web) rows.push(link(/^https?:/.test(o.web) ? o.web : 'https://' + o.web, 'web', o.web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), 'Situs web'));
        if (o.fb) rows.push(link(o.fb, 'share', 'Facebook', 'Halaman tempat ini'));
        if (o.ig) rows.push(link(o.ig, 'share', 'Instagram', ''));
      }
      rows.push('<div data-r="extra"></div>');
      const pc = G.olc(p.lat, p.lng);
      rows.push('<div class="row click" data-a="copy" data-v="' + esc(G.olcShort(pc) + (p.city ? ' ' + p.city : '')) + '">' + ic('info') + '<div class="rt">' + esc(G.olcShort(pc)) + '<small>Plus Code · ketuk untuk salin</small></div></div>');
      rows.push('<div class="row click" data-a="copy" data-v="' + G.fmtLL([p.lng, p.lat], 6) + '">' + ic('locate') + '<div class="rt">' + G.fmtLL([p.lng, p.lat], 6) + '<small>Koordinat · ketuk untuk salin</small></div></div>');
      rows.push('<div class="row" data-r="wx">' + ic('sun') + '<div class="rt mut">Cuaca & ketinggian…</div></div>');
      rows.push('<a class="row click" target="_blank" rel="noopener" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + p.lat.toFixed(6) + ',' + p.lng.toFixed(6) + '">' + ic('street') + '<div class="rt">Street View<small>Buka foto jalan di Google Maps (tab baru)</small></div></a>');
      if (p.osm && p.osm.id) rows.push('<a class="row click" target="_blank" rel="noopener" href="https://www.openstreetmap.org/' + ({ N: 'node', W: 'way', R: 'relation' }[String(p.osm.t)[0].toUpperCase()] || 'node') + '/' + p.osm.id + '">' + ic('edit') + '<div class="rt">Lihat / perbaiki di OpenStreetMap</div></a>');
      else if (p.ov) rows.push('<div class="row">' + ic('info') + '<div class="rt mut">Data tempat usaha: Overture Maps<small>Sumber Meta, Microsoft & lainnya (CDLA-Permissive-2.0)</small></div></div>');
      return '<div class="pbar"><button class="ib" data-a="back" aria-label="Kembali">' + ic('back') + '</button><div class="tt"></div><button class="ib" data-a="close" aria-label="Tutup">' + ic('x') + '</button></div>' +
        '<div class="ph"><h2>' + esc(p.name || 'Titik di peta') + '</h2><div class="cat">' + esc(p.cat || '') + (p.dist ? ' · ' + esc(p.dist) : '') + '</div><div class="sub" data-r="status"></div></div>' +
        '<div class="acts"><button class="act pri" data-a="dir"><i>' + ic('dir') + '</i>Rute</button><button class="act" data-a="start"><i>' + ic('nav') + '</i>Mulai</button>' +
        '<button class="act' + (saved ? ' on' : '') + '" data-a="save"><i>' + ic('bookmark') + '</i>' + (saved ? 'Tersimpan' : 'Simpan') + '</button><button class="act" data-a="nearby"><i>' + ic('search') + '</i>Di sekitar</button>' +
        '<button class="act" data-a="send"><i>' + ic('send') + '</i>Kirim ke HP</button><button class="act" data-a="share"><i>' + ic('share') + '</i>Bagikan</button></div>' +
        '<div class="rows">' + rows.join('') + '</div>';
    },
    mount(el, p) {
      M.showPin([p.lng, p.lat]);
      el.onclick = e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'back') return PV.back();
        if (a === 'close') return PV.close();
        if (a === 'copy') return U.copy(b.dataset.v);
        if (a === 'dir') return DIR.open({ to: p });
        if (a === 'start') { AM.H.ask(); return DIR.open({ to: p, start: true }); }
        if (a === 'save') return A().saveDialog(p);
        if (a === 'nearby') return A().nearbyPrompt([p.lng, p.lat]);
        if (a === 'send') { D.send({ type: 'place', p: { name: p.name, addr: p.addr, lng: p.lng, lat: p.lat, cat: p.cat, osm: p.osm || null } }); return U.toast('Terkirim. Buka Amatu Maps di HP/perangkat lain untuk melihatnya.'); }
        if (a === 'share') return A().share(p.name, A().link({ p }));
        if (a === 'ohx') { const t = el.querySelector('.oh'); if (t) t.hidden = !t.hidden; }
      };
      // address, details, weather — fill in when they arrive
      const id = p._tok = U.uid();
      const alive = () => PV.is('place') && PV.cur().data._tok === id;
      if (!p.addr) Q.reverse([p.lng, p.lat]).then(r => {
        if (!alive()) return;
        const row = el.querySelector('[data-r="addr"]');
        const addr = r ? [r.name !== p.name ? r.name : '', r.addr].filter(Boolean).join(', ') : '';
        p.addr = addr || 'Alamat tidak diketahui';
        if (!p.name || p.name === 'Titik di peta') { p.name = r && r.name ? r.name : 'Titik di peta'; const h = el.querySelector('.ph h2'); if (h) h.textContent = p.name; }
        if (row) row.innerHTML = ic('pin') + '<div class="rt">' + esc(p.addr) + '</div>';
      });
      if (p.osm && p.osm.id) Q.details(p.osm).then(t => {
        if (!alive() || !t) return;
        const box = el.querySelector('[data-r="extra"]'), out = [];
        const oh = t.opening_hours, ph = t.phone || t['contact:phone'] || t.mobile || t['contact:mobile'], web = t.website || t['contact:website'] || t.url;
        if (oh && !(p.spbu && p.spbu.oh)) out.push(ohRow(oh));
        if (ph) out.push('<a class="row click" href="tel:' + esc(ph.split(/[;,]/)[0].replace(/\s/g, '')) + '">' + ic('phone') + '<div class="rt">' + esc(ph) + '</div></a>');
        if (web) out.push('<a class="row click" target="_blank" rel="noopener" href="' + esc(/^https?:/.test(web) ? web : 'https://' + web) + '">' + ic('web') + '<div class="rt">' + esc(web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</div></a>');
        if (t.cuisine) out.push('<div class="row">' + ic('food') + '<div class="rt">' + esc(t.cuisine.replace(/;/g, ', ').replace(/_/g, ' ')) + '<small>Masakan</small></div></div>');
        if (t.operator && !p.spbu) out.push('<div class="row">' + ic('work') + '<div class="rt">' + esc(t.operator) + '<small>Pengelola</small></div></div>');
        if (box) box.innerHTML = out.join('');
        if (oh) { const st = Q.ohStatus(oh), s = el.querySelector('[data-r="status"]'); if (st && s) s.innerHTML = '<span class="' + (st.open ? (st.soon ? 'warn' : 'ok') : 'bad') + '">' + esc(st.text) + '</span>'; }
      });
      if (p.spbu && p.spbu.oh) { const st = Q.ohStatus(p.spbu.oh), s = el.querySelector('[data-r="status"]'); if (st && s) s.innerHTML = '<span class="' + (st.open ? 'ok' : 'bad') + '">' + esc(st.text) + '</span>'; }
      else if (p.spbu && p.spbu.fl & 1) { const s = el.querySelector('[data-r="status"]'); if (s) s.innerHTML = '<span class="ok">Buka 24 jam</span>'; }
      Promise.all([
        U.json('https://api.open-meteo.com/v1/forecast?latitude=' + p.lat.toFixed(4) + '&longitude=' + p.lng.toFixed(4) + '&current=temperature_2m,weather_code,is_day&timezone=auto', { timeout: 8000 }).catch(() => null),
        U.json('https://api.open-meteo.com/v1/elevation?latitude=' + p.lat.toFixed(5) + '&longitude=' + p.lng.toFixed(5), { timeout: 8000 }).catch(() => null),
      ]).then(([w, e]) => {
        if (!alive()) return;
        const row = el.querySelector('[data-r="wx"]'); if (!row) return;
        const c = w && w.current, el2 = e && e.elevation && e.elevation[0];
        if (!c && el2 == null) { row.remove(); return; }
        row.innerHTML = ic(c && !c.is_day ? 'moon' : 'sun') + '<div class="rt">' + (c ? Math.round(c.temperature_2m) + '°C · ' + wx(c.weather_code) : '') + (el2 != null ? (c ? ' · ' : '') + U.num(Math.round(el2)) + ' mdpl' : '') + '<small>Cuaca sekarang · ketinggian (Open-Meteo)</small></div>';
      });
    },
    leave() { M.showPin(null); },
  };
  function ohRow(oh) {
    const st = Q.ohStatus(oh), tb = Q.ohTable(oh), today = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][new Date().getDay()];
    return '<div class="row click" data-a="ohx">' + ic('clock') + '<div class="rt">' + (st ? '<span class="' + (st.open ? (st.soon ? 'warn' : 'ok') : 'bad') + '">' + esc(st.text) + '</span>' : esc(oh)) +
      (tb ? '<table class="oh" hidden>' + tb.map(r => '<tr' + (r[0] === today ? ' class="today"' : '') + '><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td></tr>').join('') + '</table>' : '') + '<small>Jam buka' + (tb ? ' · ketuk untuk melihat' : '') + '</small></div></div>';
  }

  // ============ directions ============
  const DIR = AM.DIR = {
    pts: [null, null], mode: 'car', routes: [], ri: 0, loading: false, err: '', key: '', ac: null, tab: 'ring',
    along: null, alongList: [], alongBusy: false, prog: null, depart: null, other: {}, spFilter: { brand: 'all', left: false, h24: false, kinds: 'f' },
    open(o = {}) {
      DIR.mode = o.mode || DIR.mode || D.cfg.mode || 'car';
      if (!['car', 'moto', 'walk', 'bike'].includes(DIR.mode)) DIR.mode = 'car';
      const st = A().st;
      const from = o.from || (st.user ? DIR.gps() : null);
      DIR.pts = [from, o.to ? DIR.pt(o.to) : null];
      DIR.routes = []; DIR.ri = 0; DIR.err = ''; DIR.key = ''; DIR.tab = 'ring'; DIR.along = null; DIR.alongList = []; DIR.other = {};
      DIR.autoStart = !!o.start;
      PV.open('dir', {}, { root: true, snap: 'half' });
      if (!from && !st.user) A().locate({ quiet: true }).then(() => { if (!DIR.pts[0] && A().st.user) { DIR.pts[0] = DIR.gps(); DIR.drawHead(); DIR.compute(); } }).catch(() => { });
      DIR.compute();
    },
    gps() { const u = A().st.user; return u ? { gps: true, name: 'Lokasi Anda', lng: u[0], lat: u[1] } : null; },
    pt(p) { return { name: p.name || G.fmtLL([p.lng, p.lat], 5), addr: p.addr || '', lng: p.lng, lat: p.lat, osm: p.osm || null, cat: p.cat || '' }; },
    valid() { return DIR.pts.filter(Boolean).length >= 2 && DIR.pts.every(Boolean); },
    route() { return DIR.routes[DIR.ri] || null; },
    setPt(i, p) { DIR.pts[i] = p; DIR.drawHead(); DIR.compute(); },
    async compute(force) {
      const pts = DIR.pts;
      if (!pts.every(Boolean) || pts.length < 2) {
        DIR.routes = []; DIR.loading = false; DIR.err = ''; M.clearRoute(); M.showWps(pts.map(p => p), DIR.dragWp); PV.refresh('body'); return;
      }
      if (pts[0].gps && A().st.user) { pts[0].lng = A().st.user[0]; pts[0].lat = A().st.user[1]; }
      const key = JSON.stringify([pts.map(p => [p.lng.toFixed(5), p.lat.toFixed(5)]), DIR.mode, D.cfg.avoid]);
      if (key === DIR.key && !force && DIR.routes.length) return;
      DIR.key = key;
      if (DIR.ac) DIR.ac.abort();
      const ac = DIR.ac = new AbortController();
      DIR.loading = true; DIR.err = ''; PV.refresh('body');
      M.showWps(pts, DIR.dragWp);
      try {
        const st = A().st;
        const routes = await R.plan(pts.map((p, i) => Object.assign({ lng: p.lng, lat: p.lat }, i === 0 && p.gps && isFinite(st.heading) && st.speed > 2 ? { heading: st.heading } : {})), { mode: DIR.mode, avoid: D.cfg.avoid, signal: ac.signal });
        if (ac.signal.aborted) return;
        DIR.routes = routes; DIR.ri = 0; DIR.loading = false;
        DIR.other[DIR.mode] = routes[0].time;
        routes.forEach(r => { r.fac = fac(r.mode, DIR.depart); });
        DIR.draw(true);
        DIR.loadSpbu();
        DIR.updateProg();
        DIR.prefetchOther(pts, key);
        if (DIR.autoStart) { DIR.autoStart = false; AM.N.start(DIR.route()); }
      } catch (e) {
        if (ac.signal.aborted) return;
        DIR.loading = false; DIR.routes = []; M.clearRoute(); M.showWps(pts, DIR.dragWp);
        DIR.err = e.user ? 'Rute tidak ditemukan untuk mode ini. Coba mode lain atau pindahkan titik ke jalan terdekat.' : 'Gagal menghitung rute (' + (e.message || 'jaringan') + '). Periksa koneksi lalu coba lagi.';
        PV.refresh('body');
      }
    },
    // durations of the other fuel mode (car ↔ motorbike) for the mode tabs
    async prefetchOther(pts, key) {
      const other = DIR.mode === 'car' ? 'moto' : DIR.mode === 'moto' ? 'car' : null;
      if (!other || DIR.other[other] != null) return;
      try {
        const r = await R.plan(pts.map(p => ({ lng: p.lng, lat: p.lat })), { mode: other, avoid: D.cfg.avoid, alternates: 0 });
        if (DIR.key !== key) return;
        DIR.other[other] = r[0].time; DIR.drawModes();
      } catch (e) { /* ignore */ }
    },
    draw(fit) {
      const r = DIR.route();
      M.setRoutes(DIR.routes, DIR.ri);
      M.showTags(DIR.routes, DIR.ri, i => DIR.select(i));
      M.showWps(DIR.pts, DIR.dragWp);
      if (fit && r && !AM.N.on) {
        const bb = DIR.routes.reduce((a, x) => [Math.min(a[0], x.bbox[0]), Math.min(a[1], x.bbox[1]), Math.max(a[2], x.bbox[2]), Math.max(a[3], x.bbox[3])], [180, 90, -180, -90]);
        M.fit(bb, { maxZoom: 16 });
      }
      DIR.showSpbu();
      PV.refresh('body');
      if (r) DIR.offSave();
    },
    select(i) {
      if (i === DIR.ri || !DIR.routes[i]) return;
      DIR.ri = i; DIR.along = null; DIR.alongList = []; M.setAlong([]);
      DIR.draw(false); DIR.updateProg();
    },
    dragWp(i, ll) {
      const p = DIR.pts[i];
      DIR.pts[i] = { name: G.fmtLL(ll, 5), addr: '', lng: ll[0], lat: ll[1] };
      DIR.drawHead(); DIR.compute();
      Q.reverse(ll).then(r => { if (r && DIR.pts[i] && DIR.pts[i].lng === ll[0]) { DIR.pts[i].name = r.name; DIR.pts[i].addr = r.addr; DIR.drawHead(); } });
      void p;
    },
    async loadSpbu() {
      const r = DIR.route(); if (!r) return;
      const radius = D.cfg.radius || 150;
      for (const rt of DIR.routes) {
        if (rt.spbu && rt.spbuR === radius) continue;
        rt.spbuBusy = true;
        try { rt.spbu = await P.along(rt, radius); rt.spbuR = radius; rt.spbuSrc = 'data'; }
        catch (e) {
          // dataset missing / outside Indonesia: tiles for the first 80 km, Overpass for the rest
          try { rt.spbu = await DIR.spbuFallback(rt, radius); rt.spbuR = radius; rt.spbuSrc = 'osm'; } catch (x) { rt.spbu = []; rt.spbuErr = true; }
        }
        rt.spbuBusy = false;
        if (rt === DIR.route()) { DIR.showSpbu(); PV.refresh('body'); if (AM.N.on && AM.N.route === rt) AM.N.ui(); }
        else PV.refresh('cards');
      }
    },
    async spbuFallback(rt, radius) {
      const cat = Q.catOf('spbu');
      const pois = await Q.alongTiles(cat, rt.coords, rt.cum, radius, 0, 80000);
      const brandOf = n => /pertashop/i.test(n) ? 8 : /pertamina|\d{2}\.\d{3}\.\d{2}/i.test(n) ? 1 : /shell/i.test(n) ? 2 : /\bbp\b/i.test(n) ? 3 : /vivo/i.test(n) ? 4 : 0;
      const rows = pois.map(p => ({ k: 'f', lat: p.lat, lng: p.lng, b: brandOf(p.name || ''), name: /^spbu$/i.test(p.name || '') ? '' : p.name, fl: 0, id: p.id, no: '', oh: '' }));
      return P.match(rt, rows, radius);
    },
    filtered() {
      const r = DIR.route(); if (!r || !r.spbu) return [];
      const f = DIR.spFilter;
      return r.spbu.filter(p => {
        if (f.kinds === 'f' && p.k !== 'f') return false;
        if (f.kinds === 'r' && p.k !== 'r') return false;
        if (f.kinds === 'c' && p.k !== 'c') return false;
        if (p.k === 'f' && f.brand !== 'all') { if (f.brand === 'lain' ? [1, 2, 3, 4, 8].includes(p.b) : String(p.b) !== f.brand) return false; }
        if (f.left && p.side < 0) return false;
        if (f.h24 && !(p.fl & 1)) return false;
        return true;
      });
    },
    showSpbu() {
      const r = DIR.route();
      if (!r || !r.spbu || !D.cfg.spbuMap) { M.setSpbu([]); return; }
      M.setSpbu(DIR.filtered(), AM.N.on ? AM.N.s : DIR.prog != null ? DIR.prog : null);
    },
    // live progress from GPS while the route is on screen (not navigating): user within 80 m of the route
    updateProg() {
      const r = DIR.route(), u = A().st.user;
      let s = null;
      if (r && u && !AM.N.on) { const n = G.nearest(r.coords, r.cum, u); if (n.d < 80) s = n.s; }
      if (AM.N.on) s = AM.N.s;
      const ch = (s == null) !== (DIR.prog == null) || (s != null && Math.abs(s - DIR.prog) > 15);
      DIR.prog = s;
      if (ch) { DIR.showSpbu(); if (PV.is('dir') && DIR.tab === 'spbu') PV.refresh('spbu'); if (PV.is('dir')) PV.refresh('next'); }
    },
    next() {
      const r = DIR.route(); if (!r || !r.spbu) return null;
      const s0 = DIR.prog != null ? DIR.prog : 0;
      return DIR.filtered().filter(p => p.k === 'f').find(p => p.s > s0 + 20) || null;
    },
    close() {
      if (DIR.ac) DIR.ac.abort();
      DIR.routes = []; DIR.key = ''; M.clearRoute();
      const dt = $('#dtop'); if (dt) dt.remove();
      document.body.classList.remove('dirmode');
    },
    // ---------- rendering ----------
    headHtml() {
      const n = DIR.pts.length;
      const modes = Object.entries(R.MODES).map(([k, m]) => {
        const t = DIR.other[k] != null && !(k === DIR.mode && DIR.loading) ? U.dur(DIR.other[k] * fac(k, DIR.depart)) : m.n;
        return '<button class="mode' + (k === DIR.mode ? ' on' : '') + '" data-m="' + k + '" title="' + m.n + '">' + ic(m.ic) + '<span>' + esc(t) + '</span></button>';
      }).join('');
      const wps = DIR.pts.map((p, i) => '<div class="wp" data-w="' + i + '"><span class="dot' + (i === n - 1 ? ' end' : i > 0 ? ' mid' : '') + '"></span>' +
        '<input data-w="' + i + '" value="' + esc(p ? p.name : '') + '" placeholder="' + (i === 0 ? 'Pilih titik awal, atau klik peta' : i === n - 1 ? 'Pilih tujuan' : 'Perhentian ' + i) + '" enterkeyhint="go">' +
        (n > 2 ? '<button class="ib" data-a="rm" data-w="' + i + '" title="Hapus">' + ic('x') + '</button>' : '') + '</div>').join('');
      const av = D.cfg.avoid;
      const opts = (DIR.mode === 'car' ? '<button class="opt' + (av.toll ? ' on' : '') + '" data-o="toll">' + ic('toll') + 'Hindari tol</button>' : DIR.mode === 'moto' ? '<span class="opt on">' + ic('toll') + 'Motor: tanpa jalan tol</span>' : '') +
        (DIR.mode === 'car' || DIR.mode === 'moto' ? '<button class="opt' + (av.highway ? ' on' : '') + '" data-o="highway">' + ic('road') + 'Hindari jalan raya</button>' : '') +
        '<button class="opt' + (av.ferry ? ' on' : '') + '" data-o="ferry">' + ic('tferry') + 'Hindari feri</button>' +
        '<select class="opt" data-o="depart" title="Waktu berangkat"><option value="now">' + (DIR.depart ? 'Berangkat ' + U.day(DIR.depart) + ' ' + U.clock(DIR.depart) : 'Berangkat sekarang') + '</option><option value="now2">Berangkat sekarang</option><option value="pick">Pilih waktu berangkat…</option></select>';
      return '<div class="modes"><button class="ib" data-a="back" aria-label="Kembali">' + ic('back') + '</button>' + modes + '<button class="ib" data-a="close" aria-label="Tutup">' + ic('x') + '</button></div>' +
        '<div class="wps"><div class="rail"><span class="wpline"></span></div><div class="wpl">' + wps + '<div class="addrow"><button class="addwp" data-a="add">' + ic('plus') + 'Tambahkan tujuan</button><span class="grow"></span><button class="optb' + (DIR.optsOpen ? ' on' : '') + '" data-a="opts">' + ic('gear') + 'Opsi' + ((D.cfg.avoid.toll || D.cfg.avoid.highway || D.cfg.avoid.ferry || DIR.depart) ? ' •' : '') + '</button></div></div>' +
        '<div style="position:relative;width:36px;flex:none"><button class="ib swap" data-a="swap" title="Tukar titik awal & tujuan">' + ic('swap') + '</button></div></div>' +
        '<div class="opts">' + opts + '</div>';
    },
    drawModes() { const h = DIR.headEl(); if (!h) return; const m = h.querySelector('.modes'); if (m) { const t = document.createElement('div'); t.innerHTML = DIR.headHtml(); m.innerHTML = t.querySelector('.modes').innerHTML; } },
    headEl() { return U.mobile() ? $('#dtop') : pv.querySelector('.dhead'); },
    drawHead() {
      let h;
      if (U.mobile()) {
        h = $('#dtop');
        if (!h) { h = document.createElement('div'); h.id = 'dtop'; h.className = 'card dhead'; h.style.cssText = 'position:absolute;z-index:31;left:0;right:0;top:0;border-radius:0 0 16px 16px;padding:calc(var(--top) + 6px) 8px 10px 0;box-shadow:var(--sh2)'; document.body.appendChild(h); }
      } else h = pv.querySelector('.dhead');
      if (!h) return;
      h.innerHTML = DIR.headHtml();
      h.classList.toggle('optson', !!DIR.optsOpen);
      DIR.mountHead(h);
    },
    mountHead(h) {
      h.onclick = e => {
        const b = e.target.closest('[data-a],[data-m],[data-o]'); if (!b || b.tagName === 'SELECT') return;
        if (b.dataset.m) { if (b.dataset.m === DIR.mode) return; DIR.mode = b.dataset.m; D.cfg.mode = DIR.mode === 'car' || DIR.mode === 'moto' ? DIR.mode : D.cfg.mode; D.saveCfg(); DIR.tab = 'ring'; DIR.drawHead(); DIR.compute(); return; }
        if (b.dataset.o) { const k = b.dataset.o; D.cfg.avoid[k] = !D.cfg.avoid[k]; D.saveCfg(); DIR.other = {}; DIR.drawHead(); DIR.compute(true); return; }
        const a = b.dataset.a;
        if (a === 'back') return PV.back();
        if (a === 'close') return PV.close();
        if (a === 'opts') { DIR.optsOpen = !DIR.optsOpen; h.classList.toggle('optson', DIR.optsOpen); b.classList.toggle('on', DIR.optsOpen); if (U.mobile()) PV.snap(PV.snapState); return; }
        if (a === 'swap') { DIR.pts.reverse(); DIR.other = {}; DIR.drawHead(); DIR.compute(); return; }
        if (a === 'add') { if (DIR.pts.length >= 10) return U.toast('Maksimal 10 titik'); DIR.pts.push(null); DIR.drawHead(); const ins = h.querySelectorAll('.wp input'); ins[ins.length - 1].focus(); return; }
        if (a === 'rm') { DIR.pts.splice(+b.dataset.w, 1); DIR.other = {}; DIR.drawHead(); DIR.compute(); }
      };
      const sel = h.querySelector('select[data-o="depart"]');
      if (sel) sel.onchange = async () => {
        if (sel.value === 'now2' || sel.value === 'now') { DIR.depart = null; }
        else {
          const d = new Date(Date.now() + 3600e3), v = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
          const r = await U.modal('Waktu berangkat', '<label class="fld">Tanggal & jam<input type="datetime-local" id="dep" value="' + v + '"></label><p class="mut" style="font-size:12.5px">Estimasi waktu tiba memperhitungkan jam sibuk (perkiraan, bukan data lalu lintas langsung).</p>',
            [{ label: 'Batal', value: null }, { label: 'Pakai', kind: 'pri', fn: w => new Date(w.querySelector('#dep').value) }]);
          DIR.depart = r && isFinite(r) ? r : null;
        }
        DIR.routes.forEach(rt => { rt.fac = fac(rt.mode, DIR.depart); });
        DIR.drawHead(); M.showTags(DIR.routes, DIR.ri, i => DIR.select(i)); PV.refresh('body');
      };
      h.querySelectorAll('.wp input').forEach(inp => {
        const i = +inp.dataset.w;
        AC.attach(inp, {
          gps: true,
          onPick: it => {
            if (it.q) { inp.value = it.q; return; }
            DIR.setPt(i, it.gps ? DIR.gps() : DIR.pt(it));
            if (it.name && !it.gps && !it.coord) D.pushRecent({ name: it.name, addr: it.addr, lng: it.lng, lat: it.lat, cat: it.cat || '', osm: it.osm || null });
          },
          onEnter: async q => {
            if (!q) return;
            const c = G.parse(q, A().center());
            if (c) return DIR.setPt(i, { name: G.fmtLL(c, 5), lng: c[0], lat: c[1] });
            try { const r = await Q.suggest(q, A().center(), { limit: 1 }); if (r[0]) DIR.setPt(i, DIR.pt(r[0])); else U.toast('Tempat tidak ditemukan'); } catch (e) { U.toast('Pencarian gagal'); }
          },
          onFocus: () => { DIR.pickIdx = i; },
        });
      });
    },
    cardsHtml() {
      if (!DIR.routes.length) return '';
      const best = Math.min(...DIR.routes.map(r => r.time));
      return '<div class="routes">' + DIR.routes.map((r, i) => {
        const f = D.estimate(r.dist, r.mode), dep = DIR.depart || new Date(), t = r.time * (r.fac || 1);
        const bd = [];
        if (r.toll) bd.push('<span class="badge y">' + ic('toll') + 'Tol' + (r.tollDist > 500 ? ' ' + U.dist(r.tollDist) : '') + '</span>');
        if (r.ferry) bd.push('<span class="badge b">Feri</span>');
        if (r.spbu) { const n = r.spbu.filter(p => p.k === 'f').length; bd.push('<span class="badge r">' + ic('fuel') + n + ' SPBU</span>'); }
        else if (r.spbuBusy) bd.push('<span class="badge">' + ic('fuel') + '…</span>');
        if (f) bd.push('<span class="badge g">' + U.liter(f.liters) + ' · ' + U.rp(f.cost) + '</span>');
        return '<div class="rcard' + (i === DIR.ri ? ' on' : '') + '" data-r="' + i + '">' + ic(R.MODES[r.mode].ic) + '<div class="rm"><div class="rtop"><span class="dur' + (r.time === best ? ' best' : '') + '">' + U.dur(t) + '</span><span class="km">' + U.dist(r.dist) + '</span></div>' +
          (r.via ? '<div class="via">melalui ' + esc(r.via) + '</div>' : '') + '<div class="eta">Tiba ' + U.clock(+dep + t * 1000) + (i === 0 && DIR.routes.length > 1 ? ' · Rute terbaik' : '') + (r.src === 'osrm' ? ' · rute cadangan (OSRM)' : '') + '</div>' +
          (bd.length ? '<div class="bdg">' + bd.join('') + '</div>' : '') + '</div></div>';
      }).join('') + '</div>';
    },
    fuelHtml(r) {
      const f = D.estimate(r.dist, r.mode);
      if (!f) return '<div class="note">' + ic('info') + '<span>' + (r.mode === 'walk' ? 'Berjalan kaki tidak memakai BBM.' : 'Bersepeda tidak memakai BBM.') + ' Dibanding naik mobil, hemat sekitar <b>' + U.rp(D.estimate(r.dist, 'car').cost) + '</b>.</span></div>';
      const v = f.veh, fuelOpts = D.cfg.fuels.map(x => '<option value="' + esc(x.id) + '"' + (x.id === v.fuel ? ' selected' : '') + '>' + esc(x.n) + '</option>').join('');
      return '<div class="fuel" data-fuel><div class="fh">' + ic('fuel') + '<b>Estimasi BBM ' + esc(v.n || R.MODES[r.mode].n) + '</b><span class="badge" data-f="ratio">1 : ' + U.num(v.kmpl, v.kmpl % 1 ? 1 : 0) + '</span></div>' +
        '<div class="fbig"><div><small>Kebutuhan BBM</small><b data-f="l">' + U.liter(f.liters) + '</b></div><div><small>Perkiraan biaya</small><b class="cost" data-f="c">' + U.rp(f.cost) + '</b></div></div>' +
        '<div class="fin"><label>Perbandingan (km per liter)<span class="inp"><em>1 :</em><input data-k="kmpl" inputmode="decimal" value="' + U.num(v.kmpl, v.kmpl % 1 ? 1 : 0) + '"><em>km</em></span></label>' +
        '<label>Jenis BBM<span class="inp"><select data-k="fuel">' + fuelOpts + '</select></span></label>' +
        '<label>Harga per liter<span class="inp"><em>Rp</em><input data-k="price" inputmode="numeric" value="' + U.num(f.fuel.p) + '"></span></label>' +
        '<label>Isi tangki sekarang<span class="inp"><input data-k="now" inputmode="decimal" placeholder="opsional" value="' + (v.now ? U.num(v.now, v.now % 1 ? 1 : 0) : '') + '"><em>L</em></span></label></div>' +
        '<div class="frow"><span>Hitung pulang-pergi (×2)</span><button class="sw' + (D.cfg.pp ? ' on' : '') + '" data-k="pp" aria-label="Pulang-pergi"></button></div>' +
        '<div class="frow" data-f="tank"' + (v.now ? '' : ' hidden') + '></div>' +
        '<div class="frow mut" style="font-size:12px" data-f="calc"></div></div>';
    },
    fuelUpdate(el) {
      const r = DIR.route(), box = el.querySelector('[data-fuel]'); if (!r || !box) return;
      const f = D.estimate(r.dist, r.mode); if (!f) return;
      box.querySelector('[data-f="l"]').textContent = U.liter(f.liters);
      box.querySelector('[data-f="c"]').textContent = U.rp(f.cost);
      box.querySelector('[data-f="ratio"]').textContent = '1 : ' + U.num(f.kmpl, f.kmpl % 1 ? 1 : 0);
      box.querySelector('[data-f="calc"]').textContent = U.num(f.km, 1) + ' km ÷ ' + U.num(f.kmpl, f.kmpl % 1 ? 1 : 0) + ' km/L = ' + U.num(f.liters, 2) + ' L × ' + U.rpx(f.fuel.p) + ' (' + f.fuel.n + ')' + (f.pp ? ' · pulang-pergi' : '');
      const tk = box.querySelector('[data-f="tank"]'), v = f.veh;
      if (v.now > 0) {
        tk.hidden = false;
        const range = v.now * v.kmpl * 1000, need = r.dist;
        if (range >= need) tk.innerHTML = '<span class="ok">' + ic('check') + ' Cukup sampai tujuan</span><span class="mut">sisa ±' + U.liter(Math.max(0, v.now - need / 1000 / v.kmpl)) + '</span>';
        else {
          const lim = range * 0.88, cand = (r.spbu || []).filter(p => p.k === 'f' && p.s < lim && p.s > (DIR.prog || 0)), last = cand[cand.length - 1];
          tk.innerHTML = '<span class="bad">' + ic('warn') + ' Tidak cukup — habis ±km ' + U.num(range / 1000) + '</span>' + (last ? '<button class="btn sm" data-a="spgo" data-s="' + last.s + '">Isi di ' + esc(P.title(last)) + ' (km ' + U.num(last.s / 1000, 1) + ')</button>' : '');
        }
      } else tk.hidden = true;
      el.querySelectorAll('.rcard').forEach((c, i) => {
        const rr = DIR.routes[i], ff = rr && D.estimate(rr.dist, rr.mode), b = c.querySelector('.badge.g');
        if (b && ff) b.textContent = U.liter(ff.liters) + ' · ' + U.rp(ff.cost);
      });
    },
    // saved-for-offline state of the chosen route (saved by itself a moment after it is chosen)
    offHtml() {
      const r = DIR.route(); if (!r || !O || !O.ok) return '';
      const st = O.state && O.state.id === r.id ? O.state : null, e = O.list().find(x => x.id === r.id);
      if (st && st.busy) return '<div class="offl"><span class="spin sm"></span><span>Menyimpan peta rute untuk offline… <b>' + Math.round(st.done / Math.max(1, st.n) * 100) + '%</b></span></div>';
      if ((st && st.ok) || (e && e.done)) return '<div class="offl ok">' + ic('check') + '<span>Peta rute tersimpan offline' + (e && e.mb ? ' · ' + U.num(e.mb, 1) + ' MB' : '') + ' — tetap jalan tanpa sinyal</span></div>';
      if (st && !st.busy) return '<div class="offl bad">' + ic('warn') + '<span>Sebagian peta rute belum tersimpan (' + (navigator.onLine ? 'sinyal lemah' : 'offline') + '). Dicoba lagi saat navigasi.</span></div>';
      return '<div class="offl">' + ic('down') + '<span>Peta rute akan disimpan untuk offline…</span></div>';
    },
    offSave: U.debounce(() => {
      const r = DIR.route();
      if (r && !AM.N.on && PV.is('dir')) O.saveRoute(r, { sat: M.st.base === 'sat', name: (DIR.pts[DIR.pts.length - 1] || {}).name || '' });
    }, 1200),
    // back into a navigation that a reload interrupted: the saved route, no new routing request
    restore(pts, mode, r) {
      Object.assign(DIR, { mode, pts, routes: [r], ri: 0, err: '', tab: 'ring', along: null, alongList: [], other: {}, loading: false, autoStart: false });
      DIR.key = JSON.stringify([pts.map(p => [p.lng.toFixed(5), p.lat.toFixed(5)]), mode, D.cfg.avoid]);
      PV.open('dir', {}, { root: true, snap: 'peek' });
      DIR.draw(false);
      if (!r.spbu) DIR.loadSpbu();
    },
    nextHtml() {
      const r = DIR.route(); if (!r) return '';
      if (!r.spbu) return r.spbuBusy !== false ? '<div class="nextsp"><span class="spin"></span><div class="nx"><b>Mencari SPBU di sepanjang rute…</b></div></div>' : '';
      const n = DIR.next(), fs = r.spbu.filter(p => p.k === 'f');
      if (!fs.length) return '<div class="note y">' + ic('warn') + '<span>Tidak ada SPBU tercatat dalam radius ' + U.dist(D.cfg.radius) + ' dari rute ini. Perbesar radius di tab SPBU.</span></div>';
      if (!n) return '<div class="note">' + ic('check') + '<span>Semua ' + fs.length + ' SPBU di rute sudah terlewati.</span></div>';
      const s0 = DIR.prog != null ? DIR.prog : 0, left = n.s - s0, tt = (R.timeAt(r, n.s) - R.timeAt(r, s0)) * (r.fac || 1);
      return '<div class="nextsp" data-a="sp" data-s="' + n.s + '">' + brandBadge(n) + '<div class="nx"><b>' + esc(P.title(n)) + '</b><span>' + (DIR.prog != null ? 'SPBU berikutnya dari posisi Anda' : 'SPBU pertama dari titik awal') + ' · ' + sideTag(n.side) + '</span></div><div class="big">' + U.dist(left) + '<small>±' + U.dur(tt) + '</small></div></div>';
    },
    spbuHtml() {
      const r = DIR.route(); if (!r) return '';
      if (!r.spbu) return '<div class="loading"><span class="spin"></span>Mencari SPBU di sepanjang rute…</div>';
      const f = DIR.spFilter, list = DIR.filtered(), s0 = DIR.prog != null ? DIR.prog : null;
      const chip = (k, v, label) => '<button class="opt' + (f[k] === v ? ' on' : '') + '" data-sf="' + k + '" data-v="' + v + '">' + esc(label) + '</button>';
      const tog = (k, label) => '<button class="opt' + (f[k] ? ' on' : '') + '" data-st="' + k + '">' + esc(label) + '</button>';
      const counts = { f: r.spbu.filter(p => p.k === 'f').length, r: r.spbu.filter(p => p.k === 'r').length, c: r.spbu.filter(p => p.k === 'c').length };
      const radii = [50, 100, 150, 300, 500, 1000].map(m => '<option value="' + m + '"' + (m === D.cfg.radius ? ' selected' : '') + '>' + U.dist(m) + ' dari jalan</option>').join('');
      let html = '<div class="fbar">' + chip('kinds', 'f', 'SPBU ' + counts.f) + (counts.r ? chip('kinds', 'r', 'Rest area ' + counts.r) : '') + (counts.c ? chip('kinds', 'c', 'SPKLU ' + counts.c) : '') + chip('kinds', 'all', 'Semua') + '<select class="opt" data-sr>' + radii + '</select></div>';
      if (f.kinds === 'f' || f.kinds === 'all') html += '<div class="fbar">' + chip('brand', 'all', 'Semua merek') + chip('brand', '1', 'Pertamina') + chip('brand', '2', 'Shell') + chip('brand', '3', 'BP') + chip('brand', '4', 'Vivo') + chip('brand', '8', 'Pertashop') + chip('brand', 'lain', 'Lainnya') + tog('left', 'Sisi kiri saja') + tog('h24', '24 jam') + '</div>';
      const nx = DIR.next();
      html += '<div class="spl">' + (list.length ? list.map(p => {
        const left = s0 != null ? p.s - s0 : p.s, past = s0 != null && left < -40;
        const tt = (R.timeAt(r, p.s) - R.timeAt(r, s0 || 0)) * (r.fac || 1), dep = DIR.depart || new Date();
        const tags = P.tags(p);
        return '<div class="sp' + (past ? ' past' : '') + (nx === p ? ' next' : '') + '" data-s="' + p.s + '" data-i="' + r.spbu.indexOf(p) + '"><div class="sk"><b>' + (past ? 'lewat' : (s0 != null ? '' : 'km ') + (s0 != null ? U.dist(left) : U.num(p.s / 1000, p.s < 10000 ? 1 : 0))) + '</b><small>' + (past ? '' : '±' + U.dur(tt)) + '</small></div>' +
          brandBadge(p) + '<div class="sm"><b>' + esc(P.title(p)) + '</b><span>' + sideTag(p.side) + ' · ' + U.dist(p.d) + ' dari jalan' + (past ? '' : ' · tiba ' + U.clock(+dep + tt * 1000)) + '</span>' +
          (tags.length ? '<div class="tg">' + tags.map(t => '<span class="badge' + (t === '24 jam' ? ' g' : '') + '">' + esc(t) + '</span>').join('') + '</div>' : '') + '</div>' +
          '<button class="ib" data-a="spadd" data-i="' + r.spbu.indexOf(p) + '" title="Jadikan perhentian">' + ic('plus') + '</button></div>';
      }).join('') : '<div class="empty">Tidak ada yang cocok dengan filter.</div>') + '</div>';
      html += '<div class="note">' + ic('info') + '<span>Data SPBU dari OpenStreetMap' + (DIR.meta ? ' (' + U.num(DIR.meta.n.f) + ' SPBU se-Indonesia, diperbarui ' + esc(DIR.meta.v) + ')' : '') + '. “Kiri/Kanan” = sisi jalan menurut arah perjalanan; di Indonesia SPBU sisi kiri lebih mudah dimasuki. Sebagian SPBU mungkin belum terpetakan.</span></div>';
      return html;
    },
    stepsHtml() {
      const r = DIR.route(); if (!r) return '';
      let leg = -1;
      return r.man.map((m, i) => {
        let h = '';
        if (r.legs.length > 1 && m.leg !== leg) { leg = m.leg; h = '<div class="legh">' + (leg === 0 ? 'Dari ' + esc(DIR.pts[0] ? DIR.pts[0].name : 'awal') : 'Dari perhentian ' + leg) + ' · ' + U.dist(r.legs[leg].dist) + ' · ' + U.dur(r.legs[leg].time * (r.fac || 1)) + '</div>'; }
        return h + '<div class="step" data-m="' + i + '">' + ic(m.ic) + '<div class="stx">' + esc(m.text) + (m.toll && (m.type === 18 || m.type === 19 || m.type === 17) ? ' <span class="badge y tollb">Tol</span>' : '') + (m.len > 0 ? '<small>' + U.dist(m.len) + (m.time > 30 ? ' · ' + U.dur(m.time * (r.fac || 1)) : '') + '</small>' : '') + '</div></div>';
      }).join('');
    },
    alongHtml() {
      const r = DIR.route(); if (!r) return '';
      const cats = ['makan', 'kafe', 'mart', 'masjid', 'atm', 'bengkel', 'toilet', 'hotel'].map(Q.catOf);
      let h = '<div class="sec">' + ic('search') + 'Cari di sepanjang rute <small>(30 km ke depan)</small></div><div class="fbar">' +
        cats.map(c => '<button class="opt' + (DIR.along === c.id ? ' on' : '') + '" data-al="' + c.id + '">' + ic(c.ic) + esc(c.n) + '</button>').join('') + '</div>';
      if (DIR.alongBusy) h += '<div class="loading"><span class="spin"></span>Mencari…</div>';
      else if (DIR.along) {
        const c = Q.catOf(DIR.along), s0 = DIR.prog || 0;
        h += DIR.alongList.length ? '<div class="spl">' + DIR.alongList.map((p, i) => '<div class="sp" data-ai="' + i + '"><div class="sk"><b>' + U.dist(p.s - s0) + '</b><small>±' + U.dur((R.timeAt(r, p.s) - R.timeAt(r, s0)) * (r.fac || 1)) + '</small></div><span class="brand" style="background:' + c.c + ';color:#fff">' + ic(c.ic) + '</span><div class="sm"><b>' + esc(p.name || c.n) + '</b><span>' + sideTag(p.side) + ' · ' + U.dist(p.d) + ' dari jalan</span></div><button class="ib" data-a="aladd" data-i="' + i + '" title="Jadikan perhentian">' + ic('plus') + '</button></div>').join('') + '</div>'
          : '<div class="empty">Tidak ada ' + esc(c.n.toLowerCase()) + ' tercatat dalam 250 m dari rute pada 30 km ke depan.</div>';
      }
      return h;
    },
    bodyHtml() {
      if (DIR.loading) return '<div class="loading"><span class="spin"></span>Menghitung rute ' + esc(R.MODES[DIR.mode].n.toLowerCase()) + '…</div>';
      if (DIR.err) return '<div class="empty">' + esc(DIR.err) + '<br><br><button class="btn" data-a="retry">Coba lagi</button></div>';
      if (!DIR.routes.length) {
        const sc = [['home', 'Rumah', 'home'], ['work', 'Kantor', 'work']].filter(([k]) => D.saved[k]);
        const rec = D.recent().filter(r => !r.q).slice(0, 5);
        return '<div class="note">' + ic('info') + '<span>Pilih titik awal dan tujuan. Bisa juga klik kanan / tekan lama di peta.</span></div>' +
          (sc.length || rec.length ? '<div class="sec">Tujuan cepat</div>' + sc.map(([k, n, i]) => '<div class="row click" data-q="' + k + '">' + ic(i) + '<div class="rt">' + n + '<small>' + esc(D.saved[k].addr || D.saved[k].name || '') + '</small></div></div>').join('') +
            rec.map((r, i) => '<div class="row click" data-rc="' + i + '">' + ic('history') + '<div class="rt">' + esc(r.name) + '<small>' + esc(r.addr || '') + '</small></div></div>').join('') : '');
      }
      const r = DIR.route(), t = r.time * (r.fac || 1), dep = DIR.depart || new Date();
      const tabs = [['ring', 'Ringkasan', 'info'], ['spbu', 'SPBU' + (r.spbu ? ' ' + r.spbu.filter(p => p.k === 'f').length : ''), 'fuel'], ['steps', 'Langkah', 'list']];
      let tab = '';
      if (DIR.tab === 'ring') {
        tab = '<div class="sumbig"><div class="dur">' + U.dur(t) + '<small>(' + U.dist(r.dist) + ')</small></div><div class="eta">Tiba sekitar ' + U.clock(+dep + t * 1000) + (DIR.depart ? ' · berangkat ' + U.clock(DIR.depart) : '') + (r.via ? ' · melalui ' + esc(r.via) : '') + '</div></div>' +
          '<div data-off>' + DIR.offHtml() + '</div><div data-next>' + DIR.nextHtml() + '</div>' + DIR.fuelHtml(r) + DIR.alongHtml() +
          (r.fac && Math.abs(r.fac - 1) > 0.04 ? '<div class="note">' + ic('clock') + '<span>Estimasi waktu ×' + U.num(r.fac, 2) + ' (perkiraan kepadatan ' + (D.cfg.traffic === 'auto' ? 'menurut jam' : D.cfg.traffic) + '). Tanpa data lalu lintas langsung; waktu saat navigasi menyesuaikan kecepatan Anda.</span></div>' : '');
      } else if (DIR.tab === 'spbu') tab = '<div data-next>' + DIR.nextHtml() + '</div><div data-spbu>' + DIR.spbuHtml() + '</div>';
      else tab = DIR.stepsHtml();
      return DIR.cardsHtml() + '<div class="tabs rtabs-h">' + tabs.map(([k, n, i]) => '<button class="tab' + (DIR.tab === k ? ' on' : '') + '" data-t="' + k + '">' + ic(i) + esc(n) + '</button>').join('') + '</div>' + tab +
        '<div class="go"><button class="btn pri" data-a="nav">' + ic('nav') + 'Mulai</button><button class="ib" data-a="more" title="Lainnya" style="border:1px solid var(--line)">' + ic('more') + '</button></div>';
    },
  };
  V.dir = {
    notop: true, snap: 'half',
    html() { return (U.mobile() ? '' : '<div class="dhead">' + DIR.headHtml() + '</div>') + '<div data-body>' + DIR.bodyHtml() + '</div>'; },
    mount(el) {
      DIR.drawHead();
      P.meta().then(m => { DIR.meta = m; });
      el.onclick = async e => {
        const t = e.target;
        const tab = t.closest('[data-t]'); if (tab) { DIR.tab = tab.dataset.t; PV.refresh('body'); return; }
        const rc = t.closest('.rcard'); if (rc) { DIR.select(+rc.dataset.r); return; }
        const sf = t.closest('[data-sf]'); if (sf) { DIR.spFilter[sf.dataset.sf] = sf.dataset.v; DIR.showSpbu(); PV.refresh('spbu'); return; }
        const stg = t.closest('[data-st]'); if (stg) { DIR.spFilter[stg.dataset.st] = !DIR.spFilter[stg.dataset.st]; DIR.showSpbu(); PV.refresh('spbu'); return; }
        const al = t.closest('[data-al]'); if (al) { DIR.searchAlong(al.dataset.al); return; }
        const q = t.closest('[data-q]'); if (q) { const s = D.saved[q.dataset.q]; DIR.setPt(DIR.pts.length - 1, { name: q.dataset.q === 'home' ? 'Rumah' : 'Kantor', addr: s.addr, lng: s.lng, lat: s.lat }); return; }
        const rcn = t.closest('[data-rc]'); if (rcn) { const r = D.recent().filter(x => !x.q)[+rcn.dataset.rc]; if (r) DIR.setPt(DIR.pts.length - 1, DIR.pt(r)); return; }
        const b = t.closest('[data-a]');
        const r = DIR.route();
        if (b) {
          const a = b.dataset.a;
          if (a === 'retry') return DIR.compute(true);
          if (a === 'nav') { AM.H.ask(); return AM.N.start(r); }
          if (a === 'more') return DIR.more(b);
          if (a === 'spadd' || a === 'aladd') {
            e.stopPropagation();
            const p = a === 'spadd' ? r.spbu[+b.dataset.i] : DIR.alongList[+b.dataset.i];
            const at = DIR.pts.findIndex((x, i) => i > 0 && x && R.timeAt(r, p.s) < R.timeAt(r, G.nearest(r.coords, r.cum, [x.lng, x.lat]).s));
            DIR.pts.splice(at > 0 ? at : DIR.pts.length - 1, 0, { name: a === 'spadd' ? P.title(p) : p.name || 'Perhentian', lng: p.lng, lat: p.lat });
            DIR.other = {}; DIR.drawHead(); DIR.compute(); U.toast('Ditambahkan sebagai perhentian');
            return;
          }
          if (a === 'sp' || a === 'spgo') { const s = +b.dataset.s, p = r.spbu.find(x => x.s === s); if (p) DIR.openStation(p); return; }
        }
        const sp = t.closest('.sp[data-i]'); if (sp && r && r.spbu) { DIR.openStation(r.spbu[+sp.dataset.i]); return; }
        const ai = t.closest('[data-ai]'); if (ai) { const p = DIR.alongList[+ai.dataset.ai]; A().openPlace({ name: p.name || Q.catOf(DIR.along).n, cat: Q.catOf(DIR.along).n, lng: p.lng, lat: p.lat, osm: p.id ? { t: p.id[0].toUpperCase(), id: p.id.slice(1) } : null }); return; }
        const st = t.closest('.step'); if (st && r) { const m = r.man[+st.dataset.m]; const ll = r.coords[m.bi]; A().map.easeTo({ center: ll, zoom: 17, duration: 700 }); if (U.mobile()) PV.snap('peek'); }
      };
      el.addEventListener('input', e => DIR.fuelInput(e, el));
      el.addEventListener('change', e => {
        if (e.target.matches('[data-sr]')) { D.cfg.radius = +e.target.value; D.saveCfg(); DIR.routes.forEach(r => { r.spbu = null; }); PV.refresh('body'); DIR.loadSpbu(); return; }
        DIR.fuelInput(e, el, true);
      });
      el.addEventListener('click', e => { const sw = e.target.closest('.sw[data-k="pp"]'); if (sw) { D.cfg.pp = !D.cfg.pp; D.saveCfg(); sw.classList.toggle('on', D.cfg.pp); DIR.fuelUpdate(el); } });
      DIR.fuelUpdate(el);
    },
    update(el, d, part) {
      const body = el.querySelector('[data-body]'); if (!body) return;
      if (part === 'spbu') { const s = el.querySelector('[data-spbu]'); if (s) { const y = el.scrollTop; s.innerHTML = DIR.spbuHtml(); el.scrollTop = y; } const n = el.querySelector('[data-next]'); if (n) n.innerHTML = DIR.nextHtml(); return; }
      if (part === 'next') { const n = el.querySelector('[data-next]'); if (n) n.innerHTML = DIR.nextHtml(); return; }
      if (part === 'off') { const n = el.querySelector('[data-off]'); if (n) n.innerHTML = DIR.offHtml(); return; }
      if (part === 'cards') { const c = el.querySelector('.routes'); if (c) { const t = document.createElement('div'); t.innerHTML = DIR.cardsHtml(); c.replaceWith(t.firstChild); } return; }
      const y = el.scrollTop; body.innerHTML = DIR.bodyHtml(); el.scrollTop = y; DIR.fuelUpdate(el);
      DIR.drawModes();
    },
    leave() { DIR.close(); },
  };
  if (O) O.on(() => { if (PV.is('dir') && DIR.tab === 'ring') PV.refresh('off'); });
  DIR.fuelInput = (e, el, commit) => {
    const k = e.target.dataset && e.target.dataset.k; if (!k) return;
    const r = DIR.route(); if (!r) return;
    const v = D.veh(r.mode);
    if (k === 'kmpl') { const n = U.parse(e.target.value); if (n > 0 && n < 200) v.kmpl = n; }
    else if (k === 'price') { const n = U.parse(e.target.value); if (n >= 0 && n < 1e6) D.fuel(v.fuel).p = n; if (commit) e.target.value = U.num(D.fuel(v.fuel).p); }
    else if (k === 'now') { const n = U.parse(e.target.value); v.now = n > 0 ? n : 0; }
    else if (k === 'fuel') { v.fuel = e.target.value; const pr = el.querySelector('[data-k="price"]'); if (pr) pr.value = U.num(D.fuel(v.fuel).p); }
    D.saveCfg(); DIR.fuelUpdate(el);
  };
  DIR.openStation = p => {
    A().openPlace({ name: P.title(p), cat: p.k === 'r' ? 'Rest area' : p.k === 'c' ? 'SPKLU' : p.b > 0 ? 'SPBU · ' + P.brand(p.b).n : 'SPBU', lng: p.lng, lat: p.lat, spbu: p.k === 'f' ? p : null, osm: p.id ? { t: p.id[0].toUpperCase(), id: p.id.slice(1) } : null });
  };
  DIR.searchAlong = async id => {
    const r = DIR.route(); if (!r) return;
    if (DIR.along === id) { DIR.along = null; DIR.alongList = []; M.setAlong([]); PV.refresh('body'); return; }
    DIR.along = id; DIR.alongBusy = true; PV.refresh('body');
    const cat = Q.catOf(id), s0 = DIR.prog || 0;
    try {
      const pois = await Q.alongTiles(cat, r.coords, r.cum, 250, s0, 30000);
      const rows = pois.map(p => ({ k: 'x', lat: p.lat, lng: p.lng, name: p.name, id: p.id }));
      DIR.alongList = P.match(r, rows, 250).filter(p => p.s >= s0 - 20 && p.s <= s0 + 30000);
    } catch (e) { DIR.alongList = []; U.toast('Pencarian di sepanjang rute gagal'); }
    DIR.alongBusy = false;
    if (DIR.along !== id) return;
    M.setAlong(DIR.alongList, cat);
    PV.refresh('body');
  };
  DIR.more = async btn => {
    const r = DIR.route(); if (!r) return;
    const items = [['share', 'share', 'Bagikan rute'], ['send', 'send', 'Kirim rute ke HP/perangkat lain'], ['copy', 'copy', 'Salin link rute'], ['print', 'print', 'Cetak rute'], ['gmaps', 'web', 'Buka di Google Maps']];
    const box = $('#ctx'), rc = btn.getBoundingClientRect();
    box.innerHTML = items.map(([a, i, n]) => '<button data-x="' + a + '">' + ic(i) + n + '</button>').join('');
    box.hidden = false;
    box.style.left = Math.min(innerWidth - 260, rc.left - 200) + 'px';
    box.style.top = Math.max(8, rc.top - box.offsetHeight - 6) + 'px';
    box.onclick = e => {
      const x = e.target.closest('[data-x]'); if (!x) return;
      box.hidden = true;
      const link = A().link({ dir: DIR.pts, mode: DIR.mode });
      const name = (DIR.pts[0] ? DIR.pts[0].name : '') + ' → ' + (DIR.pts[DIR.pts.length - 1] ? DIR.pts[DIR.pts.length - 1].name : '');
      if (x.dataset.x === 'share') A().share('Rute ' + name, link);
      if (x.dataset.x === 'copy') U.copy(link);
      if (x.dataset.x === 'send') { D.send({ type: 'route', pts: DIR.pts.map(p => p && { name: p.gps ? 'Lokasi Anda' : p.name, lng: p.lng, lat: p.lat, gps: !!p.gps }), mode: DIR.mode }); U.toast('Rute terkirim. Buka Amatu Maps di HP Anda.'); }
      if (x.dataset.x === 'print') A().print();
      if (x.dataset.x === 'gmaps') window.open('https://www.google.com/maps/dir/?api=1&origin=' + DIR.pts[0].lat + ',' + DIR.pts[0].lng + '&destination=' + DIR.pts[DIR.pts.length - 1].lat + ',' + DIR.pts[DIR.pts.length - 1].lng +
        (DIR.pts.length > 2 ? '&waypoints=' + DIR.pts.slice(1, -1).map(p => p.lat + ',' + p.lng).join('|') : '') + '&travelmode=' + ({ car: 'driving', moto: 'two-wheeler', walk: 'walking', bike: 'bicycling' }[DIR.mode]), '_blank', 'noopener');
    };
    setTimeout(() => addEventListener('pointerdown', function h(e) { if (!box.contains(e.target)) { box.hidden = true; removeEventListener('pointerdown', h); } }), 0);
  };

  // ---------- saved ----------
  V.saved = {
    snap: 'full',
    html() {
      const S = D.saved, cnt = id => S.items.filter(i => i.list === id).length;
      const lab = (k, n, i) => { const s = S[k]; return '<div class="row click" data-lab="' + k + '">' + ic(i) + '<div class="rt">' + n + '<small>' + (s ? esc(s.addr || s.name) : 'Ketuk untuk mengatur') + '</small></div>' + (s ? '<button class="ib" data-a="labdir" data-k="' + k + '" title="Rute">' + ic('dir') + '</button>' : '') + '</div>'; };
      return '<div class="pbar"><button class="ib" data-a="back">' + ic('back') + '</button><div class="tt">Tersimpan</div><button class="ib" data-a="close">' + ic('x') + '</button></div>' +
        '<div class="rows">' + lab('home', 'Rumah', 'home') + lab('work', 'Kantor', 'work') +
        (S.park ? '<div class="row click" data-a="park">' + ic('parking') + '<div class="rt">Lokasi parkir<small>Disimpan ' + U.day(S.park.t) + ' ' + U.clock(S.park.t) + '</small></div><button class="ib" data-a="unpark" title="Hapus">' + ic('trash') + '</button></div>' : '') + '</div>' +
        '<div class="sec">Daftar Anda<span class="grow"></span><button class="btn sm" data-a="newlist">' + ic('plus') + 'Daftar baru</button></div>' +
        S.lists.map(l => '<div class="row click" data-list="' + esc(l.id) + '"><span style="color:' + esc(l.c) + '">' + ic(l.ic || 'bookmark') + '</span><div class="rt">' + esc(l.n) + '<small>' + cnt(l.id) + ' tempat</small></div>' + ic('chevr') + '</div>').join('') +
        '<div class="frow" style="padding:14px 20px;display:flex;justify-content:space-between;align-items:center"><span>Tampilkan tempat tersimpan di peta</span><button class="sw' + (D.cfg.savedMap ? ' on' : '') + '" data-a="savedmap"></button></div>';
    },
    mount(el) {
      el.onclick = async e => {
        const b = e.target.closest('[data-a]');
        if (b) {
          const a = b.dataset.a;
          if (a === 'back') return PV.back();
          if (a === 'close') return PV.close();
          if (a === 'labdir') { e.stopPropagation(); const s = D.saved[b.dataset.k]; return DIR.open({ to: { name: b.dataset.k === 'home' ? 'Rumah' : 'Kantor', addr: s.addr, lng: s.lng, lat: s.lat } }); }
          if (a === 'park') return A().openPlace({ name: 'Lokasi parkir', cat: 'Parkir · ' + U.day(D.saved.park.t) + ' ' + U.clock(D.saved.park.t), lng: D.saved.park.lng, lat: D.saved.park.lat });
          if (a === 'unpark') { e.stopPropagation(); D.saved.park = null; D.saveSaved(); A().drawPark(); return PV.refresh(); }
          if (a === 'savedmap') { D.cfg.savedMap = !D.cfg.savedMap; D.saveCfg(); M.setSaved(D.cfg.savedMap); return PV.refresh(); }
          if (a === 'newlist') {
            const n = await U.modal('Daftar baru', '<label class="fld">Nama daftar<input id="ln" maxlength="40" placeholder="mis. Kuliner Jogja"></label>', [{ label: 'Batal', value: null }, { label: 'Buat', kind: 'pri', fn: w => w.querySelector('#ln').value.trim() || false }]);
            if (n) { D.saved.lists.push({ id: U.uid(), n, ic: 'bookmark', c: '#1a73e8' }); D.saveSaved(); PV.refresh(); }
            return;
          }
        }
        const l = e.target.closest('[data-list]'); if (l) return PV.open('list', { id: l.dataset.list });
        const lb = e.target.closest('[data-lab]'); if (lb) return A().labelDialog(lb.dataset.lab);
      };
    },
  };
  V.list = {
    snap: 'full',
    html(d) {
      const l = D.saved.lists.find(x => x.id === d.id) || { n: 'Daftar' };
      const items = D.saved.items.filter(i => i.list === d.id), u = A().st.user || A().center();
      return '<div class="pbar"><button class="ib" data-a="back">' + ic('back') + '</button><div class="tt">' + esc(l.n) + ' <small class="mut">· ' + items.length + '</small></div>' +
        (['fav', 'want', 'star'].includes(d.id) ? '' : '<button class="ib" data-a="dellist" title="Hapus daftar">' + ic('trash') + '</button>') + '<button class="ib" data-a="close">' + ic('x') + '</button></div>' +
        (items.length ? items.map(it => '<div class="res" data-id="' + it.id + '"><div class="rd"><b>' + esc(it.name) + '</b><span>' + esc([it.cat, U.dist(G.dist(u, [it.lng, it.lat]))].filter(Boolean).join(' · ')) + '</span>' + (it.addr ? '<span>' + esc(it.addr) + '</span>' : '') + (it.note ? '<span>“' + esc(it.note) + '”</span>' : '') + '</div>' +
          '<div class="rr"><button class="ib" data-a="dir" data-id="' + it.id + '">' + ic('dir') + '</button><button class="ib" data-a="del" data-id="' + it.id + '" style="color:var(--mut)">' + ic('trash') + '</button></div></div>').join('') : '<div class="empty">Belum ada tempat. Buka tempat lalu ketuk “Simpan”.</div>');
    },
    mount(el, d) {
      const items = () => D.saved.items.filter(i => i.list === d.id);
      if (items().length) M.fit(G.bbox(items().map(i => [i.lng, i.lat])), { maxZoom: 15 });
      el.onclick = async e => {
        const b = e.target.closest('[data-a]');
        if (b) {
          e.stopPropagation();
          const a = b.dataset.a, it = D.saved.items.find(i => i.id === b.dataset.id);
          if (a === 'back') return PV.back();
          if (a === 'close') return PV.close();
          if (a === 'dir' && it) return DIR.open({ to: it });
          if (a === 'del' && it) { D.delSaved(it.id); M.setSaved(D.cfg.savedMap); PV.refresh(); U.toast('Dihapus dari daftar'); return; }
          if (a === 'dellist') {
            const ok = await U.modal('Hapus daftar?', '<p>Daftar dan ' + items().length + ' tempat di dalamnya akan dihapus.</p>', [{ label: 'Batal', value: false }, { label: 'Hapus', kind: 'bad', value: true }]);
            if (ok) { D.saved.items = D.saved.items.filter(i => i.list !== d.id); D.saved.lists = D.saved.lists.filter(l => l.id !== d.id); D.saveSaved(); M.setSaved(D.cfg.savedMap); PV.back(); }
            return;
          }
        }
        const r = e.target.closest('[data-id]'); if (r) { const it = D.saved.items.find(i => i.id === r.dataset.id); if (it) A().openPlace(Object.assign({}, it, { savedId: it.id })); }
      };
    },
  };
  V.recent = {
    snap: 'full',
    html() {
      const l = D.recent();
      return '<div class="pbar"><button class="ib" data-a="back">' + ic('back') + '</button><div class="tt">Terbaru</div>' + (l.length ? '<button class="btn sm" data-a="clear">Hapus semua</button>' : '') + '<button class="ib" data-a="close">' + ic('x') + '</button></div>' +
        (l.length ? l.map((r, i) => '<div class="res" data-i="' + i + '"><div class="rd"><b>' + esc(r.q || r.name) + '</b><span>' + esc(r.q ? 'Pencarian' : (r.addr || r.cat || '')) + ' · ' + U.day(r.t) + '</span></div></div>').join('') : '<div class="empty">Belum ada riwayat pencarian.</div>');
    },
    mount(el) {
      el.onclick = e => {
        const b = e.target.closest('[data-a]');
        if (b) { if (b.dataset.a === 'back') return PV.back(); if (b.dataset.a === 'close') return PV.close(); if (b.dataset.a === 'clear') { D.clearRecent(); return PV.refresh(); } }
        const r = e.target.closest('[data-i]'); if (!r) return;
        const it = D.recent()[+r.dataset.i];
        if (it.q) A().search(it.q); else A().openPlace(it);
      };
    },
  };
  V.trips = {
    snap: 'full',
    html() {
      const l = D.trips();
      const months = {};
      l.forEach(t => { const k = new Date(t.t).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); (months[k] = months[k] || []).push(t); });
      return '<div class="pbar"><button class="ib" data-a="back">' + ic('back') + '</button><div class="tt">Riwayat perjalanan</div><button class="ib" data-a="close">' + ic('x') + '</button></div>' +
        (l.length ? Object.entries(months).map(([m, ts]) => {
          const km = ts.reduce((a, t) => a + (t.dist || 0), 0) / 1000, cost = ts.reduce((a, t) => a + (t.cost || 0), 0), lit = ts.reduce((a, t) => a + (t.liters || 0), 0);
          return '<div class="sec">' + esc(m) + '<span class="grow"></span><small>' + U.num(km, 1) + ' km · ' + U.liter(lit) + ' · ' + U.rp(cost) + '</small></div>' +
            ts.map(t => '<div class="res" data-id="' + t.id + '"><div class="rd"><b>' + esc(t.to || 'Perjalanan') + '</b><span>dari ' + esc(t.from || '–') + '</span><span>' + U.day(t.t) + ' ' + U.clock(t.t) + ' · ' + esc(R.MODES[t.mode] ? R.MODES[t.mode].n : '') + ' · ' + U.dist(t.dist) + ' · ' + U.dur(t.time) + (t.liters ? ' · ' + U.liter(t.liters) + ' · ' + U.rp(t.cost) : '') + '</span></div>' +
              '<div class="rr"><button class="ib" data-a="del" data-id="' + t.id + '" style="color:var(--mut)">' + ic('trash') + '</button></div></div>').join('');
        }).join('') : '<div class="empty">Belum ada perjalanan. Riwayat tersimpan otomatis setiap navigasi selesai.</div>');
    },
    mount(el) {
      el.onclick = e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        if (b.dataset.a === 'back') return PV.back();
        if (b.dataset.a === 'close') return PV.close();
        if (b.dataset.a === 'del') { D.delTrip(b.dataset.id); PV.refresh(); }
      };
    },
  };
})();
