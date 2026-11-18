#!/usr/bin/env python3
"""Amatu Maps · build data/poi/ (SPBU, rest areas, EV charging for Indonesia) from OpenStreetMap.

Input: GeoJSON sequence written by
    osmium tags-filter indonesia.osm.pbf nwr/amenity=fuel nwr/amenity=charging_station nwr/highway=services nwr/highway=rest_area -o poi.osm.pbf
    osmium export poi.osm.pbf -f geojsonseq -a type,id -o poi.geojsonseq
or (fallback) an Overpass JSON file with `out center tags`.

Output (1° cells so a route only loads what it crosses):
    data/poi/index.json            {"v": date, "src": ..., "n": {...}, "cells": {"-8_110": [fuel, rest, charge], ...}, "brands": [...]}
    data/poi/<lat>_<lon>.json      {"f": [[lat, lon, brand, name, flags, id, no, oh], ...], "r": [[lat, lon, name, flags, id], ...],
                                    "c": [[lat, lon, name, flags, id], ...]}
Usage: build_poi.py <input> <outdir> [--overpass]
"""
import json, math, os, re, sys, datetime, collections

BRANDS = ['SPBU', 'Pertamina', 'Shell', 'BP', 'Vivo', 'TotalEnergies', 'Mobil', 'Petronas', 'Pertashop', 'AKR', 'Eceran']
B = {n: i for i, n in enumerate(BRANDS)}

# flags (fuel): 1 24h · 2 RON90 (Pertalite) · 4 RON92 (Pertamax) · 8 RON95+ (Turbo/V-Power) · 16 diesel (Solar/Dexlite)
#               32 LPG/CNG · 64 toilet · 128 ATM · 256 shop · 512 angin · 1024 cuci · 2048 outlet kecil
F24, F90, F92, F98, FD, FG, FWC, FATM, FSHOP, FAIR, FWASH, FMINI = 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048
NUM = re.compile(r'\b(\d{2})[.\s-]?(\d{3})[.\s-]?(\d{2,3})\b')
GENERIC = re.compile(r'^(spbu|spbu pertamina|pertamina|pom bensin|pom|shell|bp|vivo|total|gas station|fuel|bensin|pertashop|pertamini|spbn|spbe)$', re.I)


def yes(v):
    return str(v).lower() in ('yes', 'true', '1', 'only')


def brand_of(t):
    b = ' '.join(str(t.get(k, '')) for k in ('brand', 'operator', 'name', 'brand:wikidata', 'network')).lower()
    if 'pertashop' in b:
        return B['Pertashop']
    if 'pertamini' in b or 'eceran' in b or 'bensin botol' in b:
        return B['Eceran']
    if 'pertamina' in b:
        return B['Pertamina']
    if re.search(r'\bshell\b', b):
        return B['Shell']
    if re.search(r'\bbp\b|bp-akr|bp akr', b):
        return B['BP']
    if re.search(r'\bvivo\b', b):
        return B['Vivo']
    if 'totalenergies' in b or re.search(r'\btotal\b', b):
        return B['TotalEnergies']
    if 'exxon' in b or str(t.get('brand', '')).strip().lower() == 'mobil':
        return B['Mobil']
    if 'petronas' in b:
        return B['Petronas']
    if re.search(r'\bakr\b', b):
        return B['AKR']
    if NUM.search(str(t.get('name', '')) + ' ' + str(t.get('ref', ''))):
        return B['Pertamina']          # SPBU numbers like 44.561.15 are Pertamina's
    return B['SPBU']


def flags_fuel(t):
    f = 0
    oh = str(t.get('opening_hours', '')).strip()
    if oh in ('24/7', 'Mo-Su 00:00-24:00', '00:00-24:00') or yes(t.get('24/7', '')):
        f |= F24
    for k, v in t.items():
        if not k.startswith('fuel:') or not yes(v):
            continue
        k = k[5:].lower()
        if k in ('octane_90', 'octane_88', 'pertalite', 'premium', 'octane_89'):
            f |= F90
        elif k in ('octane_92', 'pertamax', 'octane_91', 'shell_super', 'bp_92', 'revvo_92'):
            f |= F92
        elif k in ('octane_95', 'octane_98', 'octane_100', 'pertamax_turbo', 'pertamax_racing', 'shell_vpower', 'v-power', 'revvo_95'):
            f |= F98
        elif 'diesel' in k or k in ('solar', 'biosolar', 'dexlite', 'pertamina_dex', 'hgv_diesel', 'b30', 'b35', 'b40'):
            f |= FD
        elif k in ('lpg', 'cng', 'lng', 'bbg'):
            f |= FG
    if yes(t.get('toilets', '')):
        f |= FWC
    if yes(t.get('atm', '')):
        f |= FATM
    if t.get('shop') and t.get('shop') != 'no':
        f |= FSHOP
    if yes(t.get('compressed_air', '')):
        f |= FAIR
    if yes(t.get('car_wash', '')):
        f |= FWASH
    if brand_of(t) in (B['Pertashop'], B['Eceran']):
        f |= FMINI
    return f


def num_of(t):
    m = NUM.search(str(t.get('ref', '')) + ' ' + str(t.get('name', '')))
    return '%s.%s.%s' % m.groups() if m else ''


def centre(g):
    """GeoJSON geometry → (lon, lat) representative point."""
    if not g:
        return None
    ty, c = g.get('type'), g.get('coordinates')
    if ty == 'Point':
        return c[0], c[1]
    if ty == 'LineString':
        return c[len(c) // 2]
    if ty == 'MultiLineString':
        return c[0][len(c[0]) // 2]
    if ty == 'Polygon':
        return ring_centre(c[0])
    if ty == 'MultiPolygon':
        best = max(c, key=lambda p: abs(ring_area(p[0])))
        return ring_centre(best[0])
    return None


def ring_area(r):
    return sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1)) / 2


def ring_centre(r):
    a = ring_area(r)
    if abs(a) < 1e-14:
        return sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)
    cx = cy = 0.0
    for i in range(len(r) - 1):
        k = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
        cx += (r[i][0] + r[i + 1][0]) * k
        cy += (r[i][1] + r[i + 1][1]) * k
    return cx / (6 * a), cy / (6 * a)


def read_osmium(path):
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip().lstrip('\x1e')
            if not line:
                continue
            f = json.loads(line)
            p = f.get('properties') or {}
            ty, oid = p.pop('@type', ''), p.pop('@id', '')
            c = centre(f.get('geometry'))
            if c:
                yield (ty[:1] or 'n') + str(oid), c[0], c[1], p


def read_overpass(path):
    d = json.load(open(path, encoding='utf-8'))
    for e in d.get('elements', []):
        if e['type'] == 'node':
            lon, lat = e.get('lon'), e.get('lat')
        else:
            c = e.get('center') or {}
            lon, lat = c.get('lon'), c.get('lat')
        if lon is None:
            continue
        yield e['type'][0] + str(e['id']), lon, lat, e.get('tags') or {}


def clean(s, n=60):
    s = re.sub(r'\s+', ' ', str(s or '')).strip()
    return s[:n]


def main():
    src, out = sys.argv[1], sys.argv[2]
    rows = read_overpass(src) if '--overpass' in sys.argv else read_osmium(src)
    cells = collections.defaultdict(lambda: {'f': [], 'r': [], 'c': []})
    seen = {}
    n = collections.Counter()
    for oid, lon, lat, t in rows:
        if not (-12 <= lat <= 7 and 94 <= lon <= 142):     # Indonesia's box (the extract has border spill-over)
            continue
        kind = None
        if t.get('amenity') == 'fuel':
            kind = 'f'
        elif t.get('amenity') == 'charging_station':
            kind = 'c'
        elif t.get('highway') in ('services', 'rest_area'):
            kind = 'r'
        if not kind:
            continue
        la, lo = round(lat, 5), round(lon, 5)
        # node + area mapped for the same station: keep one (same kind within ~35 m)
        key = (kind, round(lat * 300), round(lon * 300))
        if key in seen and oid[0] != 'n':
            continue
        seen[key] = oid
        cell = '%d_%d' % (math.floor(lat), math.floor(lon))
        name = clean(t.get('name') or t.get('name:id') or t.get('brand') or '')
        if kind == 'f':
            b = brand_of(t)
            nm = '' if GENERIC.match(name) else name
            oh = clean(t.get('opening_hours', ''), 60)
            if oh in ('24/7',):
                oh = ''
            cells[cell]['f'].append([la, lo, b, nm, flags_fuel(t), oid, num_of(t), oh])
        elif kind == 'r':
            fl = (1 if yes(t.get('fuel', '')) or t.get('highway') == 'services' else 0) | (64 if yes(t.get('toilets', '')) else 0)
            cells[cell]['r'].append([la, lo, name, fl | (4096 if t.get('highway') == 'services' else 0), oid])
        else:
            op = clean(t.get('operator') or t.get('brand') or '', 40)
            cells[cell]['c'].append([la, lo, name or op, 0, oid])
        n[kind] += 1
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.json'):
            os.remove(os.path.join(out, f))
    idx = {}
    for cell, v in sorted(cells.items()):
        for k in v:
            v[k].sort(key=lambda r: (r[0], r[1]))
        with open(os.path.join(out, cell + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(v, fh, ensure_ascii=False, separators=(',', ':'))
        idx[cell] = [len(v['f']), len(v['r']), len(v['c'])]
    meta = {
        'v': datetime.date.today().isoformat(),
        'src': '© OpenStreetMap contributors (ODbL) via Geofabrik' if '--overpass' not in sys.argv else '© OpenStreetMap contributors (ODbL) via Overpass',
        'n': {'f': n['f'], 'r': n['r'], 'c': n['c']},
        'brands': BRANDS,
        'cells': idx,
    }
    with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, separators=(',', ':'))
    print('SPBU %d · rest area %d · SPKLU %d · %d cells' % (n['f'], n['r'], n['c'], len(idx)))
    if n['f'] < 1000:
        sys.exit('too few fuel stations — refusing to publish')


if __name__ == '__main__':
    main()
