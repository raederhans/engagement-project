import { createHash } from 'node:crypto';

import {
  createGeneralizedIncidentAccumulator,
  finalizeGeneralizedIncidentAccumulator,
} from '../../src/routes_crime/known_route_contributions.js';

const EXCLUSION_KEYS = Object.freeze([
  'nonActive',
  'coordinateUnavailable',
  'precisionUnavailable',
  'categoryUnavailable',
  'outsideUncertaintyCorridor',
  'ambiguousNonAdjacent',
  'malformed',
]);

export function createKnownRouteEvidenceCheckpoint({
  warehouseIdentity,
  routeIdentity,
  centerlineDataVersion,
  catalogIdentity,
  corridorIdentity,
  completedPartitions,
  partitionCount,
  accumulator,
  startedAt,
  completion = null,
} = {}) {
  const checkpoint = {
    schema: 'known-route-evidence-checkpoint/v1',
    warehouseIdentity,
    routeIdentity,
    centerlineDataVersion,
    catalogIdentity,
    corridorIdentity,
    completedPartitions,
    partitionCount,
    startedAt,
    completion,
    accumulator: {
      rowsRead: accumulator?.rowsRead,
      eligibleGeneralizedRows: accumulator?.eligibleGeneralizedRows,
      contributingRows: accumulator?.contributingRows,
      excluded: { ...accumulator?.excluded },
      segments: (accumulator?.segments || []).map((segment) => ({
        analysisSegmentId: segment.analysisSegmentId,
        streetLabel: segment.streetLabel,
        contributionUnits: segment.contributionUnits,
        contributingRows: segment.contributingRows,
        categories: [...segment.categories.entries()].sort(([left], [right]) => left.localeCompare(right)),
      })),
    },
  };
  validateCheckpoint(checkpoint);
  return checkpoint;
}

export function restoreKnownRouteEvidenceAccumulator(checkpoint, { matchedEdges, expected } = {}) {
  validateCheckpoint(checkpoint);
  for (const key of ['warehouseIdentity', 'routeIdentity', 'centerlineDataVersion', 'catalogIdentity', 'corridorIdentity', 'partitionCount']) {
    if (checkpoint[key] !== expected?.[key]) throw new Error(`Known Route checkpoint ${key} does not match the current inputs.`);
  }
  const accumulator = createGeneralizedIncidentAccumulator({ matchedEdges });
  if (checkpoint.accumulator.segments.length !== accumulator.segments.length) {
    throw new Error('Known Route checkpoint segment count does not match the current corridor.');
  }
  accumulator.rowsRead = checkpoint.accumulator.rowsRead;
  accumulator.eligibleGeneralizedRows = checkpoint.accumulator.eligibleGeneralizedRows;
  accumulator.contributingRows = checkpoint.accumulator.contributingRows;
  accumulator.excluded = { ...checkpoint.accumulator.excluded };
  accumulator.segments.forEach((segment, index) => {
    const saved = checkpoint.accumulator.segments[index];
    if (saved.analysisSegmentId !== segment.analysisSegmentId || saved.streetLabel !== segment.streetLabel) {
      throw new Error('Known Route checkpoint segment identity does not match the current corridor.');
    }
    segment.contributionUnits = saved.contributionUnits;
    segment.contributingRows = saved.contributingRows;
    segment.categories = new Map(saved.categories);
  });
  return accumulator;
}

export function createSafeKnownRouteAggregateReport({
  warehouseManifest,
  warehouseManifestIdentity,
  routeLabel,
  match,
  catalogFeatureCount,
  accumulator,
  completion,
} = {}) {
  const incidents = finalizeGeneralizedIncidentAccumulator(accumulator);
  const report = {
    schema: 'known-route-corridor-aggregate/v1',
    status: 'partial',
    completedAt: completion.completedAt,
    publicRoute: {
      label: routeLabel,
      exactGeometryIncluded: false,
      endpointsIncluded: false,
      privateUserRoute: false,
      citywideValidityClaim: false,
    },
    warehouse: {
      schema: warehouseManifest.schema,
      manifestIdentity: warehouseManifestIdentity,
      currentSnapshotId: warehouseManifest.current_snapshot_id,
      partitionCount: warehouseManifest.partition_count,
      canonicalRowsRead: incidents.route.rowsRead,
      activeRowCount: warehouseManifest.active_row_count,
      coverage: { ...warehouseManifest.coverage },
      servingEligible: warehouseManifest.serving_eligible,
    },
    centerline: {
      sourceId: 'philadelphia-street-centerline',
      dataVersion: match.dataVersion,
      sourceAsOf: match.sourceAsOf,
      queryFeatureCount: catalogFeatureCount,
      matchedAnalysisSegmentCount: match.matchedEdges.length,
      connectedNodeChain: true,
      maximumMatchDistanceM: match.maximumMatchDistanceM,
      method: match.method,
      transportSemantics: match.transportSemantics,
      exactRouteIncluded: false,
      sourceEdgeIdsIncluded: false,
    },
    reportedIncidentEvidence: incidents,
    hin: {
      status: 'partial',
      networkVintage: 2025,
      crashDataPeriod: [2019, 2023],
      meaning: 'Historical planning-network context remains a separate evidence dimension.',
    },
    rawCrash: {
      status: 'unavailable',
      reason: 'No raw official crash record set was acquired and validated for M4; no count or zero inferred.',
    },
    accessibility: {
      status: 'unavailable',
      reason: 'No reviewed citywide source proves sidewalk continuity, curb-ramp accessibility, wheelchair passability, or current obstruction state.',
    },
    dimensionsCombinedIntoSafetyScore: false,
    privacy: {
      containsEventRows: false,
      containsEventCoordinates: false,
      containsGeneralizedLocations: false,
      containsAddresses: false,
      containsSourceRecordIds: false,
      containsRouteCoordinates: false,
      containsRouteEndpoints: false,
    },
    execution: {
      durationMs: completion.durationMs,
      maximumRssBytes: completion.maximumRssBytes,
      resumedPartitions: completion.resumedPartitions,
    },
  };
  const { completedAt, execution, ...semanticEvidence } = report;
  report.semanticIdentity = `sha256:${createHash('sha256').update(stableText(semanticEvidence)).digest('hex')}`;
  return report;
}

function validateCheckpoint(value) {
  const identities = ['warehouseIdentity', 'routeIdentity', 'centerlineDataVersion', 'catalogIdentity', 'corridorIdentity'];
  if (value?.schema !== 'known-route-evidence-checkpoint/v1'
    || identities.some((key) => typeof value[key] !== 'string' || !value[key])
    || !Number.isInteger(value.completedPartitions) || value.completedPartitions < 0
    || !Number.isInteger(value.partitionCount) || value.partitionCount < 1
    || value.completedPartitions > value.partitionCount
    || !exactTimestamp(value.startedAt)
    || (value.completion !== null && (!exactTimestamp(value.completion?.completedAt)
      || !nonnegativeInteger(value.completion.durationMs)
      || !nonnegativeInteger(value.completion.maximumRssBytes)
      || !nonnegativeInteger(value.completion.resumedPartitions)))) {
    throw new Error('Known Route checkpoint header is invalid.');
  }
  const accumulator = value.accumulator;
  if (!accumulator || !nonnegativeInteger(accumulator.rowsRead)
    || !nonnegativeInteger(accumulator.eligibleGeneralizedRows)
    || !nonnegativeInteger(accumulator.contributingRows)
    || !accumulator.excluded || Object.keys(accumulator.excluded).sort().join('|') !== [...EXCLUSION_KEYS].sort().join('|')
    || EXCLUSION_KEYS.some((key) => !nonnegativeInteger(accumulator.excluded[key]))
    || !Array.isArray(accumulator.segments) || !accumulator.segments.length) {
    throw new Error('Known Route checkpoint accumulator is invalid.');
  }
  for (const segment of accumulator.segments) {
    if (typeof segment?.analysisSegmentId !== 'string' || !/^segment-\d{3}$/.test(segment.analysisSegmentId)
      || typeof segment.streetLabel !== 'string' || !segment.streetLabel
      || !nonnegativeNumber(segment.contributionUnits)
      || !nonnegativeInteger(segment.contributingRows)
      || !Array.isArray(segment.categories)
      || segment.categories.some((entry) => !Array.isArray(entry) || entry.length !== 2
        || typeof entry[0] !== 'string' || !entry[0] || !nonnegativeNumber(entry[1]))) {
      throw new Error('Known Route checkpoint segment is invalid.');
    }
  }
  return value;
}

function stableText(value) {
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableText(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonnegativeNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

function exactTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
    && new Date(value).toISOString() === value;
}
