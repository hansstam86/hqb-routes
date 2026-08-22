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

## Metro

Getting around Huaqiangbei starts at a metro exit, so the map treats them as first-class.

**Exits** are drawn as pills with the letter people actually navigate by — `A`, `D1`, `E2` —
in the colour of the line they serve. There are 40 of them across seven stations.
OpenStreetMap had this all along and the map was throwing it away.

**Lines** are drawn in their own colours — Line 1 green, Line 2 orange, Line 7 blue — dashed,
because they run underneath you.

**Stations** are outlined in the colours of the lines that serve them, one band per line, so
an interchange reads as an interchange: 华强路站 is plain green because only Line 1 stops
there, while 华强北站 carries an orange band and a blue one. They also show line badges.

None of this is tagged usably in OSM. Line colours come from the route relations; which line
stops where is derived at build time by matching each line's stop-positions to the station
beside it; and station *areas* (`building=train_station`) carry no line reference at all, so
they're matched back by name.

**A series that wasn't real.** OpenStreetMap tags 17 nodes north of 振华路 as
`railway=subway_entrance` with nothing but a number, 1 to 17. They sit 135–305 m from any
station and run in two columns up 华强北路. They don't correspond to metro access on the
ground, so the build drops them (`bogusEntrance` in `scripts/build.mjs`). Every exit that
survives is lettered and belongs to a station 37–214 m away.

If a future `npm run fetch:osm` brings back numbered entrances somewhere legitimate, the rule
is geographic — numeric ref *and* north of lat 22.5472 — so it won't silently eat them.

**Nearest exit** is computed along the walking network, not as the crow flies, and shown on
every building directory and above every route:

```
SEG Plaza 赛格广场      华强北 exit D1 · 229 m walk
```

A route also offers **Add as first stop**, which prepends that exit with a zero-minute dwell —
most trips here begin by coming up some steps. Dropping a stop directly on an exit names it
`华强北 exit D1` / `华强北站 D1出口` automatically.

Ranking 57 exits is a single search, not 57: the router does one Dijkstra from the
destination and reads every exit's cost off the result, which takes about 3 ms.

### What this still can't do

Tencent and Amap model the *inside* of these stations — concourse layouts, transfer passages,
which underground exit connects to which mall basement. OpenStreetMap has essentially no
indoor mapping in Huaqiangbei, so neither do we. If that matters, it has to be surveyed by
hand into the building directories.

## What's sold where

Huaqiangbei is vertical: which floor a thing is on matters more than which street. The
**Buildings** tab keeps a floor-by-floor directory for each building.

Click any building on the map with no tool active and it opens there. Add floors, each with a
level (`B1`, `1F`, `3F`), what's sold on it, and the Chinese for the same. Floors sort the way
you'd walk them — B2, B1, 1F, 2F — regardless of the order you type them in. Buildings with a
directory are tinted **gold** on the map, so you can see at a glance which ones you've done.

### Ways in

OpenStreetMap has **three** entrance nodes in the whole of Huaqiangbei, all unnamed — useless
for blocks like 赛格, SEGCOM or the AVIC Center. So entrances are yours to place.

With a building open, **+ Add entrance** then click the map. Each gets a short label drawn on
the map (`N`, `1`, `西`) plus a full name in both scripts. Drag one to nudge it onto the
actual door. They render as slate pills — deliberately the same shape as the green metro
exits, since they do the same job — and visitors see them too.

### Booths

Each floor expands to a list of booths — the toggle on the right of the floor row. A booth has
its **code** (`3C21`), what it sells in both scripts, and a free note for the things that
actually matter on the day: who to ask, what they quoted, minimum order.

That's the level people can act on. "3F is connectors" gets someone to the right floor;
"3C21, ask for the guy at the back" gets them to the right stall.

### Finding things

The search box is the point of all this. Type `connectors`, `线材`, `3H09`, or a name from a
note, and it searches every directory at once — floors *and* booths:

```
SEG Plaza   3F           Connectors, cables, wire
SEG Plaza   3F · 3C21    USB-C connectors
```

Floor and booth matches both show, because "the whole floor is connectors" and "this one
booth" answer different questions. Click a result and it jumps to the building with that
floor already open. It matches both scripts and booth codes, so you can search however you
were thinking about it.

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
  data/transit.geojson metro exits (with letters) and stations (with lines/colours)
  data/routes.json     the published routes (public read, author-only write)
  data/places.json     your names: overrides, hidden labels, and ones you added
  data/buildings.json  floor-by-floor directories of what's sold where
  router.js            Dijkstra over the walking graph
  app.js               map, route model, UI
  vendor/ fonts/       MapLibre and label glyphs, vendored so nothing is fetched at runtime
```

Map data © OpenStreetMap contributors (ODbL). MapLibre GL JS is BSD-3-Clause.
