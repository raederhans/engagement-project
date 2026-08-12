# Plan

## Goal

Build the non-public S3 evidence layer on top of the accepted S0-S2 route
decision foundation: preregister a reproducible large-cohort protocol, create a
candidate-only pilot route-graph acquisition/admission lifecycle, and run a
production-versus-independent offline validation harness without turning the
result into a safety, city-validity, user-research, or public routing claim.

## Scope

- Add a versioned S3 cohort/run contract that distinguishes unique OD pairs,
  configuration groups, scenario-config evaluations, profile assignments,
  conformance probes, graph identity, seed, policy identity, and evidence clocks.
- Freeze the first cohort as exactly 1,000 unique synthetic OD pairs evaluated
  under five preregistered configuration groups: 5,000 scenario-config
  evaluations. This is not 5,000 users, trips, usable routes, or safety tests.
- Use only synthetic functional-need profiles. They may not be named after or
  inferred from protected identities, neighborhoods, demographic groups, Diary
  records, real homes, workplaces, schools, or personal routes.
- Research and acquire a candidate pilot street source through official or
  upstream endpoints where possible. Preserve canonical URL, steward, license,
  attribution, coverage, mode, sourceAsOf/retrievedAt/builtAt/observedAt,
  transport validators, schema, topology audit, receipt, and semantic diff.
- Keep every acquired or derived route-graph artifact candidate-only until a
  separate primary-owner admission. Do not add it to `public/data`, runtime
  loaders, Source Health, Evidence Bundle, bundle policy, CI, or Pages in this
  batch.
- Add an offline harness with a thin production adapter and an independently
  implemented reference path. Report determinism, terminal, constraint,
  alternative, completeness, budget, capacity, explanation, latency, and memory
  evidence in separate denominators.
- Use isolated worktree tasks for S3-0 protocol, S3-R replacement semantics
  research, S3-1 candidate graph/data lifecycle, and S3-2 independent Golden
  design/implementation in gated sequence. S3-R and S3-2 began read-only, and
  S3-1 started implementation only after its source/license/topology research
  handoff was accepted. The primary task owns dependency handoffs, shared files,
  Git integration, long tests, final review, and claim boundaries.

## Sources of truth

- Released local/remote baseline
  `main@70f9727cd5003ad8524447b795701337d04ade1d`.
- Accepted S0/S1/Golden records under
  `docs/active/route-decision-s0-s1-golden/` and S2 records under
  `docs/active/route-decision-s2-candidate-search/`.
- Executable S0-S2 contracts, route search, enrichment, evaluator, Golden
  adapters, tests, release workflow, source-health semantics, and bundle policy.
- Original research tasks:
  - controlled functional-needs and deterministic constraints:
    `019ff15a-1e6e-72b0-b344-4acb680dec72` (historical input only after it became
    unavailable for follow-up); replacement current-code audit:
    `019ff4f2-28e4-7783-90fa-0195838ea077`;
  - scenario validation, explanation, and city adaptation:
    `019ff15a-333e-7733-a71e-a0797c8b9e5b`;
  - route generation, external sources, and data lifecycle:
    `019ff15a-c4f8-74a2-9321-a9fc8df76eb9`.
- Current official/upstream source and license evidence. A reachable endpoint is
  not by itself proof of license, freshness, completeness, or production fitness.

## Stages

- [x] S3-0 Protocol / Preregistration: implement strict cohort, configuration,
  synthetic-profile, negative-probe, run-manifest, and report admissions plus
  focused tests. This lane freezes the S3 handoff consumed by the other lanes.
- [x] S3-1 Candidate Graph / Data Lifecycle: the existing route/data research
  handoff is accepted; the assigned owner will compare eligible
  official/upstream pilot sources and implement candidate-only acquisition,
  receipt, schema/topology audit, semantic diff, and synthetic validator
  fixtures. Bounded network/API requests are allowed; publication and runtime
  admission are not.
- [x] S3-2 Independent Scale / Golden: begin with read-only preparation. After
  S3-0 and S3-1 handoffs, implement the deterministic 1,000 x 5 offline runner,
  thin product adapter, independent comparator, replay evidence, separate
  denominators, and bounded performance reporting.
- [x] Integration owner: review S3-0 first, reconcile its graph/run identity with
  S3-1, then release an exact handoff to S3-2. Integrate one accepted lane at a
  time and add a single standard S3 test/report entry only after focused gates.
- [x] Supervisor: monitor the three tasks, return narrow semantic questions to
  the original research tasks, block ownership crossings and claim inflation,
  and own all shared/full/browser/release validation and Git state.

## Acceptance criteria

- The report mechanically discloses `uniqueOdPairs=1000`,
  `configurationGroups=5`, and `scenarioConfigEvaluations=5000`; it cannot
  collapse these into “5,000 routes” or a user-success metric.
- The five groups are explicitly researcher-defined S3 configurations, not a
  reconstruction of unavailable historical WRT settings. Their names and
  behavior must use only executable current primitives: objective-cost-only;
  distance ranking over objective-generated candidates; equal-weight distance
  plus objective cost; reweighted/range-capped distance plus objective cost;
  and three-capability constraint-aware behavior. No group may claim a distinct
  time or penalty primitive that the product contract does not expose.
- Profile A/B are machine-marked non-behavioral synthetic cohort strata for the
  first S3 run. They do not change policy, search, constraints, or evaluation.
  Profile labels cannot encode or imply sensitive identity, community quality,
  risk, persona inference, protected-trait proxies, or product behavior.
- OD pairs come only from an admitted graph revision and fixed preregistered
  seed/strata. Invalid, disconnected, source-unavailable, and deliberate
  constraint-no-solution probes use a separate conformance denominator.
- Scenario generation, product execution, and independent expected-result
  computation are separate modules. Expected outcomes cannot be imported from
  the production search/evaluator or derived by rerunning the same control flow.
- S0-S2 schema versions remain compatible. S3 uses new versions or envelopes
  when it adds required fields or semantics; no existing serialized version is
  silently reinterpreted.
- Budget, capacity, completeness, topology/coverage, constraint, and source
  states remain orthogonal. Unavailable/unknown/partial/stale/invalid never
  become observed zero or a default pass.
- Candidate graph acquisition failure cannot fall back to sample/demo data under
  a production source identity. Missing license, attribution, clocks, topology,
  mode, or coverage evidence prevents production admission.
- Performance evidence states the reference environment, graph size, warm/cold
  path, distribution, memory method, and stopped/incomplete cases. No threshold
  is invented after observing results and no bounded run is called global proof.
- Every lane returns exact base/HEAD, worktree status, changed files, focused
  tests, unrun gates, semantic risks, overlap, and recommended integration. Only
  the primary owner may stage, commit, merge, push, clean worktrees, or edit
  shared package/CI/task-record files.

## Non-goals

- No public route-decision UI, map workflow, graph loader, worker, persistence,
  URL state, sharing, telemetry, geolocation, address collection, GPS tracking,
  map matching, account, backend, PostGIS service, or external route API.
- No production graph admission, `public/data` artifact, Source Health catalog
  entry, Evidence Bundle contribution, bundle-budget change, CI scheduler,
  deployment, or publication in this batch.
- No Crime, HIN, ACS, property, neighborhood, Diary rating, or demographic value
  may become a route ranking cost or proxy.
- No `safe`, `safer`, `risk`, prediction, recommended route, scientific
  validation, Philadelphia correctness, accessibility guarantee, transferability,
  or user-research claim.
- No claim that historical WRT weights, configurations, profiles, pilots, or
  results have been recovered; the required original artifacts are unavailable.

## Risks and constraints

- S3-0 may implement only inside its exclusive paths while S3-R independently
  audits controlled-label and constraint semantics. Candidate graph work waits
  for the existing route/data research handoff and an exact owner assignment.
  S3-2 remains read-only until the primary owner sends accepted protocol,
  semantics, and graph handoffs; this is a correctness gate, not scheduling
  overhead.
- The current production route foundation is synthetic and production-isolated.
  Existing demo network/pathfinder files are not trusted topology, provenance,
  distance, cost, or Golden truth and must not be promoted by convenience.
- City/OpenDataPhilly and OSM licensing/redistribution requirements may remain
  ambiguous. A truthful validator-only delivery or candidate artifact retained
  outside Git is acceptable; ambiguity must not be papered over.
- A 1,000 x 5 run may expose capacity or memory limits. The harness must preserve
  stopped/partial results rather than raising limits until a desired outcome
  appears.
- Existing `.playwright-mcp/`, historical `logs/`, `output/`, unrelated
  worktrees, and all retained S0-S2 audit worktrees remain user-owned and
  untouched.
