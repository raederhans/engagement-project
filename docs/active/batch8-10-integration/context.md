# Batch 8–10 integration context

## Baseline and commits

- P0 baseline on main: `db41214`.
- P8 integrated as `0622644`.
- P9 integrated as `b714764`.
- P10 integrated as `ca28980`.
- `origin/main` was `9234450` when integration began.

Root-level untracked Playwright, log, and audit output predates this integration
and is not owned by this task.

## Central decisions

1. The P0 `registeredSourceHealthObservations` seam remains source-agnostic.
   Main owns an in-memory source-id upsert and refreshes Data Status only if its
   lazy controller has already loaded.
2. ACS registers its VRE observation after Review loads the admitted snapshot.
   HIN registers its lifecycle observation after a Known Route context request.
3. The current Evidence Bundle v2 content contract is Crime-only. The ACS and
   HIN aggregate contribution adapters remain explicit future inputs rather
   than being inserted into an incompatible schema.
4. The 4,000,000-byte dist ceiling continues to cover everything except the
   separately admitted ACS VRE source artifact. VRE has a 200,000-byte raw
   ceiling, while total dist has a transparent 4,200,000-byte ceiling.

## Combined local evidence

- Targeted combined contracts: 164/164.
- JavaScript and CSS lint: passed.
- Focused ACS browser: passed, including one post-Review VRE request, bilingual
  keyboard/focus behavior, and 390 px no-overflow checks.
- Shared browser smoke: passed with zero console and page errors.
- Visual experience: 35 passed and 10 intentional skips after reviewing and
  updating the two affected Windows Help/Data baselines.
- Coverage report: 53.06% lines, 73.34% branches, 56.40% functions.
- Entry: 123,027 raw / 39,231 gzip bytes.
- ACS loader/controller/styles: 896/516, 20,960/7,418, 2,913/881 bytes.
- HIN UI/lifecycle chunk: 17,045/6,879 bytes.
- Evidence product/v2/import/adapter/preview: 1,429/741, 22,751/6,223,
  6,875/2,932, 4,633/1,757, 5,278/1,846 bytes.
- Total dist: 4,168,260 bytes.
- VRE source artifact: 181,959 bytes.
- Non-VRE dist: 3,986,301 bytes.

Measurements are local Windows build evidence and must be rechecked by the
exact committed candidate and remote Linux gates.

## Remote closeout

- The first remote run, `31395793965`, passed Windows core and coverage but
  correctly rejected two stale Linux Help/Data screenshots. Its diagnostic
  artifact showed only the reviewed ACS entry insertion; thresholds and
  product code were not changed to mask the failure.
- The two Linux platform baselines were updated in `8d6c420` from that run's
  actual artifacts after visual inspection.
- Exact-revision run `31396682634` passed core, coverage, Linux release, and
  deploy. Deployment `5833634422` records the same `8d6c420` revision.
- P0/P8/P9/P10 source worktrees were clean and had no scoped live process when
  removed. Other historical worktrees and root untracked output were retained.
