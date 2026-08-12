# Plan

## Goal

Build the non-public S0 and S1 foundations for a deterministic, local-first
route-decision capability, together with executable golden-test infrastructure,
without promoting the legacy safety-weighted demo, introducing a runtime route
API, or making safety, accessibility, user-research, or city-validity claims.

## Scope

- Freeze versioned contracts for graph artifacts, route requests and candidate
  facts, functional-need policies, decision results, source states, and run
  manifests.
- Implement a pure deterministic evaluator with hard-constraint-first behavior,
  fixed-point scoring, stable tie-breaking, reason codes, and trace-derived
  explanations.
- Implement a new production-isolated graph/compiler seam and browser-compatible
  base Dijkstra core over explicit directed topology; do not promote the legacy
  `safetyBySegmentId` demo.
- Add reproducible synthetic/golden graph fixtures, an independent reference
  oracle, fixture integrity checks, and a harness seam that can later run the
  production solver against the same cases.
- Keep all work on isolated worktrees. Each execution lane prepares a focused
  commit and a ready-for-integration delivery package; the primary thread is the
  only integration owner.
- Keep the primary thread active as supervisor: monitor progress, answer bounded
  implementation questions, enforce gates and claim boundaries, request targeted
  confirmation from the original research tasks when evidence changes, and own
  the final integration decision.

## Sources of truth

- The three research tasks begun on 2026-08-11: controlled tags and constraint
  decisions; scenario validation/explanation/city adaptation; route generation
  and data-update boundaries.
- Original research task IDs:
  - controlled tags and constraint decisions:
    `019ff15a-1e6e-72b0-b344-4acb680dec72`;
  - scenario validation, explanation, and city adaptation:
    `019ff15a-333e-7733-a71e-a0797c8b9e5b`;
  - route generation and data-update boundaries:
    `019ff15a-c4f8-74a2-9321-a9fc8df76eb9`.
- The approved orchestration in the primary task: S0 contract first, then S1-A,
  S1-C, and Golden infrastructure in bounded parallel lanes.
- Repository baseline
  `1e9fecad2e42e8081a8fb3f6fee7a0ac175786c8` before this coordination record.
- Current executable contracts, source-health semantics, bundle budgets, and CI
  workflows in the repository.
- Official/upstream data contracts only when an implementation lane actually
  needs them. This batch does not publish or admit an OSM, City, SEPTA, or ArcGIS
  production artifact.

## Stages

- [ ] S0 lane: versioned schemas, strict validation, functional-need allowlist,
  source-state semantics, forbidden-claim/privacy contracts, and focused tests.
- [ ] S1-A lane: deterministic pure evaluator, trace/reason codes, fixed-point
  policy semantics, and focused truth-table/regression tests.
- [ ] S1-C lane: isolated graph artifact/compiler core, directed base Dijkstra,
  deterministic tie-breaking, truthful distance/cost fields, and focused tests.
- [ ] Golden lane: checked-in synthetic fixtures, independent reference oracle,
  manifest/terminal-outcome schema, fixture integrity tests, and an adapter seam
  for later production-solver comparison.
- [ ] Integration owner: inspect delivery packages, calculate overlaps, integrate
  in dependency order, and run the exact integrated verification set.
- [ ] Supervisor: use compact task snapshots to monitor all lanes; intervene only
  for blockers, ownership crossings, contract drift, false completion claims, or
  evidence that requires a research-task clarification.

## Acceptance criteria

- `unknown`, `unavailable`, `partial`, `stale`, observed zero, and invalid input
  remain distinct and cannot silently become a numeric score or default pass.
- Functional-need labels describe tasks such as minimizing distance or requiring
  a capability; they do not encode sensitive identity or infer a persona.
- Hard constraints are evaluated before soft ranking. An unknown hard-constraint
  observation returns unresolved, not pass.
- The evaluator is pure: no network, DOM, storage, clock, randomness, locale-
  dependent ordering, or caller-input mutation.
- Graph edges are explicit, directed, finite, and non-negative. Physical distance
  and weighted objective cost are separate fields.
- No new code consumes Crime, HIN, ACS, Diary, real-estate proxies, or a safety
  score as route cost or ranking input.
- Golden cases cover unique path, equal-cost tie, directed edge, disconnected
  components, self-route, invalid edge, geometric crossing without topology,
  endpoint-unavailable behavior, and multiple/no-distinct-alternative facts.
- Every lane reports exact base/HEAD, changed files, tests, unrun gates, overlap,
  and a recommended integration method. Passing a lane is not an integration,
  release, city-validity, user-research, accessibility, or safety claim.

## Non-goals

- No public data or graph publication in this batch.
- No OSM/ODbL product admission, City centerline production admission, SEPTA
  license acceptance, transit router, ArcGIS account, or external credential.
- No production UI, map workflow, route persistence, URL encoding, sharing,
  telemetry, geolocation, GPS tracking, or map matching.
- No Crime/HIN/ACS route ranking and no `safe`, `safer`, `risk`, or predictive
  route claim.
- No formal 1,000 OD x 5 configuration run yet; this batch creates the contracts,
  implementation seams, and golden infrastructure needed before that run.
- No integration, push, deployment, worktree cleanup, or main-branch mutation by
  execution lanes.

## Risks and constraints

- The four lanes begin from a shared coordination baseline but do not receive one
  another's in-progress files. S1-A and S1-C must follow the documented provisional
  shapes without editing S0-owned contract paths; integration may require narrow
  import/adapter reconciliation after S0 lands.
- `package.json`, global test aggregation, shared source-health catalogs, public
  artifact manifests, bundle budgets, CI workflows, and this task record are
  integration-owner files unless explicitly reassigned.
- Existing untracked `.playwright-mcp/`, `logs/`, and `output/` artifacts are
  user-owned and must remain unmodified and unstaged.
- Existing Codex worktrees and branches are unrelated unless explicitly listed in
  this task's handoff table; no lane may clean or repurpose them.
- A synthetic or golden test result proves only the stated algorithm contract.
  It does not establish Philadelphia coverage, real-world accessibility, safety,
  scientific validity, or user acceptance.
