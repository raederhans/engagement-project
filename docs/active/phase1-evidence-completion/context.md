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

## Decisions and boundaries

- The first Home Compare compare intent creates and observes the lazy renderer
  import; it completes before result commit, not after a completed compare.
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

Validated implementation candidate: f7190f5c77432f0855e4575583f6e66ac906f50d.
It completed fresh focused checks, serial real-browser evidence, unchanged
bundle policy, and the full npm run ci:release composite with no remaining
listener on 4178, 4189, 4194, or 4198. The cumulative handoff is now
ready-for-integration and independent re-review is requested. Integration,
remote CI, deployment, scheduled refresh, and online smoke remain deferred.
