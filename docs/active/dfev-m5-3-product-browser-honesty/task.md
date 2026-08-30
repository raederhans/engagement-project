# DFEV M5-3 task

Status: verified and ready for isolated commit

Acceptance decision: use a zero-product-code browser/runtime gate. The existing UI is a user-provided Known Route historical review surface, not an arbitrary route-candidate generator. The public M5 wrapper remains unavailable and cannot be promoted by test-side declarations.

Required fresh evidence:

- `npm run test:dfev-m5-3`
- `npm run build:manifest`
- `npm run verify:bundle`
- `npm run test:known-route-evidence`
- `npm run test:known-route-evidence-browser`

Admission is blocked if the browser exposes candidate generation/ranking, contacts OSRM or candidate endpoints, leaks private values to URL/network/log/share/persistence, emits serious/critical scoped ARIA violations, logs console/page errors, exceeds the existing bundle ceiling, or reports a product capability outside `unavailable` / `local-batch-only`.

Fresh result:

- Admission verdict: `NO_PRODUCT_PROMOTION`; observed product capability state: `unavailable`.
- Chromium matrix: desktop 1440 x 900 and mobile 390 x 844; English and Simplified Chinese; Escape restores focus; scoped Axe serious/critical violations: 0.
- Private address, Diary-note sentinel, and coordinate sentinels: 0 private action requests; 0 candidate/OSRM requests; 0 URL, console, clipboard, history, Web Storage, or IndexedDB side effects from the M5 surface.
- Browser errors: 0 console errors and 0 page errors in both viewports.
- Bundle: 3,999,824 / 4,000,000 bytes excluding the separately admitted ACS VRE artifact; 176 bytes headroom; ceiling unchanged.
- M5 contract: 12/12 passed. M4 Known Route contract: 16/16 passed. M4 Known Route browser: passed.

M5-4 independent-review repair:

- P2 repaired: the gate checks complete console, request, observed-URL, current-URL, and privacy-probe observations for every private sentinel. Leak errors report only category and sentinel index.
- The executable hostile self-test reproduces the old late-slice false negative, proves the complete gate rejects all four sentinel categories, and proves failure messages do not echo the private value.
- P3 repaired: desktop and mobile each run scoped Axe and overflow/layout checks independently while English is active and again while Simplified Chinese is active.
- Fresh repair verification preserves `NO_PRODUCT_PROMOTION`, observed product capability `unavailable`, 0 private action requests, 0 candidate/OSRM requests, 0 console/page errors, and the unchanged 3,999,824 / 4,000,000-byte bundle result.
