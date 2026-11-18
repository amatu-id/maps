// Amatu Maps · minimal Mapbox Vector Tile reader (protobuf) — enough to read POI points out of OpenFreeMap tiles
// for "nearby" category search without Overpass. MVT spec 2.1.
(function (root) {
  'use strict';
  function Pbf(buf) { this.b = buf; this.p = 0; this.n = buf.length; }
  Pbf.prototype.varint = function () {
    const b = this.b; let r = 0, s = 0, x;
    do { x = b[this.p++]; if (s < 28) r |= (x & 0x7f) << s; else r += (x & 0x7f) * Math.pow(2, s); s += 7; } while (x >= 0x80);
    return r >>> 0 === r ? r : r;               // values above 2^31 stay positive doubles
  };
  Pbf.prototype.svarint = function () { const v = this.varint(); return v % 2 === 1 ? (v + 1) / -2 : v / 2; };
  Pbf.prototype.str = function () {
    const len = this.varint(), s = this.p; this.p += len;
    return td.decode(this.b.subarray(s, s + len));
  };
  Pbf.prototype.skip = function (t) {
    // NB: `this.p += this.varint()` would read this.p before varint() advances it
    if (t === 0) this.varint(); else if (t === 2) { const l = this.varint(); this.p += l; } else if (t === 5) this.p += 4; else if (t === 1) this.p += 8;
    else throw new Error('pbf wire ' + t);
  };
  Pbf.prototype.packed = function () { const end = this.varint() + this.p, a = []; while (this.p < end) a.push(this.varint()); return a; };
  const td = new TextDecoder();

  function readValue(p, end) {
    let v = null;
    while (p.p < end) {
      const tag = p.varint(), f = tag >> 3, t = tag & 7;
      if (f === 1) v = p.str();
      else if (f === 2) { v = new DataView(p.b.buffer, p.b.byteOffset + p.p, 4).getFloat32(0, true); p.p += 4; }
      else if (f === 3) { v = new DataView(p.b.buffer, p.b.byteOffset + p.p, 8).getFloat64(0, true); p.p += 8; }
      else if (f === 4 || f === 5) v = p.varint();
      else if (f === 6) v = p.svarint();
      else if (f === 7) v = !!p.varint();
      else p.skip(t);
    }
    return v;
  }

  // first point of a geometry (points) or a rough centre (lines/polygons), in tile units
  function anchor(cmds, type) {
    let x = 0, y = 0, i = 0, n = 0, sx = 0, sy = 0, minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    while (i < cmds.length) {
      const c = cmds[i++], id = c & 7, cnt = c >> 3;
      if (id === 7) continue;
      for (let k = 0; k < cnt; k++) {
        const dx = cmds[i++], dy = cmds[i++];
        x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1);
        if (type === 1) return [x, y];
        sx += x; sy += y; n++;
        if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y;
      }
    }
    if (!n) return null;
    return type === 3 ? [(minx + maxx) / 2, (miny + maxy) / 2] : [sx / n, sy / n];
  }

  // → { layerName: [{id, props, x, y (0..1 inside tile)}] } for the wanted layers only
  function decode(buf, want) {
    const p = new Pbf(buf instanceof Uint8Array ? buf : new Uint8Array(buf)), out = {};
    while (p.p < p.n) {
      const tag = p.varint(), f = tag >> 3, t = tag & 7;
      if (f !== 3) { p.skip(t); continue; }
      const end = p.varint() + p.p;
      let name = '', extent = 4096; const keys = [], vals = [], feats = [];
      const start = p.p;
      // first pass: name (to skip unwanted layers quickly)
      while (p.p < end) {
        const t2 = p.varint(), f2 = t2 >> 3, w2 = t2 & 7;
        if (f2 === 1) name = p.str(); else p.skip(w2);
      }
      if (want && !want.includes(name)) { p.p = end; continue; }
      p.p = start;
      while (p.p < end) {
        const t2 = p.varint(), f2 = t2 >> 3, w2 = t2 & 7;
        if (f2 === 3) keys.push(p.str());
        else if (f2 === 4) { const e = p.varint() + p.p; vals.push(readValue(p, e)); p.p = e; }
        else if (f2 === 5) extent = p.varint();
        else if (f2 === 2) {
          const e = p.varint() + p.p; let id, tags = [], type = 0, geom = [];
          while (p.p < e) {
            const t3 = p.varint(), f3 = t3 >> 3, w3 = t3 & 7;
            if (f3 === 1) id = p.varint(); else if (f3 === 2) tags = p.packed(); else if (f3 === 3) type = p.varint();
            else if (f3 === 4) geom = p.packed(); else p.skip(w3);
          }
          feats.push({ id, tags, type, geom }); p.p = e;
        } else p.skip(w2);
      }
      out[name] = feats.map(ft => {
        const props = {};
        for (let k = 0; k + 1 < ft.tags.length; k += 2) props[keys[ft.tags[k]]] = vals[ft.tags[k + 1]];
        const a = anchor(ft.geom, ft.type);
        return a ? { id: ft.id, type: ft.type, props, x: a[0] / extent, y: a[1] / extent } : null;
      }).filter(Boolean);
    }
    return out;
  }
  // tile (z,x,y) + fraction inside → lng/lat
  function toLngLat(z, tx, ty, fx, fy) {
    const n = Math.pow(2, z), lng = (tx + fx) / n * 360 - 180;
    const yy = Math.PI * (1 - 2 * (ty + fy) / n);
    return [lng, Math.atan(Math.sinh(yy)) * 180 / Math.PI];
  }
  root.MVT = { decode, toLngLat };
  (root.AM = root.AM || {}).MVT = root.MVT;
})(typeof window !== 'undefined' ? window : globalThis);
