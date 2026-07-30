# Philadelphia Crime Dashboard + Route Safety Diary

[![CI](https://github.com/raederhans/engagement-project/actions/workflows/ci.yml/badge.svg)](https://github.com/raederhans/engagement-project/actions/workflows/ci.yml)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](package.json)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An interactive web dashboard for exploring Philadelphia crime patterns and a
browser-based Route Safety Diary prototype. The project uses vanilla
JavaScript, MapLibre GL JS, Chart.js, Turf, and Vite.

> [!IMPORTANT]
> The Route Safety Diary currently uses demo data and local browser state. It
> does not provide production accounts, persistent community submissions, or a
> safety guarantee. Crime locations are approximate and should not be used as
> the sole basis for personal-safety decisions.

## Features

### Crime Data Explorer

- Interactive district and census-tract maps.
- Configurable buffer analysis from 400 m to 3.2 km.
- Monthly comparisons, top-offense charts, and a 7 x 24 activity heatmap.
- Per-capita rates using ACS population data.
- Viewport filtering and clustering for larger result sets.

### Route Safety Diary Prototype

- Demo routes with segment-level safety styling and an optional alternative.
- Route ratings, tags, notes, and segment overrides stored locally.
- Live Route, My Routes, Community, and Insights views.
- Community-feedback simulations with session-level throttling.
- Deterministic demo-data generation and validation scripts.

## Quick Start

### Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`.
- npm 10 or later.

Install the locked dependencies and start the development server:

```bash
npm ci
npm run dev
```

Then open `http://localhost:5173/?mode=diary` for the Route Safety Diary or
`http://localhost:5173/` for the crime dashboard.

### Optional MapTiler Style

Create `.env.local` if you want to use a MapTiler style:

```dotenv
VITE_MAPTILER_API_KEY=your_key_here
```

Without a key, the app uses its OpenStreetMap fallback. Environment files are
ignored by Git and must never be committed.

## Validation

Run the same repository gate used by CI:

```bash
npm run validate
```

The gate runs:

- `npm run data:check` — validates the checked-in demo GeoJSON.
- `npm test` — runs the diary math and aggregation regression scripts.
- `npm run build` — creates the production bundle in `dist/`.

Individual commands remain available when working on a narrow area:

```bash
npm run test:diary:math
npm run test:diary:agg
npm run data:check
npm run build
```

## Demo Data

Regenerate and validate the deterministic Route Safety Diary fixtures:

```bash
npm run data:gen
npm run data:check
```

The street-network commands fetch external OpenStreetMap or Philadelphia data
and are intentionally separate from the default validation gate:

```bash
npm run data:fetch:streets
npm run data:segment:streets
```

## Project Structure

```text
src/
  api/              External data access and normalization
  charts/           Crime and diary visualizations
  map/              MapLibre layers and interactions
  routes_diary/     Route Safety Diary state and UI
  state/            Shared application state
scripts/
  tests/            Lightweight regression scripts
  *.mjs             Data generation and validation tools
server/api/diary/   Prototype API handlers
data/               Checked-in demo GeoJSON
docs/               Design, data, and implementation notes
```

## Data Sources and Limits

| Source | Use |
| --- | --- |
| [Philadelphia CARTO](https://phl.carto.com/) | Crime incident queries |
| [Philadelphia GIS](https://www.phila.gov/departments/office-of-innovation-and-technology/open-data/) | Police districts and local boundaries |
| [US Census Bureau ACS](https://www.census.gov/programs-surveys/acs) | Population denominators |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Street-network inputs |

Crime points are rounded to the hundred block and remain approximate. External
services can change availability, schema, or rate limits independently of this
repository.

## Deployment

Create a static production build with:

```bash
npm run build
```

Serve the generated `dist/` directory with a static host. This repository does
not currently publish a package to npm or GitHub Packages. A GitHub Pages
deployment would also need the Vite base path configured for
`/engagement-project/` before publishing.

## Documentation

- [Known issues](docs/KNOWN_ISSUES.md)
- [Control specification](docs/CONTROL_SPEC.md)
- [Route Safety Diary specification](docs/DIARY_SPEC_M2.md)
- [Backend API draft](docs/API_BACKEND_DIARY_M2.md)
- [Data and file map](docs/FILE_MAP_ENGAGEMENT.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and proposed improvements
can be submitted through [GitHub Issues](https://github.com/raederhans/engagement-project/issues).

## License

Project-authored software is available under the [MIT License](LICENSE).
Third-party data remains subject to the terms of its respective provider.
