# Task

## Current status

Complete and integrated: the Crime data foundation, residential-stability view, Help contract reconciliation, localization follow-up, full validation, and PR merge are green.

## Checklist

- [x] Capture official offense/UCR combinations and classify every observed label.
- [x] Add failing taxonomy contracts.
- [x] Add failing metadata and Philadelphia coverage-date contracts.
- [x] Add failing residential-stability model contracts.
- [x] Implement taxonomy and metadata foundation.
- [x] Implement selected time metrics and residential-stability subsection.
- [x] Run targeted validation.
- [x] Run build/bundle and safe browser verification.
- [x] Perform final code review and first-principles simplification review.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Worktree/branch/status inspection | Single worktree on `main`; unrelated dirty WIP identified and protected. |
| Port 5173 ownership inspection | Existing listener PID 38872; treated as externally owned until live-test phase. |
| `node --test scripts/tests/crime_safety_foundation_contracts.mjs` (RED) | 7 expected failures before implementation. |
| Focused Crime/UI/data contracts | 75/75 passed after implementation. |
| Final `npm test` | All data, Diary, runtime, Crime, chart, product-integrity, repository, i18n, and UI-P0 suites passed; P1 finished 13/14 with only the unrelated Help dialog expectation failing. |
| Final focused Crime/chart/async contracts | 37/37 passed, including the regression that fills API-omitted zero-count months inside the selected time window. |
| `npm run build:manifest && npm run verify:bundle` | PASS. Entry 902428/243320; Crime 37543/13037; Incident Results 6980/2769; Charts 230704/78635; all lazy-boundary budgets passed. |
| Browser smoke on the existing `127.0.0.1:5173` listener | Selected a real map point; live summary and incidents loaded. Six themes rendered in Chinese; `房产与财产` exposed 7 official leaf offenses; residential direction/variation/evidence rendered; the three-month-average chart mode became pressed. |
| First-principles review | One product surface retained; no walking module, external housing data, prediction, or opaque score added. Current partial month is excluded from stability comparisons. |
| Final integration validation | `npm run validate` passed; PR #62 CI run `30983733787` passed on Windows and Ubuntu, including Chromium smoke and 36 visual tests; merged as `5184c901` |

## Open risks and remaining work

- Crime leaf labels retain their official values internally while the drill-down, summaries, legends, district popup, incident list, and selected detail render only the active language.
- The Help P1 contract now matches the centered `role=dialog` design and passed the final P1 and visual suites.
- The external housing/building composite index is deferred until its component data and weighting policy are approved by evidence.
