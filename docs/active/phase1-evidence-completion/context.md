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

No persistent service is authorized. If the same hypothesis fails three times,
stop rerunning it and diagnose. The helper failure-injection contract is the
mechanical proof that a preview-success/Chromium-launch failure and context,
route, page creation, or page-setup failure close acquired resources and remove
the temporary harness.

Current repair execution owner: this e4c5 task alone. Before the next composite
gate, it runs the production Home Compare browser suite serially on port 4189;
the task-owned retained output is `.dfev1/home-neighborhood-compare/m3-v1/browser`.
No second browser, preview, or release runner may share that port/output.

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

Implementation tip: `fe32f7baeb1bbaf19b219012f5b89285b575311a`. It adds
preserved primary nonzero errors for both composite runners, the visual
nonzero-plus-close failure contract, closed Phase 1 policy fields, and distinct
preparation/consumption/admission/deletion decisions. The M4 future receipt
policy now requires `known-route-evidence-checkpoint/v1`, DQ, lineage, explicit
consent, and four clocks; current M4 evidence remains unavailable rather than
being backfilled or claimed. One task-owned `npm.cmd run ci:release` parent
naturally exited 0; its self-contained receipt at
`.dfev1/phase1-release-fe32f7/receipt.json` binds pre-run
HEAD/main/merge-base/clean status, owner PID, timestamps, npm exit, process
tree snapshots, and empty five-port LISTENING audits. It completed complete
validation, unchanged-ceiling bundle policy, release-owned browser leaves, and
visual-dist (35 passed, 10 designed skips). Earlier evidence is historical only
and is not evidence for this implementation tip.

Cumulative evidence-record tip: this strict record-only commit; its exact SHA
must be resolved with `git rev-parse HEAD`. It records `fe32f7b`
implementation-tip evidence without claiming to have re-run the composite
after a documentation-only commit.

Reviewed candidate tip: none. Independent re-review is requested for the
cumulative evidence-record tip; this task cannot designate or self-approve it.
Integration, remote CI, deployment, scheduled refresh, and online smoke remain
deferred. The task is ready-for-review but blocked-for-admission; the reviewed
candidate tip remains none. The runtime receipt's final snapshot retains only
the runner's Windows console host while it writes the receipt; after the parent
returns, a separate audit finds no task-owned runner child and ports **4173,
4178, 4189, 4194, and 4198** have no LISTENING socket. No process was manually
stopped for this passing run.

## 2026-08-22 exact implementation release receipt

- Implementation tip: `78db018ddf8eb30335393347b2c897b834fccd79`; local
  main and merge-base: `91cba5544f6a1ae7dc8c26a9d265657f452aae3b`.
- The task-owned ignored receipt is
  `.dfev1/phase1-release-78db018/receipt.json`; its separately readable
  `.dfev1/phase1-release-78db018/exit.txt` is `0`. It records owner PID
  60068, clean pre-status, 2026-08-21T20:45:23Z–20:52:27Z, command
  `npm.cmd run ci:release`, `releaseExitCode=0`, `wrapperExitCode=0`, zero
  wrapper errors, and existing stdout/stderr log paths.
- Its pre/post task-child and five-port snapshots are all empty; baseline-
  subtracted new child/listener arrays are empty. The independent post-run
  audit also found no listener at 4173/4178/4189/4194/4198 and no release or
  visual Node process. No process was killed for this passing run.
- A prior failed wrapper was stopped only after it was proven to be this task's
  child PID 44480 with no release children, no marker/receipt, and runaway
  memory/CPU. It is not credited as release evidence.
