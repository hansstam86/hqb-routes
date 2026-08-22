// Turns the raw Overpass dump into (a) slim thematic GeoJSON for drawing and
// (b) a walking graph so routes follow real paths instead of straight lines.
import fs from 'node:fs';
import path from 'node:path';
import osmtogeojson from 'osmtogeojson';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'site', 'data');
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hqb.osm.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const round = (c) => (Array.isArray(c[0]) ? c.map(round) : [r6(c[0]), r6(c[1])]);

/* ------------------------------------------------ 1. basemap layers */

// Built before osmtogeojson, which mutates the element array it is handed.
const LINE_BY_WAY = new Map();      // way id -> { ref, colour }
for (const r of raw.elements) {
  if (r.type !== 'relation' || r.tags?.route !== 'subway' || !r.tags.ref) continue;
  const info = { ref: r.tags.ref, colour: r.tags.colour || r.tags.color || '#6b7280' };
  for (const m of r.members ?? []) {
    if (m.type === 'way' && !LINE_BY_WAY.has(m.ref)) LINE_BY_WAY.set(m.ref, info);
  }
}

// Station areas are tagged building=train_station and carry no line information,
// so work out which lines serve each one here, before the element array is mutated.
const STATION_LINES = new Map();    // station name without the 站 suffix -> [colour, ...]
{
  const byId = new Map();
  for (const e of raw.elements) if (e.type === 'node' && !byId.has(e.id)) byId.set(e.id, e);
  const stns = [...byId.values()].filter((n) => n.tags && (n.tags.railway === 'station' || n.tags.station === 'subway'));
  const dist = (a, b) => Math.hypot((a.lon - b.lon) * 102800, (a.lat - b.lat) * 111000);
  const perNode = new Map();
  const cols = new Map();
  for (const r of raw.elements) {
    if (r.type !== 'relation' || r.tags?.route !== 'subway' || !r.tags.ref) continue;
    cols.set(r.tags.ref, r.tags.colour || r.tags.color || '#6b7280');
    for (const m of r.members ?? []) {
      if (m.role !== 'stop') continue;
      const sp = byId.get(m.ref);
      if (!sp) continue;
      let best = null, bd = 200;
      for (const st of stns) { const d = dist(sp, st); if (d < bd) { bd = d; best = st; } }
      if (best) {
        if (!perNode.has(best.id)) perNode.set(best.id, new Set());
        perNode.get(best.id).add(r.tags.ref);
      }
    }
  }
  for (const st of stns) {
    const key = (st.tags.name || '').replace(/[\u200e\u200f]/g, '').replace(/站$/, '').trim();
    if (!key) continue;
    const set = new Set([...(STATION_LINES.get(key) ?? []).keys()]);
    const refs = [...(perNode.get(st.id) ?? [])];
    const merged = new Set([...(STATION_LINES.get(key) ?? []), ...refs.map((r) => cols.get(r) || '#6b7280')]);
    STATION_LINES.set(key, [...merged]);
  }
}

const gj = osmtogeojson(raw, { flatProperties: true });
console.log(`osm elements ${raw.elements.length} -> features ${gj.features.length}`);

const ROAD_CLASS = {
  motorway: 'major', motorway_link: 'major', trunk: 'major', trunk_link: 'major',
  primary: 'primary', primary_link: 'primary',
  secondary: 'secondary', secondary_link: 'secondary',
  tertiary: 'tertiary', tertiary_link: 'tertiary', unclassified: 'tertiary',
  residential: 'minor', living_street: 'minor', service: 'minor',
  pedestrian: 'foot', footway: 'foot', path: 'foot', steps: 'foot', corridor: 'foot',
  cycleway: 'cycle',
};
const FOOD = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream']);

function poiClass(t) {
  if (t.railway === 'subway_entrance') return 'exit';
  if (t.railway === 'station' || t.station === 'subway' || t.public_transport === 'station') return 'station';
  if (t.shop === 'mall' || t.shop === 'department_store' || t.building === 'retail') return 'mall';
  if (t.shop === 'electronics' || t.shop === 'computer' || t.shop === 'mobile_phone') return 'electronics';
  if (t.tourism === 'hotel' || t.tourism === 'hostel') return 'hotel';
  if (FOOD.has(t.amenity)) return 'food';
  if (t.amenity === 'toilets') return 'toilets';
  if (t.amenity === 'bank' || t.amenity === 'atm') return 'money';
  if (t.shop) return 'shop';
  if (t.amenity) return 'amenity';
  return null;
}

const centroid = (g) => {
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0];
  if (!ring?.length) return null;
  let x = 0, y = 0;
  for (const [a, b] of ring) { x += a; y += b; }
  return [r6(x / ring.length), r6(y / ring.length)];
};

const layers = { water: [], green: [], buildings: [], roads: [], rail: [], pois: [] };

// Keep the two scripts apart. OSM's plain `name` here is usually Chinese, but not
// always, so decide by what the string actually contains rather than assuming.
const HAN = /[\u4e00-\u9fff]/;
function nm(t) {
  const zh = t['name:zh'] || (t.name && HAN.test(t.name) ? t.name : null);
  const en = t['name:en'] || t.int_name || (t.name && !HAN.test(t.name) ? t.name : null);
  return { name: t.name || zh || en || null, zh: zh || null, en: en || null };
}

for (const f of gj.features) {
  const t = f.properties || {}, g = f.geometry;
  if (!g?.coordinates) continue;
  g.coordinates = round(g.coordinates);
  const area = g.type === 'Polygon' || g.type === 'MultiPolygon';
  const line = g.type === 'LineString' || g.type === 'MultiLineString';
  // e.g. "way/123456" -- the key a custom name is filed under.
  const oid = String(f.id ?? t.id ?? '');
  const put = (k, p) => layers[k].push({ type: 'Feature', properties: { oid, ...p }, geometry: g });

  if (area && (t.natural === 'water' || t.waterway || t.landuse === 'reservoir')) put('water', {});
  else if (area && (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'pitch'
    || t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.natural === 'wood')) put('green', {});
  else if (area && t.building) {
    // A station area gets the colours of the lines that serve it, so its outline
    // can be drawn the way the network map draws it.
    const isStation = t.building === 'train_station' || t.public_transport === 'station';
    const cols = isStation
      ? (STATION_LINES.get(String(t.name || '').replace(/站$/, '').trim()) ?? [])
      : [];
    put('buildings', {
      ...nm(t),
      levels: t['building:levels'] ? +t['building:levels'] : null,
      ...(isStation ? { station: 1 } : {}),
      ...(cols[0] ? { c1: cols[0] } : {}),
      ...(cols[1] ? { c2: cols[1] } : {}),
      ...(cols[2] ? { c3: cols[2] } : {}),
    });
  }
  else if (line && (t.railway === 'subway' || t.railway === 'rail')) {
    const info = LINE_BY_WAY.get(Number(String(oid).split('/')[1]));
    put('rail', { line: info?.ref ?? null, colour: info?.colour ?? '#b6afa3' });
  }
  else if (line && ROAD_CLASS[t.highway]) {
    put('roads', { cls: ROAD_CLASS[t.highway], ...nm(t), tunnel: t.tunnel && t.tunnel !== 'no' ? 1 : 0 });
  }

  const cls = poiClass(t);
  const label = nm(t).name;
  if (cls && label) {
    const at = g.type === 'Point' ? g.coordinates : area ? centroid(g) : null;
    if (at) layers.pois.push({ type: 'Feature', properties: { oid, ...nm(t), cls }, geometry: { type: 'Point', coordinates: at } });
  }
}

for (const [k, features] of Object.entries(layers)) {
  const file = path.join(OUT, `${k}.geojson`);
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`  ${k.padEnd(10)} ${String(features.length).padStart(5)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

/* ------------------------------------------------ 1b. transit

   Exits carry the letter people actually navigate by ("come out exit D1"), and
   stations carry the lines that serve them. Neither is tagged directly the way we
   need it, so both are derived here rather than in the browser. */

const M_LNG = 102800, M_LAT = 111000;
const metres = (a, b) => Math.hypot((a[0] - b[0]) * M_LNG, (a[1] - b[1]) * M_LAT);

// osmtogeojson mutates the element array it is handed, leaving duplicate node
// entries behind, so index by id first and read everything back off that.
const nodeById = new Map();
for (const e of raw.elements) if (e.type === 'node' && !nodeById.has(e.id)) nodeById.set(e.id, e);
const allNodes = [...nodeById.values()];
const stationNodes = allNodes.filter((e) => e.tags && (e.tags.railway === 'station' || e.tags.station === 'subway'));
const entrances = allNodes.filter((e) => e.tags && e.tags.railway === 'subway_entrance');
const subwayRels = raw.elements.filter((e) => e.type === 'relation' && e.tags?.route === 'subway');

// A line's "stop" members are bare positions on the track, so the only way to say
// which line serves which station is to match each stop to the station beside it.
const linesAt = new Map();          // station node id -> Set of line refs
const lineColour = new Map();
for (const r of subwayRels) {
  const ref = r.tags.ref;
  if (!ref) continue;
  lineColour.set(ref, r.tags.colour || r.tags.color || '#666');
  for (const mem of r.members ?? []) {
    if (mem.role !== 'stop') continue;
    const sp = nodeById.get(mem.ref);
    if (!sp) continue;
    let best = null, bd = 200;
    for (const st of stationNodes) {
      const d = metres([sp.lon, sp.lat], [st.lon, st.lat]);
      if (d < bd) { bd = d; best = st; }
    }
    if (best) {
      if (!linesAt.has(best.id)) linesAt.set(best.id, new Set());
      linesAt.get(best.id).add(ref);
    }
  }
}

// One station is several OSM nodes (one per platform); collapse them by name.
const stationGroups = new Map();
for (const st of stationNodes) {
  const key = (st.tags.name || '').replace(/[\u200e\u200f]/g, '').trim();
  if (!key) continue;
  if (!stationGroups.has(key)) stationGroups.set(key, []);
  stationGroups.get(key).push(st);
}

const transit = [];
const stationAt = [];               // for assigning exits to a station, and its colour
for (const [name, group] of stationGroups) {
  const at = [
    r6(group.reduce((a, n) => a + n.lon, 0) / group.length),
    r6(group.reduce((a, n) => a + n.lat, 0) / group.length),
  ];
  const lines = [...new Set(group.flatMap((n) => [...(linesAt.get(n.id) ?? [])]))]
    .sort((a, b) => Number(a) - Number(b));
  const t = group[0].tags;
  stationAt.push({ name, at, colour: lines.length ? (lineColour.get(lines[0]) || '#1c7a4a') : '#1c7a4a' });
  transit.push({
    type: 'Feature',
    properties: {
      oid: `node/${group[0].id}`, kind: 'station', name,
      zh: t['name:zh'] || name, en: t['name:en'] || null,
      lines: lines.join(','), colours: lines.map((l) => lineColour.get(l) || '#666').join(','),
    },
    geometry: { type: 'Point', coordinates: at },
  });
}

// The 1-17 series north of 振华路 (lat 22.5471) is tagged railway=subway_entrance
// but carries nothing except a number, sits 135-305m from any station, and runs in
// two columns up 华强北路. It does not correspond to anything on the ground, so it
// is dropped rather than drawn as metro access.
const ZHENGHUA_LAT = 22.5472;
const bogusEntrance = (ref, lat) => /^\d+$/.test(ref) && lat > ZHENGHUA_LAT;

let dropped = 0;
for (const e of entrances) {
  const at = [r6(e.lon), r6(e.lat)];
  const ref = (e.tags.ref || e.tags.name || '').trim() || '?';
  if (bogusEntrance(ref, e.lat)) { dropped++; continue; }
  let station = null, colour = '#1c7a4a', bd = 600;
  for (const s of stationAt) {
    const d = metres(at, s.at);
    if (d < bd) { bd = d; station = s.name; colour = s.colour; }
  }
  // Lettered exits sit 37-214m from their station and clearly belong to it. The
  // numbered series runs the length of 华强北路 between two stations, tagged with
  // nothing but its number -- most likely entrances to the underground street.
  // Guessing a station for those would put a wrong line colour on the map, so
  // they stay neutral and unattributed.
  if (/^\d+$/.test(ref)) { station = null; colour = '#1c7a4a'; }
  transit.push({
    type: 'Feature',
    properties: {
      oid: `node/${e.id}`, kind: 'exit', ref,
      station: station || '', colour,
    },
    geometry: { type: 'Point', coordinates: at },
  });
}

{
  const file = path.join(OUT, 'transit.geojson');
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: transit }));
  const st = transit.filter((f) => f.properties.kind === 'station').length;
  console.log(`  transit    ${String(transit.length).padStart(5)}  (${st} stations, ${transit.length - st} exits`
    + `${dropped ? `, ${dropped} unmapped numbered entrances dropped` : ''})  `
    + `${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

/* ------------------------------------------------ 2. walking graph */

// Footways and small streets are the real walking network. Big roads are included
// only so the graph stays connected -- they carry a cost penalty so the router
// prefers alleys and uses Shennan-scale roads only when there is no alternative.
const WALK_COST = {
  footway: 1, pedestrian: 1, path: 1, corridor: 1, steps: 1.6,
  living_street: 1.1, residential: 1.2, service: 1.2, unclassified: 1.3,
  tertiary: 1.5, secondary: 2.2, secondary_link: 2.2,
  primary: 3.5, primary_link: 3.5, trunk: 4.5, trunk_link: 4.5,
};

const nodePos = new Map();
for (const e of raw.elements) if (e.type === 'node') nodePos.set(e.id, [e.lon, e.lat]);

const idx = new Map();
const xy = [];
const edges = [];
const cost = [];          // per-edge multiplier, parallel to edges/2
const useNode = (id) => {
  if (idx.has(id)) return idx.get(id);
  const p = nodePos.get(id);
  if (!p) return -1;
  const i = xy.length / 2;
  xy.push(r6(p[0]), r6(p[1]));
  idx.set(id, i);
  return i;
};

for (const e of raw.elements) {
  if (e.type !== 'way' || !e.tags || !e.nodes) continue;
  const w = WALK_COST[e.tags.highway];
  if (!w) continue;
  if (e.tags.access === 'private' || e.tags.foot === 'no') continue;
  for (let i = 1; i < e.nodes.length; i++) {
    const a = useNode(e.nodes[i - 1]), b = useNode(e.nodes[i]);
    if (a >= 0 && b >= 0 && a !== b) { edges.push(a, b); cost.push(w); }
  }
}

const adj = Array.from({ length: xy.length / 2 }, () => []);
for (let i = 0; i < edges.length; i += 2) { adj[edges[i]].push(edges[i + 1]); adj[edges[i + 1]].push(edges[i]); }
const seen = new Int8Array(adj.length);
let best = 0;
for (let s = 0; s < adj.length; s++) {
  if (seen[s]) continue;
  let n = 0; const stack = [s]; seen[s] = 1;
  while (stack.length) { const v = stack.pop(); n++; for (const w of adj[v]) if (!seen[w]) { seen[w] = 1; stack.push(w); } }
  best = Math.max(best, n);
}

const gfile = path.join(OUT, 'walkgraph.json');
fs.writeFileSync(gfile, JSON.stringify({ xy, edges, cost }));
console.log(`\n  walkgraph  ${xy.length / 2} nodes, ${edges.length / 2} edges, `
  + `largest component ${best} (${((best / (xy.length / 2)) * 100).toFixed(0)}%)  `
  + `${(fs.statSync(gfile).size / 1024).toFixed(0)} KB`);
