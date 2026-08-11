import { CARTO_SQL_BASE } from '../config.js';
import { BUNDLED_SOURCE_RECEIPTS } from './source_health_bundled_receipts.js';
import { admitSourceHealthObservation } from './source_health_read_model.js';

function emptyObservation(sourceId, status, statusReason, observedAt = null) {
  return {
    sourceId,
    status,
    statusReason,
    clocks: { sourceAsOf: null, retrievedAt: null, builtAt: null, observedAt },
    snapshot: { version: null, identity: null },
    boundaryVintage: null,
    coverage: { geography: null, temporalStart: null, temporalEnd: null },
    transport: { endpointUrl: null, lastModified: null, etag: null },
    recordCount: null,
  };
}

function exactNow(now) {
  const parsed = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(parsed.getTime())) throw new TypeError('source health now must be a valid date');
  return parsed;
}

function dateAgeDays(value, now) {
  const source = new Date(`${value}T00:00:00.000Z`);
  return Math.floor((now.getTime() - source.getTime()) / 86_400_000);
}

/** Runtime Crime coverage is semantic evidence; an HTTP header is never used as sourceAsOf. */
export function adaptCrimeCoverageObservation(runtime = {}, {
  now = new Date(),
  staleAfterDays = 7,
} = {}) {
  const observed = exactNow(now);
  const observedAt = observed.toISOString();
  if (runtime.status === 'error') {
    return admitSourceHealthObservation({
      ...emptyObservation('philadelphia-reported-crime', 'unavailable', 'coverage-probe-failed', observedAt),
      transport: { endpointUrl: CARTO_SQL_BASE, lastModified: null, etag: null },
    });
  }
  if (runtime.status !== 'ready') {
    return admitSourceHealthObservation({
      ...emptyObservation('philadelphia-reported-crime', 'unknown', 'coverage-not-admitted', observedAt),
      transport: { endpointUrl: CARTO_SQL_BASE, lastModified: null, etag: null },
    });
  }
  const min = typeof runtime.min === 'string' ? runtime.min : null;
  const max = typeof runtime.max === 'string' ? runtime.max : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(min || '') || !/^\d{4}-\d{2}-\d{2}$/.test(max || '') || min > max) {
    return admitSourceHealthObservation({
      ...emptyObservation('philadelphia-reported-crime', 'unavailable', 'coverage-schema-drift', observedAt),
      transport: { endpointUrl: CARTO_SQL_BASE, lastModified: null, etag: null },
    });
  }
  const stale = dateAgeDays(max, observed) > staleAfterDays;
  return admitSourceHealthObservation({
    ...emptyObservation(
      'philadelphia-reported-crime',
      stale ? 'stale' : 'current',
      stale ? 'coverage-older-than-policy' : 'coverage-within-policy',
      observedAt,
    ),
    clocks: { sourceAsOf: max, retrievedAt: null, builtAt: null, observedAt },
    coverage: { geography: 'Philadelphia', temporalStart: min, temporalEnd: max },
    transport: { endpointUrl: CARTO_SQL_BASE, lastModified: null, etag: null },
  });
}

/**
 * A successful transport observation proves only that an endpoint answered at
 * observedAt. Last-Modified and ETag remain transport evidence.
 */
export function adaptTransportObservation({
  sourceId,
  endpointUrl,
  observedAt,
  lastModified = null,
  etag = null,
} = {}) {
  return admitSourceHealthObservation({
    ...emptyObservation(sourceId, 'unknown', 'transport-only', observedAt),
    transport: { endpointUrl, lastModified, etag },
  });
}

export function bundledArtifactObservations({ now = new Date() } = {}) {
  const observed = exactNow(now);
  const observedAt = observed.toISOString();
  const acs = BUNDLED_SOURCE_RECEIPTS.acsPopulation;
  const acsVre = BUNDLED_SOURCE_RECEIPTS.acsVre;
  const hin = BUNDLED_SOURCE_RECEIPTS.hin2025;
  const tract = BUNDLED_SOURCE_RECEIPTS.tractCrime;
  const tractStale = dateAgeDays(tract.sourceAsOf, observed) > 7;
  return Object.freeze([
    admitSourceHealthObservation({
      ...emptyObservation(acs.sourceId, 'partial', 'bundled-fallback', observedAt),
      clocks: {
        sourceAsOf: acs.sourceAsOf,
        retrievedAt: acs.retrievedAt,
        builtAt: acs.builtAt,
        observedAt,
      },
      snapshot: { version: acs.version, identity: acs.identity },
      boundaryVintage: '2020 census tract geography',
      coverage: {
        geography: '408 census tracts in Philadelphia County, Pennsylvania',
        temporalStart: '2020-01-01',
        temporalEnd: '2024-12-31',
      },
      recordCount: acs.recordCount,
    }),
    admitSourceHealthObservation({
      ...emptyObservation(acsVre.sourceId, 'partial', 'bundled-vre-snapshot', observedAt),
      clocks: {
        sourceAsOf: acsVre.sourceAsOf,
        retrievedAt: acsVre.retrievedAt,
        builtAt: acsVre.builtAt,
        observedAt,
      },
      snapshot: { version: acsVre.version, identity: acsVre.identity },
      boundaryVintage: acsVre.boundaryVintage,
      coverage: {
        geography: acsVre.geography,
        temporalStart: acsVre.temporalStart,
        temporalEnd: acsVre.temporalEnd,
      },
      recordCount: acsVre.recordCount,
    }),
    admitSourceHealthObservation({
      ...emptyObservation(hin.sourceId, 'partial', 'bundled-historical-planning-snapshot', observedAt),
      clocks: {
        sourceAsOf: hin.sourceAsOf,
        retrievedAt: hin.retrievedAt,
        builtAt: hin.builtAt,
        observedAt,
      },
      snapshot: { version: hin.version, identity: hin.identity },
      boundaryVintage: hin.boundaryVintage,
      coverage: {
        geography: hin.geography,
        temporalStart: hin.temporalStart,
        temporalEnd: hin.temporalEnd,
      },
      recordCount: hin.recordCount,
    }),
    admitSourceHealthObservation({
      ...emptyObservation(
        tract.sourceId,
        tractStale ? 'stale' : 'current',
        tractStale ? 'snapshot-older-than-policy' : 'snapshot-within-policy',
        observedAt,
      ),
      clocks: {
        sourceAsOf: tract.sourceAsOf,
        retrievedAt: tract.retrievedAt,
        builtAt: tract.builtAt,
        observedAt,
      },
      snapshot: { version: tract.version, identity: tract.identity },
      coverage: {
        geography: '408 Philadelphia census tracts',
        temporalStart: tract.temporalStart,
        temporalEnd: tract.temporalEnd,
      },
      recordCount: tract.recordCount,
    }),
  ]);
}

export function createSourceHealthObservations(runtimeEvidence = {}, options = {}) {
  // Feature modules adapt their own evidence, then register the admitted
  // observation here without adding source-specific imports to this assembler.
  const registered = runtimeEvidence.registeredSourceHealthObservations ?? [];
  if (!Array.isArray(registered)) {
    throw new TypeError('registered source health observations must be an array');
  }
  const observations = [
    adaptCrimeCoverageObservation(runtimeEvidence.crimeCoverage, options),
    ...bundledArtifactObservations(options),
  ];
  const registeredBySourceId = new Map();
  const observationsWithoutSourceId = [];
  for (const observation of registered) {
    const sourceId = typeof observation?.sourceId === 'string' ? observation.sourceId : null;
    if (sourceId) registeredBySourceId.set(sourceId, observation);
    else observationsWithoutSourceId.push(observation);
  }
  for (const [sourceId, observation] of registeredBySourceId) {
    const bundledIndex = observations.findIndex((item) => item.sourceId === sourceId);
    if (bundledIndex >= 0) observations.splice(bundledIndex, 1, observation);
    else observations.push(observation);
  }
  observations.push(...observationsWithoutSourceId);
  return Object.freeze(observations);
}
