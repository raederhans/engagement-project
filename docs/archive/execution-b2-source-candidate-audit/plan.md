# Plan

## Goal

Establish a reproducible, candidate-only audit lifecycle for the committed ACS
B01003 estimates, ACS B01003 VRE, and HIN 2025 snapshot/receipt while preserving
an explicit human admission and rollback boundary.

## Scope

- Reuse the existing ACS fetch/build contracts and HIN acquisition/validation
  contracts to produce temporary candidates and audit evidence.
- Add one scheduled/manual GitHub Actions workflow that has read-only repository
  permissions, uploads audit artifacts, and never commits, pushes, opens a PR,
  merges, or changes admitted source files.
- Make the committed ACS estimate, ACS VRE, and HIN receipts visible to Source
  Health on static Pages without treating an upstream transport probe as release
  truth.
- Add focused contract tests and package entry points reached by the existing
  data-contract gate.

## Sources of truth

- Baseline: `HEAD`, `main`, and `origin/main` at
  `67eddae4f023aea6a29808654d5012d51f6342ac` with a clean detached worktree.
- U.S. Census Bureau pinned 2024 ACS B01003 table-based summary and VRE URLs and
  their committed manifests.
- City of Philadelphia ArcGIS item `7e416319784a463fa0d8b528d7ccf511`, layer 0,
  committed HIN snapshot, and lifecycle receipt.
- Existing `engagement-source-health/v1` admission model and committed-artifact
  adapters.

## Stages

- [x] Stage 1: verify Git baseline, repository guidance, current source owners,
  clocks, identities, schema guards, review boundaries, and rollback artifacts.
- [x] Stage 2: implement candidate-only source audit and workflow.
- [x] Stage 3: expose committed ACS VRE/HIN receipts in static Source Health with
  runtime observations allowed to replace, not duplicate, bundled evidence.
- [x] Stage 4: run focused and project-standard validation, inspect diff/status,
  and create one local handoff commit.

## Acceptance criteria

- No-change audits leave admitted artifacts untouched and retain only a report.
- Semantic or contract changes retain temporary candidates when validation makes
  that safe, mark human review required, and exit non-zero.
- Transport/contract failures produce bounded audit evidence, no admitted zero,
  and a non-zero result.
- HIN candidate evidence has no fabricated reviewer, review time, admission, or
  build clock; reviewed replacement still requires the existing
  `--accept-reviewed-change --reviewed-by` path.
- ACS vintage, period, table, geography, variable/schema, row identity, or VRE
  replicate changes cannot update committed artifacts automatically.
- The workflow has only `contents: read`, uploads temporary evidence, and does
  not contain Git write, PR, issue, merge, deployment, or main-push behavior.
- Static Source Health reports committed ACS estimates, ACS VRE, and HIN
  evidence, while runtime failures can replace that evidence fail-closed.

## Non-goals

- No tract refresh workflow/cadence changes, Diary changes, Known Route geometry
  changes, generic release/Pages workflow changes, deployment, push, or merge.
- No automatic discovery/admission of a newer ACS release and no automatic HIN
  semantic acceptance.
- No live danger, safety score, prediction, GPS matching, telemetry, account, or
  route-geometry transport behavior.

## Risks and constraints

- Scheduled external endpoints can be unavailable or drift independently; this
  audit is operational evidence, never the sole release gate.
- Pinned ACS endpoints audit the currently admitted release; a new vintage must
  be proposed and reviewed through a separate code/data change.
- HIN contract drift may prevent creation of a safe normalized candidate; the
  failure report must remain sufficient to trigger manual review without
  inventing source metadata.
- GitHub-hosted CI execution and live external endpoints are not proven by local
  fixture tests.
