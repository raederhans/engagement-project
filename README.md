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

### Route Safety Diary (M1)
- **Safety-rated segments** with time-decay aggregation and Bayesian shrinkage
- **Route recording simulator** with play/pause/finish controls
- **Alternative route discovery** with safety benefit calculation
- **Community interactions** (Agree 👍, Feels safer ✨) with session throttling
- **Rating modal** with 5-star scale, tags, and optional comments

**Status:** M1 complete (U0-U7), M2 specifications ready for implementation.

---

## Quick Start

### Prerequisites
- Node.js 20+ (tested on v22.18.0)
- npm 10+

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/engagement-project.git
cd engagement-project

# Install dependencies
npm install

# Start development server
npm run dev
```

Visit **http://localhost:5173** to see the dashboard.

### Production Build

```bash
npm run build     # Build to dist/
npm run preview   # Preview production build at http://localhost:4173
```

---

## Project Structure

```
engagement-project/
├── src/
│   ├── main.js                  # Application entry point
│   ├── routes_diary/            # Route Safety Diary feature
│   │   ├── index.js             # Main diary orchestrator (1,270 lines)
│   │   ├── form_submit.js       # Rating submission logic
│   │   └── my_routes.js         # Route management UI
│   ├── map/
│   │   ├── segments_layer.js    # Segment rendering + hover cards
│   │   ├── routing_overlay.js   # Alt routes + simulator point
│   │   └── *.js                 # Other map layers (districts, tracts, points)
│   ├── charts/
│   │   ├── line_monthly.js      # Time-series chart
│   │   ├── bar_topn.js          # Top offenses bar chart
│   │   └── heat_7x24.js         # Hour/day heatmap
│   ├── utils/
│   │   └── decay.js             # Time-decay & Bayesian math
│   └── api/
│       └── diary.js             # Diary API client (stubbed M1)
├── data/
│   ├── segments_phl.demo.geojson  # 64 demo segments (Philadelphia)
│   └── routes_phl.demo.geojson    # 3 demo routes
├── docs/
│   ├── DIARY_SPEC_M2.md         # Visual encoding & UI specs
│   ├── CHARTS_SPEC_M2.md        # Chart specifications
│   ├── API_BACKEND_DIARY_M2.md  # REST API contracts
│   ├── SQL_SCHEMA_DIARY_M2.md   # Postgres schema
│   ├── TEST_PLAN_M2.md          # Acceptance criteria (60 tests)
│   └── *.md                     # Additional documentation
├── logs/
│   ├── AGENTM_AUDIT_M1_CLOSURE_*.md  # Audit reports
│   └── screenshots/             # Feature evidence
├── index.html                   # HTML entry (must be at root for Vite)
├── vite.config.js               # Vite configuration
└── package.json
```

---

## Key Technologies

| Technology | Version | Purpose |
|-----------|---------|---------|
| [MapLibre GL JS](https://maplibre.org/) | ^4.5.0 | Vector map rendering |
| [Chart.js](https://www.chartjs.org/) | ^4.4.0 | Data visualizations |
| [Vite](https://vitejs.dev/) | ^5.0.0 | Build tooling & dev server |
| [Ajv](https://ajv.js.org/) | ^8.12.0 | JSON schema validation |

**No framework:** This project uses vanilla JavaScript (no React, Vue, or Angular).

---

## Route Safety Diary

The Route Safety Diary feature allows users to:
1. **Record routes** with a simulator that steps through street segments
2. **Rate safety** on a 1-5 scale with optional tags (well-lit, busy, bike lane, etc.)
3. **View aggregated ratings** with time-decay (21-day half-life) and Bayesian shrinkage
4. **Discover alternative routes** with safety benefit calculations
5. **Contribute to community safety data** via Agree 👍 and Feels safer ✨ votes

### Key Algorithms

**Time-Decay Weighting:**
```javascript
weight = 2^(-days_ago / 21)
```
Recent ratings are weighted exponentially higher than older ones.

**Bayesian Shrinkage (James-Stein Estimator):**
```javascript
shrunk_mean = (prior_mean × prior_N + observed_mean × observed_N) / (prior_N + observed_N)
```
Pulls low-sample segments toward a neutral prior (3.0 out of 5) to avoid extreme ratings from single observations.

**A* Pathfinding Cost Function (M2):**
```javascript
cost = length_m × (1 + safety_weight × penalty)
penalty = (5 - rating) / 5
```
Balances distance and safety when calculating optimal and alternative routes.

### Feature Flags

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

### M1 (Complete)
- [x] U0-U3: Segment visualization, route picker, rating modal
- [x] U4: Client-side aggregation with time-decay + Bayesian shrinkage
- [x] U5: Alternative route overlay with benefit summary
- [x] U6: Recording simulator with lifecycle management
- [x] U7: Community interactions (Agree 👍, Feels safer ✨)

### M2 (Specifications Ready)
- [ ] Backend API implementation (Node.js + Express)
- [ ] Postgres + PostGIS database setup
- [ ] A* pathfinding with safety cost function
- [ ] Three data visualization charts (trend, tags, heatmap)
- [ ] Enhanced confidence visualization (opacity + width + color)
- [ ] 60 acceptance tests (unit + integration + E2E)

### M3 (Future)
- [ ] User authentication (OAuth2: Google, GitHub)
- [ ] Real-time WebSocket updates for community votes
- [ ] Mobile app (React Native)
- [ ] Advanced analytics dashboard
- [ ] Public API for third-party integrations

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

**Last Updated:** 2025-11-11
**Branch:** feat/diary-u6-u7
**Commit:** 03f8e65

Happy mapping! 🗺️✨
