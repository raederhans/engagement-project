# Known Issues and Product Limits

## Data availability

- Crime and boundary sources are external and can be unavailable, rate-limited,
  delayed, or outside the selected period. The UI must preserve `unavailable`
  or failure states; it must not convert them to a count of zero.
- Reported records are historical source rows. They are not guaranteed to be
  unique incidents, real-time conditions, complete observations, causal
  evidence, or predictions of future risk.
- Crime locations are generalized to roughly the hundred block and are not
  precise addresses.

## Diary and route scope

- Diary community content is sample data. Private route records and drafts are
  browser-local IndexedDB data; there are no production accounts or cloud sync.
- Known-route corridor analysis accepts a supplied route. It is not raw-GPS
  collection or map matching, and it does not recommend a "safer" route.
- Raw GPS, telemetry, long-term user profiles, and account synchronization are
  not implemented and require separate privacy/product review.

## Runtime and browser scope

- The current map runtime remains on MapLibre 4. A MapLibre 6 production upgrade
  is not part of current work because it changes runtime and bundle constraints.
- Browser smoke and visual regression cover supported Chromium scenarios. Node
  coverage is report-only and does not represent complete DOM, map, browser,
  accessibility, or visual coverage.

## Reporting a new issue

Record a reproducible symptom, exact command or URL, data/source status, and
expected versus observed behavior. Do not add resolved historical incidents to
this file; preserve them in the relevant archived task record or Git history.
