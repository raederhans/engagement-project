# Roadnet Packet A Log 20251118T022208Z

- start: 2025-11-17T21:22:08-05:00
- npm run data:fetch:streets

> dashboard-project@0.0.0 data:fetch:streets
> node scripts/fetch_streets_phl.mjs

- npm run data:segment:streets

> dashboard-project@0.0.0 data:segment:streets
> node scripts/segment_streets_phl.mjs

- node scripts/segment_streets_phl.mjs (via Windows node) → raw 109,953 ways, bbox-filter 105,838, segments 144,120 (kept 7,586 sampled)
- npm run data:gen → 64 demo segments / 5 routes using network
- /mnt/c/Program Files/nodejs/node.exe scripts/segment_streets_phl.mjs → raw 109,953 ways, bbox-filter 105,838, segments 144,120 (class counts: 1=4043,2=8267,3=5598,4=126,212)
- npm run data:gen → 64 demo segments / 5 routes on network
