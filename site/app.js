import * as maplibregl from './vendor/maplibre-gl.mjs';   // v6 exports names, not a default
import { createRouter } from './router.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const EMPTY = { type: 'FeatureCollection', features: [] };
const COLORS = ['#c81e3a', '#1d4ed8', '#047857', '#b45309', '#7c3aed', '#0e7490'];
const WALK_M_PER_MIN = 70;          // ~4.2 km/h, allowing for Huaqiangbei crowds

const uid = () => (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now());
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------------------------------------------------------- basemap */

const OSM_ATTRIB = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const geo = (n) => ({ type: 'geojson', data: `./data/${n}.geojson`, attribution: OSM_ATTRIB });
const road = (id, cls, stops, color, extra = {}) => ({
  id, type: 'line', source: 'roads', filter: ['==', ['get', 'cls'], cls],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': color, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], ...stops], ...extra },
});

const style = {
  version: 8,
  glyphs: './fonts/{fontstack}/{range}.pbf',
  sources: {
    water: geo('water'), green: geo('green'), rail: geo('rail'),
    // Loaded as objects so labels can be rewritten for language and custom names.
    buildings: { type: 'geojson', data: EMPTY, attribution: OSM_ATTRIB },
    roads: { type: 'geojson', data: EMPTY, attribution: OSM_ATTRIB },
    pois: { type: 'geojson', data: EMPTY, attribution: OSM_ATTRIB },
    route: { type: 'geojson', data: EMPTY },
    vias: { type: 'geojson', data: EMPTY },
    customs: { type: 'geojson', data: EMPTY },
    transit: geo('transit'),
    entrances: { type: 'geojson', data: EMPTY },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#f1efe9' } },
    { id: 'green', type: 'fill', source: 'green', paint: { 'fill-color': '#e3e9d7' } },
    { id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': '#c8dced' } },
    { id: 'buildings', type: 'fill', source: 'buildings',
      paint: {
        // A warmer fill marks the buildings you've written a directory for.
        'fill-color': ['case', ['==', ['get', 'hasDir'], 1], '#e7d6b0', ['has', 'name'], '#e0d8ca', '#e9e5dc'],
        'fill-outline-color': ['case', ['==', ['get', 'hasDir'], 1], '#c9ab72', '#cdc6b8'],
      } },

    road('r-minor-c', 'minor', [14, 2.2, 19, 11], '#d5cec1'),
    road('r-ter-c', 'tertiary', [13, 2.8, 19, 15], '#cec6b6'),
    road('r-sec-c', 'secondary', [12, 3.4, 19, 20], '#c8bda8'),
    road('r-pri-c', 'primary', [11, 4, 19, 26], '#c2b398'),
    road('r-maj-c', 'major', [10, 4.6, 19, 30], '#b9a77f'),
    road('r-minor', 'minor', [14, 1, 19, 8], '#fff'),
    road('r-ter', 'tertiary', [13, 1.4, 19, 12], '#fff'),
    road('r-sec', 'secondary', [12, 1.9, 19, 17], '#fffdf7'),
    road('r-pri', 'primary', [11, 2.4, 19, 22], '#fff7e2'),
    road('r-maj', 'major', [10, 2.8, 19, 26], '#fdefc8'),
    road('r-foot', 'foot', [15, 1, 19, 4.5], '#c6bdae', { 'line-dasharray': [2, 1.8] }),

    // Invisible but wide, so a street can be clicked without pixel-hunting.
    { id: 'road-hit', type: 'line', source: 'roads',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 } },

    // Each metro line in its own colour, dashed because it runs underneath you.
    { id: 'rail', type: 'line', source: 'rail',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'colour'], '#b6afa3'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.4, 18, 4.5],
        'line-opacity': 0.55,
        'line-dasharray': [3, 2.2],
      } },

    // Station footprints outlined in the colours of the lines that serve them:
    // one band per line, so an interchange reads as an interchange.
    { id: 'station-fill', type: 'fill', source: 'buildings',
      filter: ['==', ['get', 'station'], 1],
      paint: { 'fill-color': ['coalesce', ['get', 'c1'], '#8a8f98'], 'fill-opacity': 0.12 } },
    { id: 'station-edge-1', type: 'line', source: 'buildings',
      filter: ['==', ['get', 'station'], 1],
      paint: { 'line-color': ['coalesce', ['get', 'c1'], '#8a8f98'], 'line-width': 2.2 } },
    { id: 'station-edge-2', type: 'line', source: 'buildings',
      filter: ['all', ['==', ['get', 'station'], 1], ['has', 'c2']],
      paint: { 'line-color': ['get', 'c2'], 'line-width': 2.2, 'line-offset': 2.6 } },
    { id: 'station-edge-3', type: 'line', source: 'buildings',
      filter: ['all', ['==', ['get', 'station'], 1], ['has', 'c3']],
      paint: { 'line-color': ['get', 'c3'], 'line-width': 2.2, 'line-offset': 5.2 } },

    { id: 'bldg-entrance-dot', type: 'circle', source: 'entrances', minzoom: 15.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15.5, 5, 19, 9.5],
        'circle-color': '#3f4a5a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.6,
      } },
    { id: 'bldg-entrance-ref', type: 'symbol', source: 'entrances', minzoom: 16,
      layout: {
        'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 8, 19, 10.5],
        'text-allow-overlap': true, 'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' } },
    { id: 'bldg-entrance-label', type: 'symbol', source: 'entrances', minzoom: 17,
      filter: ['has', 'label'],
      layout: {
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 10.5,
        'text-offset': [0, 1], 'text-anchor': 'top', 'text-max-width': 8, 'text-padding': 3,
      },
      paint: { 'text-color': '#3f4a5a', 'text-halo-color': '#f1efe9', 'text-halo-width': 1.6 } },

    { id: 'exit-dot', type: 'circle', source: 'transit', minzoom: 15.5,
      filter: ['==', ['get', 'kind'], 'exit'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15.5, 5.5, 19, 10],
        'circle-color': ['coalesce', ['get', 'colour'], '#1c7a4a'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1.6,
      } },
    { id: 'exit-label', type: 'symbol', source: 'transit', minzoom: 16,
      filter: ['==', ['get', 'kind'], 'exit'],
      layout: {
        'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 8, 19, 11],
        'text-allow-overlap': true, 'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' } },

    { id: 'poi', type: 'circle', source: 'pois', minzoom: 15,
      filter: ['!', ['in', ['get', 'cls'], ['literal', ['exit', 'station']]]],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.8, 18, 3.4],
        'circle-color': '#a89e8e', 'circle-opacity': .8 } },
    { id: 'road-label', type: 'symbol', source: 'roads', minzoom: 15,
      filter: ['has', 'label'],
      layout: {
        'symbol-placement': 'line', 'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 19, 12.5],
        'symbol-spacing': 260, 'text-max-angle': 32, 'text-padding': 4,
      },
      paint: { 'text-color': ['case', ['==', ['get', 'custom'], 2], '#b0a89a', ['==', ['get', 'custom'], 1], '#b45309', '#6f6757'],
        'text-halo-color': '#f1efe9', 'text-halo-width': 1.6 } },

    { id: 'building-label', type: 'symbol', source: 'buildings', minzoom: 17,
      filter: ['all', ['has', 'label'], ['!=', ['get', 'isMall'], 1]],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'],
        'text-size': 10.5, 'text-max-width': 8, 'text-padding': 4 },
      paint: { 'text-color': ['case', ['==', ['get', 'custom'], 2], '#b0a89a', ['==', ['get', 'custom'], 1], '#b45309', '#7a715f'],
        'text-halo-color': '#f1efe9', 'text-halo-width': 1.5 } },

    { id: 'poi-label', type: 'symbol', source: 'pois', minzoom: 16,
      filter: ['all', ['has', 'label'], ['!', ['in', ['get', 'cls'], ['literal', ['exit', 'station']]]]],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 19, 12.5],
        'text-offset': [0, .9], 'text-anchor': 'top', 'text-max-width': 7, 'text-padding': 3 },
      paint: { 'text-color': ['case', ['==', ['get', 'custom'], 2], '#b0a89a', ['==', ['get', 'custom'], 1], '#b45309', '#5f5748'],
        'text-halo-color': '#f6f5f2', 'text-halo-width': 1.4 } },
    { id: 'mall-label', type: 'symbol', source: 'pois', minzoom: 14,
      filter: ['all', ['has', 'label'], ['in', ['get', 'cls'], ['literal', ['mall', 'electronics']]]],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 19, 14.5], 'text-max-width': 8, 'text-padding': 4 },
      paint: { 'text-color': ['case', ['==', ['get', 'custom'], 2], '#b0a89a', ['==', ['get', 'custom'], 1], '#b45309', '#4c4438'],
        'text-halo-color': '#f6f5f2', 'text-halo-width': 1.8 } },

    // The walked line: a white casing under a coloured core reads clearly over any background.
    { id: 'route-case', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': 9, 'line-opacity': .95 } },
    { id: 'route-line', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 5 } },
    // Legs the footpath network couldn't connect are drawn dashed, never passed off as a real path.
    { id: 'route-direct', type: 'line', source: 'route', filter: ['==', ['get', 'direct'], true],
      layout: { 'line-cap': 'butt' },
      paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [1, 2] } },
    // Invisible but wide, so the line is easy to grab without drawing a fat line.
    { id: 'route-hit', type: 'line', source: 'route',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 22 } },
    // Names you've added for things OpenStreetMap doesn't have at all.
    { id: 'custom-anchor', type: 'circle', source: 'customs',
      layout: { visibility: 'none' },
      paint: { 'circle-radius': 4.5, 'circle-color': '#fff', 'circle-stroke-color': '#b45309', 'circle-stroke-width': 2 } },
    { id: 'custom-label', type: 'symbol', source: 'customs',
      filter: ['has', 'label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['match', ['get', 'kind'], 'street', 11, 'building', 11.5, 13],
        'text-offset': [0, 0.75], 'text-anchor': 'top', 'text-max-width': 8, 'text-padding': 3,
      },
      paint: { 'text-color': '#b45309', 'text-halo-color': '#f1efe9', 'text-halo-width': 1.8 } },

    // Handles for the bends you've added by hand.
    { id: 'via-dot', type: 'circle', source: 'vias',
      paint: {
        'circle-radius': 5,
        'circle-color': '#fff',
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 2.5,
      } },
  ],
};

const map = new maplibregl.Map({
  container: 'map', style,
  center: [114.0818, 22.5455], zoom: 15.2,
  maxBounds: [[114.055, 22.518], [114.118, 22.572]],
  localIdeographFontFamily: "'PingFang SC','Hiragino Sans GB',sans-serif",
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-right');

// The commercial spine, framed clear of the panel rather than hidden behind it.
const CORE = [[114.0785, 22.5408], [114.0866, 22.5496]];
const panelPad = () => (innerWidth > 820 ? { top: 60, bottom: 100, left: 372, right: 60 }
                                         : { top: 60, bottom: 120, left: 30, right: 30 });
// resize() first: on a cold load the container can still be settling, and fitting
// against a stale size lands a whole zoom level short.
const fitCore = () => { map.resize(); map.fitBounds(CORE, { padding: panelPad(), duration: 0 }); };

/* ---------------------------------------------------------------- store

   Routes are public: everyone loads the same routes.json committed to the repo.
   Writing needs a GitHub token with contents:write on this repo, held only in the
   author's own browser — so anyone can read the routes, nobody else can change them. */

const REPO = { owner: 'hansstam86', repo: 'hqb-routes', branch: 'main' };
const FILES = {
  routes: { path: 'site/data/routes.json', label: 'routes' },
  places: { path: 'site/data/places.json', label: 'names' },
  buildings: { path: 'site/data/buildings.json', label: 'building directories' },
};
const TOKEN_KEY = 'hqb.gh.token';
const DRAFT_KEY = 'hqb.draft.v3';
const LEGACY_KEY = 'hqb.routes.v1';
const LANG_KEY = 'hqb.lang';

let routes = [];
let places = {};              // OSM id -> { en, zh }: names you've given things
let buildings = {};           // OSM id -> { floors: [{ level, en, zh }] }: what's sold where
let publishedJson = { routes: '[]', places: '{}', buildings: '{}' };
let lang = localStorage.getItem(LANG_KEY) || 'zh';
let canBuild = false;
let activeId = null;
let router = null;
let addMode = false;
let renameMode = false;
let markers = [];
let legs = [];
const basemap = { buildings: null, roads: null, pois: null };

const live = { routes: () => routes, places: () => places, buildings: () => buildings };
const token = () => localStorage.getItem(TOKEN_KEY);
const active = () => routes.find((r) => r.id === activeId) ?? null;
const dirtyKeys = () => Object.keys(FILES).filter((k) => JSON.stringify(live[k]()) !== publishedJson[k]);
const dirty = () => dirtyKeys().length > 0;
const saveDraft = () => canBuild && localStorage.setItem(DRAFT_KEY, JSON.stringify({ routes, places, buildings }));

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com/${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token()}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function loadJson(name, fallback) {
  // Cache-bust for the author, so a just-published change isn't masked by the CDN.
  try {
    const r = await fetch(`./data/${name}.json${canBuild ? `?t=${Date.now()}` : ''}`,
      { cache: canBuild ? 'no-store' : 'default' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch { return fallback; }
}

async function publish() {
  const btn = $('#publish');
  const keys = dirtyKeys();
  if (!keys.length) return;
  btn.disabled = true;
  btn.textContent = 'Publishing…';
  try {
    for (const k of keys) {
      // Re-read the sha immediately before writing so a stale one can't clobber.
      let sha = null;
      try {
        sha = (await gh(`repos/${REPO.owner}/${REPO.repo}/contents/${FILES[k].path}?ref=${REPO.branch}`)).sha;
      } catch { /* file may not exist yet */ }
      await gh(`repos/${REPO.owner}/${REPO.repo}/contents/${FILES[k].path}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: `Update ${FILES[k].label}`,
          content: b64(JSON.stringify(live[k](), null, 2)),
          branch: REPO.branch,
          ...(sha ? { sha } : {}),
        }),
      });
      publishedJson[k] = JSON.stringify(live[k]());
    }
    localStorage.removeItem(DRAFT_KEY);
    toast('Published — live in about a minute');
  } catch (err) {
    console.error(err);
    toast(/40[13]/.test(err.message)
      ? 'Token rejected — check it has Contents: Read and write'
      : `Publish failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    refreshPublish();
  }
}

function refreshPublish() {
  const btn = $('#publish');
  btn.hidden = !canBuild;
  const n = dirtyKeys().length;
  btn.textContent = n ? 'Publish changes' : 'Published';
  btn.disabled = !n;
}

/* ---------------------------------------------------------------- labels

   Every label on the map is computed here rather than in a style expression, so a
   custom name and a language switch are the same operation: rewrite `label`, re-set
   the source. Custom names are tinted so you can see which ones are yours. */

const pickName = (zh, en) => (lang === 'zh' ? (zh || en) : (en || zh)) || null;
const isCustomId = (k) => k.startsWith('custom/');

// Names with their own coordinates: things OSM has no feature for.
function drawCustoms() {
  const features = [];
  for (const [id, v] of Object.entries(places)) {
    if (!isCustomId(id) || !Array.isArray(v.at)) continue;
    const label = pickName(v.zh, v.en);
    features.push({
      type: 'Feature',
      properties: { id, kind: v.kind || 'place', ...(label ? { label } : {}) },
      geometry: { type: 'Point', coordinates: v.at },
    });
  }
  map.getSource('customs')?.setData({ type: 'FeatureCollection', features });
}

function applyLabels() {
  for (const key of ['buildings', 'roads', 'pois']) {
    const fc = basemap[key];
    if (!fc) continue;
    for (const f of fc.features) {
      const p = f.properties;
      const o = places[p.oid];
      // Hidden names stay visible (greyed) while the Names tool is on, otherwise
      // hiding one would be irreversible: there'd be nothing left to click.
      const osmName = pickName(p.zh, p.en);
      const label = o?.hidden ? (renameMode ? osmName : null) : pickName(o?.zh || p.zh, o?.en || p.en);
      if (label) p.label = label; else delete p.label;
      p.custom = o?.hidden ? 2 : (o ? 1 : 0);
      p.hasDir = buildings[p.oid]?.floors?.length ? 1 : 0;
    }
    map.getSource(key)?.setData(fc);
  }
  drawCustoms();
  $('#lang').textContent = lang === 'zh' ? '中' : 'EN';
  $('#lang').title = lang === 'zh' ? 'Showing Chinese — click for English' : 'Showing English — click for Chinese';
}

const featureIdx = new Map();   // oid -> { zh, en, at }

function indexFeature(f) {
  const p = f.properties;
  if (!p.oid || featureIdx.has(p.oid)) return;
  const g = f.geometry;
  let at = null;
  if (g.type === 'Point') at = g.coordinates;
  else {
    const ring = g.type === 'Polygon' ? g.coordinates[0]
      : g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.coordinates;
    if (ring?.length) {
      let x = 0, y = 0;
      for (const c of ring) { x += c[0]; y += c[1]; }
      at = [x / ring.length, y / ring.length];
    }
  }
  if (at) featureIdx.set(p.oid, { zh: p.zh || null, en: p.en || null, at });
}

// The name to show for a directory entry, honouring anything you've renamed.
function nameOf(oid) {
  const o = places[oid];
  const f = featureIdx.get(oid);
  return pickName(o?.zh || f?.zh, o?.en || f?.en) || '(unnamed building)';
}
const otherNameOf = (oid) => {
  const o = places[oid], f = featureIdx.get(oid);
  const zh = o?.zh || f?.zh, en = o?.en || f?.en;
  const other = lang === 'zh' ? en : zh;
  return other && other !== nameOf(oid) ? other : '';
};

async function loadBasemap() {
  await Promise.all(['buildings', 'roads', 'pois'].map(async (k) => {
    try {
      const fc = await (await fetch(`./data/${k}.geojson`)).json();
      // Mall labels are drawn from the POI layer; don't repeat them on the building.
      if (k === 'buildings') {
        const malls = new Set((basemap.pois?.features ?? []).map((f) => f.properties.oid));
        for (const f of fc.features) if (malls.has(f.properties.oid)) f.properties.isMall = 1;
      }
      basemap[k] = fc;
    } catch (err) { console.warn(`basemap ${k} failed`, err); }
  }));
  // pois load in parallel, so flag malls once everything is in
  const malls = new Set((basemap.pois?.features ?? [])
    .filter((f) => ['mall', 'station', 'electronics'].includes(f.properties.cls))
    .map((f) => f.properties.oid));
  for (const f of basemap.buildings?.features ?? []) {
    if (malls.has(f.properties.oid)) f.properties.isMall = 1;
  }
  for (const k of ['pois', 'buildings']) for (const f of basemap[k]?.features ?? []) indexFeature(f);
  applyLabels();
}

/* ---------------------------------------------------------------- helpers */

const COLORS_ = COLORS;
function newRoute(name) {
  const r = { id: uid(), name: name || `Route ${routes.length + 1}`, color: COLORS_[routes.length % COLORS_.length], stops: [] };
  routes.push(r);
  activeId = r.id;
  return r;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').append(el);
  requestAnimationFrame(() => el.classList.add('go'));
  setTimeout(() => el.remove(), 3200);
}

const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const fmtMins = (n) => (n >= 60 ? `${Math.floor(n / 60)}h ${Math.round(n % 60)}m` : `${Math.round(n)} min`);

/* ---------------------------------------------------------------- routing

   A leg runs from stop i to stop i+1 and is split into sub-legs by the via points
   held on stop i+1. Dragging the line inserts a via, which is how you overrule the
   router where it doesn't know about a shortcut. */

function chainFor(i) {
  const s = active().stops;
  return [[s[i].lng, s[i].lat], ...(s[i + 1].via ?? []).map((v) => [...v]), [s[i + 1].lng, s[i + 1].lat]];
}

function recompute() {
  const r = active();
  legs = [];
  if (!r || r.stops.length < 2 || !router) return;
  for (let i = 0; i < r.stops.length - 1; i++) {
    const chain = chainFor(i);
    const subs = [];
    for (let k = 1; k < chain.length; k++) subs.push(router.leg(chain[k - 1], chain[k]));
    legs.push({
      subs,
      metres: subs.reduce((a, s) => a + s.metres, 0),
      direct: subs.some((s) => s.direct),
    });
  }
}

function drawRoute() {
  const r = active();
  const feats = [];
  const vias = [];
  legs.forEach((leg, i) => {
    leg.subs.forEach((sub, k) => {
      feats.push({
        type: 'Feature',
        properties: { color: r.color, direct: sub.direct, leg: i, sub: k },
        geometry: { type: 'LineString', coordinates: sub.coords },
      });
    });
    (r.stops[i + 1].via ?? []).forEach((v, idx) => {
      vias.push({ type: 'Feature', properties: { leg: i, idx, color: r.color }, geometry: { type: 'Point', coordinates: v } });
    });
  });
  map.getSource('route')?.setData({ type: 'FeatureCollection', features: feats });
  map.getSource('vias')?.setData({ type: 'FeatureCollection', features: canBuild ? vias : [] });

  for (const m of markers) m.remove();
  markers = [];
  if (!r) return;
  r.stops.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'marker';
    el.style.background = r.color;
    el.textContent = String(i + 1);
    const m = new maplibregl.Marker({ element: el, draggable: canBuild })
      .setLngLat([s.lng, s.lat]).addTo(map);
    if (canBuild) {
      m.on('dragstart', () => el.classList.add('drag'));
      m.on('dragend', () => {
        el.classList.remove('drag');
        const p = m.getLngLat();
        s.lng = +p.lng.toFixed(6); s.lat = +p.lat.toFixed(6);
        commit();
      });
    }
    markers.push(m);
  });
}

function refreshStats() {
  const r = active();
  const metres = legs.reduce((a, l) => a + l.metres, 0);
  const dwell = (r?.stops ?? []).reduce((a, s) => a + (Number(s.mins) || 0), 0);
  $('#statDist').textContent = fmtDist(metres);
  $('#statTime').textContent = fmtMins(metres / WALK_M_PER_MIN + dwell);
  $('#statStops').textContent = r?.stops.length ?? 0;

  const broken = legs.filter((l) => l.direct).length;
  const warn = $('#warn');
  warn.hidden = !broken;
  if (broken) {
    warn.textContent = `${broken} leg${broken > 1 ? 's' : ''} drawn as a dashed straight line — `
      + `no mapped footpath connects those points, so that distance is as-the-crow-flies.`;
  }
}

function commit() {
  recompute();
  drawRoute();
  refreshStats();
  renderStops();
  saveDraft();
  refreshPublish();
}

/* ---------------------------------------------------------------- line editing */

let dragVia = null;      // { leg, idx } of an existing via being moved
let pendingVia = null;   // { leg, sub } of a new via being dragged out of the line

function insertVia(leg, sub, lngLat) {
  const s = active().stops[leg + 1];
  s.via ??= [];
  s.via.splice(sub, 0, [+lngLat.lng.toFixed(6), +lngLat.lat.toFixed(6)]);
}

if (true) {
  // Grab the line itself to bend it.
  map.on('mousedown', 'route-hit', (e) => {
    if (!canBuild || addMode) return;
    e.preventDefault();
    const f = e.features[0];
    pendingVia = { leg: f.properties.leg, sub: f.properties.sub };
    map.getCanvas().style.cursor = 'grabbing';
  });

  map.on('mousedown', 'via-dot', (e) => {
    if (!canBuild) return;
    e.preventDefault();
    const f = e.features[0];
    if (e.originalEvent.altKey) {
      const s = active().stops[f.properties.leg + 1];
      s.via.splice(f.properties.idx, 1);
      commit();
      return;
    }
    dragVia = { leg: f.properties.leg, idx: f.properties.idx };
    map.getCanvas().style.cursor = 'grabbing';
  });

  map.on('mousemove', (e) => {
    if (dragVia) {
      const s = active().stops[dragVia.leg + 1];
      s.via[dragVia.idx] = [+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)];
      recompute(); drawRoute();
      return;
    }
    if (pendingVia) {
      insertVia(pendingVia.leg, pendingVia.sub, e.lngLat);
      dragVia = { leg: pendingVia.leg, idx: pendingVia.sub };
      pendingVia = null;
      recompute(); drawRoute();
    }
  });

  // On the document, so releasing over the panel or off-window still ends the drag.
  const endDrag = () => {
    if (!dragVia && !pendingVia) return;
    dragVia = null; pendingVia = null;
    map.getCanvas().style.cursor = '';
    commit();
  };
  document.addEventListener('mouseup', endDrag);
  window.addEventListener('blur', endDrag);

  for (const l of ['route-hit', 'via-dot']) {
    map.on('mouseenter', l, () => { if (canBuild && !addMode) map.getCanvas().style.cursor = 'grab'; });
    map.on('mouseleave', l, () => { if (!dragVia) map.getCanvas().style.cursor = addMode ? 'crosshair' : ''; });
  }
}

/* ---------------------------------------------------------------- stops UI */

function renderRouteExit() {
  const box = $('#routeExit');
  const r = active();
  const first = r?.stops?.[0];
  if (!first) { box.hidden = true; return; }
  const x = nearestExit([first.lng, first.lat], `s:${first.id}`);
  if (!x) { box.hidden = true; return; }
  // Once stop 1 is itself an exit, saying "start from an exit" is just noise.
  const already = /exit/i.test(first.name || '') || /出口/.test(first.zh || '');
  if (already) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<span class="exitline"><i>M</i> Start from <b>${esc(exitLabel(x))}</b>`
    + ` · ${fmtDist(x.metres)} to stop 1</span>`
    + (canBuild ? '<button class="ghost" id="useExit">Add as first stop</button>' : '');
  const btn = $('#useExit');
  if (btn) btn.onclick = () => {
    r.stops.unshift({
      id: uid(), name: exitLabel(x), zh: exitLabelZh(x),
      note: '', mins: 0, lng: x.at[0], lat: x.at[1], via: [],
    });
    if (r.stops[1]) r.stops[1].via = [];
    commit();
  };
}

function renderStops() {
  const r = active();
  const el = $('#stops');
  renderRouteExit();
  el.innerHTML = '';
  const has = !!(r && r.stops.length);
  $('#empty').hidden = has;
  $('#empty').innerHTML = canBuild
    ? 'Click <b>Add stops</b>, then click the map to drop stops in order. Drag the line between stops to bend it onto the path you actually walk.'
    : (routes.length ? 'This route has no stops yet.' : 'No routes published yet.');
  if (!r) return;

  r.stops.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'stop';
    li.dataset.i = i;
    const legTxt = i > 0 && legs[i - 1]
      ? `${fmtDist(legs[i - 1].metres)}${legs[i - 1].direct ? ' direct' : ''}` : 'start';

    if (canBuild) {
      li.innerHTML = `
        <div class="n" style="background:${r.color}" draggable="true" title="Drag to reorder">${i + 1}</div>
        <div class="body">
          <input class="nm" value="${esc(s.name)}" placeholder="Stop ${i + 1}" autocomplete="off" spellcheck="false" />
          <input class="zhin" value="${esc(s.zh)}" placeholder="中文名（给路人看）" autocomplete="off" spellcheck="false" />
          <textarea class="nt" rows="1" placeholder="What to do here…">${esc(s.note)}</textarea>
        </div>
        <div class="side">
          <button class="x" title="Remove stop">×</button>
          <div class="mins"><input class="mi" value="${Number(s.mins) || 0}" inputmode="numeric" autocomplete="off" /> min</div>
          <span class="legdist">${legTxt}</span>
        </div>`;
      li.querySelector('.nm').oninput = (e) => { s.name = e.target.value; saveDraft(); refreshPublish(); };
      li.querySelector('.zhin').oninput = (e) => { s.zh = e.target.value; saveDraft(); refreshPublish(); };
      li.querySelector('.nt').oninput = (e) => { s.note = e.target.value; autoGrow(e.target); saveDraft(); refreshPublish(); };
      li.querySelector('.mi').oninput = (e) => { s.mins = e.target.value.replace(/\D/g, ''); refreshStats(); saveDraft(); refreshPublish(); };
      li.querySelector('.x').onclick = () => { r.stops.splice(i, 1); if (r.stops[i]) r.stops[i].via = []; commit(); };

      const badge = li.querySelector('.n');
      badge.onclick = () => map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 17) });
      badge.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); li.classList.add('drag'); });
      badge.addEventListener('dragend', () => li.classList.remove('drag'));
      li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('over'); });
      li.addEventListener('dragleave', () => li.classList.remove('over'));
      li.addEventListener('drop', (e) => {
        e.preventDefault(); li.classList.remove('over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        const to = Number(li.dataset.i);
        if (Number.isNaN(from) || from === to) return;
        const [moved] = r.stops.splice(from, 1);
        r.stops.splice(to, 0, moved);
        // Reordering invalidates the hand-drawn detours around the moved stop.
        for (const st of r.stops) st.via = [];
        commit();
      });
      el.append(li);
      autoGrow(li.querySelector('.nt'));
    } else {
      li.innerHTML = `
        <div class="n" style="background:${r.color}">${i + 1}</div>
        <div class="body">
          <div class="ro-name">${esc(stopPrimary(s)) || `Stop ${i + 1}`}</div>
          ${stopSecondary(s) ? `<div class="zh">${esc(stopSecondary(s))}</div>` : ''}
          ${s.note ? `<div class="ro-note">${esc(s.note)}</div>` : ''}
        </div>
        <div class="side">
          ${Number(s.mins) ? `<div class="mins">${Number(s.mins)} min</div>` : ''}
          <span class="legdist">${legTxt}</span>
        </div>`;
      li.querySelector('.n').onclick = () => map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 17) });
      el.append(li);
    }
  });
}

// Which script leads depends on the 中/EN switch; the other sits underneath so a
// lost visitor always has the Chinese to point at.
const stopPrimary = (s) => (lang === 'zh' ? (s.zh || s.name) : (s.name || s.zh)) || '';
const stopSecondary = (s) => {
  const other = lang === 'zh' ? s.name : s.zh;
  return other && other !== stopPrimary(s) ? other : '';
};

function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; }

/* ---------------------------------------------------------------- routes UI */

function renderRouteBar() {
  const sel = $('#routeSel');
  sel.innerHTML = routes.length
    ? routes.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')
    : '<option value="">— no routes —</option>';
  sel.value = activeId ?? '';
  const r = active();
  $('#routeName').value = r?.name ?? '';
  $('#swatches').innerHTML = COLORS_
    .map((c) => `<button data-c="${c}" style="background:${c}" class="${r && r.color === c ? 'on' : ''}"></button>`).join('');
  $('#swatches').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { const a = active(); if (!a) return; a.color = b.dataset.c; renderRouteBar(); commit(); };
  });
}

function selectRoute(id) {
  activeId = id;
  renderRouteBar();
  commit();
  if (active()?.stops.length) fitRoute();
}

function fitRoute() {
  const r = active();
  if (!r?.stops.length) return;
  const pts = legs.length ? legs.flatMap((l) => l.subs.flatMap((s) => s.coords)) : r.stops.map((s) => [s.lng, s.lat]);
  const b = pts.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(pts[0], pts[0]));
  map.resize();
  map.fitBounds(b, { padding: panelPad(), maxZoom: 17.5 });
}

/* ---------------------------------------------------------------- map input */

function setAddMode(on) {
  addMode = on && canBuild;
  if (addMode) renameMode = false;
  $('#addMode').classList.toggle('on', addMode);
  $('#renameMode')?.classList.toggle('on', renameMode);
  $('#hint').textContent = addMode ? 'Click the map to drop stops in order' : 'Drag the line to bend it';
  map.getCanvas().style.cursor = addMode ? 'crosshair' : '';
}

map.on('click', (e) => {
  if (placingFor && canBuild) {
    const b = (buildings[placingFor] ??= { floors: [] });
    b.entrances ??= [];
    b.entrances.push({
      id: uid().slice(0, 8), ref: String(b.entrances.length + 1), en: '', zh: '',
      at: [+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)],
    });
    placingFor = null;
    $('#hint').textContent = '';
    map.getCanvas().style.cursor = '';
    touchBuildings(true);
    return;
  }
  if (renameMode && canBuild) {
    const mine = pickCustom(e.point);
    if (mine) return openCustom(mine);
    const hit = pickFeature(e.point);
    if (hit) return openOsm(hit);
    return openNew(e.lngLat);
  }
  if (!addMode) {
    const hit = pickFeature(e.point);
    if (hit && (hit.key === 'buildings' || hit.key === 'pois')) {
      // Don't create an entry just for looking: an empty one would be published.
      const oid = hit.props.oid;
      const b = buildings[oid];
      if (canBuild || b?.floors?.length || b?.entrances?.length) return selectBuilding(oid);
    }
    return;
  }
  if (!canBuild) return;
  const r = active() ?? newRoute();
  // Take both scripts from the place you clicked, so the stop can be shown to a
  // local in Chinese even if you filed it under an English name.
  // An exit under the cursor wins: it is the most specific thing you can name.
  const ex = map.getLayer('exit-dot')
    ? map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]],
        { layers: ['exit-dot'] })[0] : null;
  const hit = pickFeature(e.point);
  const o = hit ? places[hit.props.oid] : null;
  const zh = ex ? exitLabelZh(ex.properties) : (o?.zh || hit?.props?.zh || '');
  const en = ex ? exitLabel(ex.properties) : (o?.en || hit?.props?.en || '');
  r.stops.push({
    id: uid(), name: en || zh || '', zh, note: '', mins: ex ? 0 : 10,
    lng: +e.lngLat.lng.toFixed(6), lat: +e.lngLat.lat.toFixed(6), via: [],
  });
  renderRouteBar();
  commit();
});

/* ---------------------------------------------------------------- naming

   Custom names are stored against the OSM id and replace the OSM label for
   everyone. Most named buildings here have Chinese but no English, so both
   fields are offered and the language switch falls back to whichever exists. */

const KIND = { pois: 'place', roads: 'street', buildings: 'building' };
let renaming = null;   // { mode:'osm'|'custom'|'new', ... }

function setRenameMode(on) {
  renameMode = on && canBuild;
  if (renameMode) addMode = false;
  $('#renameMode').classList.toggle('on', renameMode);
  $('#addMode').classList.toggle('on', addMode);
  $('#hint').textContent = renameMode
    ? 'Click a name to edit it, or empty space to add one'
    : (addMode ? 'Click the map to drop stops in order' : 'Drag the line to bend it');
  map.getCanvas().style.cursor = renameMode ? 'help' : (addMode ? 'crosshair' : '');
  // The anchors are editing furniture; visitors never see them.
  map.setLayoutProperty('custom-anchor', 'visibility', renameMode ? 'visible' : 'none');
  applyLabels();   // hidden names appear/disappear with the tool
}

// Label layers come first: clicking the words "SEG Plaza" should pick SEG Plaza,
// not whatever unnamed service road happens to pass under the text.
const RENAME_LAYERS = [
  ['mall-label', 'pois'], ['poi-label', 'pois'], ['building-label', 'buildings'], ['road-label', 'roads'],
  ['poi', 'pois'], ['road-hit', 'roads'], ['buildings', 'buildings'],
];

const boxAt = (point, r = 6) => [[point.x - r, point.y - r], [point.x + r, point.y + r]];

function pickCustom(point) {
  for (const layer of ['custom-label', 'custom-anchor']) {
    if (!map.getLayer(layer)) continue;
    const f = map.queryRenderedFeatures(boxAt(point, 10), { layers: [layer] })[0];
    if (f?.properties?.id) return f.properties.id;
  }
  return null;
}

function pickFeature(point) {
  const found = [];
  for (const [layer, key] of RENAME_LAYERS) {
    if (!map.getLayer(layer)) continue;
    for (const h of map.queryRenderedFeatures(boxAt(point), { layers: [layer] })) {
      if (h.properties?.oid) found.push({ key, props: h.properties });
    }
  }
  // Anything you've already given a name to -- or hidden -- wins, so your own
  // edits are always reachable again. Then anything named. Then whatever's there.
  return found.find((f) => places[f.props.oid])
    ?? found.find((f) => f.props.zh || f.props.en)
    ?? found[0] ?? null;
}

function showDialog({ title, target, note, kind, en, zh, showKind, hide, clear, del }) {
  $('#rnTitle').textContent = title;
  $('#rnTarget').innerHTML = target;
  $('#rnNote').textContent = note;
  $('#rnKindWrap').hidden = !showKind;
  $('#rnKind').value = kind || 'place';
  $('#rnEn').value = en ?? '';
  $('#rnZh').value = zh ?? '';
  $('#rnHide').hidden = !hide;
  $('#rnClear').hidden = !clear;
  $('#rnDelete').hidden = !del;
  $('#rename').showModal();
}

function openOsm(hit) {
  const { oid, zh, en } = hit.props;
  const o = places[oid];
  renaming = { mode: 'osm', oid, kind: KIND[hit.key] };
  const osm = [zh, en].filter(Boolean).join(' · ');
  showDialog({
    title: 'Name this place',
    target: `<span class="kind">${renaming.kind}</span><br>`
      + (osm ? `OpenStreetMap calls this <b>${esc(osm)}</b>` : 'This one is <b>unnamed</b> in OpenStreetMap')
      + (o?.hidden ? '<br><b>Its name is currently hidden.</b>' : ''),
    note: 'Your name replaces the OpenStreetMap one for everyone. Hide it instead to show no '
      + 'label at all, which is the way to clear a name you do not want on the map.',
    en: o?.hidden ? '' : o?.en, zh: o?.hidden ? '' : o?.zh,
    hide: !o?.hidden, clear: !!o,
  });
}

function openCustom(id) {
  const v = places[id];
  if (!v) return;
  renaming = { mode: 'custom', oid: id, at: v.at };
  showDialog({
    title: 'Edit this name',
    target: '<span class="kind">your own name</span><br>Not from OpenStreetMap — you added this one.',
    note: 'Delete removes it from the map entirely.',
    showKind: true, kind: v.kind, en: v.en, zh: v.zh, del: true,
  });
}

function openNew(lngLat) {
  renaming = { mode: 'new', at: [+lngLat.lng.toFixed(6), +lngLat.lat.toFixed(6)] };
  showDialog({
    title: 'Add a name here',
    target: '<span class="kind">new name</span><br>Nothing of OpenStreetMap\u2019s is here, so this '
      + 'will be a name of your own.',
    note: 'It sits where you clicked. Drag it later while the Names tool is on.',
    showKind: true, kind: 'place',
  });
}

$('#rename').addEventListener('close', () => {
  const dlg = $('#rename');
  const r = renaming;
  renaming = null;
  if (!r || dlg.returnValue === 'cancel' || !dlg.returnValue) return;

  const en = $('#rnEn').value.trim();
  const zh = $('#rnZh').value.trim();
  let msg = '';

  if (dlg.returnValue === 'hide' && r.mode === 'osm') {
    places[r.oid] = { hidden: true };
    msg = 'Name hidden';
  } else if (dlg.returnValue === 'clear' && r.mode === 'osm') {
    delete places[r.oid];
    msg = 'Reset to the OpenStreetMap name';
  } else if (dlg.returnValue === 'delete' && r.mode === 'custom') {
    delete places[r.oid];
    msg = 'Name deleted';
  } else if (dlg.returnValue === 'ok') {
    if (r.mode === 'osm') {
      if (!en && !zh) { delete places[r.oid]; msg = 'Reset to the OpenStreetMap name'; }
      else { places[r.oid] = { ...(en ? { en } : {}), ...(zh ? { zh } : {}) }; msg = 'Name set'; }
    } else {
      if (!en && !zh) { toast('Give it a name in at least one language'); return; }
      const id = r.mode === 'custom' ? r.oid : `custom/${uid().slice(0, 8)}`;
      places[id] = { ...(en ? { en } : {}), ...(zh ? { zh } : {}), at: r.at, kind: $('#rnKind').value };
      msg = r.mode === 'custom' ? 'Name updated' : 'Name added';
    }
  } else return;

  applyLabels();
  saveDraft();
  refreshPublish();
  toast(`${msg} — publish to share it`);
});

/* Drag an entrance onto the actual door. */
let dragEnt = null;
map.on('mousedown', 'bldg-entrance-dot', (e) => {
  if (!canBuild || addMode || renameMode || placingFor) return;
  e.preventDefault();
  const p = e.features[0].properties;
  dragEnt = { oid: p.oid, id: p.id };
  map.getCanvas().style.cursor = 'grabbing';
});
map.on('mousemove', (e) => {
  if (!dragEnt) return;
  const en = buildings[dragEnt.oid]?.entrances?.find((x) => x.id === dragEnt.id);
  if (en) { en.at = [+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]; drawEntrances(); }
});
document.addEventListener('mouseup', () => {
  if (!dragEnt) return;
  dragEnt = null;
  map.getCanvas().style.cursor = '';
  saveDraft(); refreshPublish();
});
map.on('click', 'bldg-entrance-dot', (e) => {
  if (placingFor) return;
  const oid = e.features[0].properties.oid;
  if (buildings[oid]) selectBuilding(oid);
});

/* Drag one of your own names to reposition it. */
let dragName = null;
map.on('mousedown', 'custom-anchor', (e) => {
  if (!renameMode || !canBuild) return;
  e.preventDefault();
  dragName = e.features[0].properties.id;
  map.getCanvas().style.cursor = 'grabbing';
});
map.on('mousemove', (e) => {
  if (!dragName) return;
  const v = places[dragName];
  if (v) { v.at = [+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]; drawCustoms(); }
});
// On the document, so releasing off-map cannot strand the drag.
document.addEventListener('mouseup', () => {
  if (!dragName) return;
  dragName = null;
  map.getCanvas().style.cursor = renameMode ? 'help' : '';
  saveDraft();
  refreshPublish();
});

$('#renameMode').onclick = () => setRenameMode(!renameMode);

$('#lang').onclick = () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  localStorage.setItem(LANG_KEY, lang);
  applyLabels();
  loadTransit();
  renderStops();
  if (!$('.panel > .tab[data-tab=buildings]').hidden) renderBuildings();
};

/* ---------------------------------------------------------------- transit

   Which exit to come out of is the thing people actually need in Shenzhen, so
   exits are drawn with their letters and every destination gets the nearest one
   measured along the walking network, not as the crow flies. */

let exitIdx = [];              // { props, at, node } for every exit
let stationMarkers = [];
const nearestCache = new Map();

async function loadTransit() {
  let fc;
  try { fc = await (await fetch('./data/transit.geojson')).json(); }
  catch (err) { return console.warn('transit failed', err); }

  const stations = fc.features.filter((f) => f.properties.kind === 'station');
  const exits = fc.features.filter((f) => f.properties.kind === 'exit');

  if (router) {
    exitIdx = exits.map((f) => ({
      props: f.properties, at: f.geometry.coordinates,
      node: router.snap(f.geometry.coordinates[0], f.geometry.coordinates[1]),
    })).filter((e) => e.node >= 0);
  }

  for (const m of stationMarkers) m.remove();
  stationMarkers = stations.map((f) => {
    const p = f.properties;
    const el = document.createElement('div');
    el.className = 'station-mk';
    const lines = (p.lines || '').split(',').filter(Boolean);
    const cols = (p.colours || '').split(',');
    el.innerHTML = `<div class="lines">${lines
      .map((l, i) => `<i style="background:${esc(cols[i] || '#666')}">${esc(l)}</i>`).join('')}</div>`
      + `<div class="sname">${esc(pickName(p.zh, p.en) || p.name)}</div>`;
    el.title = `${p.name} · ${lines.length ? `line ${lines.join(', ')}` : 'metro'}`;
    return new maplibregl.Marker({ element: el, anchor: 'top' })
      .setLngLat(f.geometry.coordinates).addTo(map);
  });
}

/* Ways into the big blocks. OpenStreetMap has three entrance nodes in the whole
   district, all unnamed, so these are yours to place. */
function drawEntrances() {
  const features = [];
  for (const [oid, b] of Object.entries(buildings)) {
    for (const en of b?.entrances ?? []) {
      if (!Array.isArray(en.at)) continue;
      const label = pickName(en.zh, en.en);
      features.push({
        type: 'Feature',
        properties: { oid, id: en.id, ref: en.ref || '·', ...(label ? { label } : {}) },
        geometry: { type: 'Point', coordinates: en.at },
      });
    }
  }
  map.getSource('entrances')?.setData({ type: 'FeatureCollection', features });
}

/* Nearest exit by walking distance. One search ranks every exit at once. */
function nearestExit(at, cacheKey) {
  if (cacheKey && nearestCache.has(cacheKey)) return nearestCache.get(cacheKey);
  let out = null;
  if (router && exitIdx.length) {
    const costs = router.costsFrom(router.snap(at[0], at[1]));
    let best = null, bd = Infinity;
    for (const e of exitIdx) {
      const c = costs[e.node];
      if (c < bd) { bd = c; best = e; }
    }
    if (best && bd < Infinity) {
      const leg = router.leg(best.at, at);
      out = { ref: best.props.ref, station: best.props.station, metres: leg.metres, at: best.at };
    }
  }
  if (cacheKey) nearestCache.set(cacheKey, out);
  return out;
}

const exitLabel = (x) => (x.station ? `${x.station} exit ${x.ref}` : `metro entrance ${x.ref}`);
const exitLabelZh = (x) => (x.station ? `${x.station}站 ${x.ref}出口` : `地铁 ${x.ref}号出入口`);
const exitLine = (x) => x
  ? `<span class="exitline"><i>M</i> ${esc(exitLabel(x))} · ${fmtDist(x.metres)} walk</span>`
  : '';

/* ---------------------------------------------------------------- buildings

   Huaqiangbei is vertical: which floor a thing is on matters more than which
   street. Each building keeps an ordered list of floors and what's sold there,
   in both scripts so you can point at it. */

let bSelected = null;
let bQuery = '';
const bOpen = new Set();       // "<oid>:<floorId>" of expanded floors

// B2 < B1 < 1F < 2F, so the list reads the way you'd walk it.
function levelOrder(l) {
  const t = String(l || '').trim().toUpperCase();
  const b = t.match(/^B\s*(\d+)/);
  if (b) return -Number(b[1]);
  const f = t.match(/^(\d+)\s*F?$/);
  if (f) return Number(f[1]);
  if (t === 'G' || t === 'GF') return 0;
  return 99;
}

// Older entries predate floor ids and booths; heal them rather than special-case
// every read site.
function normalizeBuildings() {
  for (const b of Object.values(buildings)) {
    for (const f of b?.floors ?? []) {
      f.id ??= uid().slice(0, 8);
      f.booths ??= [];
    }
    for (const en of b?.entrances ?? []) en.id ??= uid().slice(0, 8);
  }
}

const sortedFloors = (oid) =>
  [...(buildings[oid]?.floors ?? [])].sort((a, b) => levelOrder(a.level) - levelOrder(b.level));

const boothText = (b) => `${b.code || ''} ${b.en || ''} ${b.zh || ''} ${b.note || ''}`.toLowerCase();
const floorText = (f) => `${f.en || ''} ${f.zh || ''}`.toLowerCase();
const pick = (en, zh) => (lang === 'zh' ? (zh || en) : (en || zh)) || '';

/* One flat list of hits so a search can answer "which booth", not just "which floor". */
function searchDirectories(q) {
  const hits = [];
  for (const oid of Object.keys(buildings)) {
    for (const f of sortedFloors(oid)) {
      // Floor and booth hits both count: "3F is all connectors" and "booth 3C21
      // specifically" answer different questions, and suppressing either loses one.
      if (floorText(f).includes(q)) hits.push({ oid, floor: f, booth: null });
      for (const b of f.booths ?? []) if (boothText(b).includes(q)) hits.push({ oid, floor: f, booth: b });
    }
  }
  return hits;
}

function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.panel > .tab').forEach((sec) => { sec.hidden = sec.dataset.tab !== name; });
  if (name === 'buildings') renderBuildings();
}

function selectBuilding(oid) {
  bSelected = oid;
  showTab('buildings');
  renderBuildings();
  const at = featureIdx.get(oid)?.at;
  if (at) map.flyTo({ center: at, zoom: Math.max(map.getZoom(), 17) });
}

function renderBuildings() {
  normalizeBuildings();
  const el = $('#bBody');
  const q = bQuery.trim().toLowerCase();
  el.innerHTML = '';

  if (q) return renderSearch(el, q);
  if (!bSelected) return renderIndex(el);
  return renderBuilding(el, bSelected);
}

function renderSearch(el, q) {
  const hits = searchDirectories(q);
  $('#bHint').textContent = hits.length ? `${hits.length} match(es)` : '';
  if (!hits.length) {
    el.innerHTML = `<p class="bempty">Nothing recorded for <b>${esc(bQuery)}</b> yet.</p>`;
    return;
  }
  const list = document.createElement('div');
  list.className = 'blist';
  for (const h of hits) {
    const btn = document.createElement('button');
    const what = h.booth ? pick(h.booth.en, h.booth.zh) : pick(h.floor.en, h.floor.zh);
    btn.innerHTML = `<span class="bn">${esc(nameOf(h.oid))}</span>`
      + `<span class="hit">${esc(h.floor.level)}${h.booth?.code ? ` · ${esc(h.booth.code)}` : ''}</span>`
      + `<span class="bf">${esc(what)}</span>`;
    btn.onclick = () => {
      bQuery = ''; $('#bSearch').value = '';
      bOpen.add(`${h.oid}:${h.floor.id}`);
      selectBuilding(h.oid);
    };
    list.append(btn);
  }
  el.append(list);
}

function renderIndex(el) {
  const keys = Object.keys(buildings)
    .filter((k) => buildings[k]?.floors?.length || buildings[k]?.entrances?.length);
  $('#bHint').textContent = keys.length ? `${keys.length} building(s) mapped` : '';
  if (!keys.length) {
    el.innerHTML = `<p class="bempty">${canBuild
      ? 'Click any building on the map to record what\u2019s sold on each floor.'
      : 'No building directories published yet.'}</p>`;
    return;
  }
  const list = document.createElement('div');
  list.className = 'blist';
  for (const oid of keys.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
    const floors = buildings[oid].floors ?? [];
    const booths = floors.reduce((a, f) => a + (f.booths?.length ?? 0), 0);
    const ents = buildings[oid].entrances?.length ?? 0;
    const bits = [floors.length ? `${floors.length} floors` : '', booths ? `${booths} booths` : '',
      ents ? `${ents} ways in` : ''].filter(Boolean).join(' · ');
    const btn = document.createElement('button');
    btn.innerHTML = `<span class="bn">${esc(nameOf(oid))}</span><span class="bf">${bits}</span>`;
    btn.onclick = () => selectBuilding(oid);
    list.append(btn);
  }
  el.append(list);
}

function renderBuilding(el, oid) {
  const other = otherNameOf(oid);
  const card = document.createElement('div');
  card.className = 'bcard';
  const x = nearestExit(featureIdx.get(oid)?.at ?? [0, 0], `b:${oid}`);
  card.innerHTML = `<h3>${esc(nameOf(oid))}</h3><div class="sub">${esc(other)}</div>${exitLine(x)}`;
  el.append(card);

  const floors = sortedFloors(oid);
  const booths = floors.reduce((a, f) => a + (f.booths?.length ?? 0), 0);
  $('#bHint').textContent = floors.length
    ? `${floors.length} floor(s)${booths ? `, ${booths} booth(s)` : ''}` : '';

  if (!floors.length && !canBuild) {
    el.insertAdjacentHTML('beforeend', '<p class="bempty">Nothing recorded for this building yet.</p>');
  }

  for (const f of floors) el.append(...floorNodes(oid, f));

  const ents = buildings[oid]?.entrances ?? [];
  if (ents.length || canBuild) {
    const h = document.createElement('div');
    h.className = 'enthead';
    h.textContent = 'Ways in';
    el.append(h);
  }
  for (const en of ents) el.append(entranceRow(oid, en));
  if (canBuild) {
    const addRow = document.createElement('div');
    addRow.className = 'baddrow';
    addRow.innerHTML = `<button class="ghost" id="bAddEnt">${placingFor === oid
      ? 'Click the map to place it…' : '+ Add entrance'}</button>`;
    el.append(addRow);
    addRow.querySelector('#bAddEnt').onclick = () => {
      placingFor = placingFor === oid ? null : oid;
      setAddMode(false);
      setRenameMode(false);
      $('#hint').textContent = placingFor ? 'Click the map to place the entrance' : '';
      map.getCanvas().style.cursor = placingFor ? 'crosshair' : '';
      renderBuildings();
    };
  }

  const foot = document.createElement('div');
  foot.className = 'baddrow';
  foot.innerHTML = (canBuild ? '<button class="ghost" id="bAdd">+ Add floor</button>' : '')
    + '<button class="ghost" id="bBack">All buildings</button>';
  el.append(foot);
  if (canBuild) {
    foot.querySelector('#bAdd').onclick = () => {
      buildings[oid] ??= { floors: [] };
      buildings[oid].floors.push({ id: uid().slice(0, 8), level: '', en: '', zh: '', booths: [] });
      touchBuildings(true);
    };
  }
  foot.querySelector('#bBack').onclick = () => { bSelected = null; renderBuildings(); };
}

function floorNodes(oid, f) {
  const key = `${oid}:${f.id}`;
  const open = bOpen.has(key);
  const n = f.booths?.length ?? 0;
  const nodes = [];

  const row = document.createElement('div');
  row.className = 'floor';
  const toggle = (canBuild || n)
    ? `<button class="exp" title="Booths on this floor">${open ? '▾' : '▸'} ${n || 'add'}</button>` : '';

  if (canBuild) {
    row.innerHTML = `
      <input class="lvlin" value="${esc(f.level)}" placeholder="3F" autocomplete="off" />
      <div>
        <input class="fen" value="${esc(f.en)}" placeholder="What's sold on this floor" autocomplete="off" />
        <input class="fzh" value="${esc(f.zh)}" placeholder="中文" autocomplete="off" />
      </div>
      <div class="fmeta">${toggle}<button class="x" title="Remove floor">×</button></div>`;
    row.querySelector('.lvlin').oninput = (e) => { f.level = e.target.value; touchBuildings(false); };
    row.querySelector('.fen').oninput = (e) => { f.en = e.target.value; touchBuildings(false); };
    row.querySelector('.fzh').oninput = (e) => { f.zh = e.target.value; touchBuildings(false); };
    row.querySelector('.x').onclick = () => {
      buildings[oid].floors = buildings[oid].floors.filter((x) => x !== f);
      bOpen.delete(key);
      touchBuildings(true);
    };
  } else {
    row.innerHTML = `
      <div class="lvl">${esc(f.level)}</div>
      <div>
        <div class="ro-en">${esc(pick(f.en, f.zh))}</div>
        ${(lang === 'zh' ? f.en : f.zh) ? `<div class="ro-zh">${esc(lang === 'zh' ? f.en : f.zh)}</div>` : ''}
      </div>
      <div class="fmeta">${toggle}</div>`;
  }
  row.querySelector('.exp')?.addEventListener('click', () => {
    if (open) bOpen.delete(key); else bOpen.add(key);
    renderBuildings();
  });
  nodes.push(row);

  if (!open) return nodes;

  const wrap = document.createElement('div');
  wrap.className = 'booths';
  for (const b of f.booths ?? []) {
    const bo = document.createElement('div');
    bo.className = 'booth';
    if (canBuild) {
      bo.innerHTML = `
        <input class="bcode" value="${esc(b.code)}" placeholder="3C21" autocomplete="off" />
        <div>
          <input class="ben" value="${esc(b.en)}" placeholder="What this booth sells" autocomplete="off" />
          <input class="bzh" value="${esc(b.zh)}" placeholder="中文" autocomplete="off" />
          <input class="bnote" value="${esc(b.note)}" placeholder="Contact, prices, who to ask…" autocomplete="off" />
        </div>
        <button class="x" title="Remove booth">×</button>`;
      bo.querySelector('.bcode').oninput = (e) => { b.code = e.target.value; touchBuildings(false); };
      bo.querySelector('.ben').oninput = (e) => { b.en = e.target.value; touchBuildings(false); };
      bo.querySelector('.bzh').oninput = (e) => { b.zh = e.target.value; touchBuildings(false); };
      bo.querySelector('.bnote').oninput = (e) => { b.note = e.target.value; touchBuildings(false); };
      bo.querySelector('.x').onclick = () => {
        f.booths = f.booths.filter((x) => x !== b);
        touchBuildings(true);
      };
    } else {
      bo.innerHTML = `
        <div class="code">${esc(b.code) || '—'}</div>
        <div>
          <div class="ro-en">${esc(pick(b.en, b.zh))}</div>
          ${(lang === 'zh' ? b.en : b.zh) ? `<div class="ro-zh">${esc(lang === 'zh' ? b.en : b.zh)}</div>` : ''}
          ${b.note ? `<div class="bnote-ro">${esc(b.note)}</div>` : ''}
        </div><div></div>`;
    }
    wrap.append(bo);
  }
  if (canBuild) {
    const add = document.createElement('button');
    add.className = 'ghost addbooth';
    add.textContent = '+ Add booth';
    add.onclick = () => {
      f.booths ??= [];
      f.booths.push({ id: uid().slice(0, 8), code: '', en: '', zh: '', note: '' });
      touchBuildings(true);
    };
    wrap.append(add);
  } else if (!(f.booths ?? []).length) {
    wrap.insertAdjacentHTML('beforeend', '<p class="bempty">No booths listed for this floor.</p>');
  }
  nodes.push(wrap);
  return nodes;
}

let placingFor = null;      // oid awaiting a click to place an entrance

function entranceRow(oid, en) {
  const row = document.createElement('div');
  row.className = 'entrance';
  if (canBuild) {
    row.innerHTML = `
      <input class="eref" value="${esc(en.ref)}" placeholder="N" autocomplete="off" title="Short label shown on the map" />
      <div>
        <input class="een" value="${esc(en.en)}" placeholder="North entrance" autocomplete="off" />
        <input class="ezh" value="${esc(en.zh)}" placeholder="北门" autocomplete="off" />
      </div>
      <div class="fmeta">
        <button class="goto" title="Show on map">◎</button>
        <button class="x" title="Remove entrance">×</button>
      </div>`;
    row.querySelector('.eref').oninput = (e) => { en.ref = e.target.value; touchBuildings(false); };
    row.querySelector('.een').oninput = (e) => { en.en = e.target.value; touchBuildings(false); };
    row.querySelector('.ezh').oninput = (e) => { en.zh = e.target.value; touchBuildings(false); };
    row.querySelector('.x').onclick = () => {
      buildings[oid].entrances = buildings[oid].entrances.filter((x) => x !== en);
      touchBuildings(true);
    };
  } else {
    row.innerHTML = `
      <div class="eref-ro">${esc(en.ref) || '·'}</div>
      <div>
        <div class="ro-en">${esc(pickName(en.zh, en.en)) || 'Entrance'}</div>
        ${(lang === 'zh' ? en.en : en.zh) ? `<div class="ro-zh">${esc(lang === 'zh' ? en.en : en.zh)}</div>` : ''}
      </div>
      <div class="fmeta"><button class="goto" title="Show on map">◎</button></div>`;
  }
  row.querySelector('.goto').onclick = () =>
    map.flyTo({ center: en.at, zoom: Math.max(map.getZoom(), 18) });
  return row;
}

/* Re-render only when the shape changed; typing shouldn't steal focus. */
function touchBuildings(rerender) {
  const oid = bSelected;
  const b = buildings[oid];
  if (oid && b && !b.floors?.length && !b.entrances?.length) delete buildings[oid];
  saveDraft();
  refreshPublish();
  applyLabels();
  drawEntrances();
  if (rerender) renderBuildings();
}

$$('.tabs button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
$('#bSearch').oninput = (e) => { bQuery = e.target.value; bSelected = null; renderBuildings(); };

/* ---------------------------------------------------------------- chrome */

$('#routeSel').onchange = (e) => selectRoute(e.target.value);
$('#newRoute').onclick = () => { newRoute(); renderRouteBar(); commit(); setAddMode(true); };
$('#routeName').oninput = (e) => { const r = active(); if (!r) return; r.name = e.target.value; renderRouteBar(); saveDraft(); refreshPublish(); };
$('#addMode').onclick = () => setAddMode(!addMode);
$('#undo').onclick = () => { const r = active(); if (r?.stops.length) { r.stops.pop(); commit(); } };
$('#delRoute').onclick = () => {
  const r = active();
  if (!r || !confirm(`Delete "${r.name}"? Publish afterwards to remove it for everyone.`)) return;
  routes = routes.filter((x) => x.id !== r.id);
  activeId = routes[0]?.id ?? null;
  renderRouteBar();
  commit();
};
$('#collapse').onclick = () => { $('#panel').classList.add('hide'); $('#reveal').hidden = false; };
$('#reveal').onclick = () => { $('#panel').classList.remove('hide'); $('#reveal').hidden = true; };
$('#publish').onclick = publish;

$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify(routes, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hqb-routes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('#import').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const list = JSON.parse(await f.text());
    for (const r of (Array.isArray(list) ? list : [list])) {
      if (Array.isArray(r.stops)) routes.push({ ...r, id: uid() });
    }
    activeId = routes[routes.length - 1]?.id ?? null;
    renderRouteBar(); commit();
    toast('Imported');
  } catch (err) { alert(`Could not import: ${err.message}`); }
  e.target.value = '';
};

const packRoute = (r) => b64(JSON.stringify({
  n: r.name, c: r.color, s: r.stops.map((s) => [s.lng, s.lat, s.name, s.note, s.mins, s.via ?? [], s.zh ?? '']),
})).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function unpackRoute(s) {
  const j = JSON.parse(unb64(s.replace(/-/g, '+').replace(/_/g, '/')));
  return {
    id: uid(), name: j.n || 'Shared route', color: j.c || COLORS_[0],
    stops: (j.s || []).map(([lng, lat, name, note, mins, via, zh]) =>
      ({ id: uid(), lng, lat, name: name || '', zh: zh || '', note: note || '', mins: mins ?? 10, via: via ?? [] })),
  };
}

$('#share').onclick = async () => {
  const r = active();
  if (!r?.stops.length) return toast('Nothing to share yet');
  const url = `${location.origin}${location.pathname}#r=${packRoute(r)}`;
  try { await navigator.clipboard.writeText(url); toast('Link copied'); }
  catch { prompt('Copy this link:', url); }
};

/* ---------------------------------------------------------------- auth */

function applyMode() {
  canBuild = !!token();
  document.body.classList.toggle('can-build', canBuild);
  $('#lock').textContent = canBuild ? '🔓' : '🔒';
  $('#lock').title = canBuild ? 'Editing unlocked — click to manage' : 'Editing locked';
  $('#signout').hidden = !canBuild;
  refreshPublish();
}

$('#lock').onclick = () => {
  $('#token').value = '';
  $('#auth').showModal();
};

$('#auth').addEventListener('close', async () => {
  const dlg = $('#auth');
  if (dlg.returnValue === 'signout') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(DRAFT_KEY);
    applyMode();
    location.reload();
    return;
  }
  if (dlg.returnValue !== 'ok') return;
  const t = $('#token').value.trim();
  if (!t) return;
  localStorage.setItem(TOKEN_KEY, t);
  try {
    await gh(`repos/${REPO.owner}/${REPO.repo}`);
    applyMode();
    setAddMode(false);
    commit();
    toast('Editing unlocked');
  } catch (err) {
    localStorage.removeItem(TOKEN_KEY);
    applyMode();
    toast('That token cannot reach the repo — check its permissions');
  }
});

/* ---------------------------------------------------------------- boot */

map.on('load', async () => {
  try {
    router = createRouter(await (await fetch('./data/walkgraph.json')).json());
  } catch (err) {
    console.error('walk graph failed', err);
    toast('Routing unavailable — legs will be straight lines');
  }

  applyMode();

  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const [pubRoutes, pubPlaces, pubBuildings] = await Promise.all([
    loadJson('routes', []), loadJson('places', {}), loadJson('buildings', {}),
  ]);
  routes = Array.isArray(pubRoutes) ? pubRoutes : [];
  places = isObj(pubPlaces) ? pubPlaces : {};
  buildings = isObj(pubBuildings) ? pubBuildings : {};
  publishedJson = {
    routes: JSON.stringify(routes), places: JSON.stringify(places), buildings: JSON.stringify(buildings),
  };

  if (canBuild) {
    // An unpublished draft beats the published copy; losing edits would be worse
    // than showing stale ones, and Publish is always one click away.
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (d && (JSON.stringify(d.routes) !== publishedJson.routes
             || JSON.stringify(d.places) !== publishedJson.places
             || JSON.stringify(d.buildings) !== publishedJson.buildings)) {
        if (Array.isArray(d.routes)) routes = d.routes;
        if (isObj(d.places)) places = d.places;
        if (isObj(d.buildings)) buildings = d.buildings;
        toast('Restored unpublished changes');
      }
    } catch { /* ignore */ }
    // One-time rescue of routes built before routes lived in the repo.
    try {
      const l = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
      if (Array.isArray(l) && l.length && !routes.length) {
        routes = l;
        toast('Imported your earlier local routes');
      }
    } catch { /* ignore */ }
  }

  await loadBasemap();
  await loadTransit();
  drawEntrances();

  const hash = location.hash.match(/^#r=(.+)$/);
  if (hash) {
    try {
      routes.push(unpackRoute(hash[1]));
      history.replaceState(null, '', location.pathname);
      toast('Opened shared route');
    } catch { toast('That shared link could not be read'); }
  }

  activeId = routes[0]?.id ?? null;
  renderRouteBar();
  commit();
  setAddMode(false);
  if (active()?.stops.length) fitRoute(); else fitCore();
});

map.on('error', (e) => console.warn('map:', e.error?.message || e));
window.hqb = { routes: () => routes, map, legs: () => legs };
