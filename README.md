# Philadelphia Urban Evidence Lab

[中文说明](README.zh-CN.md) | English

[![CI](https://github.com/raederhans/engagement-project/actions/workflows/ci.yml/badge.svg)](https://github.com/raederhans/engagement-project/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/live_demo-GitHub_Pages-0969da)](https://raederhans.github.io/engagement-project/)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](package.json)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An evidence-first, bilingual urban-data lab for Philadelphia. The repository joins reproducible data
engineering, aggregate spatial analysis, model admission, and privacy-bounded product surfaces without
turning preliminary public records into claims of complete harm, personal risk, or safety.

The current verified data-foundation receipt covers **3,586,620 canonical reported-incident records**.
Its retained, content-addressed local evidence bundle is approximately **10.81 GB**. Those numbers describe
one exact local candidate receipt; they do not imply a live warehouse, complete crime ground truth, model
promotion, or routing authority.

## Explore in 30 seconds

- **[Open the live evidence demo](https://raederhans.github.io/engagement-project/)** — bilingual historical
  reported-incident exploration plus three bounded product surfaces.
- **Area Intelligence** — admitted historical aggregates are visible; the forecast remains
  `not-promoted / unavailable` because the frozen evaluation gate did not pass.
- **Home Compare** — privacy-preserving, aggregate source comparison with independent
  `available / partial / unavailable` states. Private address input remains session-only.
- **Known Route** — evidence for a route supplied by the user. It keeps reported incidents, raw crashes,
  accessibility, legality, and calibration dimensions separate and never emits a combined safety score.
- **Diary / Sample Community** — a demo-only, browser-local experience. It is not an evidence-admitted
  route, community backend, or current-conditions feed.

The maintainable system, data-flow, and promotion diagrams are in
[Portfolio v2](docs/PORTFOLIO_V2.md). The remote repository mutation audit is documented separately in
[Remote governance mutation plan](docs/REMOTE_GOVERNANCE_MUTATION_PLAN.md).

## Evidence flow

```text
official public source snapshots
  -> revision-aware canonical warehouse
  -> ArtifactRegistry/v1 + content-hash inventory
  -> clean-room restore and exact receipt checks
  -> tract / 500 m grid / admitted uncertainty comparisons
  -> frozen evaluation protocol and no-promotion gate
  -> aggregate-only Area Intelligence, Home Compare, and Known Route surfaces
```

The project intentionally compares census-tract admission with the 500 m fixed grid. Tracts support
interpretation and ACS denominator audits; the fixed grid remains the prediction geometry whenever
generalized-location sensitivity is not demonstrably stable. Weighted attribution never mutates canonical
events.

## Model admission, not model marketing

Candidate models enter only through a protocol frozen before final test-fold results. A model can be
evaluated without being promoted. Promotion requires every declared temporal, spatial, interval,
convergence, and slice gate; failure produces an honest no-promotion outcome.

- Current protocol: [Evaluation Protocol v2](scripts/data/area_intelligence_evaluation_protocol.v2.json)
- Mainline expansion: Evaluation Protocol v3 freezes additional baseline, sklearn, and PyTorch candidate
  identities while preserving the same no-promotion boundary.
- Model evidence: [Area Intelligence model card](reports/area-intelligence/model-card.md)
- Lineage: [Data lineage summary](reports/area-intelligence/data-lineage-summary.v1.json)

## Reproducibility

Install the locked dependencies and run the core gate:

```bash
npm ci
npm run validate
```

Focused fixture gates are intentionally lightweight. Full-data rebuild and restore are separate,
authorization-aware operations:

```bash
npm run test:mainline-m0-m6
```

The exact materialize, mirror, restore, second-environment, scheduled-observation, and disaster-drill
commands are kept in the [Data Foundation operations runbook](docs/DATA_FOUNDATION_OPERATIONS_RUNBOOK.md).

The canonical warehouse is not a short-lived Actions artifact. `ArtifactRegistry/v1` binds source scope,
four clocks, producer/schema/transform versions, every object hash and byte count, partitions, retention,
and zero serving/promotion/deletion authority. The documented clean-room sequence restores from an exact
`file` or immutable `https` location and re-observes the inventory before downstream use.

CI runs the core gate on Windows and the release gate on Linux, then deploys GitHub Pages from the same
exact main SHA. A green local test is not CI, deployment, publication, or production serving evidence.

## Repository map

```text
src/                 Product surfaces and strict browser-side projections
scripts/lib/         Data, evidence, restore, evaluation, and gate contracts
scripts/data/        Versioned schemas and frozen protocols
scripts/tests/       Lightweight contract and hostile-input fixtures
public/data/         Small admitted serving artifacts only
reports/             Small aggregate reports and model/lineage evidence
docs/                Architecture, runbooks, active records, and governance plans
.github/workflows/   Windows/Linux CI, exact-SHA Pages, and maintenance workflows
```

## Data and claim boundaries

- “Reported incidents” means source records reported to the Philadelphia Police Department; it is not a
  complete measure of crime or harm.
- Generalized locations and uncertainty methods remain analysis assumptions, not reconstructed exact
  locations.
- `unavailable`, `partial`, `ambiguous`, and `unmapped` are never zero-filled.
- Private addresses, route geometry, Diary text, and exact locations do not enter tracked artifacts, URLs,
  telemetry, or share state.
- No surface provides a safest route, safest area, combined safety score, individual victim probability,
  causal effect, or real-time guarantee.

See [Portfolio v2](docs/PORTFOLIO_V2.md), [deployment evidence requirements](docs/DEPLOY.md), and
[contribution guidance](CONTRIBUTING.md) for the complete operating boundary.

## License

Project-authored software is available under the [MIT License](LICENSE). Third-party data remains subject
to each provider's terms, license, retention, and republication rules.
