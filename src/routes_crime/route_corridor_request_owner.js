import { fetchRouteCorridorEnvelope } from '../api/route_corridor.js';
import { CRIME_DATASET_METADATA, CRIME_METRICS } from '../data/crime_metadata.js';
import {
  ROUTE_CORRIDOR_FILTER_KEY_MAX_LENGTH,
  createRouteCorridorQueryFingerprint,
  evaluateRouteCorridorQuery,
  validateKnownRouteInput,
} from './route_corridor_capability.js';
import { fetchPhiladelphiaRouteCorridorCoverage } from './route_corridor_coverage.js';
import { createCoarseRouteEnvelope } from './route_corridor_privacy.js';

const MAX_CANDIDATES = 2_000;

export function createRouteCorridorFilterKey({ types, drilldownCodes } = {}) {
  const normalized = {
    types: normalizeFilterValues(types),
    drilldownCodes: normalizeFilterValues(drilldownCodes),
  };
  const key = JSON.stringify(normalized);
  if (key.length > ROUTE_CORRIDOR_FILTER_KEY_MAX_LENGTH) {
    throw new Error('Route corridor offense filter is too large.');
  }
  return key;
}

/**
 * Owns abort/supersession and the boundary between coarse remote admission and
 * exact local association. It holds no route beyond an active call and has no
 * persistence, URL, telemetry, or background tracking path.
 */
export function createRouteCorridorRequestOwner({
  fetchEnvelope = fetchRouteCorridorEnvelope,
  fetchSpatialCoverage = fetchPhiladelphiaRouteCorridorCoverage,
} = {}) {
  let active = true;
  let generation = 0;
  let controller = null;

  const invalidate = () => {
    generation += 1;
    controller?.abort();
    controller = null;
  };

  return {
    async request({
      routeInput,
      bufferM,
      selectedRange,
      types = [],
      drilldownCodes = [],
      signal: ownerSignal,
    } = {}) {
      if (!active || ownerSignal?.aborted) return emptyResult('superseded');
      invalidate();

      const routeAdmission = validateKnownRouteInput(routeInput);
      if (!routeAdmission.ok) return emptyResult(routeAdmission.status, routeAdmission.reason);

      let filterKey;
      try {
        filterKey = createRouteCorridorFilterKey({ types, drilldownCodes });
      } catch (error) {
        return emptyResult('source-failure', 'invalid-filter-key', {
          detail: String(error?.message || error),
        });
      }

      let queryFingerprint;
      let bbox;
      try {
        queryFingerprint = createRouteCorridorQueryFingerprint({
          routeInput,
          bufferM,
          selectedRange,
          filterKey,
        });
        bbox = createCoarseRouteEnvelope({ routeInput, bufferM });
      } catch (error) {
        return emptyResult('route-invalid', String(error?.message || error));
      }

      const requestGeneration = generation;
      const requestController = new AbortController();
      controller = requestController;
      const abortFromOwner = () => requestController.abort(ownerSignal.reason);
      ownerSignal?.addEventListener('abort', abortFromOwner, { once: true });
      const isCurrent = () => active
        && generation === requestGeneration
        && !requestController.signal.aborted;
      const query = {
        filterKey,
        selectedRange: { ...selectedRange },
        historicNotRealtime: true,
        spatialDisclosure: 'coarse-bbox-only',
        coarseEnvelope: { ...bbox },
      };

      let phase = 'spatial-coverage';
      try {
        const spatialCoverage = await fetchSpatialCoverage({
          routeInput: routeAdmission.value,
          bufferM,
          signal: requestController.signal,
        });
        if (!isCurrent()) return emptyResult('superseded', undefined, { query });
        if (!isAdmittedSpatialCoverage(spatialCoverage)) {
          return emptyResult('coverage-unavailable', 'spatial-coverage-unavailable', { query });
        }

        phase = 'incident-source';
        const sourceEnvelope = await fetchEnvelope({
          start: selectedRange.start,
          end: selectedRange.end,
          types: normalizeFilterValues(types),
          drilldownCodes: normalizeFilterValues(drilldownCodes),
          bbox: { ...bbox },
          signal: requestController.signal,
        });
        if (!isCurrent()) return emptyResult('superseded', undefined, { query });

        const admission = admitSourceEnvelope(sourceEnvelope, spatialCoverage);
        if (admission.status === 'partial') {
          return {
            ...evaluateRouteCorridorQuery({
              routeInput,
              bufferM,
              selectedRange,
              coverage: admission.coverage,
              sourceStatus: 'partial',
              requestStatus: 'current',
              incidents: [],
              filterKey,
              requestGeneration,
            }),
            query,
          };
        }
        if (admission.status === 'coverage-missing') {
          return emptyResult('coverage-unavailable', 'source-coverage-unavailable', {
            coverage: admission.coverage,
            query,
          });
        }
        if (admission.status !== 'ready') {
          return emptyResult('source-failure', admission.reason, { coverage: admission.coverage, query });
        }

        const result = evaluateRouteCorridorQuery({
          routeInput,
          bufferM,
          selectedRange,
          coverage: admission.coverage,
          incidentScope: {
            kind: 'route-corridor',
            complete: true,
            queryFingerprint,
            requestGeneration,
          },
          sourceStatus: 'ready',
          requestStatus: 'current',
          incidents: admission.candidates,
          filterKey,
          requestGeneration,
        });
        return { ...result, query };
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) {
          return emptyResult('superseded', undefined, { query });
        }
        if (phase === 'spatial-coverage') {
          return emptyResult('coverage-unavailable', 'spatial-coverage-unavailable', { query });
        }
        return emptyResult('source-failure', String(error?.message || error), { query });
      } finally {
        ownerSignal?.removeEventListener('abort', abortFromOwner);
        if (generation === requestGeneration) controller = null;
      }
    },
    clear() {
      invalidate();
    },
    setActive(next) {
      active = Boolean(next);
      if (!active) invalidate();
    },
  };
}

function admitSourceEnvelope(value, spatialCoverage) {
  const candidateTotal = toNonnegativeInteger(value?.candidateTotal);
  const returnedCandidateCount = toNonnegativeInteger(value?.returnedCandidateCount);
  const unmappedIncidentCount = toNonnegativeInteger(value?.sourceWideUnmappedCount);
  const candidates = Array.isArray(value?.candidates) ? value.candidates : null;
  const availableMonths = normalizeCoverageMonths(value?.coverageMonths);
  const availableStart = strictDate(value?.coverageMin);
  const coverageMax = strictDate(value?.coverageMax);
  const coverage = availableStart && coverageMax && availableMonths && unmappedIncidentCount !== null
    ? {
        status: 'ready',
        source: CRIME_DATASET_METADATA.provider,
        datasetId: CRIME_DATASET_METADATA.datasetId,
        availableStart,
        availableEndExclusive: nextCalendarDate(coverageMax),
        availableMonths,
        unmappedIncidentCount,
        unmappedIncidentScope: 'selected-time-and-filter-citywide',
        locationPrecision: CRIME_DATASET_METADATA.locationPrecision,
        recordGrain: CRIME_DATASET_METADATA.grain,
        recordNote: CRIME_METRICS.reportedRecords.note,
        spatialRegion: spatialCoverage.region,
        corridorCovered: spatialCoverage.corridorCovered,
        spatialCoverageSource: spatialCoverage.source,
        conservativeBoundaryMarginM: spatialCoverage.conservativeMarginM,
        spatialDisclosure: 'coarse-bbox-only',
      }
    : null;

  if (candidateTotal === null || returnedCandidateCount === null || !candidates
    || returnedCandidateCount !== candidates.length) {
    return { status: 'invalid', reason: 'invalid-source-envelope', coverage };
  }
  if (!coverage) return { status: 'coverage-missing', reason: 'source-coverage-unavailable', coverage };
  if (value.truncated === true || candidateTotal > MAX_CANDIDATES
    || returnedCandidateCount > MAX_CANDIDATES) {
    return { status: 'partial', reason: 'candidate-limit-exceeded', coverage };
  }
  if (value.truncated !== false || candidateTotal !== returnedCandidateCount) {
    return { status: 'invalid', reason: 'candidate-count-mismatch', coverage };
  }

  const identities = new Set();
  for (const candidate of candidates) {
    const identity = stableCandidateIdentity(candidate);
    if (!identity || identities.has(identity) || !isValidCandidate(candidate)) {
      return { status: 'invalid', reason: 'invalid-candidate-feature', coverage };
    }
    identities.add(identity);
  }
  return { status: 'ready', candidates, coverage };
}

function stableCandidateIdentity(candidate) {
  const value = candidate?.properties?.cartodb_id;
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  if (candidate?.id !== undefined && String(candidate.id) !== String(value)) return null;
  return String(value);
}

function isValidCandidate(candidate) {
  const coordinates = candidate?.geometry?.type === 'Point'
    ? candidate.geometry.coordinates : null;
  return candidate?.type === 'Feature'
    && Array.isArray(coordinates)
    && coordinates.length >= 2
    && Number.isFinite(coordinates[0])
    && Number.isFinite(coordinates[1])
    && coordinates[0] >= -180 && coordinates[0] <= 180
    && coordinates[1] >= -90 && coordinates[1] <= 90
    && typeof candidate?.properties?.dispatch_date_time === 'string'
    && Number.isFinite(Date.parse(candidate.properties.dispatch_date_time));
}

function normalizeFilterValues(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))].sort();
}

function strictDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value : null;
}

function normalizeCoverageMonths(value) {
  if (!Array.isArray(value) || value.length === 0
    || value.some((month) => typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
    return null;
  }
  const normalized = [...new Set(value)].sort();
  return normalized.length === value.length && normalized.every((month, index) => month === value[index])
    ? normalized : null;
}

function isAdmittedSpatialCoverage(value) {
  return value?.status === 'ready'
    && value.region === 'Philadelphia'
    && value.corridorCovered === true
    && typeof value.source === 'string'
    && value.source.trim().length > 0
    && Number.isFinite(value.conservativeMarginM)
    && value.conservativeMarginM >= 0;
}

function nextCalendarDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function toNonnegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function emptyResult(status, reason, details = {}) {
  return {
    status,
    matches: [],
    unmapped: [],
    excluded: {
      duplicateStableIdentity: 0,
      outsideCorridor: 0,
      outsideSelectedRange: 0,
    },
    ...(reason ? { reason } : {}),
    ...details,
  };
}
