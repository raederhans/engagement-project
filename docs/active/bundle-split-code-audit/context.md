# Context

## Starting state

- Repository: `raederhans/engagement-project`.
- Branch: `agent/split-and-audit`, created from clean `main` at `71a2d5232fd064b0f189bb55629ec8d2f2c79baa`.
- Current build warning: the largest minified JavaScript chunk is about 1.1 MB; `src/utils/http.js` and `src/map/points.js` are both statically and dynamically imported, so their dynamic imports do not form boundaries.
- The app is a Vite static deployment with Crime and Diary modes selected through `?mode=`.
- No new backend or dependency is authorized.

## Review lanes

- `full_code_review`: read-only correctness, security, quality, performance, and test review.
- `architecture_review`: read-only boundary, coupling, code-splitting, and static-hosting challenge review.
- Root agent owns all edits, tests, Git operations, integration, and deployment.

## Working target

Reduce JavaScript executed or fetched for the initial Crime route by separating optional mode/features at existing ownership boundaries, while preserving direct Diary loading and in-page mode switching.

## Live-process ownership

- Owner: root agent only.
- Baseline browser session: `playwright-cli -s=engagement-bundle-baseline`, targeting the current production Pages URLs.
- Post-change local session: one Vite preview on `127.0.0.1:4173` plus one serial Playwright session; no agent may start or poll another server/browser.
- Shared resources: browser session names, port 4173, `dist/`, and Playwright artifacts.
- Evidence: performance resource entries, network request list, console errors/warnings, Crime interaction, and Diary rating flow.
- Success: both modes function with zero unexpected browser errors and the intended lazy chunks are absent before their feature is activated.
- Stop: close browser and preview immediately after evidence capture; remove only task-owned Playwright artifacts.

## Next step

Capture a machine-readable bundle baseline and inspect the main entry plus dynamic/static import overlaps before defining the first failing regression test.
