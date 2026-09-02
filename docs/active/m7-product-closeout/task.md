# Task

## Current status

`local-complete-review-remediated-cleaned-awaiting-remote-authorization`：all three M7 lanes are integrated, final correctness/security/performance findings are closed at verified product code tip `main@ecb3f4c`, the exact combined local release gate passes, and the three completed M7 source worktrees/branches are archived and retired. Only separately authorized remote work remains.

## Checklist

- [x] Read and extract the latest project guidance.
- [x] Verify protected WIP, clean integration baseline, M0-M6 delivery state, and M7 gaps.
- [x] Dispatch ML M7 governed admission lane.
- [x] Dispatch Mainline M7 public walking product lane.
- [x] Dispatch Mainline M7 local-private and validation lane.
- [x] Record ready thread ids, worktree paths, generated branches, and first progress snapshots.
- [x] Review each lane delivery package and changed-path overlap.
- [x] Integrate lane commits serially in dependency order.
- [x] Run affected focused gates and the combined local release gate.
- [x] Reconcile portfolio documentation with exact integrated facts.
- [x] Run final integrated correctness, security, and performance reviews; remediate every material finding and obtain PASS rechecks.
- [x] Preserve small ignored execution evidence and exact source tips before cleanup.
- [x] Unregister completed M7 source worktrees and delete their local source branches while retaining recovery refs.
- [ ] If separately authorized, perform and verify remote CI/Pages/release/governance closeout.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Browser extraction of latest assistant guidance | Complete; two M7 lines, M7-0 gate, public/local route split, admission/fallback/validation boundaries captured. |
| `git status --short --branch` in phase1-main | Clean verified product code tip `ecb3f4c` before this final record-only closeout. |
| `git rev-parse` / `git log` | Exact lane base `dfb4bc8a8a02e211e4fb212db847487c9970318a`. |
| `git worktree list --porcelain` | Three task worktrees were created at exact `dfb4bc8`, completed, archived, and later unregistered; protected RD6B and evidence worktrees remain unchanged. |
| Read-only code mapping | ML M7 and product-wired Mainline M7 are not already implemented; M5/M6 remain contracts/no-promotion groundwork. |
| First `wait_threads` snapshot | All three primary threads active; each independently confirmed exact `dfb4bc8` and the required fail-closed/privacy boundaries before implementation. |
| Independent remediation reviews | Public fixture manifest PASS; ML receipt/output authority PASS; private loopback/module-loading security PASS. |
| Serial local integration | ML, public, and private/validation sequences integrated; expected `package.json` overlap resolved by preserving all three focused gates; integrated lane tip `0202f5a`. |
| `npm run validate` | PASS, exit 0 at combined integrated tip; full Node chain includes ML M7 and both Mainline M7 gates. |
| Pages-base M7 browser/Axe | PASS after final closeout: Chromium desktop/mobile, EN/zh-CN, complete/single/degraded scenarios, serious/critical Axe 0, overflow 0, same-origin public dependencies only. |
| Python ML focused gates | PASS: uv lock, Ruff, Mypy, pytest 23 passed / 1 Windows live-symlink privilege skip; synthetic reparse rejection passed. |
| Pre-review `npm run ci:release` | PASS, exit 0 with Pages environment; audit, lint, core tests, release bundle, five browser lanes, 45-case visual matrix, and listener postcondition completed. |
| Release bundle policy | PASS without threshold change: total `4,322,377 / 4,323,000`; non-VRE `4,140,418 / 4,141,000`. |
| `npm run coverage:report` | PASS: 76/76; report-only aggregate line 56.47%, branch 71.33%, functions 59.95%. |
| Pre-cleanup bounded artifact review | PASS; canonical artifact digest independently matched `sha256:c3f052c82ed0a568a20e869de69ef8acca46a19e030ce05326c501b7d1d4ea36`; no material finding in that closeout diff. |
| Final integrated reviews | Initial REQUEST CHANGES: Node shadow output escaped its task root; Stage 3–7 contradicted local-complete; aborted native OSRM calls could overlap; expired loopback challenges never released session capacity. |
| Review remediation focused gates | PASS: `test:ml-m7` 3/3; `test:mainline-m7-private` 53/53 plus validation pack; Portfolio 2/2; targeted ESLint and `git diff --check`. |
| Correctness / security / performance rechecks | Three independent PASS verdicts; no remaining material finding. |
| Post-repair `npm run ci:release` | PASS, exit 0 at `ecb3f4c` with Pages environment; frozen bundle remains total `4,322,377 / 4,323,000`, non-VRE `4,140,418 / 4,141,000`; 35 visual cases passed and 10 project-scoped cases skipped by design. |
| M7 source cleanup | 20 ML files and 4 public logs copied with source-to-archive SHA-256 mismatch 0; three exact tips preserved under `refs/archive/m7-closeout-20260901/*`; source branches deleted and worktrees absent from Git topology. |

## Open risks and remaining work

- Full ML benchmark may remain `unavailable` without exact registry admission; that is not an implementation failure.
- Public graph/runtime admission, the 30-50 public OD benchmark, real local OSRM evidence, and 100-segment human QA were not performed; the product preserves explicit unavailable states rather than synthetic promotion claims.
- The frozen Pages-base budget passes but remains narrow: 582 bytes of non-VRE and 623 bytes of total raw headroom at the final release build.
- Windows retained three empty former task directories because the task hosts still hold directory handles; each has zero children, no `.git`, and is absent from `git worktree list`.
- Remote push, CI, Pages, release, ruleset, repository description/topics, and deployment were not requested by this local integration/cleanup step and remain unverified.
