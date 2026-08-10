# Task

## Current status

Ready for integration — implementation, official snapshot verification, targeted regression tests, lint, and final scope review pass locally.

## Checklist

- [x] Verify exact base, clean worktree, ownership, forbidden files, and no live-process conflict.
- [x] Read delegated root rules, `docs/AGENTS.md`, `docs/KNOWN_ISSUES.md`, and central optimization planning read-only.
- [x] Inspect ACS config/API/snapshot/scripts, tract merge, buffer population, compare card, Analysis History, Evidence Bundle, and overlapping tests.
- [x] Verify official 2024 ACS 5-year, E/M, 90% MOE, Summary File, and Census Reporter response contracts.
- [x] Add and capture failing tests before implementation.
- [x] Implement canonical ACS population normalization and live/fallback adapters.
- [x] Generate and verify the official 2024 snapshot with manifest/hash evidence.
- [x] Propagate structured population to tract properties, comparison presentation, and saved artifacts.
- [x] Run targeted tests, relevant lint, snapshot reproducibility, and diff checks.
- [x] Complete diff/bug/first-principles review and create local Lore commits.
- [x] Mark ready-for-integration with exact handoff evidence.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` | `9f585b9e86fc3ee4f2378647cba2ef49a0308ccb` |
| `git status --short --branch` | Clean detached worktree |
| Official B01003 variable metadata probe | HTTP 200; E=Estimate, M=Margin of Error |
| Official API tract query without key | Returned Census `Missing Key` page; no credential available |
| Official Summary File range probe | HTTP 206; header `GEO_ID|B01003_E001|B01003_M001` |
| Census Reporter live tract probe | HTTP 200; release `acs2024_5yr`, years `2020-2024`, nested `estimate` and `error` |
| Committed snapshot source | `https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01003.dat`; retrieved `2026-08-10T08:53:02.383Z` |
| Initial target contracts before implementation | RED: 180 tests, 169 passed, 11 failed on the intended missing ACS/MOE/artifact behavior |
| `npm ci` | Exit 0; 395 packages installed; audit reported 0 vulnerabilities |
| `node --test` over data source, runtime, P2 comparison, Crime UI, product integrity, Analysis repository/history, and i18n contracts | Exit 0; 251 passed, 0 failed |
| `node scripts/fetch_acs_tracts.mjs --verify` | Exit 0; 408 official rows; rows SHA-256 `sha256:c30e568037e55fd77b49396d039d98e03b2dc0d2bbe5c3f3035dcfe9c83db356` |
| `node scripts/compute_acs_averages.mjs` | Exit 0; 408 available, 0 partial, 0 unavailable; population 0–10,596; MOE 10–2,108 |
| Targeted ESLint over every changed JS/MJS file | Exit 0 |
| `git diff --check` and cached diff check | Exit 0; only Git's informational LF-to-CRLF working-copy warnings appeared |
| Snapshot file SHA-256 | `85839F3FA5BEAEC03A6FAB7950A2781966808BBCB2941759660D8D6D95B870E3` |
| Forbidden-path intersection | None |
| Code Lore commit | `dc9a86fb407d924d9bc96350bf6d3702386f7aa9` |

## Remaining integration gates and boundaries

- Browser, visual, dev server, full `validate`, `ci:release`, push, deployment, integration, and release workflows were intentionally not run or changed.
- The Census data API query could not be executed directly because its current examples require an API key and no key was present. Its E/M shape is covered by official metadata plus adapter contract tests; the committed data itself came from the official keyless Summary File.
- The circular-buffer population remains a centroid-selected sum of whole-tract point estimates. It intentionally has no aggregate MOE, rate interval, or significance claim.
- A reported-incident rate still is not a complete statistical crime-rate confidence interval; the ACS MOE covers only sampling uncertainty in the population denominator.
