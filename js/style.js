// Amatu Maps · map style: OpenFreeMap "liberty" + own night palette, satellite (Esri), terrain (AWS Terrarium),
// 3D buildings, transit & bike highlights. One style for every mode, so overlays never have to be re-added:
// switching day/night or base map only changes paint/visibility of the base layers.
(function () {
  'use strict';
  const AM = window.AM = window.AM || {};
  const BASE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  const SAT = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];
  const DEM = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];

  const N = {
    bg: '#1b2430', res: '#202a37', park: '#1c3227', parkO: '#24402f', wood: 'rgba(30,56,41,0.8)', grass: '#1e3529', ice: '#283240', sand: '#2a2e33',
    pitch: '#22312c', cem: '#21302a', hosp: '#2c2532', school: '#282d27', water: '#0d1c2f', waterway: '#15304c', aero: '#27303c', runway: '#37414e',
    bld: '#273140', bldO: '#212934', b3d: '#2b3646', minor: '#313b49', case: '#161d26', sec: '#3c4656', pri: '#485162', mot: '#76643f', motC: '#28221a',
    path: '#394351', rail: '#4a5262', bnd: '#56657a',
    txt: '#c4ccd6', city: '#e8edf3', road: '#9ea8b5', poi: '#d3a06a', wtxt: '#6c8fb6', halo: '#111822'
  };
  // base layer id → night paint (first match wins; symbols handled separately)
  const NIGHT = [
    [/^background$/, { 'background-color': N.bg }],
    [/^natural_earth$/, { 'raster-brightness-max': 0.32, 'raster-saturation': -0.5 }],
    [/^park$/, { 'fill-color': N.park, 'fill-outline-color': N.parkO }],
    [/^park_outline$/, { 'line-color': N.parkO }],
    [/landuse_residential/, { 'fill-color': N.res }],
    [/landcover_wood/, { 'fill-color': N.wood }],
    [/landcover_grass/, { 'fill-color': N.grass }],
    [/landcover_ice/, { 'fill-color': N.ice }],
    [/landuse_(pitch|track)/, { 'fill-color': N.pitch }],
    [/landuse_cemetery/, { 'fill-color': N.cem }],
    [/landuse_hospital/, { 'fill-color': N.hosp }],
    [/landuse_school/, { 'fill-color': N.school }],
    [/^waterway_(tunnel|river|other)$/, { 'line-color': N.waterway }],
    [/^water$/, { 'fill-color': N.water }],
    [/landcover_sand/, { 'fill-color': N.sand }],
    [/aeroway_fill/, { 'fill-color': N.aero }],
    [/aeroway_(runway|taxiway)/, { 'line-color': N.runway }],
    [/motorway.*casing/, { 'line-color': N.motC }],
    [/casing/, { 'line-color': N.case }],
    [/motorway/, { 'line-color': N.mot }],
    [/trunk_primary/, { 'line-color': N.pri }],
    [/secondary_tertiary/, { 'line-color': N.sec }],
    [/_link$/, { 'line-color': N.sec }],
    [/minor|street|service_track/, { 'line-color': N.minor }],
    [/path_pedestrian/, { 'line-color': N.path }],
    [/rail/, { 'line-color': N.rail }],
    [/^building$/, { 'fill-color': N.bld, 'fill-outline-color': N.bldO }],
    [/^building-3d$/, { 'fill-extrusion-color': N.b3d }],
    [/^boundary/, { 'line-color': N.bnd }],
  ];
  function symNight(id) {
    if (/^label_(city|country)/.test(id)) return { 'text-color': N.city, 'text-halo-color': N.halo };
    if (/^label_/.test(id)) return { 'text-color': N.txt, 'text-halo-color': N.halo };
    if (/^highway-name/.test(id)) return { 'text-color': N.road, 'text-halo-color': N.halo };
    if (/^(poi_|airport)/.test(id)) return { 'text-color': N.poi, 'text-halo-color': N.halo };
    if (/water/.test(id)) return { 'text-color': N.wtxt, 'text-halo-color': N.halo };
    return null;
  }
  function symSat(id) {
    if (/^(poi_|airport)/.test(id)) return { 'text-color': '#ffe2b8', 'text-halo-color': 'rgba(0,0,0,.8)' };
    if (/water/.test(id)) return { 'text-color': '#bfe0ff', 'text-halo-color': 'rgba(0,0,0,.7)' };
    return { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.78)' };
  }
  const isRoadLine = id => /^(road|bridge|tunnel)_/.test(id) && !/rail|hatching|area_pattern|arrow/.test(id);

  const S = AM.S = {
    beforeId: null,             // first label layer above the roads: overlays go under the labels
    async load() {
      let st = null;
      try { st = await AM.U.json(BASE_URL, { timeout: 12000 }); try { localStorage.setItem('pt.maps.style', JSON.stringify(st)); } catch (e) { /* full */ } }
      catch (e) { st = AM.U.get('pt.maps.style', null); if (!st) throw e; }
      return S.build(st);
    },
    build(st) {
      st = JSON.parse(JSON.stringify(st));
      // Google-like water
      for (const l of st.layers) {
        if (l.id === 'water') l.paint['fill-color'] = '#a7d3f6';
        if (/^waterway_(tunnel|river|other)$/.test(l.id)) l.paint['line-color'] = '#a7d3f6';
        if (l.id === 'building-3d') { l.layout = Object.assign({}, l.layout, { visibility: 'none' }); l.paint['fill-extrusion-opacity'] = 0.85; }
        // poi labels a little earlier (Google shows shops/mosques from z15)
        if (l.id === 'poi_r1') l.minzoom = 14.5;
      }
      st.sources.esri = { type: 'raster', tiles: SAT, tileSize: 256, maxzoom: 19, attribution: 'Citra © Esri, Maxar, Earthstar Geographics' };
      st.sources.dem = { type: 'raster-dem', tiles: DEM, tileSize: 256, maxzoom: 14, encoding: 'terrarium', attribution: 'Elevasi: AWS Terrain Tiles' };
      st.sources.demt = { type: 'raster-dem', tiles: DEM, tileSize: 256, maxzoom: 14, encoding: 'terrarium' };
      const bi = st.layers.findIndex(l => l.id === 'natural_earth');
      st.layers.splice(bi + 1, 0, { id: 'x-sat', type: 'raster', source: 'esri', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 150 } });
      const hi = st.layers.findIndex(l => l.id === 'waterway_tunnel');
      st.layers.splice(hi, 0, {
        id: 'x-hill', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#4d5a52', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#6b6b5a' }
      });
      const ri = st.layers.findIndex(l => l.id === 'building');
      st.layers.splice(ri, 0,
        { id: 'x-bike', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 11, layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
          filter: ['all', ['==', ['get', 'class'], 'path'], ['in', ['get', 'subclass'], ['literal', ['cycleway', 'bridleway']]]],
          paint: { 'line-color': '#1e8e3e', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 4], 'line-opacity': 0.9 } },
        { id: 'x-transit', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 8, layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
          filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
          paint: { 'line-color': ['match', ['get', 'class'], 'transit', '#e37400', '#7e57c2'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 15, 4.5], 'line-opacity': 0.9 } });
      // overlays (route etc.) go right below the first label above the roads
      const li = st.layers.findIndex(l => l.id === 'building');
      const lab = st.layers.slice(li).find(l => l.type === 'symbol' && l.id !== 'road_one_way_arrow' && l.id !== 'road_one_way_arrow_opposite');
      S.beforeId = lab ? lab.id : undefined;
      // remember day paint (the style as loaded) for every property the night/satellite modes touch
      S.day = {};
      for (const l of st.layers) {
        const night = l.type === 'symbol' ? symNight(l.id) : (NIGHT.find(r => r[0].test(l.id)) || [])[1];
        const keys = new Set(Object.keys(night || {}));
        if (l.type === 'symbol' && l.layout && l.layout['text-field']) { keys.add('text-color'); keys.add('text-halo-color'); }
        if (l.type === 'line') keys.add('line-opacity');
        S.day[l.id] = { type: l.type, vis: (l.layout && l.layout.visibility) || 'visible', p: {}, night: night || {} };
        keys.forEach(k => { S.day[l.id].p[k] = l.paint ? l.paint[k] : undefined; });
      }
      st.glyphs = st.glyphs || 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
      return st;
    },
    // o: {night, base: 'map'|'sat'|'terrain', labels, b3d, transit, bike}
    apply(map, o) {
      if (!S.day || !map.getStyle()) return;
      const sat = o.base === 'sat';
      const want = {};
      for (const id in S.day) {
        const d = S.day[id];
        if (!map.getLayer(id)) continue;
        let vis = d.vis, p = Object.assign({}, d.p);
        if (o.night) Object.assign(p, d.night);
        if (sat) {
          if (d.type === 'fill' || d.type === 'fill-extrusion' || id === 'natural_earth' || id === 'background') vis = id === 'background' ? 'visible' : 'none';
          if (d.type === 'line') {
            if (/casing|path_pedestrian|service_track|aeroway|park_outline|waterway/.test(id)) vis = 'none';
            else if (isRoadLine(id)) p['line-opacity'] = 0.55;
          }
          if (d.type === 'symbol' && d.p['text-color'] !== undefined) Object.assign(p, symSat(id));
        }
        if (d.type === 'symbol' && o.labels === false) vis = 'none';
        if (id === 'building-3d') vis = o.b3d && !sat ? 'visible' : 'none';
        if (id === 'building' && o.b3d && !sat) vis = 'none';
        want[id] = { vis, p };
      }
      for (const id in want) {
        const w = want[id], cur = S.cur && S.cur[id];
        if (!cur || cur.vis !== w.vis) map.setLayoutProperty(id, 'visibility', w.vis);
        for (const k in w.p) {
          if (cur && JSON.stringify(cur.p[k]) === JSON.stringify(w.p[k])) continue;
          try { map.setPaintProperty(id, k, w.p[k]); } catch (e) { /* property not valid for this layer */ }
        }
      }
      S.cur = want;
      const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      vis('x-sat', sat);
      vis('x-hill', o.base === 'terrain');
      vis('x-transit', !!o.transit);
      vis('x-bike', !!o.bike);
      if (map.getLayer('poi_transit')) map.setLayerZoomRange('poi_transit', o.transit ? 11 : 0, 24);
      if (map.getLayer('x-hill')) {
        map.setPaintProperty('x-hill', 'hillshade-shadow-color', o.night ? '#05080c' : '#4d5a52');
        map.setPaintProperty('x-hill', 'hillshade-highlight-color', o.night ? '#3b4757' : '#ffffff');
        map.setPaintProperty('x-hill', 'hillshade-accent-color', o.night ? '#1d2530' : '#6b6b5a');
      }
      if (map.getLayer('x-sat')) map.setPaintProperty('x-sat', 'raster-brightness-max', o.night ? 0.8 : 1);
      // 3D relief only in terrain mode with a tilted camera (keeps the flat map fast on phones)
      const terr = o.base === 'terrain' && map.getPitch() > 5;
      if (terr && !map.getTerrain()) map.setTerrain({ source: 'demt', exaggeration: 1.25 });
      else if (!terr && map.getTerrain()) map.setTerrain(null);
    },
    satThumb: (z, x, y) => SAT[0].replace('{z}', z).replace('{y}', y).replace('{x}', x),
  };
})();
