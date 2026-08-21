# Phase 1 Evidence Completion

## Goal

Provide one durable Phase 1 handoff surface for evidence-first Area Intelligence,
Home Compare, Known Route, and Source Health work. Phase 1-0 makes the existing
three feature browser suites mechanically mandatory in release CI, restores
meaningful Home Compare gzip headroom without relaxing a ceiling, corrects the
M0 publication description, and freezes shared lifecycle/time semantics.

## Scope and ownership

- This worktree (`C:/Users/raede/.codex/worktrees/e4c5/engagement_project`) owns
  Phase 1-0 source, tests, package/release wiring, this record, and its local
  verification only.
- The Phase 1 integration owner alone may change refs, main, remote state,
  worktree topology, or perform merge/rebase/cherry-pick/push/deploy.
- The Phase 1-0 live-process owner is this task. Browser/build/bundle commands
  run serially from this cwd; no shared server is retained after each command.

## Phase plan and gates

| Phase | Outcome | Gate before handoff | Owner / status |
| --- | --- | --- | --- |
| 1-0 | Release-gate, bundle-headroom, M0 vocabulary, lifecycle baseline | Targeted contracts; all three real browser suites; local release/core/bundle evidence; independent review requested | This task / executing |
| 1A | Area Intelligence evidence completion | Source, evaluation, provenance, DQ and browser evidence; no forecast promotion by implication | Future delegated owner |
| 1B | Home Compare evidence completion | Registry/schema/revision/lineage and privacy contracts; real browser evidence; bundle policy remains unchanged | Future delegated owner |
| 1C | Known Route evidence completion | Consent, privacy, fail-closed source/admission and real browser evidence; no routing authority claim | Future delegated owner |
| 1D | Source Health/release integration closeout | Cross-feature lifecycle receipt, release candidate, independent review, remote CI/deploy gates owned by integration owner | Integration owner only |

## Shared source lifecycle contract

- `sourceAsOf` is the date/time represented by the source facts; `retrievedAt`
  is acquisition time; `builtAt` is artifact-build time; `observedAt` is the
  time a local observation was made. They are distinct clocks and a missing
  clock remains null/unavailable as its contract requires.
- `current`, `partial`, `stale`, `unavailable`, and `unknown` are separate
  evidence states. In particular, unavailable/unknown are not zero or current;
  partial/stale may not be silently promoted to current.
- Every future source admission must preserve schema/version/revision,
  data-quality (DQ), coverage and lineage/provenance facts. Transport validators
  are transport evidence, never a substitute business clock or lineage proof.
- M0 publication is a **validated recoverable serialized multi-file
  transaction** (`经验证、可恢复的串行多文件事务发布`): temporary artifacts,
  backups, serial rename installation, and rollback. It does not assert
  instantaneous all-files atomic visibility.

## Non-goals and deferred authority

- No ceiling increase, dependency addition, product behavior/privacy/availability
  change, scheduled refresh, remote CI, deploy, live smoke, source acquisition,
  routing authority, forecast promotion, merge, push, or cleanup.
- Local browser fixtures prove the exercised browser contract only. They do not
  prove external source liveness, scheduled refresh, remote CI, deployment, or
  production authority.

## Handoff rules

1. Recheck exact target SHA, worktree topology, status, ownership, and path
   overlap immediately before integration.
2. Integrate Phase 1-0 only by strict fast-forward when its base remains the
   target tip; otherwise use one reviewed, path-scoped cherry-pick. Never bulk
   merge an older worktree.
3. Re-run the recorded targeted contracts, all three browser suites, core/release
   gates as applicable, and bundle policy on the integration candidate.
4. Keep this single directory active through 1D; append progress in place and
   do not create duplicate Phase 1 total plans or archive it early.
