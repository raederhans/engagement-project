Param()
$ErrorActionPreference = "Stop"
Write-Host "== Route Safety Diary env setup (PowerShell) =="

node -v; npm -v

Write-Host ">> Installing deps (ajv, dayjs, @turf/turf)..."
npm i ajv dayjs @turf/turf -S

Write-Host ">> Ensuring .env.example..."
if (!(Test-Path ".env.example")) {
@"
# Feature flag for Route Safety Diary
VITE_FEATURE_DIARY=0
"@ | Set-Content ".env.example" -NoNewline -Encoding UTF8
  Write-Host "  .env.example created"
} else {
  Write-Host "  .env.example exists"
}

Write-Host ">> Seeding data/segments_phl.dev.geojson..."
New-Item -ItemType Directory -Force -Path "data" | Out-Null
@'
{
  "type":"FeatureCollection",
  "features":[
    {"type":"Feature","properties":{"segment_id":"seg_001","length_m":120},"geometry":{"type":"LineString","coordinates":[[-75.1900,39.9520],[-75.1890,39.9525]]}},
    {"type":"Feature","properties":{"segment_id":"seg_002","length_m":180},"geometry":{"type":"LineString","coordinates":[[-75.1890,39.9525],[-75.1880,39.9530]]}},
    {"type":"Feature","properties":{"segment_id":"seg_003","length_m":95},"geometry":{"type":"LineString","coordinates":[[-75.1895,39.9515],[-75.1890,39.9525]]}}
  ]
}
'@ | Set-Content "data/segments_phl.dev.geojson" -NoNewline -Encoding UTF8

Write-Host ">> Done."
