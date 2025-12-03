# Philadelphia Crime Dashboard + Route Safety Diary

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()
[![Node Version](https://img.shields.io/badge/node-22.18.0-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

An interactive web dashboard for exploring crime incidents and personal safety routing in Philadelphia. Built with vanilla JavaScript, MapLibre GL JS, and Chart.js.

---

## Features

### Crime Data Explorer
- **Interactive map** with police district and census tract choropleths
- **Buffer analysis** with customizable radius (400m - 3.2km)
- **Time-series charts** comparing buffer vs citywide trends
- **7x24 heatmap** showing temporal crime patterns
- **Per-capita rates** using 2023 ACS population data

### Route Safety Diary (frontend complete)
- **Live route demo** with safety gradient coloring and optional safer alternative overlay
- **Route rating modal** (overall stars, tags, optional notes + segment overrides)
- **Segment popup “community feedback” card** with top issues and quick actions
- **Views:** Live Route, My Routes (history list), Community (radius + high-concern list), Insights panel (trend, tags, heatmap)
- **Community taps:** “Agree” / “Feels safer” votes with session throttling

**Status:** Diary frontend (M1/M3) is complete for demo data; ready for backend integration and real submissions.

---

## Quick Start

### Prerequisites
- Node.js 20+ (tested on v22.18.0)
- npm 10+

### Installation

```bash
# Install dependencies
npm install

# Start development server (Crime + Diary)
npm run dev
# Open http://localhost:5173/?mode=diary (or /diary-demo.html) for the Route Safety Diary
```

### Production Build

```bash
npm run build     # Build to dist/
npm run preview   # Preview production build at http://localhost:4173
```

---

## Route Safety Diary overview

**What it is:** A Diary mode that lets users explore safer routes in Philadelphia, rate trips, and see community perceptions of street safety. Demo data is generated from the Philly street network; submissions are currently local-only.

**Major pieces**
- **UI views:** Live Route (default), My Routes (history list), Community (area focus + concern list), right-side Insights card, segment popups, and the route rating modal.
- **Map & style:** MapLibre GL with MapTiler Positron light style when `VITE_MAPTILER_API_KEY` is set; muted OSM raster fallback with a gray network grid beneath safety overlays.
- **Routing + data:** Road network fetched from Overpass, segmented, then demo routes built via Dijkstra/SegmentGraph; safety colors use time-decayed, shrinkage-adjusted scores.
- **State & modules:** Central store, modular UI panels under `src/routes_diary/`, shared IDs (`map_ids.js`), normalization helpers (`data_normalization.js`), and label helpers (`labels.js`).

**Run the Diary**
```bash
npm install
# Optional quickstart scripts may exist (diary:qs:*); otherwise:
npm run dev
# then open http://localhost:5173/?mode=diary or /diary-demo.html
```

**Configure MapTiler**
Create `.env.local` with:
```
VITE_MAPTILER_API_KEY=YOUR_KEY
```
Without a key, the app falls back to muted OSM with the network grid still visible.

**Regenerate demo data**
```bash
npm run data:fetch:streets    # Fetch OSM streets (or STREETS_PHL_URL if set)
npm run data:segment:streets  # Segment streets and build the graph
npm run data:gen              # Generate demo routes + demo segment set
npm run data:check            # Validate demo GeoJSON
```

## Project Structure (diary-focused)

- `src/routes_diary/` — Diary orchestrator (`index.js`), modular panels (`ui_*_panel.js`), rating modal (`form_submit.js`), shared helpers (`map_ids.js`, `data_normalization.js`, `labels.js`).
- `src/map/` — MapLibre layers: segments layer + popups, routing overlays, network grid.
- `src/charts/diary_insights.js` — Insights rendering.
- `scripts/` — Road network ETL (fetch, segment, demo data generation).
- `data/` — Demo GeoJSON outputs (`segments_phl.demo.geojson`, `routes_phl.demo.geojson`, `segments_phl.network.geojson`).

---

## Key Technologies

| Technology | Version | Purpose |
|-----------|---------|---------|
| [MapLibre GL JS](https://maplibre.org/) | ^4.5.0 | Vector map rendering |
| [Chart.js](https://www.chartjs.org/) | ^4.4.0 | Data visualizations |
| [Vite](https://vitejs.dev/) | ^5.0.0 | Build tooling & dev server |
| [Ajv](https://ajv.js.org/) | ^8.12.0 | JSON schema validation |

**No framework:** Vanilla JavaScript (no React/Vue/Angular).

---

## Feature Flags

The diary feature is controlled by an environment variable:

```bash
# .env.local
VITE_FEATURE_DIARY=1
```

To disable the diary, set `VITE_FEATURE_DIARY=0` or remove the variable.

---

## Crime Dashboard

### Data Sources

All data is fetched from public APIs at runtime:

| Source | API Endpoint | Update Frequency |
|--------|--------------|------------------|
| Crime incidents | [CARTO SQL API](https://phl.carto.com/api/v2/sql) | Daily |
| Police districts | [PhillyGIS ArcGIS](https://policegis.phila.gov/arcgis/rest/services/POLICE/Boundaries/MapServer/1) | Static |
| Census tracts | [Esri ArcGIS](https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0) | Static |
| ACS 2023 demographics | [Census Bureau API](https://api.census.gov/data/2023/acs/acs5) | Annual |

**Note:** Crime data is rounded to the hundred block for privacy. Incident locations are approximate.

### Performance

- **Clustering:** Automatically enabled when >20,000 points would be rendered
- **Bbox filtering:** All crime queries are constrained to the current map viewport
- **Caching:** Boundary GeoJSON files cached in `public/data/` when available
- **Rate limiting:** API requests throttled to avoid overloading city servers

---

## Documentation

### User Guides
- [Control Specifications](docs/CONTROL_SPEC.md) - Detailed state model for all UI controls
- [Known Issues](docs/KNOWN_ISSUES.md) - Current blockers and workarounds

### Developer Guides
- [M2 Specifications](docs/) - Five detailed spec documents for Agent-I implementation
  - [DIARY_SPEC_M2.md](docs/DIARY_SPEC_M2.md) - Visual encoding, UI copy, accessibility
  - [CHARTS_SPEC_M2.md](docs/CHARTS_SPEC_M2.md) - Three chart specifications with JSON schemas
  - [API_BACKEND_DIARY_M2.md](docs/API_BACKEND_DIARY_M2.md) - REST API contracts (future backend)
  - [SQL_SCHEMA_DIARY_M2.md](docs/SQL_SCHEMA_DIARY_M2.md) - Postgres + PostGIS schema
  - [TEST_PLAN_M2.md](docs/TEST_PLAN_M2.md) - 60 testable acceptance criteria
- [File Map](docs/FILE_MAP_ENGAGEMENT.md) - Codebase structure and module relationships
- [Deployment Guide](docs/DEPLOY.md) - Vite setup, build troubleshooting, hosting

### Audit & Compliance
- [Diary Audit Checks](docs/DIARY_AUDIT_CHECKS.md) - M1 verification checklist (all passed)
- [Audit Logs](logs/) - Timestamped audit reports with screenshots

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Code style guidelines
- Branch naming conventions
- Pull request process
- Testing requirements

**Key rules:**
- All features must be feature-flagged (see `src/config.js`)
- Maintain vanilla JavaScript (no JSX, no frameworks)
- All map operations must use MapLibre GL APIs
- Performance: map refreshes <5s, routing <2s

---

## Testing

### Run Tests

```bash
npm run test:unit         # Jest unit tests
npm run test:integration  # Mocha + Supertest integration tests
npm run test:e2e          # Playwright end-to-end tests
npm run test:perf         # Artillery performance tests
npm test                  # Run all tests
```

### Coverage

```bash
npm run test:coverage
```

Target: 80% line coverage for all source files.

### Manual Testing

1. Start dev server: `npm run dev`
2. Open feature flag: Set `VITE_FEATURE_DIARY=1` in `.env.local`
3. Follow test scenarios in [TEST_PLAN_M2.md](docs/TEST_PLAN_M2.md)

---

## Deployment

### GitHub Pages (Static Hosting)

```bash
npm run build
# Upload dist/ to GitHub Pages
```

**Important:** Configure `base` in `vite.config.js` if deploying to a subdirectory:

```javascript
export default {
  base: '/engagement-project/',  // Match your repo name
}
```

### Custom Server

Serve the `dist/` folder with any static file server:

```bash
npm install -g serve
serve -s dist -p 8080
```

---

## Roadmap

### Diary frontend (complete)
- Live route demo with safety gradients + alt route overlay
- Rating modal (overall + tags + optional segment overrides)
- Segment popup community card
- My Routes / Community views + Insights panel

### Next steps
- Wire Diary to real backend submissions + persistence
- Extend My Routes / Community with live data
- Promote demo routes to user-submitted routes
- Expand analytics (interactive insights, filterable trends)

---

## Troubleshooting

### Build Errors

**Error: "Cannot resolve module 'maplibre-gl'"**
- **Cause:** Missing dependencies
- **Fix:** `npm install`

**Error: "HTML proxy error"**
- **Cause:** `index.html` not at project root
- **Fix:** Ensure `index.html` is in the root directory (not `public/`)

### Runtime Errors

**Error: "Network request failed"**
- **Cause:** CARTO API or ArcGIS endpoints unreachable
- **Fix:** Check internet connection, verify API URLs are correct

**Error: "Feature flag not working"**
- **Cause:** `.env.local` not read by Vite
- **Fix:** Restart dev server (`npm run dev`) after editing `.env.local`

### Performance Issues

**Map rendering slow:**
- Reduce cluster radius (see `src/map/points.js`)
- Limit time window (use "Last 3mo" instead of "Last 12mo")

**Chart.js lagging:**
- Enable dataset decimation in `src/charts/line_monthly.js`
- Reduce data points on mobile devices

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## Acknowledgments

- **Data providers:** City of Philadelphia Open Data, US Census Bureau
- **Mapping:** OpenStreetMap contributors, MapLibre GL JS
- **Charts:** Chart.js community
- **Inspiration:** Safe Streets Philadelphia, Walk Score

---

## Contact

- **Issues:** [GitHub Issues](https://github.com/yourusername/engagement-project/issues)
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/engagement-project/discussions)
- **Email:** your.email@example.com

---

**Last Updated:** 2025-12-xx
**Branch:** chore/diary-docs-and-copy-polish
**Status:** Route Safety Diary frontend milestone complete; ready for backend integration.

Happy mapping! 🗺️✨
