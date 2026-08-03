# Task

## Current status

Delivered for review in PR #48 on `codex/tract-outline-controls` from `origin/main@784b812`; product commit `abe325b` is pushed.

## Checklist

- [x] Protect unrelated worktrees and stop the previous owned preview.
- [x] Add and observe failing regression tests.
- [x] Implement state and URL behavior.
- [x] Implement map paint updates and UI controls.
- [x] Add bilingual copy and accessibility behavior.
- [x] Run targeted validation.
- [x] Run full validation and browser QA.
- [x] Review, commit, push, and open PR.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Worktree and port ownership audit | Clean implementation worktree; unrelated `.gitignore` and P1-5-8 WIP preserved; Vite PID 30524 stopped before branch switch. |
| `node --test` on product, Crime UI/async, shell, and i18n contracts | 99 passed, 0 failed after observing 5 expected pre-implementation failures. |
| `git diff --check` | Passed; only repository line-ending notices were emitted. |
| First full `npm run validate` | Tests and build passed; bundle policy failed because Analysis History was 23,020 bytes against a 23,000-byte raw limit. Removed unnecessary exported range constants without changing behavior before retry. |
| Schema source consolidation | Replaced the duplicated analysis-artifact key list with keys from canonical decoded view state; Analysis History fell to 22,699 raw bytes. |
| Review-fix regression tests | 77 passed, 0 failed across analysis repository, Crime UI, and product-integrity contracts. |
| Final flagged `npm run validate` | Passed data checks, all test suites, production manifest build, and bundle policy after both review fixes. |
| `npm run verify:bundle` | Passed; Analysis History 22,823/7,422 bytes and total dist 3,971,045 bytes. |
| `npm audit --audit-level=high` | 0 vulnerabilities. |
| `npm run test:browser-smoke` | Passed; 0 console errors and 0 page errors. |
| Desktop/mobile local QA on port 5173 | Width/opacity change immediately, disabling follows visibility, URL restores `2.5px / 40%`, English/Chinese labels render, no horizontal overflow, 0 browser warnings/errors. |
| Local preview | `http://127.0.0.1:5173/`, owned PID 64620, ready with HTTP 200. |
| Independent review | Code review APPROVE; architecture review CLEAR after verifying legacy schema-v1 compatibility and Tract cold-start outline creation. |
| Delivery | Product commit `abe325b`; PR #48: `https://github.com/raederhans/engagement-project/pull/48`. |

## Open risks and remaining work

- Vite still emits the repository's existing warning for the large entry chunk; bundle policy remains within all enforced raw/gzip limits.
- PR CI and human review remain external gates; this task does not merge or deploy the branch.
