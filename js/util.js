// Amatu Maps · helpers (DOM, format Indonesia, storage, fetch, toast)
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const nf = (d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF = [nf(0), nf(1), nf(2)];
  const U = AM.U = {
    $: (s, el = document) => el.querySelector(s),
    $$: (s, el = document) => Array.from(el.querySelectorAll(s)),
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    ic: (n, cls = '') => '<svg class="ic ' + cls + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>',
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    num(n, d = 0) { return NF[d] ? NF[d].format(n) : nf(d).format(n); },
    // "10.000" / "10,5" / "1:10" → number
    parse(s) {
      s = String(s == null ? '' : s).trim().replace(/^rp\.?\s*/i, '').replace(/\s/g, '');
      if (/^\d+:\d+([.,]\d+)?$/.test(s)) s = s.split(':')[1];
      if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(',', '.');
      const v = parseFloat(s);
      return isFinite(v) ? v : NaN;
    },
    dist(m) {
      if (!isFinite(m)) return '–';
      m = Math.max(0, m);
      if (m < 950) return (m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10) + ' m';
      if (m < 9950) return U.num(m / 1000, 1) + ' km';
      return U.num(Math.round(m / 1000)) + ' km';
    },
    dur(s) {
      if (!isFinite(s)) return '–';
      const m = Math.max(1, Math.round(s / 60));
      if (m < 60) return m + ' mnt';
      const h = Math.floor(m / 60), r = m % 60;
      if (h < 24) return h + ' j' + (r ? ' ' + r + ' mnt' : '');
      const d = Math.floor(h / 24);
      return d + ' hr ' + (h % 24) + ' j';
    },
    clock(d) { d = new Date(d); return String(d.getHours()).padStart(2, '0') + '.' + String(d.getMinutes()).padStart(2, '0'); },
    day(d) {
      d = new Date(d); const t = new Date(); const y = new Date(Date.now() - 864e5);
      if (d.toDateString() === t.toDateString()) return 'Hari ini';
      if (d.toDateString() === y.toDateString()) return 'Kemarin';
      return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
    },
    rp: n => 'Rp' + U.num(Math.round(n / 100) * 100),
    rpx: n => 'Rp' + U.num(Math.round(n)),
    liter: l => U.num(l, l < 10 ? 2 : 1) + ' L',
    debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; },
    throttle(fn, ms) { let last = 0, t; return function (...a) { const now = Date.now(); clearTimeout(t); if (now - last >= ms) { last = now; fn.apply(this, a); } else t = setTimeout(() => { last = Date.now(); fn.apply(this, a); }, ms - (now - last)); }; },
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    async json(url, o = {}) {
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), o.timeout || 15000);
      if (o.signal) o.signal.addEventListener('abort', () => ac.abort(), { once: true });
      try {
        const r = await fetch(url, { method: o.method || (o.body ? 'POST' : 'GET'), body: o.body, headers: o.headers, signal: ac.signal, cache: o.cache });
        if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; try { e.body = await r.text(); } catch (x) { /* */ } throw e; }
        return await r.json();
      } finally { clearTimeout(tm); }
    },
    mobile: () => matchMedia('(max-width: 899px)').matches,
    reduced: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    on(el, ev, sel, fn) { el.addEventListener(ev, e => { const t = e.target.closest(sel); if (t && el.contains(t)) fn(e, t); }); },
    async copy(text) {
      try { await navigator.clipboard.writeText(text); }
      catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (x) { /* */ } ta.remove(); }
      U.toast('Disalin: ' + (text.length > 48 ? text.slice(0, 46) + '…' : text));
    },
    toast(msg, o = {}) {
      let box = document.getElementById('toasts');
      if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
      if (o.key) { const old = box.querySelector('[data-key="' + o.key + '"]'); if (old) old.remove(); }
      const el = document.createElement('div');
      el.className = 'toast ' + (o.kind || '');
      if (o.key) el.dataset.key = o.key;
      el.innerHTML = '<span>' + U.esc(msg) + '</span>' + (o.action ? '<button>' + U.esc(o.action.label) + '</button>' : '');
      if (o.action) el.querySelector('button').onclick = () => { el.remove(); o.action.fn(); };
      box.appendChild(el);
      requestAnimationFrame(() => el.classList.add('in'));
      setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, o.ms || 3200);
      return el;
    },
    // small modal: html body + buttons [{label, kind, fn → false keeps it open}]
    modal(title, body, buttons = [{ label: 'Tutup' }], o = {}) {
      return new Promise(res => {
        const w = document.createElement('div');
        w.className = 'mwrap';
        w.innerHTML = '<div class="modal ' + (o.cls || '') + '" role="dialog" aria-modal="true"><div class="mhead"><h3>' + U.esc(title) + '</h3><button class="ib mx" aria-label="Tutup">' + U.ic('x') + '</button></div><div class="mbody">' + body + '</div>' +
          (buttons.length ? '<div class="mfoot">' + buttons.map((b, i) => '<button class="btn ' + (b.kind || '') + '" data-i="' + i + '">' + U.esc(b.label) + '</button>').join('') + '</div>' : '') + '</div>';
        document.body.appendChild(w);
        const close = v => { w.classList.remove('in'); setTimeout(() => w.remove(), 180); document.removeEventListener('keydown', key); res(v); };
        const key = e => { if (e.key === 'Escape') close(null); };
        document.addEventListener('keydown', key);
        w.addEventListener('mousedown', e => { if (e.target === w) close(null); });
        w.querySelector('.mx').onclick = () => close(null);
        w.querySelectorAll('.mfoot button').forEach(b => b.onclick = () => {
          const bt = buttons[+b.dataset.i];
          const r = bt.fn ? bt.fn(w) : true;
          if (r !== false) close(bt.value !== undefined ? bt.value : (r === true || r === undefined ? +b.dataset.i : r));
        });
        if (o.onOpen) o.onOpen(w, close);
        requestAnimationFrame(() => w.classList.add('in'));
        const f = w.querySelector('input,select,textarea');
        if (f && !U.mobile()) setTimeout(() => f.focus(), 60);
      });
    },
  };
})();
