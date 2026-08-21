import { TRACT_CRIME_BUNDLED_RECEIPT } from './tract_crime_bundled_receipt.generated.js';

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
  acsVre: Object.freeze({
    sourceId: 'acs-tract-population-vre',
    sourceAsOf: '2024-12-31',
    retrievedAt: '2026-08-10T10:30:15.161Z',
    builtAt: null,
    version: 'engagement-acs-tract-aggregation-v1:2024 ACS 5-year',
    identity: 'sha256:66233c0306c6f18cce0625199b37160647139ac26563e339f51ee66d641c7422',
    recordCount: 408,
    boundaryVintage: '2020 Census tract geography',
    geography: 'Complete census tracts in Philadelphia County, Pennsylvania (state 42, county 101)',
    temporalStart: '2020-01-01',
    temporalEnd: '2024-12-31',
  }),
  hin2025: Object.freeze({
    sourceId: 'hin-2025',
    sourceAsOf: '2025-12-10T17:29:32.369Z',
    retrievedAt: '2026-08-10T10:29:36.678Z',
    builtAt: null,
    version: 'phl-hin-2025-v1@2025',
    identity: 'sha256:b518f8b370c6375f5d3188ec2ec487ed834b7b7c25cb51f5f5e554285749e250',
    recordCount: 162,
    boundaryVintage: null,
    geography: 'Philadelphia High Injury Network historical planning geometry',
    temporalStart: '2019-01-01',
    temporalEnd: '2023-12-31',
  }),
  tractCrime: TRACT_CRIME_BUNDLED_RECEIPT,
});
