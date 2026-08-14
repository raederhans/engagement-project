# Plan

## Goal

Implement the first bounded S4 contract and infrastructure slices on top of the
accepted S0-S3 synthetic foundation, in an order that keeps explanation,
performance, city adaptation, and external-graph admission independently
auditable and fail closed. Stage 5 now addresses the four retained integration
WATCH prerequisites through new versioned seams without opening runtime,
public, real-data, or release gates.

## Scope

- Freeze one S4 execution record and claim matrix before implementation.
- Implement four isolated, synthetic-only lanes:
  1. `route-decision-explanation/v1` R3, counterfactual-effect verification,
     explicit no-claim output, and a Node/tooling-only pure presentation model.
  2. `route-s4-performance-protocol/v1` R2 and stage instrumentation that can
     emit observations but has no authority to emit a gate decision.
  3. `CityAdapter`, profile, result, and identity V2 plus an explicitly
     synthetic Philadelphia adapter shape; the admitted output graph remains
     `GraphArtifact/v1`.
  4. External graph R2 validation-only caller-policy conformance without actual
     authority, admission, materialization, promotion, or publication.
- Review and integrate lane deliveries one at a time under the primary owner.
- Open downstream UI, eligible performance sampling, data acquisition, pilot,
  or release gates only after their direct prerequisites pass review.
- Run Stage 5 in two dependency-gated waves:
  1. Wave 1 may author S5-A typed route integration binding and S5-D external
     graph authority state-machine prerequisite in parallel.
  2. Only after S5-A passes independent code/spec/security and architecture
     review and is serially integrated on the central branch may S5-B browser
     serialized delivery and S5-C cross-process performance runner/authority
     result start from that new exact central HEAD.

## Sources of truth

- `docs/active/route-decision-s3-scale-adaptation/{task,context,plan}.md`
- Existing S0-S3 contracts, evaluators, search, Golden/oracle, and tests at
  coordination baseline `4f7c06c`.
- Repository `AGENTS.md` and executable test/admission contracts.
- The two accepted S4 preparation packages recorded in the S3 task record.

## Stages

- [x] Stage 1: Confirm S4 implementation authority, freeze the integration
  branch, ownership matrix, claim boundaries, and dependency gates.
- [x] Stage 2: Run four isolated implementation lanes and receive committed
  lane deliveries plus reviewed tracked repair diffs.
- [x] Stage 3: Independently review contract truth, compatibility, provenance,
  import boundaries, and test adequacy; final bounded verdict is `COMMENT` /
  architecture `WATCH`, with no P0/P1/P2 or direct path/schema/export conflict.
- [x] Stage 4: Integrate accepted lanes sequentially, run exact-head focused
  regressions, and complete bounded combined integrated-HEAD validation as
  `COMMENT` / architecture `WATCH` without starting shared or long-lived
  processes.
- [x] Stage 5: Address the four integration WATCH prerequisites through the
  dependency-gated waves below and separately decide which downstream S4 gates
  are technically ready. Eligible
  Node/browser/Worker performance runs, real data, pilot, public UI, release,
  and deployment remain separate main-owned decisions.

### Stage 5 dependency graph

```text
Wave 1 author/review:  S5-A typed route binding  ||  S5-D authority state machine
                                 |
                                 v
Central gate G1:       S5-A independently accepted and integrated first
                                 |
                                 v
Wave 2 author/review:  S5-B browser wire  ||  S5-C cross-process performance authority
```

- S5-D may finish and be independently reviewed while S5-A proceeds, but it
  cannot make any actual authority transition reachable without a future
  caller-unforgeable root of trust.
- Only the integration owner may create source-final commits, change index or
  refs, integrate a lane, or update central records. One lane is integrated at
  a time; each exact central HEAD must pass its focused, adjacent, static,
  source-equality, and scope checks before another lane is released.
- No relative central integration order after S5-A is implied yet. S5-D, S5-B,
  and S5-C enter the integration queue only after their own stable freeze and
  two-view review; product decisions or conflicts are not guessed.

### Current Stage 5 gate after S5-B browser-boundary integration

- S5-A and S5-D R2 reviews closed both earlier descriptor P2 findings. Each has
  code `COMMENT` with P0/P1/P2/WATCH zero and architecture `CLEAR`.
- S5-A received a source-final and serial central integration. Its typed
  Node/tooling seam is accepted at this bounded gate; stopped `partial` output
  remains incomplete and future consumers must inspect `incomplete`, search
  `completeness`, and `termination` together.
- Under a later explicit single-unit release, S5-D also received a complete
  source-final and serial central integration. Its accepted surface is only an
  authority-unavailable prerequisite contract plus a synthetic state-machine
  simulator; no actual authority transition became reachable.
- S5-C R2 closed its original code P1/P2 and four architecture blockers for the
  internal diagnostic fresh-child seam. Complete source-final `b8858488` was
  integrated alone as central `a0443491`, with exact seven-blob equality and
  focused/adjacent/hostile/static/scope validation.
- This S5-C integration is not formal authority: prerequisites stay
  `installed: false`, the formal factory stays `authority-unavailable`, formal
  pass/fail remains unestablished, and a pure classifier is not an authority
  result. S4-2 remains no-authority/no-decision and no runtime/public wiring was
  added.
- S5-B R3 is code/spec/security `COMMENT` with P0/P1/P2 zero and architecture
  `CLEAR`; all earlier terminal/limitations/prose, code P1, completeness, and
  graph-wide findings are closed. Complete source-final `f967a3a` was integrated
  alone as central `3d65c86`, with exact four-blob equality and focused,
  adjacent, 4,032-tuple, hostile, static, consumer, and scope validation.
- S5-B completeness is exactly `browser-boundary-summary/v1`; its source
  presentation relationship is not a full S4 projection, and graph-wide
  requested-factor states are not terminal causes. No UI/runtime/public barrel
  consumes the delivery yet.
- S5-C formal enablement remains blocked on three future main-owned inputs: a
  unique cohort, an authoritative measured-reference, and a complete manifest
  covering the modules actually executed inside the timing window. The
  diagnostic seam cannot self-supply those prerequisites.

### Final Stage 5 closeout (2026-08-14)

- A fresh combined review found no direct S5-A/B/C/D path, export, schema, or
  claim-boundary conflict. The remaining release blocker was test reachability:
  the standard `npm test` / `npm run validate` / CI chain reached none of the 14
  S3-S5 suites even though the one-off focused suites passed.
- `test:route-decision-s3-s5` now owns that exact 14-suite set and is called by
  the standard `test` aggregate. The named aggregate passed `267/267`; the
  direct S4/S5 closeout set passed `136/136`; full `npm run validate`, JS lint,
  and CSS lint passed on the closeout candidate.
- This closes Stage 5 contract integration and continuous-regression coverage.
  It does not establish a real browser/Worker result, formal performance
  authority, trusted external-graph authority, real-data admission, runtime or
  public wiring, pilot evidence, release, deployment, or scientific/safety
  claim.

## Proposed Stage 6 research handoff (planning only)

1. **S6-0 canonical freeze:** integrate and push the exact Stage 5 closeout,
   freeze its claim matrix, and use that immutable revision as every S6 lane's
   common input. No lane may reinterpret `unavailable`, `unknown`, `partial`, or
   `no-decision-not-executed` as a positive or negative outcome.
2. **S6-1 controlled functional-needs compiler:** build a tooling-only,
   synthetic-only compiler from non-identity functional-need selections to one
   versioned public compile artifact, then through existing `DecisionPolicy/v1`,
   `CandidateSearchRequest/v1`, S2 search, the S5-A typed run, and a traceable S6
   result. Do not add personas, inferred identity, UI, backend, or safety/
   accessibility-outcome claims.
3. **S6-2 synthetic B-lite graph seam:** first freeze the compact directed-graph
   schema and authority registry; then implement deterministic build-time
   compiler, browser lazy loader, Worker solver seam, manifests, and
   snapshot/current/rollback lifecycle using synthetic fixtures only. This may
   prove conformance and failure behavior, not real-city readiness.
4. **S6-3 explanation/browser acceptance:** define atomic consumption of the
   S5-B summary, claim boundary, and limitations plus scenario/city conformance
   fixtures. A real browser run remains a separate live gate; tooling-only
   serialization does not prove product experience.
5. **S6-G2 external authority gate:** actual graph acquisition, review,
   admission, formal performance, or trusted browser delivery requires explicit
   main-owned inputs and an independently controlled root of trust. On static
   Pages, a real graph delivered to the browser is public redistribution, so
   license and publication authority must be established before such a path is
   designed as deployable.
6. **Later execution order:** admit at most one real authority lane at a time:
   candidate-only acquisition -> independent admission/root -> exact-graph
   performance -> runtime/public promotion. Until G2 is satisfied, all actual
   admission, Source Health current state, formal pass/fail, real-data runtime,
   pilot, and publication work returns `authority-unavailable` rather than a
   guessed fallback.

## Acceptance criteria

- Each new public or validation artifact has one exact versioned schema,
  deterministic admission, bounded inputs, and explicit unavailable/unknown/
  stopped truth; callers cannot self-author evidence-backed outcomes.
- Explanation effects are independently recomputed and do not turn score
  contribution into a causal, safety, or preference claim.
- Performance evidence freezes environment, strata, sample eligibility,
  denominators, thresholds, and failure policy before any eligible sample;
  diagnostics cannot enter the admitted denominator, and the current R2 cannot
  produce pass/fail without a future typed binding, cross-process runner, and
  independently admitted authority result.
- City adaptation makes CRS, timezone, mode/taxonomy, capability mapping, and
  missing/unknown handling explicit. V2 identities must be recomputed from the
  original synthetic source; a V1 receipt/revision cannot be relabeled as V2.
- External graph admission separates candidate, reviewed internal, product
  runtime, public/redistribution, publication, and Source Health gates. The R2
  report is validation-only; S3-1 artifacts and caller JSON cannot be relabeled
  or promoted by metadata alone.
- S0-S3 versions and existing runtime/product behavior remain compatible and
  unchanged unless an explicit reviewed versioned adapter is introduced.
- Every accepted lane has fresh focused tests, targeted lint/syntax checks,
  ownership-clean status, and an independent review before central integration.
- S5-A must mechanically bind CityAdapter/v2, GraphArtifact/v1, CandidateSet/v3,
  Evaluation/v2, and Explanation/v1 identities. Its versioned capability
  observation projection must preserve observed true/false and map unknown or
  unavailable only to explicit unresolved S2 evidence; missing values, aliases,
  false, and zero cannot be guessed.
- S5-B must be a versioned serialized data delivery whose browser consumer has
  no Node builtin or direct Node/tooling-module import. It cannot weaken S4-1
  no-claim language or turn S4-3 synthetic evidence into runtime/public data.
  Its completeness claim is limited to the browser-boundary summary, and a
  future UI must consume summary, claim boundary, and limitations atomically
  under separately admitted delivery authority and a real browser/runtime gate.
- S5-C diagnostic execution binds the typed S5-A artifact and runs in fresh
  child processes, but its admitted result is still no-decision and
  non-authoritative. A future formal path must separately admit main-owned
  cohort, measured-reference, and complete timed transitive-code-manifest
  prerequisites; generic identity, an in-process session, or the pure
  classifier cannot self-author performance pass/fail.
- S5-D may define a versioned transition protocol and root-of-trust prerequisite,
  but absent a caller-unforgeable trusted root every actual admission,
  promotion, materialization, publication, and Source Health transition remains
  mechanically unreachable and false.

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
- The first locally integrated R1/V1 commits are historical implementation
  evidence, not the final reviewed deliveries. They must not be renamed or
  treated as R2/R3/V2 without integrating the reviewed repair diffs.
- S4-1 and S4-3 import Node builtins and remain outside browser/runtime/public
  barrels. A future browser consumer may only receive a versioned serialized
  wire artifact through a separately reviewed adapter.
- Short isolated tests are allowed in worker worktrees; all shared/long live
  gates have a single primary owner and will be scheduled separately.
- Wave 1 ownership is exact and disjoint. S5-A owns only
  `src/route_decision/integration/**`,
  `scripts/tests/route_decision_s5_integration_binding.mjs`, and
  `scripts/fixtures/route-s5-integration/**`. S5-D owns only
  `scripts/lib/route_graph_authority/**`,
  `scripts/tests/route_graph_authority_s5.mjs`, and
  `scripts/fixtures/route-graph-authority-s5/**`.
- S5-B and S5-C have no active writer or owned paths in Wave 1. Browser/server,
  full/long/live tests, real data, shared barrels, package files, workflows, and
  protected untracked artifacts remain closed and primary-owned.
