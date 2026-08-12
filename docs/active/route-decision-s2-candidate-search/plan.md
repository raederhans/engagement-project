# Plan

## Goal

Build the versioned S2 route-candidate-search layer on top of the accepted S0/S1
foundation: freeze explicit search/completeness semantics, generate bounded and
constraint-aware candidate sets, enrich candidates through a source-auditable
one-way seam, and extend Golden verification to alternatives without weakening
v1 or creating safety, city-validity, accessibility, or publication claims.

## Scope

- Define a new versioned CandidateSet/search request/result contract instead of
  relaxing the executable v1 invariants.
- Freeze the meanings of requested K, route distinctness, search budget,
  constraint-aware search, completeness, no-route, no-eligible-route,
  unresolved evidence, and budget exhaustion.
- Implement deterministic bounded multi-candidate generation over the existing
  explicit directed graph, while keeping route generation upstream of evaluation.
- Add a versioned observation/enrichment seam whose outputs retain provenance and
  distinguish observed zero, unknown, unavailable, partial, stale, invalid, and
  missing states.
- Extend the independent Golden oracle and harness with separate denominators for
  primary route, terminal outcomes, alternatives, constraint outcomes, and search
  completeness.
- Use synthetic/check-in fixtures for executable validation. External source
  research and local acquisition are allowed, but no production artifact,
  credential, user data, push, deployment, or public publication is admitted by
  this batch without a separate primary-owner review.

## Sources of truth

- Accepted S0/S1 foundation on
  `codex/route-decision-s0-s1-foundation@785e2c4835133d51ea9b545dc482454ae995a1e8`.
- Foundation records under
  `docs/active/route-decision-s0-s1-golden/` and executable v1 contracts/tests.
- Original research tasks:
  - controlled tags and constraint decisions:
    `019ff15a-1e6e-72b0-b344-4acb680dec72`;
  - scenario validation, explanation, and city adaptation:
    `019ff15a-333e-7733-a71e-a0797c8b9e5b`;
  - route generation and data-update boundaries:
    `019ff15a-c4f8-74a2-9321-a9fc8df76eb9`.
- User authorization on 2026-08-12 to organize and continue all four S2 tasks,
  while keeping materials and data non-public.
- Current repository source-health, runtime-data, privacy, bundle, and release
  contracts. Code and tests outrank drift-prone planning notes.

## Stages

- [ ] S2-0 Contract / Product Semantics: resolve the six open search questions,
  define versioned public schemas and fail-closed status semantics, and add
  focused admission tests.
- [ ] S2-1 Search Algorithm: after the S2-0 handoff is integrated, implement
  deterministic bounded K-candidate and constraint-aware search with no evaluator
  back-edge.
- [ ] S2-2 Observation / Data Admission: after the S2-0 handoff is integrated,
  implement a source-auditable enrichment seam and synthetic adapters; separately
  report external source/license candidates without admitting them as production.
- [ ] S2-3 Golden / Independent Verification: after S2-0 is integrated and the
  S2-1 result shape is stable, extend fixtures/oracle/harness with explicit
  full-alternative and constraint-search comparison scopes.
- [ ] Integration owner: review and integrate S2-0 first, release the frozen
  contract handoff to the three dependent tasks, then integrate S2-1, S2-2, and
  S2-3 with one standard S2 test entry.
- [ ] Supervisor: monitor task state, return narrow semantic questions to the
  original research tasks, prevent ownership crossings, and own final review,
  full validation, Git state, and claim boundaries.

## Acceptance criteria

- CandidateSet/search v1 remains byte- and behavior-compatible. S2 uses a new
  versioned public contract and does not silently reinterpret v1 fields.
- Requested K is mechanically distinguished from candidates returned and from a
  completeness claim; budget exhaustion is not reported as global infeasibility.
- Route distinctness is deterministic, machine-readable, and based on explicit
  directed topology rather than rendered geometry alone.
- Search terminal states distinguish invalid input, unavailable endpoint,
  disconnected/no-route, no eligible route within the proven search scope,
  unresolved constraint evidence, and bounded-search exhaustion.
- Only constraints declared search-admissible by the public contract may affect
  graph expansion. Unknown or unavailable observations cannot silently pass.
- Search emits public candidate facts and never calls the evaluator. Evaluation
  continues to consume an admitted CandidateSet through the one-way C to A seam.
- Observation enrichment has no DOM, storage, clock-dependent ranking, user
  identity inference, raw GPS matching, or hidden network access from evaluator
  code. Provenance and source states are retained end to end.
- Golden expected outcomes are computed independently of the production search
  implementation. Primary, terminal, alternative, constraint, and completeness
  denominators remain separate.
- Every task reports exact base/HEAD, changed files, diff, focused tests, unrun
  gates, semantic risks, overlap, and a recommended integration method. Only the
  primary owner may stage, commit, merge, push, clean worktrees, or edit shared
  package/CI/task-record files.

## Non-goals

- No production UI, map workflow, route persistence, URL state, sharing,
  telemetry, geolocation, GPS tracking, or map matching.
- No safety score, safer-route recommendation, crime/HIN/ACS/real-estate route
  ranking, predictive claim, protected-trait inference, or user-research claim.
- No assertion that a bounded algorithm has enumerated every graph path unless a
  separately proven contract explicitly supports that statement.
- No OSM, City, SEPTA, ArcGIS, or other external artifact is published, bundled,
  or labeled production-ready in this batch without a separate admission review.
- No main-branch mutation, push, deployment, worktree cleanup, or release by an
  execution task.

## Risks and constraints

- S2-1, S2-2, and S2-3 begin with read-only preparation only. They must not write
  competing schemas before S2-0 is integrated and handed off by the primary task.
- Contract/search/enrichment/Golden semantics are yellow-overlap even when files
  do not overlap. The integration order is therefore a correctness requirement.
- Exact K, distinctness, completeness, and constraint aggregation are product and
  algorithm decisions. Conflicting research evidence must be escalated rather
  than hidden behind a permissive adapter.
- External data availability, licensing, schema stability, and coverage may be
  insufficient. A truthful synthetic-only or unavailable result is acceptable.
- Existing untracked `.playwright-mcp/`, `logs/`, and `output/` artifacts and all
  unrelated worktrees remain user-owned and untouched.
