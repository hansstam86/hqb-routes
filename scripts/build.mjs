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
  else if (area && t.building) put('buildings', { ...nm(t), levels: t['building:levels'] ? +t['building:levels'] : null });
  else if (line && (t.railway === 'subway' || t.railway === 'rail')) put('rail', {});
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
