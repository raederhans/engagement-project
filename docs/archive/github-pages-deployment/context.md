# Context

## Final truth

- Repository: `raederhans/engagement-project`.
- Final verified `main`: `d4d0e9d146e279a7c81ba0c71af173d64cb7f08b`.
- Production URL: `https://raederhans.github.io/engagement-project/`.
- Diary URL: `https://raederhans.github.io/engagement-project/?mode=diary`.
- Final CI run: `30513404951`, successful.
- Final Pages run: `30513404940`, successful.
- Integrated pull requests: #7, #12, #13, #14, and #15.

## Decisions and evidence

| Decision | Evidence and impact |
| --- | --- |
| Build Pages from source instead of committing `dist/`. | Keeps generated output behind the repository validation gate. |
| Derive Vite's base from `GITHUB_REPOSITORY`. | Required assets resolve below `/engagement-project/` while local development remains root-based. |
| Use explicit capability flags for optional tract and road-network artifacts. | Pages no longer uses expected 404 responses as feature detection or invents placeholder data. |
| Resume deferred Diary startup on MapLibre `idle`. | Unlike the one-shot `load` event, `idle` can occur after the initial rendering and matches the observed Pages timing. |
| Reuse `fetchPoints` for viewport incidents. | All CARTO browser queries now use the shared POST, cache, timeout, deduplication, and retry contract. |
| Probe the live browser, not only HTTP 200. | Found and repaired initialization ordering, map-style, optional-data, and transport defects that static probes could not detect. |

## Live-process closeout

- All temporary Vite servers and Playwright sessions were stopped.
- Generated Playwright and Actions-monitor artifacts were removed from the working tree.
- No live process ownership remains.

## Handoff

The deployment task is complete. The improvement backlog in `task.md` is the recommended next planning input.
