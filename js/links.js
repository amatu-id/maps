// Amatu Maps · map links → place. A link shared from Google Maps (also Apple Maps, OpenStreetMap, Waze, Bing, geo:)
// opens here with its name and exact coordinates, so a shop that only Google lists can still be routed to.
// Short links (maps.app.goo.gl/…) are expanded by our Supabase function amatu-link — a browser cannot see where a
// cross-origin redirect goes. Places opened from a link are kept (maps.places, synced) so the search finds them later.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U;
  const FN = 'https://ieyqxmzztoxgpvwexbkj.supabase.co/functions/v1/amatu-link';
  const SHORT = /^(maps\.app\.goo\.gl|goo\.gl|g\.page|g\.co|share\.google|maps\.apple)$/i;
  const URL_RE = /https?:\/\/[^\s<>"'`]+|geo:[^\s<>"'`(]+(?:\([^)\n]*\))?/i;
  const BARE = /^(?:www\.)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.page|google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple\.com|openstreetmap\.org|waze\.com)\/\S*/i;
  const SRC = { google: 'Google Maps', apple: 'Apple Maps', osm: 'OpenStreetMap', waze: 'Waze', bing: 'Bing Maps', geo: 'link lokasi', amatu: 'Amatu Maps' };

  const ok = (la, lo) => isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0);
  const dec = s => { s = String(s || '').replace(/\+/g, ' '); try { s = decodeURIComponent(s); } catch (e) { /* keep */ } return s.replace(/\s+/g, ' ').trim(); };
  const llOf = s => { const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s || ''); return m && ok(+m[1], +m[2]) ? [+m[1], +m[2]] : null; };   // "lat,lng"

  // trailing punctuation of a sentence is not part of the link; a ")" only when it has no "(" partner
  function tidy(u) {
    for (;;) {
      const v = u.replace(/[.,;!?]+$/, '');
      if (v.endsWith(')') && (v.match(/\(/g) || []).length < (v.match(/\)/g) || []).length) { u = v.slice(0, -1); continue; }
      return v;
    }
  }
  // the first map link inside a text ("Send2 Laundry Magelang https://maps.app.goo.gl/…" from the share sheet)
  function find(text) {
    const t = String(text || '').trim();
    let m = URL_RE.exec(t);
    if (!m) { const b = BARE.exec(t); if (b) return { url: 'https://' + tidy(b[0]), pre: '' }; return null; }
    return { url: tidy(m[0]), pre: t.slice(0, m.index).replace(/[\s:–—-]+$/, '').trim() };
  }
  const isLink = text => { const f = find(text); return !!(f && (SHORT.test(host(f.url)) || parse(f.url))); };
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }

  // full link → {name, lat, lng, src, url} | {q, src, url} (a search, not a place) | {short:true, url} | {err, src, url} | null
  function parse(s) {
    if (/^geo:/i.test(s)) {                          // geo:-7.48,110.23?q=-7.48,110.23(Send2 Laundry)
      const m = /^geo:(-?[\d.]+),(-?[\d.]+)/i.exec(s), q = /[?&]q=([^&]+)/.exec(s);
      let la = m ? +m[1] : NaN, lo = m ? +m[2] : NaN, name = '';
      if (q) { const v = dec(q[1]), mm = /^(-?[\d.]+),\s*(-?[\d.]+)\s*(?:\((.*)\))?$/.exec(v); if (mm) { la = +mm[1]; lo = +mm[2]; name = mm[3] || ''; } else name = v; }
      if (ok(la, lo)) return { name, lat: la, lng: lo, src: 'geo', url: s };
      return name ? { q: name, src: 'geo', url: s } : null;
    }
    let u; try { u = new URL(s); } catch (e) { return null; }
    const h = u.hostname.replace(/^www\./, '').toLowerCase(), P = u.searchParams, href = u.href;
    if (SHORT.test(h)) return { short: true, url: href };
    const llp = k => llOf(dec(P.get(k) || ''));
    // ---- Google Maps ----
    if (/^(maps\.)?google\.[a-z.]+$/.test(h) && (/^\/maps/.test(u.pathname) || h.startsWith('maps.') || P.has('q') || P.has('cid'))) {
      const path = u.pathname, data = href;
      const seg = re => { const m = re.exec(path); return m ? dec(m[1]) : ''; };
      let name = seg(/\/maps\/place\/([^/@]+)/);
      // exact place point: …!3d<lat>!4d<lng> (the last one is the place itself)
      let la = NaN, lo = NaN;
      for (const m of data.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)) { la = +m[1]; lo = +m[2]; }
      if (/\/maps\/dir\//.test(path)) {                // route link: the destination = last waypoint
        const pts = [...data.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)];
        const segs = path.split('/').slice(3).filter(x => x && !/^(@|data=)/.test(x));
        const last = dec(segs[segs.length - 1] || '');
        const c = llOf(last);
        if (c) { la = c[0]; lo = c[1]; name = ''; }
        else if (pts.length) { const m = pts[pts.length - 1]; lo = +m[1]; la = +m[2]; name = last; }
        if (ok(la, lo)) return { name, lat: la, lng: lo, src: 'google', url: href };
        if (last) return { q: last, src: 'google', url: href };
      }
      const c0 = llOf(name);
      if (c0) { la = c0[0]; lo = c0[1]; name = ''; }
      if (!ok(la, lo)) { const c = llp('q') || llp('query') || llp('destination') || llp('ll') || llp('center') || llp('daddr'); if (c) { la = c[0]; lo = c[1]; } }
      if (!ok(la, lo) && name) { const m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(path); if (m) { la = +m[1]; lo = +m[2]; } }
      if (ok(la, lo)) return { name, lat: la, lng: lo, src: 'google', url: href };
      const q = name || seg(/\/maps\/search\/([^/@]+)/) || dec(P.get('q') || P.get('query') || P.get('destination') || '');
      if (q && !llOf(q)) {
        const m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(path);
        return { q, near: m ? [+m[2], +m[1]] : null, src: 'google', url: href };
      }
      const v = /\/maps\/@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(path);          // just a map view
      if (v) return { name: '', lat: +v[1], lng: +v[2], src: 'google', url: href };
      return { err: P.has('cid') || /!1s0x[0-9a-f]+:0x[0-9a-f]+/.test(data) ? 'nocoord' : 'unknown', src: 'google', url: href };
    }
    // ---- Apple Maps ----  ?ll=lat,lng&q=Name · /place?coordinate=lat,lng&name=Name · ?daddr=
    if (h === 'maps.apple.com') {
      const c = llp('coordinate') || llp('ll') || llp('daddr') || llp('sll') || llp('q') || llp('center');
      const name = dec(P.get('name') || P.get('q') || P.get('address') || '');
      if (c) return { name: llOf(name) ? '' : name, lat: c[0], lng: c[1], src: 'apple', url: href };
      if (name) return { q: name, src: 'apple', url: href };
      return { err: 'nocoord', src: 'apple', url: href };
    }
    // ---- OpenStreetMap ----  ?mlat=&mlon= · #map=z/lat/lng
    if (/(^|\.)openstreetmap\.org$/.test(h) || h === 'osm.org') {
      const la = parseFloat(P.get('mlat')), lo = parseFloat(P.get('mlon'));
      if (ok(la, lo)) return { name: '', lat: la, lng: lo, src: 'osm', url: href };
      const m = /map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(u.hash);
      if (m) return { name: '', lat: +m[1], lng: +m[2], src: 'osm', url: href };
      return { err: 'nocoord', src: 'osm', url: href };
    }
    // ---- Waze ----  /ul?ll=lat,lng · /live-map/directions?to=ll.lat,lng
    if (/(^|\.)waze\.com$/.test(h)) {
      const c = llp('ll') || llOf(dec(P.get('to') || '').replace(/^ll\./, ''));
      if (c) return { name: '', lat: c[0], lng: c[1], src: 'waze', url: href };
      const q = dec(P.get('q') || '');
      return q ? { q, src: 'waze', url: href } : { err: 'nocoord', src: 'waze', url: href };
    }
    // ---- Bing ----  ?cp=lat~lng&where1=
    if (/(^|\.)bing\.com$/.test(h) && /^\/maps/.test(u.pathname)) {
      const m = /^(-?[\d.]+)~(-?[\d.]+)$/.exec(P.get('cp') || '');
      const name = dec(P.get('where1') || P.get('q') || '');
      if (m && ok(+m[1], +m[2])) return { name, lat: +m[1], lng: +m[2], src: 'bing', url: href };
      return name ? { q: name, src: 'bing', url: href } : null;
    }
    // ---- Amatu Maps itself ----  #p=lat,lng&n=Name
    if (/amatu-id\.github\.io|liemyo\.github\.io/.test(h) && /\/maps/.test(u.pathname)) {
      const hp = new URLSearchParams(dec(u.hash.slice(1)));
      const c = llOf(hp.get('p') || '');
      if (c) return { name: hp.get('n') || '', lat: c[0], lng: c[1], src: 'amatu', url: href };
    }
    return null;
  }

  const ERR = {
    nocoord: 'Link ini tidak memuat titik lokasi. Di Google Maps buka tempatnya, ketuk Bagikan → Salin link, lalu tempel di sini.',
    unknown: 'Link ini bukan link tempat. Buka tempatnya di Google Maps, ketuk Bagikan → Salin link, lalu tempel di sini.',
  };
  // text containing a map link → {place} | {q, near} ; throws Error(message in Indonesian)
  async function resolve(text) {
    const f = find(text);
    if (!f) throw new Error('Tidak ada link peta di teks itu.');
    let r = parse(f.url);
    if (!r) throw new Error(ERR.unknown);
    if (r.short) {
      if (!navigator.onLine) throw new Error('Butuh sinyal untuk membuka link pendek.');
      let d = null;
      try { d = await U.json(FN + '?u=' + encodeURIComponent(r.url), { timeout: 12000 }); }
      catch (e) { throw new Error(e.status === 404 ? 'Link tidak ditemukan atau sudah kedaluwarsa.' : 'Link pendek belum bisa dibuka. Coba lagi sebentar lagi.'); }
      const r2 = d && d.ok && d.url ? parse(d.url) : null;
      if (!r2 || r2.short) throw new Error(ERR.unknown);
      r = Object.assign(r2, { short: r.url });
    }
    if (r.err) throw new Error(ERR[r.err] || ERR.unknown);
    if (r.q && !isFinite(r.lat)) return { q: r.q, near: r.near || null };
    const name = (r.name || f.pre || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return {
      place: { name: name || 'Tempat dari ' + (SRC[r.src] || 'link'), lng: +r.lng.toFixed(7), lat: +r.lat.toFixed(7), addr: '', cat: '', link: { url: r.short || r.url, src: r.src }, fromLink: true },
    };
  }
  const googleSearch = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);

  AM.L = { find, parse, resolve, isLink, googleSearch, srcName: s => SRC[s] || 'link', FN };
})();
