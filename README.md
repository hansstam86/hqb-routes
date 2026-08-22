# 华强北 walking routes

A route builder for Huaqiangbei, Shenzhen. Drop stops on the map in order; the line
follows the real footpath network, so the distance is what you'll actually walk rather
than a straight line through buildings.

**Live site:** https://hansstam86.github.io/hqb-routes/

```bash
npm run dev     # http://127.0.0.1:5180
```

## Using it

Hit **Add stops** and click the map. Each click adds the next stop, and if you click on a
mapped place it takes that name automatically — most Huaqiangbei malls and markets are
already in OpenStreetMap.

Every stop has a name, a free-text note ("what to do here"), and a time in minutes. The
header totals the three things that matter when planning a day: **walking distance**,
**total time** (walking at ~4.2 km/h plus your dwell minutes), and **stop count**.

- Drag the numbered badge in the list to reorder stops.
- Drag a marker on the map to move a stop.
- **Drag the line between two stops to bend it.** See below.
- Click a badge to fly to that stop.
- Keep several routes with the dropdown; each gets its own colour.

**Copy link** packs a route into the URL, so an unpublished draft can be opened on your
phone without any account or sync. **Export** writes a JSON file; **Import** reads one back.

## Bending the line

The router is only as good as OpenStreetMap, and Huaqiangbei is full of cut-throughs,
arcades and indoor shortcuts nobody has mapped. So the routed line is a starting point, not
a verdict.

Drag any point on the line and it becomes a **via point** — a white handle the route must
pass through. The two halves either side are still routed on real footpaths, so the distance
stays honest; you've only told the router which way to go.

- **Drag the line** → adds a via point there.
- **Drag a handle** → moves it.
- **Alt-click a handle** → removes it.

Reordering stops clears the via points on the affected route, since a hand-drawn detour
between two stops means nothing once their order changes.

## Who can edit

Routes are **public** — everyone loading the site gets the same routes from
`site/data/routes.json`, committed in this repo.

Editing is **yours alone**. The lock button asks for a GitHub fine-grained token with
`Contents: Read and write` on this repo; without one the site is strictly read-only, with no
add, edit, delete or publish controls. With one, the **Publish** button commits
`routes.json` straight to `main` via the GitHub API and Pages redeploys in about a minute.

The token is stored only in your browser's `localStorage`. It is never committed and never
sent anywhere except `api.github.com`. It is a real credential: anyone with access to that
device can publish as you, so revoke it at
[github.com/settings/tokens](https://github.com/settings/tokens) if a device is lost, and
use **Sign out** in the lock dialog to remove it from a browser.

Unpublished edits are kept as a local draft and restored on your next visit, so closing the
tab mid-route doesn't lose anything — but they aren't public until you press Publish.

## Why the line bends

Straight lines between stops would understate distance and route you through buildings. The
build extracts a walking graph from OpenStreetMap — 3,293 nodes and 3,785 edges — and the
browser runs Dijkstra over it between consecutive stops.

Edges are weighted, not just measured. Footways and pedestrian streets cost their true
length; residential and service roads a little more; Shennan-scale trunk roads 4.5×. Big
roads are in the graph only so it stays connected, so the router treats them as a last
resort and prefers the alleys people actually walk. Distances reported to you are always
real metres, never the weighted cost.

About 98% of point pairs across the district route successfully. When the network genuinely
can't connect two stops, that leg is drawn as a **dashed straight line** and a warning
appears above the stop list — it never passes off an as-the-crow-flies distance as a walked
one.

## Rebuilding the map data

```bash
npm run fetch:osm    # re-download from Overpass, rebuild basemap + walk graph
```

The bounding box lives in `scripts/overpass.ql` (`22.5370,114.0770,22.5530,114.0960` —
Shennan Middle Road up to Hongli Road). Change it there, rebuild, then update `CORE` and
`maxBounds` near the top of `site/app.js`.

## Deploying

`site/` is a plain static directory — no server, no build step. Drop it on anything:

```bash
npx wrangler pages deploy site      # Cloudflare Pages
npx netlify deploy --dir=site --prod
```

This repo publishes itself: `.github/workflows/pages.yml` uploads `site/` to GitHub Pages on
every push to `main`.

## Layout

```
scripts/overpass.ql    the bounding box + what to download
scripts/fetch-osm.sh   re-download, then rebuild
scripts/build.mjs      Overpass JSON -> basemap layers + walking graph
scripts/serve.mjs      dev-only static server
data/hqb.osm.json      raw download (24 MB, gitignored)
site/                  ← the deployable site
  data/                basemap layers + walkgraph.json
  data/routes.json     the published routes (public read, author-only write)
  router.js            Dijkstra over the walking graph
  app.js               map, route model, UI
  vendor/ fonts/       MapLibre and label glyphs, vendored so nothing is fetched at runtime
```

Map data © OpenStreetMap contributors (ODbL). MapLibre GL JS is BSD-3-Clause.
