# Plan

## Goal

Implement the first bounded S4 contract and infrastructure slices on top of the
accepted S0-S3 synthetic foundation, in an order that keeps explanation,
performance, city adaptation, and external-graph admission independently
auditable and fail closed.

## Scope

- Freeze one S4 execution record and claim matrix before implementation.
- Implement four isolated, synthetic-only lanes:
  1. `route-decision-explanation/v1`, counterfactual-effect verification, and a
     pure text-complete/map-optional presentation model.
  2. `route-s4-performance-protocol/v1`, stage instrumentation, and diagnostic
     dry-run records that are mechanically excluded from gate-eligible evidence.
  3. `CityAdapter/v1` plus an explicitly synthetic Philadelphia adapter shape.
  4. External graph admission, trusted review/baseline authority, and product/
     public promotion contracts without acquiring or promoting data.
- Review and integrate lane deliveries one at a time under the primary owner.
- Open downstream UI, eligible performance sampling, data acquisition, pilot,
  or release gates only after their direct prerequisites pass review.

## Sources of truth

- `docs/active/route-decision-s3-scale-adaptation/{task,context,plan}.md`
- Existing S0-S3 contracts, evaluators, search, Golden/oracle, and tests at
  coordination baseline `4f7c06c`.
- Repository `AGENTS.md` and executable test/admission contracts.
- The two accepted S4 preparation packages recorded in the S3 task record.

## Stages

- [x] Stage 1: Confirm S4 implementation authority, freeze the integration
  branch, ownership matrix, claim boundaries, and dependency gates.
- [ ] Stage 2: Run four isolated implementation lanes and receive uncommitted
  diff plus focused validation packages.
- [ ] Stage 3: Independently review contract truth, compatibility, provenance,
  import boundaries, and test adequacy; return narrow rework where needed.
- [ ] Stage 4: Integrate accepted lanes sequentially and run exact-head focused
  regressions without starting shared or long-lived processes.
- [ ] Stage 5: Decide which downstream S4 gates are technically ready. Eligible
  Node/browser/Worker performance runs, real data, pilot, public UI, release,
  and deployment remain separate main-owned decisions.

## Acceptance criteria

- Each new public or validation artifact has one exact versioned schema,
  deterministic admission, bounded inputs, and explicit unavailable/unknown/
  stopped truth; callers cannot self-author evidence-backed outcomes.
- Explanation effects are independently recomputed and do not turn score
  contribution into a causal, safety, or preference claim.
- Performance evidence freezes environment, strata, sample eligibility,
  denominators, thresholds, and failure policy before any eligible sample;
  diagnostics cannot enter the admitted denominator.
- City adaptation makes CRS, timezone, mode/taxonomy, capability mapping, and
  missing/unknown handling explicit; Philadelphia fixtures are synthetic and
  no second-city transfer claim is emitted.
- External graph admission separates candidate, reviewed internal, product
  runtime, public/redistribution, publication, and Source Health gates. S3-1
  artifacts cannot be relabeled or promoted by metadata alone.
- S0-S3 versions and existing runtime/product behavior remain compatible and
  unchanged unless an explicit reviewed versioned adapter is introduced.
- Every accepted lane has fresh focused tests, targeted lint/syntax checks,
  ownership-clean status, and an independent review before central integration.

## Non-goals

- Downloading or admitting Philadelphia, NYC, OS Open Roads, OSM, TIGER, or
  other real route data.
- Running gate-eligible performance samples, browsers, Workers, dev servers,
  full validation, or deployment from worker tasks.
- Recruiting participants or collecting addresses, routes, GPS, Diary,
  accessibility, identity, or preference data.
- Publishing a route UI, graph, manifest, bundle, safety recommendation,
  scientific result, accessibility outcome, or cross-city claim.

## Risks and constraints

- The four lanes must not edit the same production or task-record paths; shared
  package scripts, barrels, UI files, workflows, and central records stay owned
  by the primary task until integration.
- Existing untracked Playwright output, S3 logs, and private S3 evidence are
  protected user artifacts and remain unstaged and untouched.
- JSON/internal consistency is not cryptographic authenticity. Any trusted
  review authority must be explicit and cannot be inferred from a self-authored
  receipt.
- Short isolated tests are allowed in worker worktrees; all shared/long live
  gates have a single primary owner and will be scheduled separately.
