#!/usr/bin/env bash
set -euo pipefail

echo "== Route Safety Diary env setup (bash) =="
node -v && npm -v || true

echo ">> Installing deps (ajv, dayjs, @turf/turf)..."
npm pkg set scripts._tmp="echo ok" >/dev/null 2>&1 || true
npm i ajv dayjs @turf/turf -S

echo ">> Ensuring .env.example..."
if [ ! -f .env.example ]; then
  cat > .env.example <<'EOF'
# Feature flag for Route Safety Diary
VITE_FEATURE_DIARY=0
EOF
  echo "  .env.example created"
else
  echo "  .env.example exists"
fi

echo ">> Seeding data/segments_phl.dev.geojson..."
mkdir -p data
cat > data/segments_phl.dev.geojson <<'EOF'
{
  "type":"FeatureCollection",
  "features":[
    {"type":"Feature","properties":{"segment_id":"seg_001","length_m":120},"geometry":{"type":"LineString","coordinates":[[-75.1900,39.9520],[-75.1890,39.9525]]}},
    {"type":"Feature","properties":{"segment_id":"seg_002","length_m":180},"geometry":{"type":"LineString","coordinates":[[-75.1890,39.9525],[-75.1880,39.9530]]}},
    {"type":"Feature","properties":{"segment_id":"seg_003","length_m":95},"geometry":{"type":"LineString","coordinates":[[-75.1895,39.9515],[-75.1890,39.9525]]}}
  ]
}
EOF
echo "  Seed written (3 segments)."

echo ">> Done."
