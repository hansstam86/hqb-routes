import * as maplibregl from './vendor/maplibre-gl.mjs';   // v6 exports names, not a default
import { createRouter } from './router.js';

const $ = (s) => document.querySelector(s);
const EMPTY = { type: 'FeatureCollection', features: [] };
const COLORS = ['#c81e3a', '#1d4ed8', '#047857', '#b45309', '#7c3aed', '#0e7490'];
const WALK_M_PER_MIN = 70;          // ~4.2 km/h, allowing for Huaqiangbei crowds
const STORE = 'hqb.routes.v1';

const uid = () => (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now());
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------------------------------------------------------- basemap */

const geo = (n) => ({
  type: 'geojson', data: `./data/${n}.geojson`,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
});
const road = (id, cls, stops, color, extra = {}) => ({
  id, type: 'line', source: 'roads', filter: ['==', ['get', 'cls'], cls],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': color, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], ...stops], ...extra },
});

const style = {
  version: 8,
  glyphs: './fonts/{fontstack}/{range}.pbf',
  sources: {
    water: geo('water'), green: geo('green'), buildings: geo('buildings'),
    roads: geo('roads'), rail: geo('rail'), pois: geo('pois'),
    route: { type: 'geojson', data: EMPTY },
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

    { id: 'rail', type: 'line', source: 'rail',
      paint: { 'line-color': '#b6afa3', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 3], 'line-dasharray': [3, 2] } },

    { id: 'poi', type: 'circle', source: 'pois', minzoom: 15,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.8, 18, 3.4],
        'circle-color': '#a89e8e', 'circle-opacity': .8 } },
    { id: 'poi-label', type: 'symbol', source: 'pois', minzoom: 16,
      filter: ['!', ['in', ['get', 'cls'], ['literal', ['exit']]]],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 19, 12.5],
        'text-offset': [0, .9], 'text-anchor': 'top', 'text-max-width': 7, 'text-padding': 3 },
      paint: { 'text-color': '#5f5748', 'text-halo-color': '#f6f5f2', 'text-halo-width': 1.4 } },
    { id: 'mall-label', type: 'symbol', source: 'pois', minzoom: 14,
      filter: ['in', ['get', 'cls'], ['literal', ['mall', 'station', 'electronics']]],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 19, 14.5], 'text-max-width': 8, 'text-padding': 4 },
      paint: { 'text-color': '#4c4438', 'text-halo-color': '#f6f5f2', 'text-halo-width': 1.8 } },

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

/* ---------------------------------------------------------------- state */

let routes = [];
let activeId = null;
let router = null;
let addMode = false;
let markers = [];
let legs = [];

const active = () => routes.find((r) => r.id === activeId) ?? null;
const save = () => localStorage.setItem(STORE, JSON.stringify(routes));

function newRoute(name) {
  const r = { id: uid(), name: name || `Route ${routes.length + 1}`, color: COLORS[routes.length % COLORS.length], stops: [] };
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
  setTimeout(() => el.remove(), 2600);
}

/* ---------------------------------------------------------------- routing */

function recompute() {
  const r = active();
  legs = [];
  if (!r || r.stops.length < 2 || !router) return;
  for (let i = 1; i < r.stops.length; i++) {
    const a = r.stops[i - 1], b = r.stops[i];
    legs.push(router.leg([a.lng, a.lat], [b.lng, b.lat]));
  }
}

function drawRoute() {
  const r = active();
  const features = legs.map((l, i) => ({
    type: 'Feature',
    properties: { color: r.color, direct: l.direct, i },
    geometry: { type: 'LineString', coordinates: l.coords },
  }));
  map.getSource('route')?.setData({ type: 'FeatureCollection', features });

  for (const m of markers) m.remove();
  markers = [];
  if (!r) return;
  r.stops.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'marker';
    el.style.background = r.color;
    el.textContent = String(i + 1);
    const m = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([s.lng, s.lat]).addTo(map);
    m.on('dragstart', () => el.classList.add('drag'));
    m.on('dragend', () => {
      el.classList.remove('drag');
      const p = m.getLngLat();
      s.lng = p.lng; s.lat = p.lat;
      commit();
    });
    markers.push(m);
  });
}

const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const fmtMins = (n) => (n >= 60 ? `${Math.floor(n / 60)}h ${Math.round(n % 60)}m` : `${Math.round(n)} min`);

function refreshStats() {
  const r = active();
  const metres = legs.reduce((a, l) => a + l.metres, 0);
  const dwell = (r?.stops ?? []).reduce((a, s) => a + (Number(s.mins) || 0), 0);
  const walk = metres / WALK_M_PER_MIN;
  $('#statDist').textContent = fmtDist(metres);
  $('#statTime').textContent = fmtMins(walk + dwell);
  $('#statStops').textContent = r?.stops.length ?? 0;

  const broken = legs.filter((l) => l.direct).length;
  const warn = $('#warn');
  warn.hidden = !broken;
  if (broken) {
    warn.textContent = `${broken} leg${broken > 1 ? 's' : ''} shown as a dashed straight line — `
      + `no mapped footpath connects those stops, so that distance is as-the-crow-flies.`;
  }
}

/* commit = recompute geometry, redraw, update UI, persist. */
function commit() {
  recompute();
  drawRoute();
  refreshStats();
  renderStops();
  save();
}

/* ---------------------------------------------------------------- stops UI */

function renderStops() {
  const r = active();
  const el = $('#stops');
  el.innerHTML = '';
  $('#empty').hidden = !!(r && r.stops.length);
  if (!r) return;

  r.stops.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'stop';
    li.draggable = false;
    li.dataset.i = i;
    const legTxt = i > 0 && legs[i - 1]
      ? `${fmtDist(legs[i - 1].metres)}${legs[i - 1].direct ? ' direct' : ''}` : 'start';
    li.innerHTML = `
      <div class="n" style="background:${r.color}" draggable="true" title="Drag to reorder">${i + 1}</div>
      <div class="body">
        <input class="nm" value="${esc(s.name)}" placeholder="Stop ${i + 1}" autocomplete="off" spellcheck="false" />
        <textarea class="nt" rows="1" placeholder="What to do here…">${esc(s.note)}</textarea>
      </div>
      <div class="side">
        <button class="x" title="Remove stop">×</button>
        <div class="mins"><input class="mi" value="${Number(s.mins) || 0}" inputmode="numeric" autocomplete="off" /> min</div>
        <span class="legdist">${legTxt}</span>
      </div>`;

    li.querySelector('.nm').oninput = (e) => { s.name = e.target.value; save(); };
    li.querySelector('.nt').oninput = (e) => { s.note = e.target.value; autoGrow(e.target); save(); };
    li.querySelector('.mi').oninput = (e) => { s.mins = e.target.value.replace(/\D/g, ''); refreshStats(); save(); };
    li.querySelector('.x').onclick = () => { r.stops.splice(i, 1); commit(); };
    li.querySelector('.n').onclick = () => map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 17) });

    // Reorder by dragging the number badge.
    const badge = li.querySelector('.n');
    badge.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(i));
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('drag');
    });
    badge.addEventListener('dragend', () => li.classList.remove('drag'));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('over'); });
    li.addEventListener('dragleave', () => li.classList.remove('over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('over');
      const from = Number(e.dataTransfer.getData('text/plain'));
      const to = Number(li.dataset.i);
      if (Number.isNaN(from) || from === to) return;
      const [moved] = r.stops.splice(from, 1);
      r.stops.splice(to, 0, moved);
      commit();
    });

    el.append(li);
    autoGrow(li.querySelector('.nt'));
  });
}

function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; }

/* ---------------------------------------------------------------- routes UI */

function renderRouteBar() {
  const sel = $('#routeSel');
  sel.innerHTML = routes.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  sel.value = activeId ?? '';
  const r = active();
  $('#routeName').value = r?.name ?? '';
  $('#swatches').innerHTML = COLORS
    .map((c) => `<button data-c="${c}" style="background:${c}" class="${r && r.color === c ? 'on' : ''}" title="${c}"></button>`).join('');
  $('#swatches').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { const a = active(); if (!a) return; a.color = b.dataset.c; renderRouteBar(); commit(); };
  });
}

function selectRoute(id) {
  activeId = id;
  renderRouteBar();
  commit();
  const r = active();
  if (r?.stops.length) fitRoute();
}

function fitRoute() {
  const r = active();
  if (!r?.stops.length) return;
  const pts = legs.length ? legs.flatMap((l) => l.coords) : r.stops.map((s) => [s.lng, s.lat]);
  const b = pts.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(pts[0], pts[0]));
  map.resize();
  map.fitBounds(b, { padding: panelPad(), maxZoom: 17.5 });
}

/* ---------------------------------------------------------------- map input */

function setAddMode(on) {
  addMode = on;
  $('#addMode').classList.toggle('on', on);
  $('#hint').textContent = on ? 'Click the map to drop stops in order' : '';
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
}

map.on('click', (e) => {
  if (!addMode) return;
  const r = active() ?? newRoute();
  // If you clicked on a mapped place, take its name — saves typing the obvious ones.
  const hit = map.queryRenderedFeatures(e.point, { layers: ['poi', 'poi-label', 'mall-label'].filter((l) => map.getLayer(l)) });
  r.stops.push({
    id: uid(),
    name: hit[0]?.properties?.name ?? '',
    note: '', mins: 10,
    lng: +e.lngLat.lng.toFixed(6), lat: +e.lngLat.lat.toFixed(6),
  });
  renderRouteBar();
  commit();
});

$('#addMode').onclick = () => setAddMode(!addMode);
$('#undo').onclick = () => {
  const r = active();
  if (!r?.stops.length) return;
  r.stops.pop();
  commit();
};

/* ---------------------------------------------------------------- chrome */

$('#routeSel').onchange = (e) => selectRoute(e.target.value);
$('#newRoute').onclick = () => { newRoute(); renderRouteBar(); commit(); setAddMode(true); };
$('#routeName').oninput = (e) => { const r = active(); if (!r) return; r.name = e.target.value; save(); renderRouteBar(); };
$('#delRoute').onclick = () => {
  const r = active();
  if (!r) return;
  if (!confirm(`Delete "${r.name}"? This can't be undone.`)) return;
  routes = routes.filter((x) => x.id !== r.id);
  activeId = routes[0]?.id ?? null;
  if (!routes.length) newRoute();
  renderRouteBar();
  commit();
};
$('#collapse').onclick = () => { $('#panel').classList.add('hide'); $('#reveal').hidden = false; };
$('#reveal').onclick = () => { $('#panel').classList.remove('hide'); $('#reveal').hidden = true; };

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
    const incoming = JSON.parse(await f.text());
    const list = Array.isArray(incoming) ? incoming : [incoming];
    for (const r of list) {
      if (!Array.isArray(r.stops)) continue;
      routes.push({ ...r, id: uid() });
    }
    activeId = routes[routes.length - 1].id;
    renderRouteBar();
    commit();
    toast(`Imported ${list.length} route${list.length > 1 ? 's' : ''}`);
  } catch (err) { alert(`Could not import: ${err.message}`); }
  e.target.value = '';
};

/* A route packed into the URL, so a route built at the desk opens on your phone. */
const packRoute = (r) => btoa(unescape(encodeURIComponent(JSON.stringify({
  n: r.name, c: r.color, s: r.stops.map((s) => [s.lng, s.lat, s.name, s.note, s.mins]),
})))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function unpackRoute(b64) {
  const j = JSON.parse(decodeURIComponent(escape(atob(b64.replace(/-/g, '+').replace(/_/g, '/')))));
  return {
    id: uid(), name: j.n || 'Shared route', color: j.c || COLORS[0],
    stops: (j.s || []).map(([lng, lat, name, note, mins]) => ({ id: uid(), lng, lat, name: name || '', note: note || '', mins: mins ?? 10 })),
  };
}

$('#share').onclick = async () => {
  const r = active();
  if (!r?.stops.length) return toast('Add some stops first');
  const url = `${location.origin}${location.pathname}#r=${packRoute(r)}`;
  try { await navigator.clipboard.writeText(url); toast('Link copied — opens this route anywhere'); }
  catch { prompt('Copy this link:', url); }
};

/* ---------------------------------------------------------------- boot */

map.on('load', async () => {
  try {
    const graph = await (await fetch('./data/walkgraph.json')).json();
    router = createRouter(graph);
  } catch (err) {
    console.error('walk graph failed to load', err);
    toast('Routing unavailable — legs will be straight lines');
  }

  try { routes = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { routes = []; }
  if (!Array.isArray(routes)) routes = [];

  const hash = location.hash.match(/^#r=(.+)$/);
  if (hash) {
    try {
      routes.push(unpackRoute(hash[1]));
      history.replaceState(null, '', location.pathname);
      toast('Opened shared route');
    } catch { toast('That shared link could not be read'); }
  }

  if (!routes.length) newRoute('My first route');
  activeId = routes[routes.length - 1].id;

  renderRouteBar();
  commit();
  if (active()?.stops.length) fitRoute();
  else { fitCore(); setAddMode(true); }
});

map.on('error', (e) => console.warn('map:', e.error?.message || e));
window.hqb = { routes: () => routes, map, router: () => router };
