import { createHash } from 'node:crypto';

import { ACS_POPULATION_SCHEMA_VERSION } from '../../src/data/acs_population.js';

const GEOID_PATTERN = /^\d{11}$/;

export function createAcsPopulationIndex(snapshot, {
  contract,
  tractGeoids,
  tractGeographyDefinition,
} = {}) {
  if (!contract || contract.snapshot_path == null
    || contract.schema !== ACS_POPULATION_SCHEMA_VERSION
    || contract.estimate_and_moe_are_distinct !== true
    || contract.geoid_set_must_match_tract_source !== true) {
    throw new Error('ACS event-enrichment contract is invalid.');
  }
  if (contract.geography_definition !== tractGeographyDefinition) {
    throw new Error(
      `ACS geography definition ${contract.geography_definition} does not match tract definition ${tractGeographyDefinition}.`,
    );
  }
  if (snapshot?.schemaVersion !== contract.schema
    || snapshot.manifest?.dataset !== contract.dataset
    || snapshot.manifest?.vintage !== contract.vintage
    || snapshot.manifest?.period !== contract.period
    || snapshot.manifest?.variables?.estimate !== contract.estimate_variable
    || snapshot.manifest?.variables?.moe90 !== contract.moe90_variable
    || !Array.isArray(snapshot.rows)
    || snapshot.manifest?.rowCount !== snapshot.rows.length) {
    throw new Error('ACS snapshot metadata does not match the admitted estimate/MOE contract.');
  }
  const rowsIdentity = `sha256:${createHash('sha256').update(JSON.stringify(snapshot.rows)).digest('hex')}`;
  if (snapshot.manifest.rowsSha256 !== rowsIdentity) {
    throw new Error('ACS snapshot rows do not match the manifest identity.');
  }

  const expectedGeoids = [...new Set(tractGeoids || [])].sort();
  if (expectedGeoids.length === 0 || expectedGeoids.some((geoid) => !GEOID_PATTERN.test(geoid))) {
    throw new Error('ACS enrichment requires admitted tract GEOIDs.');
  }
  const byGeoid = new Map();
  for (const row of snapshot.rows) {
    const geoid = String(row?.geoid || '');
    if (!GEOID_PATTERN.test(geoid) || byGeoid.has(geoid)) {
      throw new Error(`ACS snapshot GEOID ${geoid || '(missing)'} is invalid or duplicated.`);
    }
    const estimate = nonNegativeIntegerOrNull(row.population?.estimate);
    const moe90 = nonNegativeIntegerOrNull(row.population?.moe90);
    const status = estimate == null ? 'unavailable' : moe90 == null ? 'partial' : 'available';
    if (row.population?.status !== status) {
      throw new Error(`ACS ${geoid} status does not preserve estimate/MOE availability.`);
    }
    byGeoid.set(geoid, Object.freeze({ estimate, moe90, status }));
  }
  const actualGeoids = [...byGeoid.keys()].sort();
  if (JSON.stringify(actualGeoids) !== JSON.stringify(expectedGeoids)) {
    const missing = expectedGeoids.filter((geoid) => !byGeoid.has(geoid));
    const unexpected = actualGeoids.filter((geoid) => !expectedGeoids.includes(geoid));
    throw new Error(
      `ACS/tract geography coverage drifted: ${missing.length} missing and ${unexpected.length} unexpected GEOIDs.`,
    );
  }

  const snapshotId = rowsIdentity;
  const periodMatch = String(contract.period).match(/^(\d{4})-(\d{4})$/);
  if (!periodMatch || Number(periodMatch[1]) > Number(periodMatch[2])
    || contract.temporal_compatibility !== 'event-year-within-acs-period-only'
    || contract.out_of_period_status !== 'incompatible-vintage') {
    throw new Error('ACS temporal-vintage compatibility contract is invalid.');
  }
  const periodStartYear = Number(periodMatch[1]);
  const periodEndYear = Number(periodMatch[2]);
  return Object.freeze({
    snapshotId,
    vintage: contract.vintage,
    period: contract.period,
    geographyDefinition: contract.geography_definition,
    estimateVariable: contract.estimate_variable,
    moe90Variable: contract.moe90_variable,
    retrievedAt: snapshot.manifest.retrievedAt,
    sourceUrl: snapshot.manifest.sourceUrl,
    rowCount: actualGeoids.length,
    mapTract(geoid, { eventAt = null } = {}) {
      if (!geoid) {
        return {
          status: 'unavailable',
          geoid: null,
          estimate: null,
          moe90: null,
          reason: 'tract-unavailable',
          snapshotId,
          valueStatus: 'unavailable',
          temporalAlignment: 'unavailable',
          modelInputEligible: false,
        };
      }
      const population = byGeoid.get(geoid);
      if (!population) {
        return {
          status: 'unavailable',
          geoid,
          estimate: null,
          moe90: null,
          reason: 'acs-geoid-unavailable',
          snapshotId,
          valueStatus: 'unavailable',
          temporalAlignment: 'unavailable',
          modelInputEligible: false,
        };
      }
      const eventYear = eventYearOrNull(eventAt);
      const temporalCompatible = eventYear != null
        && eventYear >= periodStartYear && eventYear <= periodEndYear;
      const status = population.status === 'available' && !temporalCompatible
        ? 'incompatible-vintage' : population.status;
      return {
        status,
        geoid,
        estimate: {
          variable: contract.estimate_variable,
          value: population.estimate,
        },
        moe90: {
          variable: contract.moe90_variable,
          value: population.moe90,
        },
        vintage: contract.vintage,
        period: contract.period,
        geographyDefinition: contract.geography_definition,
        valueStatus: population.status,
        temporalAlignment: temporalCompatible ? 'within-acs-period' : 'outside-acs-period',
        modelInputEligible: population.status === 'available' && temporalCompatible,
        reason: population.status !== 'available'
          ? 'acs-estimate-or-moe-unavailable'
          : temporalCompatible ? null : 'event-year-outside-acs-period',
        snapshotId,
      };
    },
  });
}

function eventYearOrNull(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear();
}

function nonNegativeIntegerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
