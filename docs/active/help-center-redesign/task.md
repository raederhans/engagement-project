# Task

## Current status

Complete: implementation, targeted tests, production build, bundle policy, and live-browser verification are green.

## Checklist

- [x] Map current Help DOM, focus behavior, mode switching, and responsive CSS.
- [x] Verify every planned data-source and calculation statement against code.
- [x] Add and run failing tests for new structure and required content.
- [x] Implement Help Center markup, behavior, i18n copy, and styles.
- [x] Run targeted unit/contract tests.
- [x] Run build and browser accessibility/visual checks.
- [x] Perform final review and update records.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Port ownership and `GET /?mode=diary` | Existing preview listening on `127.0.0.1:5173`; HTTP 200 |
| `node --test scripts/tests/mode_ui_contracts.mjs` before implementation | Expected RED: 3 new Help Center tests failed because the old structure/interaction was missing |
| `node --test scripts/tests/mode_ui_contracts.mjs` after implementation | PASS: 17/17 |
| Centering portal regression | Expected RED before moving the modal/backdrop to `document.body`; PASS: 17/17 after the portal fix |
| `npm run test:ui-p0` | PASS: 68/68 |
| `npm run test:i18n` | PASS: 9/9 |
| `npm run build:manifest` | PASS: production build completed; Help Center emitted as a separate 21.82 kB chunk (9.05 kB gzip) |
| `npm run verify:bundle` | PASS: entry and all lazy-chunk budgets passed |
| Playwright CLI at 932×1039 and 390×844 | PASS: modal stayed inside the viewport and centered; close button received focus, Tab entered navigation, Escape closed and restored trigger focus |
| Chinese/English live rendering | PASS: all four sections and detailed source/method copy rendered in both locales |
| Browser console | PASS: 0 errors, 0 warnings during Help interaction checks |

## Open risks and remaining work

- No blocking risk remains within the requested Help redesign scope.
- This task does not change data queries or calculations; Help accuracy remains coupled to future changes in those modules and should be updated when their contracts change.
