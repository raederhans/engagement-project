# Philadelphia Urban Evidence Lab

[中文说明](README.zh-CN.md) | English

[![CI](https://github.com/raederhans/engagement-project/actions/workflows/ci.yml/badge.svg)](https://github.com/raederhans/engagement-project/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/live_demo-GitHub_Pages-0969da)](https://raederhans.github.io/engagement-project/)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](package.json)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A bilingual Philadelphia data project for exploring historical reported incidents, comparing areas,
reviewing known-route context, and keeping personal trip notes in the browser.

## Current status

- GitHub Pages serves the latest `main` revision that passes the repository's Windows and Linux release
  gates. The CI badge and linked workflow are the current deployment evidence.
- The product includes Area Intelligence, Home Compare, expanded Known Route evidence, public route
  scenarios, the browser-local Diary demo, and the research-only ML package.
- The latest retained data-foundation receipt covers **3,586,620 standardized reported-incident records**
  in a content-addressed local evidence bundle of about **10.81 GB**.
- The forecast gate remains **not-promoted** and forecast output remains **unavailable**. Historical
  aggregates remain available.
- All incident and route context is historical or aggregate. The interface does not provide live
  conditions, personal risk or safety conclusions, or route recommendations. Diary and Sample Community
  content stays browser-local and demo-only.

## Interface preview

These repository-relative screenshots show the current interface and render directly from the README
without relying on temporary local paths.

![Crime Explorer map and controls](docs/assets/screenshots/crime-explorer-en.jpg)

![Route Experience Diary demonstration](docs/assets/screenshots/route-diary-zh.jpg)

## What is in the project

### Crime Explorer

Explore historical reported incidents by point, police district, or Census tract. Choose a time range and
offense groups, then review the result as a map, incident table, summary, monthly trend, category chart, or
day-and-hour view. Population-based rates use ACS estimates and keep their uncertainty visible.

### Complete Census tract comparison

Compare two or more whole Philadelphia Census tracts using 2020–2024 ACS population estimates and their
90% margins of error. Input uses complete tract GEOIDs.

### Area Intelligence

Review historical aggregate coverage, exclusions, and spatial methods. The current forecast did not pass
the evaluation gate, so the interface shows the failed checks alongside the historical summary.

### Home & neighborhood comparison

The latest local interface is designed to compare two to four Philadelphia homes across property records,
assessment and transfer history, civic records, nearby reported incidents, transport context, and data
quality. Each source keeps its own `available`, `partial`, or `unavailable` state.

Private-address lookup is not enabled in the public build, which currently shows citywide data readiness.
Shared links contain display settings only.

### Known Route

Provide a route by drawing it, entering waypoints, or importing a GeoJSON LineString. The interface reviews
nearby historical records and presents road-centerline, High Injury Network, crash, accessibility, and
travel-mode context as separate dimensions.

### Public route scenarios

Compare precomputed walking scenarios between public landmarks. The cards show time, distance, historical
exposure, data freshness, match quality, and uncertainty side by side.

### Route Experience Diary

Record a personal 1–5 trip rating, tags, notes, and optional segment details. Entries, drafts, and history
stay in the current browser and can be exported as a backup. “Sample community” content and alternative
routes are static demonstration data.

### Local route companion and ML research

Developers can enable the local route companion when its route engine and evidence pack are available.
The Python/ML package supports research, evaluation, and governance reporting.

## How the evidence is handled

```text
official public snapshots
  -> versioned standardized records
  -> content and lineage checks
  -> aggregate spatial analysis
  -> frozen evaluation and no-promotion gates
  -> browser views
```

The project keeps “missing”, “partial”, “ambiguous”, “unmapped”, and “unavailable” separate from zero.
Personal content remains in the local browser.

More detail is available in [Portfolio v2](docs/PORTFOLIO_V2.md) and the
[Data Foundation operations runbook](docs/DATA_FOUNDATION_OPERATIONS_RUNBOOK.md).

## Run locally

Requirements: Node.js `^20.19.0` or `>=22.12.0`, plus npm 10 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173/` for the data explorer or
`http://localhost:5173/?mode=diary` for the Diary demo.

Run the core repository gate with:

```bash
npm run validate
```

Focused fixture gates for the latest local integration are also available:

```bash
npm run test:mainline-m0-m6
npm run test:ml-m7
npm run test:mainline-m7
```

Full-data rebuild, mirror, restore, and disaster-recovery operations are separate from these lightweight
tests and require their exact local evidence roots.

## Repository map

```text
src/                 Browser application and product surfaces
ml/                  Research-only Python/ML package and contracts
scripts/lib/         Data, evidence, restore, evaluation, and gate logic
scripts/data/        Versioned schemas and frozen protocols
scripts/tests/       Unit, contract, hostile-input, browser, and visual checks
public/data/         Small browser-readable aggregate artifacts
reports/             Aggregate evaluation, model, and lineage reports
docs/                Architecture, runbooks, task records, and governance notes
```

## Data notes

- Reported incidents come from Philadelphia Police Department public records. Generalized locations,
  Census estimates, and spatial assignment introduce uncertainty.
- The project is designed for historical exploration and comparison. The documents below cover the full
  methods and operating boundaries.

See [deployment evidence requirements](docs/DEPLOY.md) and
[contribution guidance](CONTRIBUTING.md) for the operating details.

## License

Project-authored software is available under the [MIT License](LICENSE). Third-party data remains subject
to each provider's terms, license, retention, and republication rules.
