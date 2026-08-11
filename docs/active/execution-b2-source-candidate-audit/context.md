# Context

## Current truth

- The worktree is detached, clean, and starts at exact `main`/`origin/main`
  `67eddae4f023aea6a29808654d5012d51f6342ac`; stage0 `3217a2a` and stage1
  `66964fc` are separate worktrees and are not present here.
- ACS estimates and VRE use committed snapshots with manifests. Their semantic
  row identities exclude retrieval time, but their fetch scripts currently
  either write a destination or verify the committed destination directly.
- HIN has a committed same-origin snapshot/receipt pair. Normal acquisition is
  a no-write comparison; changed artifacts require
  `--accept-reviewed-change --reviewed-by` and are installed as one validated
  pair.
- Source Health catalogs ACS VRE and HIN, but default static observations include
  only ACS estimates and the tract-crime snapshot. Feature-owned VRE/HIN
  observations appear only after those features run.
- Existing runtime HIN loading is same-origin. No reviewed design sends Known
  Route geometry, GPS, Diary, or telemetry data to an upstream source.
- The implemented monthly/manual workflow runs the three source checks with
  `contents: read`, uploads temporary evidence, and exits non-zero for review or
  audit failure. It has no issue, PR, Git write, merge, release, or deployment
  path.
- Static Source Health now projects the committed ACS estimate, ACS VRE, and HIN
  receipts. A feature-owned runtime observation replaces the same source ID so
  receipt failure becomes `unavailable` instead of a duplicate or retained
  pseudo-current state.
- A live read-only audit observed all three admitted contracts unchanged at
  `2026-08-11T05:23:06.750Z`. Its two generated reports were removed after
  inspection; no candidate or committed artifact was written.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-11 | Use one candidate-only audit for the three admitted source artifacts. | Gives operators one reproducible report while leaving each source contract independent. |
| 2026-08-11 | Keep the workflow repository-read-only and upload temporary artifacts only. | No bot branch, issue, PR, merge, or admitted artifact write is possible. |
| 2026-08-11 | Treat unchanged as report-only; keep candidates only when review is required. | A scheduled no-change run is a semantic no-op. |
| 2026-08-11 | Add small committed receipt projections for VRE/HIN and allow feature runtime observations to replace bundled defaults by source ID. | Static Pages can show admitted artifact evidence without live upstream probes or duplicate-observation failure. |
| 2026-08-11 | Keep the ACS audit pinned rather than scraping an annual-release discovery page. | Current-release integrity is reproducible; proposing a new vintage remains a deliberate human-owned code/data review. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| None | B2 owner | N/A | No dev server, browser, deployment, or shared process is running. Short Node tests, production build, and live read-only source audit completed. |

## Handoff

The handoff commit contains only ACS/VRE/HIN acquisition exports, candidate
audit/workflow, receipt-backed Source Health, source/workflow tests, directly
related bundle action-policy counts, docs, package entry points, and this task
record. Obtain its exact local identity with `git rev-parse HEAD` after checkout.
The upstream supervisor owns review/integration, push, main updates, hosted CI
observation, and any deployment.

## Next step

Integration owner: review the local handoff commit, preserve the candidate-only
and human-admission boundaries, then run hosted workflow/CI observation before
any main integration or release claim.
