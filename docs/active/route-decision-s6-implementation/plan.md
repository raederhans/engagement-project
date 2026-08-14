# Plan

## Goal

Implement the first bounded S6 wave from canonical baseline `9c4756f`: compile
user-selected non-identity functional needs into existing route-decision
contracts, define a deterministic synthetic compact-graph artifact and
build-time compiler, and define atomic browser-boundary acceptance without
opening real-data, UI/runtime, formal-performance, or publication authority.

## Scope and lanes

Four conversations run with one central integration owner and disjoint roles:

1. **S6-A controlled functional-needs compiler**
   - Owns `src/route_decision/functional_needs/**`,
     `scripts/tests/route_decision_s6_functional_needs.mjs`, and
     `scripts/fixtures/route-s6-functional-needs/**`.
   - Produces a versioned, deterministic, tooling-only compiler from explicit
     functional-need selections to existing DecisionPolicy and candidate-search
     inputs, with a lossless mapping trace and explicit unresolved truth.
2. **S6-B synthetic compact-graph contract/compiler**
   - Owns `src/route_generation/compact_graph/**`,
     `scripts/lib/route_s6_compact_graph/**`,
     `scripts/tests/route_generation_s6_compact_graph.mjs`, and
     `scripts/fixtures/route-s6-compact-graph/**`.
   - Produces a browser-safe compact directed-graph contract plus deterministic
     build-time compiler and synthetic manifests. It does not load real data or
     establish admission, Source Health, runtime, or publication authority.
3. **S6-C browser-boundary atomic acceptance**
   - Owns `src/route_decision/browser_acceptance/**`,
     `scripts/tests/route_decision_s6_browser_acceptance.mjs`, and
     `scripts/fixtures/route-s6-browser-acceptance/**`.
   - Consumes the existing S5-B primitive document and admits only an atomic
     summary + claimBoundary + limitations presentation contract. It adds no UI,
     Worker, runtime barrel, server, package script, or real-browser claim.
4. **S6-R independent compatibility/review gate**
   - Read-only; owns no repository path and cannot stage, commit, integrate, or
     change refs.
   - Freezes review criteria, then reviews stable lane deliveries for schema,
     claim, import, hostile-input, compatibility, and test adequacy before any
     central source-final is formed.

## Dependency graph

```text
S6-A functional compiler  ||  S6-B compact graph compiler  ||  S6-C browser acceptance
             \                       |                       /
              +---------- stable owned-path freezes --------+
                                      |
                                      v
                         S6-R independent review gate
                                      |
                                      v
                  central serial source-final and integration
                                      |
                                      v
        future Wave 2 loader/Worker lifecycle (only after S6-B acceptance)
```

S6-A, S6-B, and S6-C may author in parallel because their owned paths are
disjoint. They may read but not modify S0-S5 contracts. Future lazy loader,
Worker solver, snapshot/current/rollback lifecycle, actual browser evidence,
and package/runtime wiring remain HOLD until S6-B is independently accepted and
integrated on the exact central revision.

## Stages

- [x] S6-0: Freeze canonical main `9c4756f`, claims, ownership, integration
  authority, and protected artifacts.
- [x] S6-1: Receive stable S6-A/B/C owned-path freezes with focused evidence.
- [x] S6-2: Complete independent code/spec/security and architecture/
  compatibility review; return blocking findings to the exact owner.
- [ ] S6-3: Form traceable source-final commits and integrate accepted units one
  at a time with exact source equality and focused/adjacent validation.
- [ ] S6-4: Add accepted suites to the standard regression entry, run central
  validation, update records, merge/push only when all bounded gates pass.
- [x] S6-5: Decide whether the later synthetic loader/Worker lifecycle wave has
  enough accepted prerequisites to begin. This decision does not open real data
  or a real browser/runtime gate.

## Acceptance criteria

- Every artifact has one exact version, schema, deterministic identity, strict
  unknown-field rejection, bounded inputs, detached/frozen outputs, and explicit
  unavailable/unknown/partial semantics.
- Functional needs are selected explicitly and are not demographic, medical,
  behavioral, address, Diary, or free-text identity inference.
- Hard constraints remain before weighted scoring; missing evidence cannot be
  guessed as false, zero, neutral, pass, no-route, or no-eligible-route.
- The compact graph preserves directed topology, integer costs, mode semantics,
  component identity, deterministic ordering, source classification, and a
  synthetic-only claim boundary. Browser-safe contract code has no Node builtin.
- Browser acceptance consumes summary, claim boundary, and limitations
  atomically. Graph-wide unresolved states remain observations, not terminal
  causes; primitive JSON/content digest remains internal consistency only.
- Each writer reports exact base/HEAD/status, complete changed paths, focused
  tests, static checks, limitations, and recommended integration method without
  changing index, refs, records, package/workflows, runtime barrels, or another
  lane's paths.
- Only the primary integration owner may form commits, integrate, update central
  records or standard test entries, start shared/long tests, merge, or push.

## Non-goals

- Real graph acquisition, license determination, independent admission/root of
  trust, Source Health mutation, product graph materialization, or publication.
- Real browser, Worker, server, eligible performance sampling, UI, backend,
  public barrel, release, deployment, pilot, GPS/address/Diary collection, or
  telemetry.
- Safety, safer-route, accessibility-outcome, preference-alignment, user-success,
  scientific-validity, real-city, or cross-city-transferability claims.

## Risks and stop conditions

- Any writer modification outside its exact ownership is a blocker, not an
  invitation to expand scope.
- Any reliance on a caller-authored hash, JSON, receipt, manifest, or review as
  external authority must fail closed.
- S6-C must not reinterpret S5-B as a full S4 presentation projection or trusted
  delivery. S6-B must not relabel synthetic output as external/admitted/current.
- Existing `.playwright-mcp/`, logs, output, prior worktrees, and detached audit
  sources are protected and remain unstaged, unmodified, and uncleared.
