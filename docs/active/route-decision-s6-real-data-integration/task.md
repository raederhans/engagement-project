# Route-decision S6 real-data integration task

## Current status

`research complete / coordination baseline being committed / RD-A/B/C/D and
RD-R not yet created`

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
- [ ] Commit the coordination baseline on
  `codex/route-decision-s6-real-data`.
- [ ] Create RD-A/B/C/D implementation conversations and RD-R read-only review
  conversation from that exact baseline.
- [ ] Record thread/worktree identities and exact preflight SHAs.
- [ ] Receive exact writer freezes and independent review verdicts.
- [ ] Integrate only accepted units serially and run central validation.
- [ ] Decide the separately gated full-PBF/tooling/product/publication wave.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` / `git rev-parse origin/main` before branch creation | Both `f300cfe2658375add6542b86c20267c63c56ec4a`. |
| `git status --short` | Only protected pre-existing untracked logs/output; tracked tree and index clean. |
| `git worktree list --porcelain` | Existing S4-S6 audit worktrees identified and preserved. |
| Repo-local S5/S6 contract inspection | Existing compact compiler/runtime is synthetic-only; S5-D actual authority is unreachable; Source Health has no graph mutation seam. |
| Official Geofabrik/OSMF/ODbL research | Dated Pennsylvania PBF is the bounded source candidate; public graph requires attribution/licence/rebuild availability; public APIs/tiles are not bulk/runtime backends. |
| Tooling preflight | `osmium` and `ogr2ogr` missing; no direct OSM PBF parser dependency declared. |

## Open risks and remaining work

- No full source payload has been acquired or hashed by this task.
- Philadelphia boundary/buffer/cross-New-Jersey policy is not frozen.
- No extraction tool has been selected or admitted.
- No owner-controlled real authority registry entry exists.
- No actual real `GraphArtifact`, compact graph, Source Health observation,
  browser runtime, performance result, or published artifact exists.
