// Amatu Maps · search: Photon autocomplete, reverse geocoding, place details (Nominatim/Overpass),
// "nearby" categories read straight from the map's vector tiles (works when Overpass is overloaded).
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const U = AM.U, G = AM.G;
  const PHOTON = 'https://photon.komoot.io';
  const NOMI = 'https://nominatim.openstreetmap.org';
  const OSM_FN = 'https://ieyqxmzztoxgpvwexbkj.supabase.co/functions/v1/amatu-osm';
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

  // ---------- category labels (Indonesian) ----------
  const LBL = {
    'amenity:fuel': 'SPBU', 'amenity:charging_station': 'SPKLU', 'amenity:restaurant': 'Restoran', 'amenity:fast_food': 'Makanan cepat saji', 'amenity:cafe': 'Kafe',
    'amenity:food_court': 'Pujasera', 'amenity:bar': 'Bar', 'amenity:bank': 'Bank', 'amenity:atm': 'ATM', 'amenity:hospital': 'Rumah sakit', 'amenity:clinic': 'Klinik',
    'amenity:doctors': 'Dokter', 'amenity:dentist': 'Dokter gigi', 'amenity:pharmacy': 'Apotek', 'amenity:school': 'Sekolah', 'amenity:kindergarten': 'TK/PAUD',
    'amenity:college': 'Perguruan tinggi', 'amenity:university': 'Universitas', 'amenity:place_of_worship': 'Tempat ibadah', 'amenity:mosque': 'Masjid',
    'amenity:police': 'Kantor polisi', 'amenity:fire_station': 'Pemadam kebakaran', 'amenity:post_office': 'Kantor pos', 'amenity:townhall': 'Kantor pemerintahan',
    'amenity:marketplace': 'Pasar', 'amenity:parking': 'Parkir', 'amenity:bus_station': 'Terminal bus', 'amenity:toilets': 'Toilet', 'amenity:library': 'Perpustakaan',
    'amenity:cinema': 'Bioskop', 'amenity:theatre': 'Teater', 'amenity:courthouse': 'Pengadilan', 'amenity:car_wash': 'Cuci kendaraan', 'amenity:car_rental': 'Rental mobil',
    'amenity:community_centre': 'Balai warga', 'amenity:prison': 'Lapas', 'amenity:veterinary': 'Dokter hewan', 'amenity:ferry_terminal': 'Pelabuhan feri',
    'shop:convenience': 'Minimarket', 'shop:supermarket': 'Supermarket', 'shop:mall': 'Mal', 'shop:department_store': 'Toserba', 'shop:bakery': 'Toko roti',
    'shop:car_repair': 'Bengkel mobil', 'shop:motorcycle_repair': 'Bengkel motor', 'shop:motorcycle': 'Dealer motor', 'shop:car': 'Dealer mobil', 'shop:tyres': 'Toko ban',
    'shop:hardware': 'Toko bangunan', 'shop:doityourself': 'Toko bangunan', 'shop:clothes': 'Toko pakaian', 'shop:electronics': 'Toko elektronik', 'shop:mobile_phone': 'Toko HP',
    'shop:books': 'Toko buku', 'shop:beauty': 'Salon kecantikan', 'shop:hairdresser': 'Pangkas rambut', 'shop:laundry': 'Laundry', 'shop:optician': 'Optik', 'shop:greengrocer': 'Sayur & buah',
    'tourism:hotel': 'Hotel', 'tourism:motel': 'Motel', 'tourism:guest_house': 'Penginapan', 'tourism:hostel': 'Hostel', 'tourism:attraction': 'Tempat wisata', 'tourism:museum': 'Museum',
    'tourism:viewpoint': 'Titik pandang', 'tourism:camp_site': 'Bumi perkemahan', 'tourism:zoo': 'Kebun binatang', 'tourism:theme_park': 'Taman hiburan', 'tourism:information': 'Informasi wisata',
    'leisure:park': 'Taman', 'leisure:stadium': 'Stadion', 'leisure:sports_centre': 'Pusat olahraga', 'leisure:swimming_pool': 'Kolam renang', 'leisure:pitch': 'Lapangan',
    'leisure:golf_course': 'Lapangan golf', 'leisure:playground': 'Taman bermain',
    'highway:bus_stop': 'Halte bus', 'highway:services': 'Rest area', 'highway:rest_area': 'Rest area', 'railway:station': 'Stasiun kereta', 'railway:halt': 'Stasiun kecil',
    'aeroway:aerodrome': 'Bandara', 'aeroway:terminal': 'Terminal bandara', 'natural:peak': 'Puncak gunung', 'natural:volcano': 'Gunung api', 'natural:beach': 'Pantai',
    'natural:water': 'Perairan', 'waterway:river': 'Sungai', 'natural:waterfall': 'Air terjun', 'waterway:waterfall': 'Air terjun', 'historic:monument': 'Monumen', 'historic:memorial': 'Tugu peringatan',
    'office:government': 'Kantor pemerintah', 'office:company': 'Kantor perusahaan', 'building:yes': 'Bangunan', 'landuse:residential': 'Permukiman',
    'place:city': 'Kota', 'place:town': 'Kota kecil', 'place:village': 'Desa', 'place:hamlet': 'Dusun', 'place:suburb': 'Kelurahan', 'place:neighbourhood': 'Lingkungan',
    'place:quarter': 'Kawasan', 'place:county': 'Kabupaten', 'place:state': 'Provinsi', 'place:island': 'Pulau', 'place:square': 'Alun-alun', 'boundary:administrative': 'Wilayah',
  };
  const HW = { motorway: 'Jalan tol', trunk: 'Jalan nasional', primary: 'Jalan utama', secondary: 'Jalan provinsi', tertiary: 'Jalan kabupaten', residential: 'Jalan', unclassified: 'Jalan', service: 'Jalan kecil', track: 'Jalan tanah', footway: 'Jalan setapak', path: 'Jalan setapak' };
  function catLabel(key, val, type) {
    if (key === 'highway' && HW[val]) return HW[val];
    if (LBL[key + ':' + val]) return LBL[key + ':' + val];
    if (key === 'place' || type === 'city') return 'Tempat';
    if (type === 'street') return 'Jalan';
    if (type === 'house') return 'Alamat';
    if (!val || val === 'yes') return key ? key[0].toUpperCase() + key.slice(1) : '';
    return val.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  }
  // icon for a place kind
  function iconOf(key, val) {
    const k = key + ':' + val;
    if (k === 'amenity:fuel') return 'fuel';
    if (k === 'amenity:charging_station') return 'ev';
    if (/restaurant|fast_food|food_court|bakery/.test(val)) return 'food';
    if (val === 'cafe') return 'cafe';
    if (/hotel|motel|guest_house|hostel/.test(val)) return 'bed';
    if (/hospital|clinic|doctors|dentist/.test(val)) return 'hosp';
    if (val === 'pharmacy') return 'pill';
    if (/bank|atm/.test(val)) return 'bank';
    if (/convenience|supermarket|mall|department_store|marketplace/.test(val)) return 'cart';
    if (val === 'place_of_worship' || val === 'mosque') return 'mosque';
    if (val === 'parking') return 'parking';
    if (/repair|tyres/.test(val)) return 'wrench';
    if (/school|college|university|kindergarten/.test(val)) return 'school';
    if (key === 'highway' && !/bus_stop|services|rest_area/.test(val)) return 'road';
    if (/station|halt|bus_stop|aerodrome|terminal/.test(val)) return 'bus';
    if (key === 'place' || key === 'boundary') return 'city';
    if (/park|attraction|museum|viewpoint|zoo|theme_park|peak|volcano|beach|waterfall/.test(val)) return 'camera';
    return 'pin';
  }

  // ---------- nearby categories (vector tile POIs) ----------
  const CATS = [
    { id: 'spbu', n: 'SPBU', ic: 'fuel', c: '#d93025', f: p => p.class === 'fuel' && p.subclass !== 'charging_station' },
    { id: 'makan', n: 'Restoran', ic: 'food', c: '#e8710a', f: p => /^(restaurant|fast_food|food_court)$/.test(p.class) || /^(restaurant|fast_food|food_court)$/.test(p.subclass) },
    { id: 'kafe', n: 'Kafe', ic: 'cafe', c: '#a0522d', f: p => p.class === 'cafe' || p.subclass === 'cafe' || p.class === 'ice_cream' },
    { id: 'mart', n: 'Minimarket', ic: 'cart', c: '#1a73e8', q: 'indomaret alfamart minimarket', f: p => /^(convenience|supermarket|mall|department_store)$/.test(p.subclass) || /indomaret|alfamart|alfamidi|minimarket|supermarket|swalayan/i.test(p.name || '') },
    { id: 'atm', n: 'ATM', ic: 'bank', c: '#188038', f: p => p.class === 'atm' || p.subclass === 'atm' || p.class === 'bank' },
    { id: 'masjid', n: 'Masjid', ic: 'mosque', c: '#0b8043', f: p => p.class === 'place_of_worship' && (p.subclass === 'muslim' || /masjid|mushol|musal|langgar|surau/i.test(p.name || '')) },
    { id: 'hotel', n: 'Hotel', ic: 'bed', c: '#c2185b', f: p => p.class === 'lodging' },
    { id: 'rs', n: 'Rumah sakit', ic: 'hosp', c: '#d93025', f: p => p.class === 'hospital' },
    { id: 'apotek', n: 'Apotek', ic: 'pill', c: '#c5221f', f: p => p.class === 'pharmacy' || /^(pharmacy|chemist)$/.test(p.subclass) },
    { id: 'parkir', n: 'Parkir', ic: 'parking', c: '#1967d2', q: 'parkir', f: p => /parking/.test(p.class) || /parking/.test(p.subclass) },
    { id: 'bengkel', n: 'Bengkel', ic: 'wrench', c: '#5f6368', q: 'bengkel', f: p => /repair|tyres|car_parts/.test(p.subclass) || (p.class === 'car' && p.subclass !== 'car') || /bengkel|tambal ban|ganti oli/i.test(p.name || '') },
    { id: 'spklu', n: 'SPKLU', ic: 'ev', c: '#00897b', q: 'spklu', f: p => p.subclass === 'charging_station' },
    { id: 'wisata', n: 'Wisata', ic: 'camera', c: '#9334e6', f: p => /^(attraction|viewpoint|museum|theme_park|zoo|aquarium|castle|monument)$/.test(p.subclass) || /^(attraction|museum|castle|monument)$/.test(p.class) },
    { id: 'toilet', n: 'Toilet', ic: 'wc', c: '#5f6368', q: 'toilet', f: p => p.subclass === 'toilets' || p.class === 'toilets' },
  ];
  const catOf = id => CATS.find(c => c.id === id);

  let tileTpl = null;
  function tileUrl(z, x, y) { return tileTpl ? tileTpl.replace('{z}', z).replace('{x}', x).replace('{y}', y) : null; }
  const tileCache = new Map();
  async function tilePois(z, x, y) {
    const k = z + '/' + x + '/' + y;
    if (tileCache.has(k)) return tileCache.get(k);
    const p = (async () => {
      const u = tileUrl(z, x, y); if (!u) return [];
      const r = await fetch(u);
      if (!r.ok) return [];
      const d = AM.MVT.decode(new Uint8Array(await r.arrayBuffer()), ['poi']);
      return (d.poi || []).map(f => {
        const ll = AM.MVT.toLngLat(z, x, y, f.x, f.y);
        const id = f.id ? ['', 'n', 'w', 'r'][f.id % 10] + Math.floor(f.id / 10) : null;
        return { id, name: f.props['name:latin'] || f.props.name || '', class: f.props.class, subclass: f.props.subclass, lng: ll[0], lat: ll[1] };
      });
    })().catch(() => []);
    tileCache.set(k, p);
    if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value);
    return p;
  }
  // tiles (z14) for a list of points with a corridor radius (m) — used along routes
  function tilesAround(points, radius, z = 14, cap = 120) {
    const set = new Map();
    for (const p of points) {
      const dLat = radius / 111000, dLng = radius / (111000 * Math.cos(p[1] * G.rad));
      const [x0, y0] = G.tile(p[0] - dLng, p[1] + dLat, z), [x1, y1] = G.tile(p[0] + dLng, p[1] - dLat, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set.set(x + ',' + y, [x, y]);
      if (set.size > cap) break;
    }
    return [...set.values()];
  }
  async function poolMap(items, n, fn) {
    const out = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
    return out;
  }

  // ---------- opening_hours (common OSM forms) ----------
  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], DID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  function parseOH(s) {
    s = String(s || '').trim();
    if (!s) return null;
    if (/^24\/7$/.test(s)) return { always: true, week: Array.from({ length: 7 }, () => [[0, 1440]]) };
    const week = Array.from({ length: 7 }, () => null);
    const rules = s.split(/\s*;\s*/);
    for (const rule of rules) {
      if (!rule) continue;
      let m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?)+)?\s*(.*)$/.exec(rule);
      if (!m) return null;
      let days = [];
      if (m[1]) {
        for (const part of m[1].split(',')) {
          if (!part || part === 'PH') continue;
          const [a, b] = part.split('-'), ia = DAYS.indexOf(a), ib = b ? DAYS.indexOf(b) : ia;
          if (ia < 0 || ib < 0) return null;
          for (let d = ia; ; d = (d + 1) % 7) { days.push(d); if (d === ib) break; }
        }
        if (!days.length && /PH/.test(m[1])) continue;
      } else days = [0, 1, 2, 3, 4, 5, 6];
      const t = m[2].trim();
      if (/^(off|closed|tutup)$/i.test(t)) { days.forEach(d => { week[d] = []; }); continue; }
      const iv = [];
      for (const r of t.split(/\s*,\s*/)) {
        const mm = /^(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})\+?$/.exec(r);
        if (!mm) return null;
        let a = +mm[1] * 60 + +mm[2], b = +mm[3] * 60 + +mm[4];
        if (b <= a) b += 1440;
        iv.push([a, b]);
      }
      days.forEach(d => { week[d] = iv; });
    }
    return { always: false, week };
  }
  function ohStatus(oh, now = new Date()) {
    const p = parseOH(oh);
    if (!p) return null;
    if (p.always) return { open: true, text: 'Buka 24 jam', p };
    const d = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    const check = (day, at) => (p.week[day] || []).find(([a, b]) => at >= a && at < b);
    let cur = check(d, mins), prev = check((d + 6) % 7, mins + 1440);
    if (cur || prev) {
      const end = cur ? cur[1] : prev[1] - 1440, left = end - mins;
      const hh = String(Math.floor((end % 1440) / 60)).padStart(2, '0') + '.' + String(end % 60).padStart(2, '0');
      return { open: true, soon: left <= 60, text: (left <= 60 ? 'Segera tutup · ' : 'Buka · ') + 'Tutup ' + hh, p };
    }
    for (let k = 0; k < 7; k++) {
      const day = (d + k) % 7, iv = (p.week[day] || []).filter(([a]) => k > 0 || a > mins).sort((x, y) => x[0] - y[0])[0];
      if (iv) {
        const hh = String(Math.floor(iv[0] / 60)).padStart(2, '0') + '.' + String(iv[0] % 60).padStart(2, '0');
        return { open: false, text: 'Tutup · Buka ' + (k === 0 ? '' : k === 1 ? 'besok ' : DID[day] + ' ') + hh, p };
      }
    }
    return { open: false, text: 'Tutup', p };
  }
  function ohTable(oh) {
    const p = parseOH(oh);
    if (!p) return null;
    const order = [1, 2, 3, 4, 5, 6, 0];
    const fmt = m => String(Math.floor((m % 1440) / 60)).padStart(2, '0') + '.' + String(m % 60).padStart(2, '0');
    return order.map(d => [DID[d], p.always ? '24 jam' : p.week[d] == null ? '–' : !p.week[d].length ? 'Tutup' : p.week[d].map(([a, b]) => a === 0 && b === 1440 ? '24 jam' : fmt(a) + '–' + fmt(b)).join(', ')]);
  }

  // Indonesia (rough box): results of other countries only when they really match the words typed
  const inID = ll => ll[0] > 94.5 && ll[0] < 141.5 && ll[1] > -11.5 && ll[1] < 6.5;
  // Photon (OpenStreetMap) and Overture places in one list: text match first, then distance; duplicates merged
  function merge(osm, ov, q, refs, o) {
    const OV = AM.OV, qt = OV.qTokens(q), qn = qt.join(' '), qfull = OV.normName(q), typing = !!o.typing, home = inID(refs[0]);
    const out = [];
    const near = ll => Math.min(...refs.map(r => G.dist(r, ll)));
    for (const r of osm) {
      const ll = [r.lng, r.lat], d = near(ll);
      let s = OV.score(OV.normName(r.name), qt, typing);
      if (r.addr) s = Math.max(s, OV.score(OV.normName(r.name + ' ' + r.addr), qt, typing) * 0.9);
      const area = /^(city|state|country|district|county|locality)$/.test(r.type || '') || r.key === 'place' || r.key === 'boundary';
      if (home && r.cc && r.cc !== 'ID' && s < 0.85) continue;            // Kuba / Portugal noise for an Indonesian query
      if (d > 300000 && s < 0.6 && !area) continue;
      if (s < 0.3 && !area && d > 30000) continue;
      const nn = OV.normName(r.name), exact = nn === qn || nn === qfull;
      out.push(Object.assign(r, { d, score: s, rank: s * 100 + (exact ? 12 : 0) + (nn === qfull ? 10 : 0) + (area && s > 0.9 ? 6 : 0) + 4 - Math.log2(1 + d / 400) * 4 }));
    }
    for (const r of ov) {
      const dup = out.find(x => x.src !== 'ov' && G.dist([x.lng, x.lat], [r.lng, r.lat]) < 150 && (OV.normName(x.name) === OV.normName(r.name) || OV.score(OV.normName(x.name), OV.qTokens(r.name), false) > 0.8));
      if (dup) { if (!dup.ov) { dup.ov = r.ov; if (!dup.addr) dup.addr = r.addr; } continue; }
      const nn = OV.normName(r.name), exact = nn === qn || nn.replace(/^(pt|cv|ud) /, '') === qn;
      out.push(Object.assign(r, { rank: r.score * 100 + (exact ? 12 : 0) + (nn === qfull ? 10 : 0) + (r.conf || 0) * 8 - Math.log2(1 + r.d / 400) * 4 }));
    }
    out.sort((a, b) => b.rank - a.rank);
    return out.slice(0, o.limit || 10);
  }

  const Q = AM.Q = {
    CATS, catOf, catLabel, iconOf, parseOH, ohStatus, ohTable,
    setTiles(tpl) { tileTpl = tpl; },
    tileTpl: () => tileTpl,
    norm(f) {
      const p = f.properties || {}, c = f.geometry.coordinates;
      const st = p.street ? p.street + (p.housenumber ? ' No. ' + p.housenumber : '') : '';
      const name = p.name || st || p.district || p.city || p.county || p.state || 'Tanpa nama';
      const parts = [];
      for (const x of [st, p.district || p.locality, p.city, p.county !== p.city ? p.county : '', p.state]) if (x && x !== name && !parts.includes(x)) parts.push(x);
      return {
        id: (p.osm_type || '') + (p.osm_id || ''), name, cat: catLabel(p.osm_key, p.osm_value, p.type), ic: iconOf(p.osm_key, p.osm_value),
        key: p.osm_key, val: p.osm_value, addr: parts.join(', '), lng: c[0], lat: c[1], ext: p.extent || null,
        osm: p.osm_type ? { t: p.osm_type, id: p.osm_id } : null, type: p.type, pc: p.postcode || '', cc: (p.countrycode || '').toUpperCase()
      };
    },
    // everything for a typed name: OpenStreetMap (Photon) + Overture business listings near the map / the user.
    // o: {zoom, user, typing, limit, rings, signal, onUpdate(list)} → final list
    async find(q, ref, o = {}) {
      const refs = [ref];
      if (o.user && G.dist(o.user, ref) > 3000) refs.push(o.user);
      let osm = [], ov = [], err = null;
      const upd = () => { if (o.onUpdate && !(o.signal && o.signal.aborted)) o.onUpdate(merge(osm.slice(), ov.slice(), q, refs, o)); };
      const a = Q.suggest(q, ref, { zoom: o.zoom, limit: o.typing ? 8 : 16, signal: o.signal, timeout: o.timeout })
        .then(r => { osm = r; upd(); }).catch(e => { err = e; });
      const b = AM.OV ? AM.OV.search(q, refs, { rings: o.rings, typing: o.typing, signal: o.signal, onUpdate: r => { ov = r; upd(); } })
        .then(r => { ov = r; }).catch(() => { }) : Promise.resolve();
      await Promise.all([a, b]);
      if (o.signal && o.signal.aborted) throw err || new DOMException('aborted', 'AbortError');
      const res = merge(osm, ov, q, refs, o);
      if (!res.length && err) throw err;
      return res;
    },
    async suggest(q, near, o = {}) {
      const u = new URL(PHOTON + '/api/');
      u.searchParams.set('q', q); u.searchParams.set('limit', o.limit || 8);
      if (near) { u.searchParams.set('lat', near[1].toFixed(5)); u.searchParams.set('lon', near[0].toFixed(5)); u.searchParams.set('zoom', Math.round(o.zoom || 12)); u.searchParams.set('location_bias_scale', '0.35'); }
      if (o.bbox) u.searchParams.set('bbox', o.bbox.map(v => v.toFixed(4)).join(','));
      if (o.tag) u.searchParams.set('osm_tag', o.tag);
      const d = await U.json(u.href, { timeout: o.timeout || 9000, signal: o.signal });
      const seen = new Set();
      return (d.features || []).map(Q.norm).filter(r => { const k = r.name + '|' + r.addr; if (seen.has(k)) return false; seen.add(k); return true; });
    },
    async reverse(ll) {
      try {
        const d = await U.json(PHOTON + '/reverse?lat=' + ll[1].toFixed(6) + '&lon=' + ll[0].toFixed(6) + '&limit=1&radius=0.2', { timeout: 7000 });
        if (d.features && d.features.length) return Q.norm(d.features[0]);
      } catch (e) { /* fall through */ }
      try {
        const d = await U.json(NOMI + '/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=id&lat=' + ll[1] + '&lon=' + ll[0], { timeout: 8000 });
        if (d && d.lat) {
          const a = d.address || {};
          return { id: (d.osm_type || '')[0] + d.osm_id, name: d.name || a.road || a.village || a.suburb || d.display_name.split(',')[0], cat: catLabel(d.category, d.type), ic: iconOf(d.category, d.type),
            addr: [a.road, a.village || a.suburb, a.city || a.town || a.county, a.state].filter(Boolean).join(', '), lng: +d.lon, lat: +d.lat, osm: d.osm_type ? { t: d.osm_type[0].toUpperCase(), id: d.osm_id } : null };
        }
      } catch (e) { /* none */ }
      return null;
    },
    // extra tags of an OSM object: opening hours, phone, website… (Nominatim lookup, Overpass as fallback)
    async details(osm) {
      if (!osm || !osm.id) return null;
      const t = String(osm.t || 'N')[0].toUpperCase();
      try {
        const d = await U.json(NOMI + '/lookup?format=jsonv2&extratags=1&addressdetails=1&namedetails=1&accept-language=id&osm_ids=' + t + osm.id, { timeout: 8000 });
        if (Array.isArray(d) && d[0]) return Object.assign({}, d[0].extratags || {}, { _addr: d[0].address || {}, _name: (d[0].namedetails || {}).name || d[0].name });
      } catch (e) { /* try Overpass */ }
      try {
        const type = { N: 'node', W: 'way', R: 'relation' }[t];
        const d = await Q.overpass('[out:json][timeout:10];' + type + '(' + osm.id + ');out tags;', 9000);
        return (d.elements && d.elements[0] && d.elements[0].tags) || null;
      } catch (e) { return null; }
    },
    // Overpass: own proxy first (some mobile networks get 406 from the public servers), then the mirrors directly
    async overpass(q, timeout = 25000) {
      const tries = [() => U.json(OSM_FN, { method: 'POST', body: JSON.stringify({ q }), headers: { 'Content-Type': 'application/json' }, timeout })]
        .concat(OVERPASS.map(ep => () => U.json(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout })));
      let err;
      for (const t of tries) { try { const d = await t(); if (d && d.elements) return d; } catch (e) { err = e; } }
      throw err || new Error('overpass');
    },
    // nearby POIs of a category around `center` inside `bounds` (z14 tiles, at most 5×5)
    async nearby(cat, center, bounds, max = 80) {
      const z = 14;
      let [x0, y0] = G.tile(bounds[0], bounds[3], z), [x1, y1] = G.tile(bounds[2], bounds[1], z);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 25) { const [cx, cy] = G.tile(center[0], center[1], z); x0 = cx - 2; x1 = cx + 2; y0 = cy - 2; y1 = cy + 2; }
      const tiles = [];
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
      const lists = await poolMap(tiles, 6, ([x, y]) => tilePois(z, x, y));
      const seen = new Set(), out = [];
      for (const l of lists) for (const p of l) {
        if (!cat.f(p)) continue;
        const k = p.id || p.lng.toFixed(5) + p.lat.toFixed(5);
        if (seen.has(k)) continue; seen.add(k);
        out.push(Object.assign(p, { d: G.dist(center, [p.lng, p.lat]) }));
      }
      out.sort((a, b) => a.d - b.d);
      return out.slice(0, max);
    },
    // POIs of a category close to a route (corridor radius m) over the first `upto` m of the shape
    async alongTiles(cat, coords, cum, radius, from = 0, upto = 30000) {
      const s1 = Math.min(cum[cum.length - 1], from + upto), pts = [];
      for (let s = from; s <= s1; s += 600) pts.push(G.at(coords, cum, s).pt);
      const tiles = tilesAround(pts, radius + 50);
      const lists = await poolMap(tiles, 6, ([x, y]) => tilePois(14, x, y));
      const seen = new Set(), out = [];
      for (const l of lists) for (const p of l) {
        if (!cat.f(p)) continue;
        const k = p.id || p.lng.toFixed(5) + p.lat.toFixed(5);
        if (seen.has(k)) continue; seen.add(k);
        out.push(p);
      }
      return out;
    },
    tilePois,
  };
})();
