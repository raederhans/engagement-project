# Philadelphia Urban Evidence Lab — Portfolio v2

## System architecture

```mermaid
flowchart LR
  Sources[Official public sources] --> Acquisition[Revision-aware acquisition]
  Acquisition --> Warehouse[Canonical reported-incident warehouse]
  Warehouse --> Registry[ArtifactRegistry/v1]
  Registry --> Restore[Content-hash mirror and clean-room restore]
  Restore --> Spatial[Aggregate spatial attribution]
  Spatial --> Evaluation[Frozen evaluation protocol]
  Evaluation --> Gate{All promotion gates pass?}
  Gate -- no --> Historical[Historical evidence; forecast unavailable]
  Gate -- eligible only --> Review[Independent serving review]
  Historical --> Area[Area Intelligence]
  Historical --> Home[Home Compare]
  Historical --> Route[Known Route evidence]
  Diary[Browser-local Diary demo] -. demo-only, no evidence authority .-> Route
```

The dashed Diary connection is a user-experience seam only. Diary observations, Sample Community cards,
demo routes, and locally generated alternatives cannot satisfy a Known Route source receipt or any R7 gate.

## Data flow and trust boundaries

```mermaid
flowchart TD
  Raw[Immutable source snapshot] --> Canonical[Canonical events]
  Canonical --> Tract[Fail-closed tract attribution]
  Canonical --> Grid[500 m fixed-grid attribution]
  Canonical --> Footprint[UncertaintyFootprintArtifact/v1]
  Footprint --> Fractional[Fractional overlap]
  Footprint --> Kernel[Area kernel]
  Tract --> Compare[Aggregate sensitivity report]
  Grid --> Compare
  Fractional --> Compare
  Kernel --> Compare
  Compare --> Decision{Stable and identity-bound?}
  Decision -- no --> GridPrimary[Fixed grid remains prediction geometry]
  Decision -- yes --> ReviewOnly[Eligible for scientific review]
  Tract --> ACS[ACS interpretation and denominator audit]
```

Every weighted row must have finite nonnegative weights that sum to one. Weighted assignments are separate
artifacts; canonical event records stay unchanged. Identity, coverage, geometry, or producer mismatch fails
closed instead of producing a best-effort number.

## Model eligibility and promotion

```mermaid
flowchart LR
  Freeze[Freeze protocol before final test folds] --> Eligible[Candidate eligibility]
  Eligible --> Train[Training-only preprocessing and inner validation]
  Train --> Temporal[Four rolling temporal folds]
  Train --> Spatial[Spatial holdout]
  Temporal --> Metrics[Accuracy, deviance and interval slices]
  Spatial --> Metrics
  Metrics --> Stability[Convergence and prediction-cap gate]
  Stability --> Slice[Every declared slice gate]
  Slice --> Decision{All gates pass?}
  Decision -- no --> NoPromotion[NO PROMOTION; forecast unavailable]
  Decision -- yes --> Candidate[Local promotion candidate only]
  Candidate --> Independent[Independent artifact and serving review]
```

Simple baselines and ML implementations receive eligibility only. Neither a green unit test nor aggregate
metric improvement grants product promotion, scientific authority, serving, or deployment.

## Evidence inventory

| Evidence | Current bounded statement | Primary contract or entry point |
| --- | --- | --- |
| Reported incidents | Exact retained local receipt covers 3,586,620 canonical records | `ArtifactRegistry/v1`, warehouse receipt v3 |
| Evidence bundle | Approx. 10.81 GB retained local, content-addressed candidate | `scripts/lib/data_foundation_artifact_bundle/` |
| Restore | `file` and immutable `https`; object bytes/hash/rows re-observed | `scripts/restore_data_artifacts.mjs` |
| Spatial attribution | Tract, 500 m grid, fractional and area-kernel aggregate comparison | `scripts/lib/spatial_attribution_*` |
| Area Intelligence | Historical evidence available; forecast not promoted | `public/data/area_intelligence_baseline.v2.json` |
| Home Compare | Source-specific aggregate availability; private address session-only | `src/home_compare/`, lifecycle and join DQ contracts |
| Known Route | User-supplied route evidence; no safest route or combined score | `src/routes_crime/known_route_*` |
| Diary | Browser-local demo and static Sample Community only | `src/routes_diary/` |

## Restore and validation routes

- **Fixture gate:** contract, hostile-input, identity, privacy, and no-authority tests run without credentials.
- **Authorized full-data pipeline:** materialize the exact registry, mirror immutable objects, restore into a
  new caller-owned root, observe inventory, then validate downstream receipts.
- **Second environment:** a different environment identity must produce its own machine-readable restore
  receipt; copying a prior receipt is not observation.
- **Disaster drill:** missing and corrupted objects must both stop before downstream build; recovery records
  duration, downloaded bytes, verification outcome, and peak disk.
- **Scheduled maintenance:** a workflow configuration is not a run observation. Until a current scheduled
  receipt exists, status remains `unavailable`.

## Public product surfaces

1. **Area Intelligence** presents historical aggregate evidence and explicit no-promotion state.
2. **Home Compare** compares 2–4 locations using independent aggregate sources; source gaps remain visible.
3. **Known Route** explains evidence along a user-provided route while separating incidents, crashes,
   accessibility, mode legality, calibration, and sensitivity.

The future R7 decision is a machine-readable go/no-go gate only. It must not create route alternatives,
choose a winner, infer a safest route, or collapse dimensions into a combined safety score.
