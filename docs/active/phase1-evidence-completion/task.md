# Phase 1 Evidence Completion Task

## Status

| Item | Status | Evidence / next action |
| --- | --- | --- |
| Base, ownership, and unique record | complete | Detached repair begins at 5435dd88a0d4edd509d3cb2c6028c666bdfa3961 over local main 91cba5544f6a1ae7dc8c26a9d265657f452aae3b. |
| Current implementation | complete | Implementation tip b156178e9c0263e2d111c4e43a9eeec0bdad3c0d closes the Vite preview through its owning `PreviewServer`, following the prior control-flow, lifecycle, structured-handoff, and release-ownership repairs. |
| Focused and bundle verification | complete | The b156 implementation chain has focused Home Compare, browser-lifecycle, Phase 1 handoff, and release-workflow contract coverage, JS/CSS lint, manifest build, and unchanged-ceiling bundle-policy evidence. The composite below freshly reran the standard release graph at b156. |
| Composite local release verification | complete | `npm.cmd run ci:release` exited **0** at b156178e9c0263e2d111c4e43a9eeec0bdad3c0d. The task-owned observation parent recorded its natural exit in `.dfev1/phase1-release-b156-observation-attempt2/exit-code.txt`; the graph included validate, bundle policy, browser leaves, and visual-dist. |
| Cumulative evidence record | complete | This strict documentation-only commit is the cumulative evidence-record tip. It does not claim a new composite execution after its own documentation delta. |
| Independent review | requested | Reviewed candidate tip is not yet designated. The main supervising task must independently resolve the clean cumulative HEAD and perform code/architecture re-review; this task cannot self-approve. |
| Integration / remote / scheduled gates | deferred | No merge, push, remote CI, deploy, scheduled refresh, live source, or online smoke is authorized. |

## Local verification ledger

All commands run from C:/Users/raede/.codex/worktrees/e4c5/engagement_project
by this task alone. Append fresh command, exact exit code, relevant result, and
post-browser port state before requesting review. Do not treat a static check as
browser evidence.

| Command | Exit | Result |
| --- | --- | --- |
| npm run test:browser-lifecycle | 0 | First fresh focused run: five deterministic launch/context/route/page cleanup contracts passed. |
| npm run test:phase1-handoff | 0 | First fresh focused run: existing executable lifecycle/status contract and required M1-M4/1D handoff binding passed. |
| npm run test:release-workflow | 0 | First fresh focused run: nine release workflow/package mapping and graph contracts passed. |
| npm run test:home-compare | 0 | First fresh focused run: sixteen Home Compare contracts passed, including deferred renderer close/destroy and rejection/retry. |
| npm run lint:js | 1 then repaired | Initial focused lint exposed unsafe throw inside helper finally-equivalent control flow; helper now records primary error, runs cleanup, then rethrows; the fresh lint rerun is green below. |
| npm run build:manifest and npm run verify:bundle | 0 after the lint repair | Build and unchanged-ceiling bundle policy passed. Home Compare controller measured 31,287/11,113 raw/gzip and results 3,672/1,505; controller headroom is 6,887 gzip bytes. |
| npm run test:browser-lifecycle; npm run test:phase1-handoff; npm run test:release-workflow; npm run test:home-compare; npm run lint:js; npm run lint:css | 0 | Fresh repaired focused pass: 5 lifecycle-injection, 1 Phase 1 binding, 9 release graph, and 16 Home Compare tests passed; both linters clean. |
| npm run test:area-intelligence-browser | 0 | Real production-dist Chromium suite passed promoted/no-promotion and responsive paths with zero console/page errors; port 4198 and its dist harness were released. |
| npm run test:home-compare-browser | 1 then repaired, then 0 | First browser run exposed close clearing a completed result; cleanup released 4189. The narrow in-flight-only fix passed 16 focused contracts, rebuilt bundle policy, then passed the real 2/3/4 profile, bilingual, privacy, partial/unavailable and mobile suite with zero console/page errors; 4189 released. |
| npm run test:known-route-evidence-browser | 0 | Real production-dist Chromium suite passed consent/privacy/fail-closed/mobile paths with zero console/page errors; port 4194 released and no test-results directory was created. |
| npm run ci:release | 0 | Full composite release runner passed on f7190f5c77432f0855e4575583f6e66ac906f50d: audit, both linters, complete npm run validate (including Phase 1 handoff/lifecycle contracts, manifest and bundle policy), general/ACS browsers, all three DFEV browser leaves, and visual-dist. |
| Post-run listener check | 0 | No listener remained on 4178, 4189, 4194, or 4198. |
| npm run test:home-compare | 0 | Current repair focused run: 20/20, including queued native-close click/Escape timing, destroy, renderer execution/re-render/retry, and immutable addresses/destinations/weights while busy. Content is included by implementation tip 7e0c5929d34140c995c8180a3804d14a1c2635c5. |
| npm run test:browser-lifecycle | 0 | Current repair focused run: 8/8, including primary-only rethrow, cleanup-only aggregation, and primary-plus-all-cleanup AggregateError with reverse cleanup. Content is included by implementation tip 7e0c5929d34140c995c8180a3804d14a1c2635c5. |
| npm run test:phase1-handoff; npm run test:release-workflow; npm run lint:js; npm run lint:css | 0 | Current repair focused run: hardened per-M1-M4 handoff assertions, 9 release graph contracts, and both linters passed. Content is included by implementation tip 7e0c5929d34140c995c8180a3804d14a1c2635c5. |
| npm run build:manifest; npm run verify:bundle | 0 | Current repair build passed unchanged ceilings. Home Compare controller is 32,205/11,369 raw/gzip, retaining 6,631 gzip bytes below the existing 18,000-byte ceiling; lazy results view is 3,520/1,460. Content is included by implementation tip 7e0c5929d34140c995c8180a3804d14a1c2635c5. |
| npm.cmd run ci:release | 0 | Fresh full composite at **b156178e9c0263e2d111c4e43a9eeec0bdad3c0d**, run by one task-owned parent process. The prior unobservable runner was not credited; a first logging attempt exited 1 before the runner because direct Node lacked `npm_execpath`, then the single corrected `npm.cmd run ci:release` attempt naturally wrote exit 0. It completed audit, linters, validate, manifest/bundle policy, general/ACS browsers, Area/Home/Known Route browser leaves, and visual-dist (35 passed, 10 designed skips). |
| Post-release task-owned process and listener audit | 0 | After the recorded exit, no task-owned process remained and `netstat` found no listener on **4173, 4178, 4189, 4194, or 4198**. No PID was manually stopped for the passing b156 run. |

Rows through old f7190f5c77432f0855e4575583f6e66ac906f50d and 7e0c5929d34140c995c8180a3804d14a1c2635c5
are historical and must not be attributed to b156. This task is
**ready-for-review / blocked-for-admission**: reviewed candidate tip is **none**;
it does not self-approve, integrate, push, deploy, or clean worktrees/branches.
