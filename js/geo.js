// Amatu Maps · geodesy: distances, polylines, route snapping, sun times, Plus Codes, coordinate parsing
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const rad = Math.PI / 180, R = 6371008.8;
  // local metres per degree at latitude φ (cheap-ruler style, < 0.1 % error over a few km)
  const kxy = lat => {
    const c = Math.cos(lat * rad), c2 = 2 * c * c - 1, c3 = 4 * c * c * c - 3 * c, c4 = 2 * c2 * c2 - 1, c5 = 2 * c * c4 - c3;
    return [111412.84 * c - 93.5 * c3 + 0.118 * c5, 111132.954 - 559.822 * c2 + 1.175 * c4];
  };
  const G = AM.G = {
    rad, R, kxy,
    dist(a, b) {
      const φ1 = a[1] * rad, φ2 = b[1] * rad, dφ = φ2 - φ1, dλ = (b[0] - a[0]) * rad;
      const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    },
    bearing(a, b) {
      const φ1 = a[1] * rad, φ2 = b[1] * rad, dλ = (b[0] - a[0]) * rad;
      const y = Math.sin(dλ) * Math.cos(φ2), x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
      return (Math.atan2(y, x) / rad + 360) % 360;
    },
    dest(p, brg, m) {
      const δ = m / R, θ = brg * rad, φ1 = p[1] * rad, λ1 = p[0] * rad;
      const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
      const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
      return [((λ2 / rad + 540) % 360) - 180, φ2 / rad];
    },
    angDiff: (a, b) => { const d = ((b - a) % 360 + 540) % 360 - 180; return d; },
    // encoded polyline (Valhalla precision 6, OSRM/Google 5) → [[lng, lat], …]
    decode(str, prec = 6) {
      const f = Math.pow(10, prec), out = []; let i = 0, lat = 0, lng = 0;
      while (i < str.length) {
        let b, s = 0, r = 0;
        do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32);
        lat += r & 1 ? ~(r >> 1) : r >> 1; s = 0; r = 0;
        do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32);
        lng += r & 1 ? ~(r >> 1) : r >> 1;
        out.push([lng / f, lat / f]);
      }
      return out;
    },
    cum(coords) {
      const c = new Float64Array(coords.length);
      for (let i = 1; i < coords.length; i++) c[i] = c[i - 1] + G.dist(coords[i - 1], coords[i]);
      return c;
    },
    // nearest point of the line coords[i0..i1] to p → {i (segment), t, d (m), s (m along), pt}
    nearest(coords, cum, p, i0 = 0, i1 = coords.length - 1) {
      const [kx, ky] = kxy(p[1]);
      let bi = -1, bt = 0, bd = Infinity;
      i0 = Math.max(0, i0); i1 = Math.min(coords.length - 1, i1);
      for (let i = i0; i < i1; i++) {
        const a = coords[i], b = coords[i + 1];
        const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
        const L2 = dx * dx + dy * dy;
        let t = L2 ? -(ax * dx + ay * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const x = ax + t * dx, y = ay + t * dy, d = x * x + y * y;
        if (d < bd) { bd = d; bi = i; bt = t; }
      }
      if (bi < 0) return { i: 0, t: 0, d: G.dist(coords[0], p), s: 0, pt: coords[0] };
      const a = coords[bi], b = coords[bi + 1];
      return { i: bi, t: bt, d: Math.sqrt(bd), s: cum[bi] + bt * (cum[bi + 1] - cum[bi]), pt: [a[0] + bt * (b[0] - a[0]), a[1] + bt * (b[1] - a[1])] };
    },
    // point at distance s along the line → {pt, i, brg}
    at(coords, cum, s) {
      const n = coords.length;
      if (s <= 0) return { pt: coords[0], i: 0, brg: n > 1 ? G.bearing(coords[0], coords[1]) : 0 };
      if (s >= cum[n - 1]) return { pt: coords[n - 1], i: n - 2, brg: n > 1 ? G.bearing(coords[n - 2], coords[n - 1]) : 0 };
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      const L = cum[hi] - cum[lo], t = L ? (s - cum[lo]) / L : 0, a = coords[lo], b = coords[hi];
      return { pt: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], i: lo, brg: G.bearing(a, b) };
    },
    // index of the shape point with cum[i] <= s
    idx(cum, s) { let lo = 0, hi = cum.length - 1; if (s >= cum[hi]) return hi; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } return lo; },
    slice(coords, cum, s0, s1) {
      const a = G.at(coords, cum, s0), b = G.at(coords, cum, s1);
      const out = [a.pt];
      for (let i = a.i + 1; i <= b.i; i++) out.push(coords[i]);
      out.push(b.pt);
      return out;
    },
    bbox(coords) {
      let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
      for (const c of coords) { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; }
      return [x0, y0, x1, y1];
    },
    // Douglas-Peucker in local metres
    simplify(coords, tol) {
      if (coords.length < 3) return coords.slice();
      const [kx, ky] = kxy(coords[0][1]);
      const keep = new Uint8Array(coords.length); keep[0] = keep[coords.length - 1] = 1;
      const st = [[0, coords.length - 1]];
      while (st.length) {
        const [a, b] = st.pop();
        const ax = coords[a][0] * kx, ay = coords[a][1] * ky, dx = coords[b][0] * kx - ax, dy = coords[b][1] * ky - ay, L2 = dx * dx + dy * dy;
        let md = -1, mi = -1;
        for (let i = a + 1; i < b; i++) {
          const px = coords[i][0] * kx - ax, py = coords[i][1] * ky - ay;
          let t = L2 ? (px * dx + py * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - t * dx, ey = py - t * dy, d = ex * ex + ey * ey;
          if (d > md) { md = d; mi = i; }
        }
        if (md > tol * tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
      }
      return coords.filter((_, i) => keep[i]);
    },
    // which side of the travel direction a→b point p is on: 1 = left, -1 = right
    side(a, b, p) {
      const [kx, ky] = kxy(p[1]);
      const v = (b[0] - a[0]) * kx * (p[1] - a[1]) * ky - (b[1] - a[1]) * ky * (p[0] - a[0]) * kx;
      return v > 0 ? 1 : -1;
    },
    circle(c, m, n = 48) { const r = []; for (let i = 0; i <= n; i++) r.push(G.dest(c, i * 360 / n, m)); return r; },
    length(coords) { let s = 0; for (let i = 1; i < coords.length; i++) s += G.dist(coords[i - 1], coords[i]); return s; },
    area(ring) {                       // m², spherical excess approximation
      let s = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        s += (b[0] - a[0]) * rad * (2 + Math.sin(a[1] * rad) + Math.sin(b[1] * rad));
      }
      return Math.abs(s * R * R / 2);
    },
    tile(lng, lat, z) {
      const n = 2 ** z, x = Math.floor((lng + 180) / 360 * n);
      const y = Math.floor((1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2 * n);
      return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
    },
    // ---------- sunrise / sunset (NOAA / Meeus approximation) ----------
    sun(date, lat, lng) {
      const dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397, J0 = 0.0009;
      const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000, lw = rad * -lng, phi = rad * lat;
      const n = Math.round(d - J0 - lw / (2 * Math.PI));
      const ds = J0 + lw / (2 * Math.PI) + n;
      const M = rad * (357.5291 + 0.98560028 * ds);
      const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
      const L = M + C + rad * 102.9372 + Math.PI;
      const dec = Math.asin(Math.sin(e) * Math.sin(L));
      const noon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
      if (!isFinite(w)) return null;
      const set = J2000 + (J0 + (w + lw) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      const rise = noon - (set - noon);
      const toDate = j => new Date((j + 0.5 - J1970) * dayMs);
      return { rise: toDate(rise), set: toDate(set), noon: toDate(noon) };
    },
    // ---------- Open Location Code (Plus Codes) ----------
    OLC: '23456789CFGHJMPQRVWX',
    olc(lat, lng) {
      lat = Math.min(89.9999999, Math.max(-90, lat)) + 90; lng = ((lng + 180) % 360 + 360) % 360;
      let code = '', res = 20;
      for (let i = 0; i < 5; i++) {
        const la = Math.floor(lat / res), lo = Math.floor(lng / res);
        lat -= la * res; lng -= lo * res;
        code += G.OLC[la] + G.OLC[lo];
        if (i === 3) code += '+';
        res /= 20;
      }
      return code;                                     // 10 digits ≈ 14 m
    },
    olcShort(code) { return code.slice(4); },
    // full or short (relative to ref [lng,lat]) code → [lng, lat] centre, or null
    olcDecode(code, ref) {
      code = String(code || '').toUpperCase().replace(/\s/g, '');
      const m = /^([23456789CFGHJMPQRVWX]{2,8})\+([23456789CFGHJMPQRVWX]{0,3})$/.exec(code);
      if (!m) return null;
      let pre = m[1], post = m[2];
      if (pre.length < 8) {
        if (!ref || pre.length % 2) return null;
        const pad = 8 - pre.length, res = Math.pow(20, 2 - pad / 2);
        const rc = G.olc(ref[1], ref[0]).replace('+', '');
        const full = rc.slice(0, pad) + pre + '+' + post;
        const c = G.olcDecode(full);
        if (!c) return null;
        // pick the neighbour cell nearest to ref
        let [lng, lat] = c;
        if (ref[1] + res / 2 < lat && lat - res >= -90) lat -= res; else if (ref[1] - res / 2 > lat && lat + res <= 90) lat += res;
        if (ref[0] + res / 2 < lng) lng -= res; else if (ref[0] - res / 2 > lng) lng += res;
        return [lng, lat];
      }
      let lat = -90, lng = -180, res = 20;
      const digits = pre + post;
      for (let i = 0; i < digits.length && i < 10; i += 2) {
        lat += G.OLC.indexOf(digits[i]) * res;
        if (i + 1 < digits.length) lng += G.OLC.indexOf(digits[i + 1]) * res;
        res /= 20;
      }
      res *= 20;
      return [lng + res / 2, lat + res / 2];
    },
    // text → [lng, lat] for "-7.43, 110.21", "-7,43 110,21", DMS, geo:, Google Maps links, Plus Codes
    parse(text, ref) {
      let s = String(text || '').trim();
      if (!s) return null;
      const ok = (la, lo) => isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? [lo, la] : null;
      let m;
      if (/^https?:\/\//i.test(s) || /^geo:/i.test(s)) {
        try { s = decodeURIComponent(s); } catch (e) { /* keep */ }
        if ((m = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(s))) return ok(+m[1], +m[2]);
        if ((m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(s))) return ok(+m[1], +m[2]);
        if ((m = /[?&](?:q|query|ll|destination|daddr|center|sll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(s))) return ok(+m[1], +m[2]);
        if ((m = /^geo:(-?\d+\.?\d*),(-?\d+\.?\d*)/i.exec(s))) return ok(+m[1], +m[2]);
        if ((m = /#map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/.exec(s))) return ok(+m[1], +m[2]);
        return null;
      }
      if ((m = /^(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(s)) || (m = /^(-?\d{1,3}\.\d+)\s+(-?\d{1,3}\.\d+)$/.exec(s))) {
        const a = +m[1], b = +m[2];
        return ok(a, b) || ok(b, a);
      }
      if ((m = /^(-?\d{1,2},\d+)\s+(-?\d{1,3},\d+)$/.exec(s))) return ok(+m[1].replace(',', '.'), +m[2].replace(',', '.'));
      const dms = /(\d{1,3})[°º\s]\s*(\d{1,2})?['′\s]?\s*(\d{1,2}(?:[.,]\d+)?)?["″]?\s*([NSUEWTB])/gi;
      const parts = []; let d;
      while ((d = dms.exec(s))) {
        let v = +d[1] + (+(d[2] || 0)) / 60 + (+(String(d[3] || 0).replace(',', '.'))) / 3600;
        const h = d[4].toUpperCase();
        if (h === 'S' || h === 'W' || h === 'B') v = -v;               // U/S = Utara/Selatan, T/B = Timur/Barat
        parts.push({ v, lat: 'NSU'.includes(h) });
      }
      if (parts.length === 2) {
        const la = parts.find(p => p.lat), lo = parts.find(p => !p.lat);
        if (la && lo) return ok(la.v, lo.v);
      }
      if (/\+/.test(s)) { const c = G.olcDecode(s.split(/\s/)[0], ref); if (c) return c; }
      return null;
    },
    fmtLL: (p, d = 6) => p[1].toFixed(d) + ', ' + p[0].toFixed(d),
  };
})();
