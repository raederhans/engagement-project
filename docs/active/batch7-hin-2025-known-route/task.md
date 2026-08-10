# Task

## Current status

Ready for integration: foundation implemented and isolated short gates passed; the exact commit is recorded in Git after staging this task record.

## Checklist

- [x] Task 1: verify exact SHA, ownership, repository guidance, and existing Known Route contracts.
- [x] Task 2: recheck ArcGIS item/layer/count/schema/geometry/timestamps and run the artifact-size spike.
- [x] Task 3: implement deterministic snapshot acquisition, normalization, validation, and rendering.
- [x] Task 4: implement pure mixed-geometry association and local-snapshot request seam.
- [x] Task 5: add no-map-compatible text UI, limitations, and official handoff.
- [x] Task 6: run short tests/build/bundle checks, inspect status/diff, and commit.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` | Exact required baseline `19d27cfb808913d4fa5e120cb28204eb3405836e`. |
| Official ArcGIS item/layer/count queries | 162 features; exact four-field schema; no GlobalID; mixed line geometry; timestamp separation verified. |
| `npm run data:check:hin-2025` | PASS: 162 features, 270,811 bytes. |
| `npm run test:hin-2025` | PASS: 13/13 pipeline, mixed geometry, tolerance, privacy, zero/unavailable, and text semantics tests. |
| `npm run test:route-corridor` | PASS: 12/12 existing pure Known Route contract tests. |
| `npm run test:route-corridor-data` | PASS: 20/20 request-owner, coverage, and shared map/list boundary tests. |
| `npm run test:route-corridor-ui` | PASS: 12/12 lazy, keyboard, no-map, state, and UI contract tests. |
| `npm run test:runtime-contracts` | PASS: 16/16 runtime contract tests. |
| `npm run test:ui-p0` | PASS: 111/111 shared shell, list-mode, keyboard, and presentation contract tests. |
| `npm run test:crime-async` | PASS: 32/32 Crime ownership and async-state contract tests. |
| Targeted ESLint and Stylelint plus `git diff --check` | PASS. |
| `npm run build:manifest && npm run verify:bundle` | PASS: snapshot 270,811/280,000 bytes; route UI 23,621/24,000 raw and 8,131/8,300 gzip; HIN UI 10,779/20,000 and 4,745/6,500; total dist 3,880,620/4,000,000 bytes. |

## Open risks and remaining work

- The local 20 m planar approximation and six-decimal snapshot are historical context, not engineering boundary proof.
- Browser, visual, full-suite/full-release, push, deploy, and integration gates were not run and remain explicitly owned by the integration supervisor.
- No dev server, live browser, shared database/cache, remote action, or worktree topology change occurred.
