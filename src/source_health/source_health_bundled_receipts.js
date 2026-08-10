/** Small, audited receipts keep the lazy source-health chunk independent of large data files. */
export const BUNDLED_SOURCE_RECEIPTS = Object.freeze({
  acsPopulation: Object.freeze({
    sourceId: 'acs-tract-population',
    sourceAsOf: '2024-12-31',
    retrievedAt: '2026-08-10T08:53:02.383Z',
    builtAt: null,
    version: '2024 ACS 5-year (2020–2024), table B01003',
    identity: 'sha256:c30e568037e55fd77b49396d039d98e03b2dc0d2bbe5c3f3035dcfe9c83db356',
    recordCount: 408,
  }),
  tractCrime: Object.freeze({
    sourceId: 'tract-crime-snapshot',
    sourceAsOf: '2026-07-30',
    retrievedAt: null,
    builtAt: '2026-07-31T03:30:49.163Z',
    version: 'tract crime snapshot schema v2',
    identity: 'coverage:2025-08-01:2026-08-01:408',
    recordCount: 408,
    temporalStart: '2025-08-01',
    temporalEnd: '2026-08-01',
  }),
});
