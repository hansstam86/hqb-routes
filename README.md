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

## Language

The **中 / EN** button in the header switches every label on the map — buildings, places
and streets — plus the stop names in the panel. It's there for everyone, not just you.

The point is the awkward moment on the street: switch to 中, and the destination is written
in characters you can show to a passer-by or a driver. Stops carry a separate 中文名 field
for exactly this, filled in automatically when you drop a stop on a mapped place, and shown
under the English name so the Chinese is always to hand.

Where OpenStreetMap has only one script, that one is used in both views rather than leaving
a blank — 华强广场, for instance, has no English name upstream. Roughly half the named
features here are missing one language.

## Naming things yourself

That gap is what the **Names** tool is for. Turn it on, then click anything on the map.
Your names show in **amber**, so you can always tell yours from OpenStreetMap's.

| Click | What you get |
|---|---|
| A building, place or street | Rename it, or **Hide this name** to take the label off the map |
| One of your own names | Edit it, or **Delete** it outright |
| Empty ground | **Add a name** where OpenStreetMap has nothing at all |

Names you add from scratch sit where you clicked and can be dragged to reposition while the
tool is on. Each is tagged as a place, a building or a street, which sets how it's drawn.

**Hiding** is how you delete a name you don't want — an OSM label that's wrong, stale or just
clutter. Hidden names don't vanish on you: while the Names tool is on they stay visible in
**grey** so you can click one and bring it back with **Reset to OSM**. Visitors never see
them. Anything you've already touched wins the click over anything else under the cursor,
so your own edits are always reachable again.

Clicking a label picks that labelled thing; clicking bare ground picks whatever is under the
cursor, preferring something already named over an unnamed service road.

Names live in `site/data/places.json`, keyed by OpenStreetMap id (`way/492615869`) for
overrides and by a generated `custom/…` id for ones you add. They publish alongside routes
with the same button. Because overrides are keyed by id, re-running `npm run fetch:osm`
keeps them attached — unless OSM replaces the feature, in which case the override is
orphaned and the OSM label returns. Names you added yourself carry their own coordinates and
are unaffected.

## What's sold where

Huaqiangbei is vertical: which floor a thing is on matters more than which street. The
**Buildings** tab keeps a floor-by-floor directory for each building.

Click any building on the map with no tool active and it opens there. Add floors, each with a
level (`B1`, `1F`, `3F`), what's sold on it, and the Chinese for the same. Floors sort the way
you'd walk them — B2, B1, 1F, 2F — regardless of the order you type them in. Buildings with a
directory are tinted **gold** on the map, so you can see at a glance which ones you've done.

The search box is the point of all this. Type `connectors` or `线材` and it searches every
directory at once, returning the building *and the floor*:

```
SEG Plaza    3F    Connectors, cables, wire
```

Click a result to jump there. It matches both scripts, so you can search in whichever you
were thinking in.

Directories live in `site/data/buildings.json`, keyed by OpenStreetMap id like the names, and
publish with the same button. Visitors get a read-only directory board; only you see the
editing controls.

## Who can edit

Routes, custom names and building directories are **public** — everyone loading the site gets
the same data from `routes.json`, `places.json` and `buildings.json`, committed in this repo.

Editing is **yours alone**. The lock button asks for a GitHub fine-grained token with
`Contents: Read and write` on this repo; without one the site is strictly read-only, with no
add, edit, delete or publish controls. With one, the **Publish** button commits whichever
of the three data files changed straight to `main` via the GitHub API, and Pages redeploys in
about a minute.

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
  data/places.json     your names: overrides, hidden labels, and ones you added
  data/buildings.json  floor-by-floor directories of what's sold where
  router.js            Dijkstra over the walking graph
  app.js               map, route model, UI
  vendor/ fonts/       MapLibre and label glyphs, vendored so nothing is fetched at runtime
```

Map data © OpenStreetMap contributors (ODbL). MapLibre GL JS is BSD-3-Clause.
