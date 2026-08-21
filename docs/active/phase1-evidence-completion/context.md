# Phase 1 Evidence Completion Context

## Candidate baseline

- Current repair begins from detached candidate
  5435dd88a0d4edd509d3cb2c6028c666bdfa3961. Its base, local main, and
  merge-base are 91cba5544f6a1ae7dc8c26a9d265657f452aae3b; that base contains
  the required DFEV closeout.
- This worktree is the only writer of its files and the only live-test owner.
  No other worktree, ref, remote, user WIP, branch, or process is changed.
- This is a repair candidate, not an integration approval. A new cumulative
  local commit and independent re-review are required after the ledger closes.

## Live-process ownership and resources

| Command class | Owner and cwd | Shared port/output | Command and success criterion | Cleanup/stop rule |
| --- | --- | --- | --- | --- |
| Focused contracts | This task; current worktree | none | package focused contracts, including browser lifecycle, release graph, Home Compare, Source Health, and Phase 1 handoff | exit recorded in task.md |
| Build / bundle | This task; current worktree | dist only | npm run build:manifest and npm run verify:bundle; existing ceilings must pass | serial build exits before any preview |
| Area Intelligence browser | This task; current worktree | port 4198; temporary dist/area-intelligence-smoke.html harness | npm run test:area-intelligence-browser; real Chromium and production dist | lifecycle helper closes page/context/browser/server then removes the dist harness |
| Home Compare browser | This task; current worktree | port 4189; retained task-owned .dfev1/home-neighborhood-compare/m3-v1/browser output | npm run test:home-compare-browser; real Chromium and production dist | helper closes page/context/browser/server; the task-owned browser evidence output is retained, not a test-results directory |
| Known Route browser | This task; current worktree | port 4194; no task-owned test-results directory | npm run test:known-route-evidence-browser; real Chromium and production dist | helper closes page/context/browser/server; no output directory is claimed |
| Composite release gate | This task; current worktree | its child commands run serially; visual runner may use its own temporary preview | npm run ci:release, not an equivalent hand-assembled command list | run only after the direct three-suite browser evidence; verify ports after completion |
| Exact-tip release supervisor | This task; current worktree | ports 4173/4178/4189/4194/4198; `.dfev1/phase1-release-4ea5bb3-r2/` | `observe-release.ps1` waits `supervise-release.ps1`, which freezes Git/status before synchronously starting `run-release.ps1`; the wrapper invokes exactly `npm.cmd run ci:release` | one live owner; retain start/receipt/log/exit artifacts on success or failure; no process kill or concurrent runner |

No persistent service is authorized. If the same hypothesis fails three times,
stop rerunning it and diagnose. The helper failure-injection contract is the
mechanical proof that a preview-success/Chromium-launch failure and context,
route, page creation, or page-setup failure close acquired resources and remove
the temporary harness.

Current repair execution owner: this e4c5 task alone. Before the next composite
gate, it runs the production Home Compare browser suite serially on port 4189;
the task-owned retained output is `.dfev1/home-neighborhood-compare/m3-v1/browser`.
No second browser, preview, or release runner may share that port/output.

The current composite gate is governed by three ignored PowerShell layers under
its exact-tip root. The supervisor freezes `HEAD`, local `main`, merge base,
and `git status --porcelain=v1 --untracked-files=all` before it starts the
wrapper and records the wrapper's externally observed exit after it waits. The
wrapper records the inner `npm.cmd run ci:release` exit, its declared exit,
recursive descendants scoped to its own PID, and fail-closed target-listener
snapshots. The independent observer waits for supervisor termination, records
that observed exit, and hashes the supervisor streams plus all receipt/log
materials after their handles close. The scope is intentionally narrower than a
machine-wide tree: wrapper termination plus baseline-subtracted target
listeners.

## Decisions and boundaries

- The first valid Home Compare compare intent/query-time creates and observes
  the lazy renderer import; it completes before result commit, not after a
  completed compare.
  Projection, labels, rendered HTML, and renderer stay local until the active
  generation/AbortSignal is checked. Synchronous close/cancel/destroy clears a
  pending request before a queued native close event; a renderer/chunk failure
  becomes results-unavailable, not source-unavailable, and explicit retry is
  covered.
- A compare request freezes addresses, destinations, and weights at its start.
  Busy inputs are disabled and reject state writes, so source evidence and
  projection sensitivity cannot mix different user edits.
- Browser-suite teardown always attempts page, context, browser, preview, and
  task-artifact cleanup in reverse order. A primary-only failure is rethrown
  unchanged; cleanup-only failures aggregate; a primary plus cleanup failure
  raises an auditable AggregateError retaining primaryError and cleanupErrors.
- The repository-defined release graph has one release-runner owner for three
  exact leaf package mappings. The workflow/package contract audits all jobs
  and composites present in this repository; it intentionally does not claim
  control over arbitrary external shell invocation.
- Source Health four-clock/status and Source lifecycle facts are existing
  executable contracts re-verified by Phase 1-0. Only release/browser wiring
  and its failure lifecycle receive new mechanical coverage here.
- Local browser fixtures remain synthetic interception where stated by the
  suites. They are not source, scheduled-refresh, remote-CI, deployment, or
  authority evidence.

## Handoff checkpoint

The former `fe32f7baeb1bbaf19b219012f5b89285b575311a` release record is
historical and superseded. It is retained only as partial local evidence of a
past runner attempt, not as execution evidence for any later implementation
tip. The existing `known-route-evidence-checkpoint/v1` is **preparation
evidence only**; it cannot satisfy M4 admission. A future M4 admission/final
handoff must use and validate only
`engagement-known-route-evidence-handoff/v2` with its required DQ, lineage,
consent, and four-clock fields. Current M4 evidence remains unavailable rather
than being backfilled or claimed.

Current exact local execution evidence is bound to implementation tip
`4ea5bb353c529aff6cf5696a7635142273f90e8a` in
`.dfev1/phase1-release-4ea5bb3-r2/external-observed.json`. The supervisor froze
local `main` and merge-base at `91cba5544f6a1ae7dc8c26a9d265657f452aae3b`
with a clean full porcelain. Inner release, wrapper-declared, outer observed,
supervisor observed, and observer exits are all `0`; baseline-subtracted
listeners and recursive wrapper descendants are empty after the run. This is
local execution evidence only, not review or admission approval.

Cumulative candidate: the documentation-only record tip is intentionally
resolved by `git rev-parse HEAD`, rather than self-written into this record.
Its parent is the execution-evidence record for implementation `4ea5bb3`; it
cannot make the implementation admissible without independent re-review.

Reviewed candidate tip: none. Independent re-review is requested for the
cumulative evidence-record tip; this task cannot designate or self-approve it.
Integration, remote CI, deployment, scheduled refresh, and online smoke remain
deferred. The task is blocked-for-admission and the reviewed candidate tip
remains none. Historical process snapshots are not a proof of a complete
process tree or of an externally observed wrapper exit.

## Historical 2026-08-22 release receipt (partial; not current admission evidence)

- Implementation tip: `78db018ddf8eb30335393347b2c897b834fccd79`; local
  main and merge-base: `91cba5544f6a1ae7dc8c26a9d265657f452aae3b`.
- The ignored historical material is
  `.dfev1/phase1-release-78db018/receipt.json` and `exit.txt`. It claims an
  inner release and wrapper exit of `0`, but its pre-run freeze,
  externally-observed supervisor exit, and complete descendant-tree scope are
  not sufficient for a later exact-tip admission claim.
- Historical child/listener snapshots are not reused as evidence that a new
  run has no descendants or listeners. A new candidate requires a new ignored
  root, explicit baseline subtraction, and an external supervisor observation.
- A prior failed wrapper was stopped only after it was proven to be this task's
  child PID 44480 with no release children, no marker/receipt, and runaway
  memory/CPU. It is not credited as release evidence.
