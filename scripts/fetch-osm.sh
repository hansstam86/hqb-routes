#!/usr/bin/env bash
# Re-pull Huaqiangbei from OpenStreetMap and rebuild. Your routes live in the
# browser (and in exported JSON) and are untouched by this.
set -euo pipefail
cd "$(dirname "$0")/.."
for EP in https://overpass.kumi.systems/api/interpreter \
          https://overpass-api.de/api/interpreter \
          https://overpass.private.coffee/api/interpreter; do
  echo "→ $EP"
  code=$(curl -sS -m 280 -X POST -d @scripts/overpass.ql "$EP" -o data/hqb.osm.json.tmp -w "%{http_code}" || echo 000)
  size=$(stat -f%z data/hqb.osm.json.tmp 2>/dev/null || echo 0)
  if [ "$code" = "200" ] && [ "$size" -gt 100000 ]; then
    mv data/hqb.osm.json.tmp data/hqb.osm.json
    echo "✓ $((size/1024)) KB"; node scripts/build.mjs; exit 0
  fi
  echo "  failed (http=$code) — next mirror"
done
rm -f data/hqb.osm.json.tmp
echo "✗ all Overpass mirrors failed; existing build unchanged." >&2; exit 1
