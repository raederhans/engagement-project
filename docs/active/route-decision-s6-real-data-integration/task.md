# Route-decision S6 real-data integration task

## Current status

`crash recovery complete / RD-A and RD-B are active on independently requested
rework / RD-C, RD-D, and RD-E are active writers / RD-Q is the active read-only
cross-lane gate / no writer freeze is accepted or integrated`

## Checklist

- [x] Verify local `main` and `origin/main` equal exact `f300cfe` and tracked/
  index state is clean while preserving unrelated untracked artifacts.
- [x] Reconcile the completed synthetic S6 records with current code.
- [x] Research official OSMF, ODbL, Geofabrik, API, Overpass, and tile-policy
  evidence and freeze a bounded candidate architecture.
- [x] Confirm no admitted PBF parser or `osmium` binary is available and forbid
  hidden/transitive extraction tooling in the first wave.
- [x] Define five disjoint lanes, exact ownership, dependency order, acceptance
  criteria, and closed product/public claims.
- [x] Commit coordination baseline `20b2be1` on
  `codex/route-decision-s6-real-data`.
- [x] Queue RD-A/B/C/D implementation conversations and RD-R read-only review
  conversation from exact baseline `20b2be1`; five detached worktrees exist at
  that SHA.
- [x] Resolve current RD-A, RD-B, and RD-R identities: RD-A is thread
  `019ffebb-64d2-7143-a2e6-b88a62a58abb` in `4342`; RD-B is thread
  `019ffebb-73db-7f52-a02d-494e0013b1fe` in `502c`; RD-R is thread
  `019ffebb-8cd1-7cd0-b0e2-6df106d3b9f9` in `53d1`.
- [x] Re-preflight A/B writer candidates: RD-A has exactly seven untracked
  owned files and passes `11/11`; RD-B has exactly six untracked owned files
  and passes `19/19`; both remain detached at `20b2be1` with clean tracked
  diff/index and no source-final commit.
- [x] Confirm the remaining old exact-base worktrees `3e2f` and `c219` are clean
  and unassigned; they are not evidence of RD-C or RD-D implementation.
- [x] Receive user authorization to complete three priorities: close the A/B/C/D
  contract wave, freeze and execute one full-PBF/tool/boundary build, and admit
  one exact real graph while keeping runtime/performance/publication closed.
- [x] Commit supervised continuation baseline `45ca4c7` and dispatch exact-base
  conversations for A/B review, RD-C, RD-D, RD-E build ownership, and RD-Q.
- [x] Receive independent A/B exact-freeze review: both old freezes are
  `REQUEST CHANGES`; RD-A has one P1 bounded-ingress blocker, while RD-B has
  three P1 blockers in hostile ingress, clipping, and result identity.
- [x] Recover all stopped tasks after the App crash without discarding partial
  bytes: A=`4342`, B=`502c`, C=`00d0`, E=`1461`, Q=`fedf`; recreate RD-D as
  thread `019fff4d-a816-7120-a9e2-d85841dbdb6d` in `6844`. Preserve clean
  orphan `b5f8` as unassigned crash evidence.
- [ ] Receive exact writer freezes and independent review verdicts.
- [ ] Integrate only accepted units serially and run central validation.
- [ ] Freeze and review the exact extractor/tool and Philadelphia
  boundary/buffer/cross-state policy.
- [ ] Assign RD-E as the sole live-process owner, acquire the dated PBF into the
  private output directory, extract and normalize one exact real graph, and
  preserve terminal logs/evidence without committing payload bytes.
- [ ] Admit the exact graph through RD-C, compile the separate RD-D compact
  artifact, and complete central compatibility validation.
- [ ] Merge/push the accepted contract/build-control implementation while
  leaving runtime, formal performance, pilot, and public release for separate
  authorization.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` / `git rev-parse origin/main` before branch creation | Both `f300cfe2658375add6542b86c20267c63c56ec4a`. |
| `git status --short` | Only protected pre-existing untracked logs/output; tracked tree and index clean. |
| `git worktree list --porcelain` | Existing S4-S6 audit worktrees identified and preserved. |
| Repo-local S5/S6 contract inspection | Existing compact compiler/runtime is synthetic-only; S5-D actual authority is unreachable; Source Health has no graph mutation seam. |
| Official Geofabrik/OSMF/ODbL research | Dated Pennsylvania PBF is the bounded source candidate; public graph requires attribution/licence/rebuild availability; public APIs/tiles are not bulk/runtime backends. |
| Tooling preflight | `osmium` and `ogr2ogr` missing; no direct OSM PBF parser dependency declared. |
| Coordination commit | `20b2be152e4186eede9b28988b256b1c58306f53`; four docs-only paths, staged diff check passed. |
| Original queued worktree preflight | All five worktrees remain detached at exact `20b2be1`; A=`4342`, B=`502c`, R=`53d1`; `3e2f` and `c219` remain clean and unassigned rather than inferred as C/D. |
| Fresh RD-A candidate verification | Exact `4342@20b2be1`; seven untracked owned files; tracked/index clean; focused `11/11` passed. No commit or independent verdict. |
| Fresh RD-B candidate verification | Exact `502c@20b2be1`; six untracked owned files; tracked/index clean; focused `19/19` passed. No commit or independent verdict. |
| RD-R current verdict | Baseline rubric only; A/B exact bytes have not received per-lane review and C/D have no bytes to review. |
| Supervised continuation commit | `45ca4c7d3e409c3c05455bf7237fa78443f25c98`; opens contract/build-control work only and keeps live PBF/runtime/performance/publication closed. |
| Independent A/B exact review | Thread `019fff28-692c-7ed0-8654-b4d4b808e8e7`; focused tests passed but hostile probes blocked both old freezes, so neither is source-final. |
| Crash recovery snapshot | All six current tasks are active; A/B continue in place, C/E preserve partial owned files, D is recreated at exact `45ca4c7`, and Q remains read-only. |

## Open risks and remaining work

- No full source payload has been acquired or hashed by this task.
- Philadelphia boundary/buffer/cross-New-Jersey policy is not frozen.
- No extraction tool has been selected or admitted.
- No owner-controlled real authority registry entry exists.
- No actual real `GraphArtifact`, compact graph, Source Health observation,
  browser runtime, performance result, or published artifact exists.
- A/B old freezes are explicitly rejected and superseded; new passing writer
  tests will still require a new stable freeze and independent review.
- Full-PBF download/extraction has no active owner until RD-E tool and boundary
  evidence is accepted and the supervisor explicitly releases the live gate.
