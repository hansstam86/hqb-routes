/* Shortest walking paths over the OSM footway network.
   Straight lines between stops would understate distance and route you through
   buildings; this follows the alleys people actually walk. */

const M_LNG = 102800;   // metres per degree longitude at 22.54N
const M_LAT = 111000;

export function createRouter(graph) {
  const { xy, edges, cost } = graph;
  const n = xy.length / 2;

  // Each edge stores true metres and a weighted cost. Dijkstra minimises cost so
  // the route prefers alleys; distance reported to the user is always real metres.
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i], b = edges[i + 1];
    const d = dist(a, b);
    const w = d * (cost?.[i / 2] ?? 1);
    adj[a].push([b, w]);
    adj[b].push([a, w]);
  }

  function dist(a, b) {
    const dx = (xy[a * 2] - xy[b * 2]) * M_LNG;
    const dy = (xy[a * 2 + 1] - xy[b * 2 + 1]) * M_LAT;
    return Math.hypot(dx, dy);
  }

  // Coarse grid so snapping a click doesn't scan all 2800 nodes.
  const CELL = 0.002;
  const grid = new Map();
  const key = (lng, lat) => `${Math.floor(lng / CELL)},${Math.floor(lat / CELL)}`;
  for (let i = 0; i < n; i++) {
    const k = key(xy[i * 2], xy[i * 2 + 1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  function snap(lng, lat) {
    let best = -1, bestD = Infinity;
    for (let ring = 0; ring <= 3 && best < 0; ring++) {
      const cx = Math.floor(lng / CELL), cy = Math.floor(lat / CELL);
      for (let x = cx - ring; x <= cx + ring; x++) {
        for (let y = cy - ring; y <= cy + ring; y++) {
          for (const i of grid.get(`${x},${y}`) ?? []) {
            const dx = (xy[i * 2] - lng) * M_LNG, dy = (xy[i * 2 + 1] - lat) * M_LAT;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
    }
    return best;
  }

  /* Dijkstra with a binary heap. The graph is small; this is well under a
     millisecond, so the whole route can be recomputed on every drag. */
  function path(from, to) {
    if (from === to) return [from];
    const distTo = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    distTo[from] = 0;

    const heap = [[0, from]];
    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let s = i;
          if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
          if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
          if (s === i) break;
          [heap[s], heap[i]] = [heap[i], heap[s]];
          i = s;
        }
      }
      return top;
    };

    while (heap.length) {
      const [d, v] = pop();
      if (done[v]) continue;
      done[v] = 1;
      if (v === to) break;
      for (const [w, len] of adj[v]) {
        const nd = d + len;
        if (nd < distTo[w]) { distTo[w] = nd; prev[w] = v; push([nd, w]); }
      }
    }
    if (distTo[to] === Infinity) return null;

    const out = [];
    for (let v = to; v !== -1; v = prev[v]) out.push(v);
    return out.reverse();
  }

  const coordOf = (i) => [xy[i * 2], xy[i * 2 + 1]];

  /* Cost from one node to every other, in a single pass. Ranking 57 metro exits
     by distance is one search this way instead of 57. */
  function costsFrom(from) {
    const distTo = new Float64Array(n).fill(Infinity);
    const done = new Uint8Array(n);
    if (from < 0) return distTo;
    distTo[from] = 0;
    const heap = [[0, from]];
    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let sm = i;
          if (l < heap.length && heap[l][0] < heap[sm][0]) sm = l;
          if (r < heap.length && heap[r][0] < heap[sm][0]) sm = r;
          if (sm === i) break;
          [heap[sm], heap[i]] = [heap[i], heap[sm]];
          i = sm;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, v] = pop();
      if (done[v]) continue;
      done[v] = 1;
      for (const [w, len] of adj[v]) {
        const nd = d + len;
        if (nd < distTo[w]) { distTo[w] = nd; push([nd, w]); }
      }
    }
    return distTo;
  }

  /* A leg between two stops. Falls back to a straight line when the network
     can't connect them, and says so, rather than reporting a bogus distance. */
  function leg(a, b) {
    const na = snap(a[0], a[1]), nb = snap(b[0], b[1]);
    const p = na >= 0 && nb >= 0 ? path(na, nb) : null;
    if (!p) {
      const dx = (a[0] - b[0]) * M_LNG, dy = (a[1] - b[1]) * M_LAT;
      return { coords: [a, b], metres: Math.hypot(dx, dy), direct: true };
    }
    const coords = [a, ...p.map(coordOf), b];
    let m = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = (coords[i][0] - coords[i - 1][0]) * M_LNG;
      const dy = (coords[i][1] - coords[i - 1][1]) * M_LAT;
      m += Math.hypot(dx, dy);
    }
    return { coords, metres: m, direct: false };
  }

  return { snap, leg, costsFrom, size: n };
}
