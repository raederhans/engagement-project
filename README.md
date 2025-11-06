# Philadelphia Crime Dashboard

An interactive web dashboard for exploring crime incidents in Philadelphia using MapLibre GL, Chart.js, and the City of Philadelphia's open data APIs.

## How to Use the Dashboard

### Setting Your Area of Interest (Buffer A)
1. Click **"Select on Map"** button to enter selection mode
2. Click anywhere on the map to set your buffer center (marker A will appear)
3. Choose a **radius** (400m, 800m, 1.6km, or 3.2km) to define your area
4. An orange circle shows your selected buffer zone

### Time Window Controls
- **Quick Presets:** Click "Last 3mo", "Last 6mo", or "Last 12mo" for recent data
- **Custom Range:** Use the start month picker + duration dropdown to query historical windows (e.g., Jan 2023 - Jun 2023)

### Filtering by Crime Type
- **Offense Groups:** Select broad categories (Property, Violent, Vehicle, etc.) from the multi-select
- **Drilldown:** After selecting groups, the fine-grained codes dropdown populates with specific offense types (e.g., "THEFT", "RETAIL THEFT")
- Choose specific codes to narrow your analysis further

### Map Layers & Visualization
- **Admin Level Toggle:** Switch between **Police Districts** and **Census Tracts** views
- **Display Mode:** Toggle between raw **counts** and **per-10k population** rates
- **Click districts/tracts** for detailed popup stats (total incidents, per-10k rate, 30-day trends, top-3 offense types)
- **Hover** over any polygon to see quick stats in the tooltip

### Charts & Compare Card
- **Monthly Series:** Line chart comparing your buffer (A) vs citywide trends
- **Top Offenses:** Bar chart showing most frequent crime types in buffer A
- **7x24 Heatmap:** Hour-of-day and day-of-week patterns
- **Compare A Card:** Live summary with total incidents, per-10k rate, 30-day change, and top-3 offenses

For detailed control semantics and technical specifications, see [docs/CONTROL_SPEC.md](docs/CONTROL_SPEC.md).

## Quick Start (Dev vs Preview)

> **‚ö†Ô∏è CRITICAL:** Do NOT open `index.html` directly in your browser. The app requires a bundler (Vite) to resolve ES modules and dependencies.

> **üìÅ Vite Project Structure Rule:** In Vite projects, `index.html` MUST be in the **project root**, not in `public/`. The `public/` directory is for static assets (images, fonts) copied as-is. If you see build errors about "HTML proxy", verify `index.html` is at project root with script tags using absolute paths like `/src/main.js`.

### Development Mode (Recommended)
```bash
npm install
npm run dev
```
- Opens at `http://localhost:5173/`
- Hot module replacement (instant updates on file save)
- Full dev tools and error reporting

### Production Preview
```bash
npm run build
npm run preview
```
- Builds optimized bundle to `dist/`
- Serves production build at `http://localhost:4173/`
- Use this to test before deploying

**Current Status (2025-10-15):** Build currently fails due to `vite.config.js` `root: 'public'` configuration. See [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) for active blockers and [docs/DEPLOY.md](docs/DEPLOY.md) for detailed troubleshooting.

### Basemap & CSS

- The base map uses OpenStreetMap raster tiles: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- The MapLibre GL CSS is linked via unpkg in `public/index.html` to keep setup simple:
  `<link href="https://unpkg.com/maplibre-gl@^4.5.0/dist/maplibre-gl.css" rel="stylesheet" />`
- Attribution: ¬© OpenStreetMap contributors.

### Charts

## How to Use the Dashboard

- Use map selection: click ‚ÄúSelect on map‚Ä?then click the map to set the A center; press Esc or click the button again to cancel. A translucent circle shows the current buffer.
- Radius: changes the buffer radius used by points, charts, and the compare card; the district choropleth is unaffected by radius.
- Time window: pick a start month and duration (3/6/12/24). Presets ‚ÄúLast 6m/12m‚Ä?help jump quickly.
- Offense grouping & drilldown: pick one or more groups, then optionally drill down into specific codes (the list reflects live audited codes).
- Admin level: switch between Districts and Tracts; per‚Ä?0k requires tracts + ACS.
- Clusters: when too many points are present, clusters are shown with a prompt to zoom in.

- Charts are implemented with Chart.js v4. Before running the app, install dependencies:
  `npm i`
- First run may download ~1‚Ä? MB of packages.
- Rebuild anytime with `npm run build`.
 - Requires `npm i` to install chart.js; see `logs/vite_build_*.log` for bundling status.

## Data Sources

- CARTO SQL API (City of Philadelphia): https://phl.carto.com/api/v2/sql
- Police Districts (GeoJSON):
  https://policegis.phila.gov/arcgis/rest/services/POLICE/Boundaries/MapServer/1/query?where=1=1&outFields=*&f=geojson
- Census Tracts (Philadelphia subset, GeoJSON):
  https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0/query?where=STATE_FIPS='42'%20AND%20COUNTY_FIPS='101'&outFields=FIPS,STATE_FIPS,COUNTY_FIPS,TRACT_FIPS,POPULATION_2020&f=geojson
- ACS 2023 5‚ÄëYear (population/tenure/income):
  https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E,B25003_001E,B25003_003E,B19013_001E&for=tract:*&in=state:42%20county:101
- ACS 2023 5‚ÄëYear Subject (poverty rate):
  https://api.census.gov/data/2023/acs/acs5/subject?get=NAME,S1701_C03_001E&for=tract:*&in=state:42%20county:101

## Limitations

- UCR categories are generalized for reporting and do not reflect full incident coding.
- Incident locations are rounded to the hundred block; exact addresses are not provided.
- Counts in this tool may differ from official UCR reports due to methodology and updates.

## Caching & Boundaries

- Police Districts are cached at `public/data/police_districts.geojson` when available.
- At runtime, the app loads the cached file first; if not present or invalid, it falls back to the live ArcGIS service above.

## Performance Policies

- Never fetch the full incidents table; all requests are constrained by a time window and, when the map is visible, the current map bounding box.
- If a points query returns more than 20,000 features, the app hides individual points and prompts the user to zoom, showing clusters instead.
- Clustering is enabled for point sources to improve rendering performance and legibility.

## Compare A/B Semantics

- ‚ÄúA vs B‚Ä?compares buffer‚Äëbased totals around two centers using the same time window and offense filters.
- Per‚Ä?0k rates are only computed when the Tracts layer and ACS population are loaded for the relevant geography; otherwise per‚Ä?0k is omitted.

## Tracts + ACS (per‚Ä?0k)

- The "Tracts" admin level uses cached tracts geometry and ACS 2023 tract stats.
- Per‚Ä?0k rates are computed as (value / population) * 10,000 when population data is available.
- Tracts with population < 500 are masked from the choropleth to avoid unstable rates.

## Precompute tract counts

- To speed up tracts choropleths for longer windows, you can precompute last‚Ä?2‚Äëmonths crime counts per tract:
  - Run: `node scripts/precompute_tract_counts.mjs`
  - Output JSON: `src/data/tract_counts_last12m.json`
  - Logs: `logs/precompute_tract_counts_*.log`
- Data freshness: re‚Äërun the script periodically to refresh counts. The app will use the precomputed file when present, and fall back to live computations otherwise.

## Technical Documentation

- **Control Specifications:** [docs/CONTROL_SPEC.md](docs/CONTROL_SPEC.md) - Detailed state model, event flows, visual aids, and edge cases for all UI controls
- **Fix Plan:** [docs/FIX_PLAN.md](docs/FIX_PLAN.md) - Root cause analysis and implementation steps for known UX/logic issues
- **TODO:** [docs/TODO.md](docs/TODO.md) - Actionable task list with acceptance tests
- **Deployment Guide:** [docs/DEPLOY.md](docs/DEPLOY.md) - Run modes (dev/preview), why raw file access fails, troubleshooting
- **Known Issues:** [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) - Current blockers, performance issues, workarounds
- **Changelog:** [docs/CHANGELOG.md](docs/CHANGELOG.md) - Feature history, implementation notes, diagnostic logs


Quick Start: index.html is at repo root; use 
pm run dev for local dev or 
pm run preview after a build.
