import * as maplibregl from './vendor/maplibre-gl.mjs';   // v6 exports names, not a default
import { createRouter } from './router.js';

const $ = (s) => document.querySelector(s);
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
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#f1efe9' } },
    { id: 'green', type: 'fill', source: 'green', paint: { 'fill-color': '#e3e9d7' } },
    { id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': '#c8dced' } },
    { id: 'buildings', type: 'fill', source: 'buildings',
      paint: { 'fill-color': ['case', ['has', 'name'], '#e0d8ca', '#e9e5dc'], 'fill-outline-color': '#cdc6b8' } },

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

    { id: 'rail', type: 'line', source: 'rail',
      paint: { 'line-color': '#b6afa3', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 3], 'line-dasharray': [3, 2] } },

    { id: 'poi', type: 'circle', source: 'pois', minzoom: 15,
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
      filter: ['all', ['has', 'label'], ['!', ['in', ['get', 'cls'], ['literal', ['exit']]]]],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 19, 12.5],
        'text-offset': [0, .9], 'text-anchor': 'top', 'text-max-width': 7, 'text-padding': 3 },
      paint: { 'text-color': ['case', ['==', ['get', 'custom'], 2], '#b0a89a', ['==', ['get', 'custom'], 1], '#b45309', '#5f5748'],
        'text-halo-color': '#f6f5f2', 'text-halo-width': 1.4 } },
    { id: 'mall-label', type: 'symbol', source: 'pois', minzoom: 14,
      filter: ['all', ['has', 'label'], ['in', ['get', 'cls'], ['literal', ['mall', 'station', 'electronics']]]],
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
};
const TOKEN_KEY = 'hqb.gh.token';
const DRAFT_KEY = 'hqb.draft.v3';
const LEGACY_KEY = 'hqb.routes.v1';
const LANG_KEY = 'hqb.lang';

let routes = [];
let places = {};              // OSM id -> { en, zh }: names you've given things
let publishedJson = { routes: '[]', places: '{}' };
let lang = localStorage.getItem(LANG_KEY) || 'zh';
let canBuild = false;
let activeId = null;
let router = null;
let addMode = false;
let renameMode = false;
let markers = [];
let legs = [];
const basemap = { buildings: null, roads: null, pois: null };

const live = { routes: () => routes, places: () => places };
const token = () => localStorage.getItem(TOKEN_KEY);
const active = () => routes.find((r) => r.id === activeId) ?? null;
const dirtyKeys = () => Object.keys(FILES).filter((k) => JSON.stringify(live[k]()) !== publishedJson[k]);
const dirty = () => dirtyKeys().length > 0;
const saveDraft = () => canBuild && localStorage.setItem(DRAFT_KEY, JSON.stringify({ routes, places }));

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
    }
    map.getSource(key)?.setData(fc);
  }
  drawCustoms();
  $('#lang').textContent = lang === 'zh' ? '中' : 'EN';
  $('#lang').title = lang === 'zh' ? 'Showing Chinese — click for English' : 'Showing English — click for Chinese';
}

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

function renderStops() {
  const r = active();
  const el = $('#stops');
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
  if (renameMode && canBuild) {
    const mine = pickCustom(e.point);
    if (mine) return openCustom(mine);
    const hit = pickFeature(e.point);
    if (hit) return openOsm(hit);
    return openNew(e.lngLat);
  }
  if (!addMode || !canBuild) return;
  const r = active() ?? newRoute();
  // Take both scripts from the place you clicked, so the stop can be shown to a
  // local in Chinese even if you filed it under an English name.
  const hit = pickFeature(e.point);
  const o = hit ? places[hit.props.oid] : null;
  const zh = o?.zh || hit?.props?.zh || '';
  const en = o?.en || hit?.props?.en || '';
  r.stops.push({
    id: uid(), name: en || zh || '', zh, note: '', mins: 10,
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
  renderStops();
};

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

  const [pubRoutes, pubPlaces] = await Promise.all([loadJson('routes', []), loadJson('places', {})]);
  routes = Array.isArray(pubRoutes) ? pubRoutes : [];
  places = (pubPlaces && typeof pubPlaces === 'object' && !Array.isArray(pubPlaces)) ? pubPlaces : {};
  publishedJson = { routes: JSON.stringify(routes), places: JSON.stringify(places) };

  if (canBuild) {
    // An unpublished draft beats the published copy; losing edits would be worse
    // than showing stale ones, and Publish is always one click away.
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (d && (JSON.stringify(d.routes) !== publishedJson.routes
             || JSON.stringify(d.places) !== publishedJson.places)) {
        if (Array.isArray(d.routes)) routes = d.routes;
        if (d.places && typeof d.places === 'object') places = d.places;
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
