# Context

## Current truth

- The original handoff started from exact `67eddae4f023aea6a29808654d5012d51f6342ac`.
  The integration owner reviewed and integrated it as local main commit
  `025f8a6b6239df60163fedc3f8201249b66f01ee`; stage0 `3217a2a` and stage1
  `66964fc` remain separate and were not integrated.
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
- Integration review added four bounded repairs before admission: canonical
  tract JSON comparison, tool-owned stale-candidate cleanup, 45-second
  per-request source timeouts, and last-wins runtime Source Health deduplication.
- Combined local main validation, JS/CSS lint, reviewer re-review, and diff
  checks passed. These facts do not claim hosted workflow, Pages, or endpoint
  availability beyond the recorded one-time probe.

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
| None | Integration owner | System temp validation log | Combined validation completed; no dev server, browser, deployment, or shared process is running. |

## Handoff

The original source commit was
`f4a762643ed91619aae7887051980a3cfd2f9e20`; the reviewed local integration is
`025f8a6b6239df60163fedc3f8201249b66f01ee`. The integration owner owns the
remaining remote push, hosted CI observation, worktree cleanup, and any future
deployment claim.

## Next step

Push the reviewed local main, verify exact local/remote identity, observe hosted
CI without treating live endpoint availability as release truth, and remove only
the two completed B1/B2 delivery worktrees.
