# Task

## Current status

Product implementation committed as `25b509a` on `codex/comparison-detail-menu`; validation and independent review are complete.

## Checklist

- [x] Audit worktrees, branch ownership, current comparison data, and live port ownership.
- [x] Define the minimal information architecture and no-refetch boundary.
- [x] Add and observe failing regression tests.
- [x] Implement rendering, localization, interaction state, and responsive styling.
- [x] Run targeted and full validation.
- [x] Run browser smoke and bilingual desktop/mobile QA.
- [x] Complete architecture and code review.
- [ ] Push and open PR.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Worktree and branch audit | PR #48 branch clean and pushed; primary `.gitignore` and P1-5-8 WIP remain separate. |
| Existing comparison contract audit | Existing A/B result already contains total, optional per-10k, top three categories, and recent 30-day delta; no new query is required. |
| Focused red tests | Three comparison-detail tests failed for the missing disclosure, truthful missing metrics, and disclosure-state binding. |
| Focused green tests | Crime UI, i18n, and product-integrity suites passed 73/73. |
| Null-metric regression | A tightened assertion failed because `null` rates rendered as `0.0`; the formatter now preserves them as unavailable and the focused suite is green. |
| Local browser QA | Desktop and mobile disclosure passed; expansion survived language rerender; no page/table horizontal overflow; 0 browser warnings/errors. |
| Final focused contracts | `node --test scripts/tests/crime_ui_contracts.mjs scripts/tests/i18n_contracts.mjs` passed 25/25 after view-local state, touch-target, and reduced-motion fixes. |
| Flagged full validation | `VITE_FEATURE_DIARY=1 VITE_TRACT_CRIME_SNAPSHOT=1 npm run validate` passed, including bundle policy. |
| Bundle policy | PASS — Entry 875643/234971; Crime 33663/11794; dist 3974949 bytes. |
| Automated browser smoke | PASS — 0 console errors and 0 page errors. |
| Dependency audit | `npm audit --audit-level=high` found 0 vulnerabilities. |
| Independent review | Architecture CLEAR and code review CLEAR after all requested fixes. |

## Open risks and remaining work

- Existing `Analysis History` raw bundle is 22 bytes below its current 23,000-byte policy ceiling; this feature does not modify that chunk or its budget.
- Remote CI remains pending until the branch and PR are published.
