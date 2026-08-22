# Phase 1 Evidence Completion Context

## Candidate baseline

- Current repair begins from detached candidate
  5435dd88a0d4edd509d3cb2c6028c666bdfa3961. Its base, local main, and
  merge-base are 91cba5544f6a1ae7dc8c26a9d265657f452aae3b; that base contains
  the required DFEV closeout.
- This worktree is the only writer of its files and the only live-test owner.
  No other worktree, ref, remote, user WIP, branch, or process is changed.
- The scope-converged candidate was independently reviewed and strictly
  fast-forwarded to local `main`; producer admission remains separately blocked.

## Step 1 scope convergence (no live process)

- The historical `543c214` → `a7271b3` → `142cd3a` candidate received
  REQUEST_CHANGES. Its ignored release material remains byte-bound historical
  execution evidence; it cannot be reused as a producer admission, review, or
  deletion decision.
- Phase 1-0 does not install any final M1/M2/M3/M4/1D producer validator.
  The immutable evaluator policy marks every phase validator `not-installed`
  and every receipt mode `future-admission`. It short-circuits before receipt
  readers, authority readers, or injected resolvers, making preparation,
  consumption, admission, and deletion false for every phase and globally.
- This preserves the independently useful release graph, real browser leaf
  wiring, lifecycle cleanup, bundle headroom, M0 wording, and existing
  sourceAsOf/retrievedAt/builtAt/observedAt plus status semantics. It does not
  invent M3 privacy fields, normalize M4 identities, repair M1/M2 producer
  schemas, or pre-approve 1D provenance.
- No long test, browser, preview, port, or full release process was started in
  this scope-convergence step. Future validator installation belongs only to
  the named phase owner in a separately reviewed implementation.

## Live-process ownership and resources

| Command class | Owner and cwd | Shared port/output | Command and success criterion | Cleanup/stop rule |
| --- | --- | --- | --- | --- |
| Focused contracts | This task; current worktree | none | package focused contracts, including browser lifecycle, release graph, Home Compare, Source Health, and Phase 1 handoff | exit recorded in task.md |
| Build / bundle | This task; current worktree | dist only | npm run build:manifest and npm run verify:bundle; existing ceilings must pass | serial build exits before any preview |
| Area Intelligence browser | This task; current worktree | port 4198; temporary dist/area-intelligence-smoke.html harness | npm run test:area-intelligence-browser; real Chromium and production dist | lifecycle helper closes page/context/browser/server then removes the dist harness |
| Home Compare browser | This task; current worktree | port 4189; retained task-owned .dfev1/home-neighborhood-compare/m3-v1/browser output | npm run test:home-compare-browser; real Chromium and production dist | helper closes page/context/browser/server; the task-owned browser evidence output is retained, not a test-results directory |
| Known Route browser | This task; current worktree | port 4194; no task-owned test-results directory | npm run test:known-route-evidence-browser; real Chromium and production dist | helper closes page/context/browser/server; no output directory is claimed |
| Composite release gate | This task; current worktree | its child commands run serially; visual runner may use its own temporary preview | npm run ci:release, not an equivalent hand-assembled command list | run only after the direct three-suite browser evidence; verify ports after completion |
| Exact-tip release supervisor | This task; current worktree | ports 4173/4178/4189/4194/4198; fresh `.dfev1/phase1-release-6e71478-r1/` | `observe-release.ps1` waits `supervise-release.ps1`, which freezes Git/status before synchronously starting `run-release.ps1`; the wrapper invokes exactly `npm.cmd run ci:release` | one live owner; retain start/receipt/log/exit artifacts on success or failure; no process kill or concurrent runner |

No persistent service is authorized. If the same hypothesis fails three times,
stop rerunning it and diagnose. The helper failure-injection contract is the
mechanical proof that a preview-success/Chromium-launch failure and context,
route, page creation, or page-setup failure close acquired resources and remove
the temporary harness.

Current repair execution owner: this e4c5 task alone. The authorized frozen
`6e71478954356f1890df1a45d167ff1a52a588ba` composite gate ran serially after
its no-release self-test. No second browser, preview, or release runner may
share port 4189 or any of the audited release ports/output roots.

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

Current exact local execution evidence is bound to frozen implementation tip
`543c214f890232b9e580c297b6547a2494e0bd50` in
`.dfev1/phase1-release-543c214-r1/external-observed.json` (schema
`engagement-phase1-release-external-observer/v1`, canonical relative path as
shown, 4,418 bytes, raw SHA-256
`628b58d9d093d5d8a90d01f7f2b1c9c93dd5bae7ad8037a6b81192affc86fe9d`). Its
tracked material binding includes wrapper `run-release.ps1` SHA-256
`2a4617fe66c0ea2f37383329886fec20a7693744e9f140d8cb85ac804e06e245`, outer
receipt SHA-256 `d10ccbe93bb82e570dd839bdda5942ea307baa9a8c02f941fc4868c729826fed`,
and wrapper receipt SHA-256
`78e96cb3d8df0c20a9589e241623e0d3ccfd454bbabdd4cd3bf001f5b9c1f22a`.
The supervisor froze local `main` and merge-base at
`91cba5544f6a1ae7dc8c26a9d265657f452aae3b` with clean full porcelain.
Inner release, wrapper-declared, outer observed, supervisor observed, and
observer exits are all `0`; wrapper errors, baseline-subtracted listeners, and
new recursive wrapper descendants are empty after the run. The release log
records visual-dist **35 passed / 10 designed skips**. This is local execution
evidence only, not review or admission approval.

Execution-evidence record `a7271b3a9a5b094af77079b7788b5a4c172f1300`
anchors these exact receipt bytes. The following record-only cumulative
candidate resolves its own identity with `git rev-parse HEAD`, never
self-writes it, and must continue to leave `cumulativeTip` and `reviewedTip`
null.

## Current Step 1 release evidence (local execution only)

- Frozen implementation: `6e71478954356f1890df1a45d167ff1a52a588ba`; local
  main and merge-base: `91cba5544f6a1ae7dc8c26a9d265657f452aae3b`; the
  supervisor froze a clean `git status --porcelain=v1 --untracked-files=all`
  before it started the wrapper.
- This task was the only live-process owner in
  `C:/Users/raede/.codex/worktrees/e4c5/engagement_project`. It first ran the
  no-release wrapper self-test, then exactly one synchronous
  `npm.cmd run ci:release` through observer → supervisor → wrapper. Its fresh
  ignored root is `.dfev1/phase1-release-6e71478-r1/`; historical 543c214 and
  earlier roots were neither overwritten nor reused.
- The canonical relative raw external receipt is
  `.dfev1/phase1-release-6e71478-r1/external-observed.json` (schema
  `engagement-phase1-release-external-observer/v1`, 4,418 bytes, raw SHA-256
  `c3d9b6e26387470b9be3e233afa33f690d8b622b736c01ac4cb2e08a899e597f`). Its
  outer and wrapper receipt SHA-256 values are respectively
  `0f0110744e7f47fdfce324e40f19ef18ed4194dcdb2257b3d150562738842969` and
  `45b41e1dca8b9546e422d5be617af851ed4d424277742b3822847d42f710b93a`.
- Inner release, wrapper-declared, outer-observed-wrapper, outer, supervisor,
  and observer exits are all `0`; all receipt error arrays are empty. The
  wrapper's recursive PID scope has zero baseline-subtracted descendants and
  zero new listeners. The pre-existing `conhost.exe` baseline was observed
  both before and after, so it is not claimed as a run leak. The audited ports
  4173/4178/4189/4194/4198 have no post-run listener and no exact-root wrapper,
  supervisor, observer, release, or visual process remains.
- Raw release logs are retained in that root: stdout is 338,770 bytes
  (`57e772bd2a76e0cde563d9984b65c80020b150fccaddc697af88794d98803c55`) and
  stderr is 863 bytes
  (`9d81809e09bc46a5ca72c6013833e9ff9eabaf7373db8c3cd8bded7660f41c51`). The
  composite runner's visual-dist result is **35 passed / 10 designed skips**;
  it included the real Area Intelligence, Home Compare, and Known Route
  browser leaves. This is local execution evidence only, never review,
  deletion, source, or producer-admission authority.
- Execution-evidence record `fd00de5c6fff65916b117bcfa6cae05f562f2074`
  anchors the exact raw receipt and material binding. The following cumulative
  candidate resolves its own identity with `git rev-parse HEAD`; it must retain
  `reviewedTip: null` and is only ready for independent review,
  blocked-for-admission.

Independent integration review task `01a028eb-3a3c-7151-8270-2e30c971e25d`
approved exact cumulative candidate `5e25b5eed082420f569739c6cc2ebceca960f80f`
for local strict fast-forward, with P0-P3 all zero. Local `main` was then
strictly fast-forwarded from `91cba5544f6a1ae7dc8c26a9d265657f452aae3b`
to that candidate. Exact-main `test:phase1-handoff` passed 13 tests with one
Windows symlink permission skip; direct evaluation remained globally blocked,
all phase/global eligibility decisions were false, and the injected resolver
was not called. `reviewedTip`, review authority, and deletion authority remain
null because this external approval authorizes only the local Phase1-0 code
integration, not M1-M4/1D producer admission. No push, remote CI, deployment,
scheduled refresh, or online smoke was performed.

## M1 local integration (2026-08-22)

M1 producer task `01a028f8-8d0f-7b92-81c6-831ba669da99` generated a new
official-local-candidate warehouse in its ignored
`.dfev1/crime/m1-frozen-2026-08-22-r2` root and delivered cumulative code tip
`326a440fe67f6c05f08a8bb4430bd641efdb2fd4`. Receipt v3 binds 21 retained raw
snapshots to 64 canonical partitions by source ID, replays producer transforms,
and mechanically recomputes the eight revision classes from the complete raw
history. The frozen receipt covers `[2006-01-01, 2026-08-22)` with 3,584,011
active rows, remains `serving_eligible=false`, and carries no integration,
serving, deployment, or deletion authority.

Independent review task `01a02961-f52f-77f3-a94e-8eb011b8b56e` approved the
code, bounded current r2 data evidence, and strict-fast-forward topology after
focused 10/10, data-pipeline 66/66, a real direct validation, hostile contract
tests, and two unchanged idempotent reruns. The integration owner then strictly
fast-forwarded local `main` from `a19fcf55438abb47e7685ee5b4d996f7e61e5d38`
to `326a440fe67f6c05f08a8bb4430bd641efdb2fd4`; exact-main focused tests passed
10/10. The producer worktree and ignored r1/r2 roots are retained through 1D.
No push, remote CI, scheduled refresh, deployment, or online serving action was
performed.

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
