import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createGeneralizedIncidentAccumulator,
  finalizeGeneralizedIncidentAccumulator,
} from '../../src/routes_crime/known_route_contributions.js';
import {
  KNOWN_ROUTE_EVIDENCE_P6_SCHEMA,
  validateKnownRouteEvidenceP6Projection,
} from '../../src/routes_crime/known_route_evidence_p6_projection.js';

export const KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION = 'known-route-generalized-incident-aggregate/v2';
export const KNOWN_ROUTE_EVIDENCE_CHECKPOINT_SCHEMA = 'known-route-evidence-checkpoint/v2';
export const KNOWN_ROUTE_EVIDENCE_HANDOFF_SCHEMA = 'engagement-known-route-evidence-handoff/v2';
export const KNOWN_ROUTE_EVIDENCE_P6_CHECKPOINT_SCHEMA = 'known-route-evidence-checkpoint/v3';
export const KNOWN_ROUTE_EVIDENCE_P6_REPORT_SCHEMA = 'known-route-corridor-aggregate/v3';

const FINAL_TRANSACTION_DIRECTORY = '.final-transaction';
const EXCLUSION_KEYS = Object.freeze([
  'nonActive',
  'coordinateUnavailable',
  'precisionUnavailable',
  'categoryUnavailable',
  'outsideUncertaintyCorridor',
  'ambiguousNonAdjacent',
  'malformed',
]);
const INPUT_IDENTITY_KEYS = Object.freeze([
  'warehouseIdentity',
  'warehouseReceiptDigest',
  'warehouseManifestIdentity',
  'partitionSetIdentity',
  'routeIdentity',
  'centerlineDataVersion',
  'catalogIdentity',
  'corridorIdentity',
  'algorithmVersion',
  'partitionCount',
]);
const CHECKPOINT_KEYS = Object.freeze([
  'schema', ...INPUT_IDENTITY_KEYS, 'completedPartitions', 'completedPartitionBindings',
  'startedAt', 'completion', 'accumulator', 'checkpointIdentity',
]);
const COMPLETION_KEYS = Object.freeze([
  'state', 'completedAt', 'durationMs', 'maximumRssBytes', 'resumedPartitions',
]);
const PARTITION_BINDING_KEYS = Object.freeze(['partition', 'path', 'rowCount', 'bytes', 'sha256']);
const ACCUMULATOR_KEYS = Object.freeze([
  'rowsRead', 'eligibleGeneralizedRows', 'contributingRows', 'excluded', 'segments',
]);
const ACCUMULATOR_SEGMENT_KEYS = Object.freeze([
  'analysisSegmentId', 'streetLabel', 'contributionUnits', 'contributingRows', 'categories',
]);
const PRIVACY_KEYS = Object.freeze([
  'containsEventRows', 'containsEventCoordinates', 'containsGeneralizedLocations', 'containsAddresses',
  'containsSourceRecordIds', 'containsRawRoute', 'containsRouteCoordinates', 'containsRouteEndpoints',
  'containsCenterlineSourceEdgeIds',
]);
const HANDOFF_KEYS = Object.freeze([
  'schema', 'warehouseIdentity', 'routeIdentity', 'centerlineDataVersion', 'catalogIdentity',
  'corridorIdentity', 'completedPartitions', 'partitionCount', 'startedAt', 'completion', 'accumulator',
  'dataQuality', 'lineage', 'consent', 'clocks', 'governance', 'authority', 'privacy', 'identity',
]);
const HANDOFF_LINEAGE_KEYS = Object.freeze([
  'warehouseIdentity', 'warehouseReceiptDigest', 'warehouseManifestIdentity', 'partitionSetIdentity',
  'routeIdentity', 'catalogIdentity', 'corridorIdentity', 'algorithmVersion',
]);
const HANDOFF_AUTHORITY_KEYS = Object.freeze([
  'centerlineTopology', 'mode', 'accessibility', 'routing', 'safety', 'm2RouteEvidence',
]);
const REPORT_KEYS = Object.freeze([
  'schema', 'status', 'completedAt', 'publicRoute', 'warehouse', 'centerline',
  'reportedIncidentEvidence', 'hin', 'rawCrash', 'accessibility', 'dimensionsCombinedIntoSafetyScore',
  'privacy', 'execution', 'semanticIdentity',
]);
const M2_GOVERNANCE_KEYS = Object.freeze([
  'identity', 'revision', 'receiptDigest', 'canonicalPath', 'evidenceRoot', 'implementationTip',
  'executionRecordTip', 'cumulativeTip', 'dq', 'dqRechecked', 'outcome', 'routeEvidenceAuthority',
]);
const P6_AUTHORITY_KEYS = Object.freeze([
  'accessibility', 'crash', 'mapMatch', 'mode', 'routeChoice', 'routing', 'safety',
]);
const P6_CHECKPOINT_KEYS = Object.freeze([
  'schema', 'legacyCheckpointIdentity', 'routeIdentity', 'aggregateRouteIdentity', 'corridorIdentity',
  'centerlineIdentity', 'aggregateCatalogIdentity', 'dataVersion',
  'crashAccessibilityProducerIdentity', 'modeLegalityQualityProducerIdentity',
  'projectionIdentity', 'authority', 'privacy', 'identity',
]);
const P6_REPORT_KEYS = Object.freeze([
  'schema', 'status', 'completedAt', 'legacySemanticIdentity', 'projection',
  'crossDimensionAggregation', 'authority', 'privacy', 'semanticIdentity',
]);

export function createKnownRouteEvidenceCheckpoint({
  warehouseIdentity,
  warehouseReceiptDigest,
  warehouseManifestIdentity,
  partitionSetIdentity,
  routeIdentity,
  centerlineDataVersion,
  catalogIdentity,
  corridorIdentity,
  algorithmVersion = KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION,
  completedPartitions,
  completedPartitionBindings = [],
  partitionCount,
  accumulator,
  startedAt,
  completion = null,
} = {}) {
  const checkpoint = {
    schema: KNOWN_ROUTE_EVIDENCE_CHECKPOINT_SCHEMA,
    warehouseIdentity,
    warehouseReceiptDigest,
    warehouseManifestIdentity,
    partitionSetIdentity,
    routeIdentity,
    centerlineDataVersion,
    catalogIdentity,
    corridorIdentity,
    algorithmVersion,
    completedPartitions,
    completedPartitionBindings: completedPartitionBindings.map(copyPartitionBinding),
    partitionCount,
    startedAt,
    completion: completion ? { ...completion } : null,
    accumulator: safeAccumulator(accumulator),
  };
  checkpoint.checkpointIdentity = identityOf(checkpoint);
  validateKnownRouteEvidenceCheckpoint(checkpoint);
  return checkpoint;
}

export function restoreKnownRouteEvidenceAccumulator(checkpoint, {
  matchedEdges,
  expected,
  verifiedPartitions,
} = {}) {
  validateKnownRouteEvidenceCheckpoint(checkpoint);
  for (const key of INPUT_IDENTITY_KEYS) {
    if (checkpoint[key] !== expected?.[key]) {
      throw new Error(`Known Route checkpoint ${key} does not match the current exact inputs.`);
    }
  }
  if (!Array.isArray(verifiedPartitions) || verifiedPartitions.length !== checkpoint.partitionCount) {
    throw new Error('Known Route checkpoint restore requires the complete verified partition set.');
  }
  const expectedCompleted = verifiedPartitions.slice(0, checkpoint.completedPartitions).map(copyPartitionBinding);
  if (stableText(checkpoint.completedPartitionBindings) !== stableText(expectedCompleted)) {
    throw new Error('Known Route checkpoint completed partition prefix drifted from the verified M1 receipt.');
  }
  const completedRows = expectedCompleted.reduce((sum, binding) => sum + binding.rowCount, 0);
  if (checkpoint.accumulator.rowsRead !== completedRows) {
    throw new Error('Known Route checkpoint accumulator rows do not match its verified completed partitions.');
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
  validateAccumulatorSemantics(checkpoint.accumulator);
  return accumulator;
}

export function validateKnownRouteEvidenceCheckpoint(value) {
  requireExactKeys(value, CHECKPOINT_KEYS, 'checkpoint');
  const candidate = structuredClone(value);
  const declaredIdentity = candidate?.checkpointIdentity;
  delete candidate?.checkpointIdentity;
  if (value?.schema !== KNOWN_ROUTE_EVIDENCE_CHECKPOINT_SCHEMA
    || INPUT_IDENTITY_KEYS.some((key) => key !== 'partitionCount'
      && (typeof value[key] !== 'string' || !value[key]))
    || value.algorithmVersion !== KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION
    || !digest(value.warehouseIdentity)
    || !digest(value.warehouseReceiptDigest)
    || !digest(value.warehouseManifestIdentity)
    || !digest(value.partitionSetIdentity)
    || !digest(value.routeIdentity)
    || !digest(value.catalogIdentity)
    || !Number.isInteger(value.completedPartitions) || value.completedPartitions < 0
    || !Number.isInteger(value.partitionCount) || value.partitionCount < 1
    || value.completedPartitions > value.partitionCount
    || !Array.isArray(value.completedPartitionBindings)
    || value.completedPartitionBindings.length !== value.completedPartitions
    || !exactTimestamp(value.startedAt)
    || declaredIdentity !== identityOf(candidate)) {
    throw new Error('Known Route checkpoint header or identity is invalid.');
  }
  value.completedPartitionBindings.forEach((binding, index) => validatePartitionBinding(binding, index));
  if (value.completion !== null) {
    if (!hasExactKeys(value.completion, COMPLETION_KEYS)
      || value.completedPartitions !== value.partitionCount
      || value.completion?.state !== 'complete'
      || !exactTimestamp(value.completion.completedAt)
      || Date.parse(value.completion.completedAt) < Date.parse(value.startedAt)
      || !nonnegativeInteger(value.completion.durationMs)
      || !nonnegativeInteger(value.completion.maximumRssBytes)
      || !nonnegativeInteger(value.completion.resumedPartitions)
      || value.completion.resumedPartitions > value.partitionCount) {
      throw new Error('Known Route checkpoint completion is invalid.');
    }
  }
  validateAccumulatorSemantics(value.accumulator);
  return value;
}

export function createSafeKnownRouteAggregateReport({
  warehouseReceipt,
  warehouseReceiptDigest,
  warehouseManifestIdentity,
  partitionSetIdentity,
  routeIdentity,
  catalogIdentity,
  match,
  catalogFeatureCount,
  accumulator,
  completion,
} = {}) {
  const incidents = finalizeGeneralizedIncidentAccumulator(accumulator);
  const report = {
    schema: 'known-route-corridor-aggregate/v2',
    status: 'partial',
    completedAt: completion.completedAt,
    publicRoute: {
      labelIncluded: false,
      sessionIdentity: routeIdentity,
      exactGeometryIncluded: false,
      endpointsIncluded: false,
      privateUserRoute: false,
      citywideValidityClaim: false,
    },
    warehouse: {
      schema: warehouseReceipt.warehouse.schema,
      receiptSchema: warehouseReceipt.schema,
      receiptIdentity: warehouseReceipt.identity,
      receiptDigest: warehouseReceiptDigest,
      manifestIdentity: warehouseManifestIdentity,
      partitionSetIdentity,
      currentSnapshotId: warehouseReceipt.warehouse.current_snapshot_id,
      partitionCount: warehouseReceipt.counts.canonical_partitions,
      canonicalRowsRead: incidents.route.rowsRead,
      activeRowCount: warehouseReceipt.counts.active_rows,
      coverage: { ...warehouseReceipt.coverage },
      servingEligible: warehouseReceipt.serving_eligible,
    },
    centerline: {
      sourceId: 'philadelphia-street-centerline',
      dataVersion: match.dataVersion,
      catalogIdentity,
      corridorIdentity: match.corridorIdentity,
      sourceAsOf: match.sourceAsOf,
      queryFeatureCount: catalogFeatureCount,
      matchedAnalysisSegmentCount: match.matchedEdges.length,
      connectedNodeChain: true,
      maximumMatchDistanceM: match.maximumMatchDistanceM,
      method: match.method,
      transportSemantics: match.transportSemantics,
      topologyAuthority: 'reference-only',
      grantsModeAuthority: false,
      grantsAccessibilityAuthority: false,
      grantsRoutingAuthority: false,
      grantsSafetyAuthority: false,
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
    privacy: privacyDeclaration(),
    execution: {
      algorithmVersion: KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION,
      durationMs: completion.durationMs,
      maximumRssBytes: completion.maximumRssBytes,
      resumedPartitions: completion.resumedPartitions,
    },
  };
  const { completedAt, execution, ...semanticEvidence } = report;
  report.semanticIdentity = identityOf(semanticEvidence);
  validateKnownRouteEvidenceAggregateReport(report);
  return report;
}

export function validateKnownRouteEvidenceAggregateReport(value) {
  requireExactKeys(value, REPORT_KEYS, 'aggregate report');
  requireExactKeys(value.publicRoute, [
    'labelIncluded', 'sessionIdentity', 'exactGeometryIncluded', 'endpointsIncluded',
    'privateUserRoute', 'citywideValidityClaim',
  ], 'aggregate report publicRoute');
  requireExactKeys(value.warehouse, [
    'schema', 'receiptSchema', 'receiptIdentity', 'receiptDigest', 'manifestIdentity',
    'partitionSetIdentity', 'currentSnapshotId', 'partitionCount', 'canonicalRowsRead',
    'activeRowCount', 'coverage', 'servingEligible',
  ], 'aggregate report warehouse');
  requireExactKeys(value.warehouse.coverage, [
    'start', 'end_exclusive', 'earliest_event_at', 'latest_event_at',
  ], 'aggregate report warehouse coverage');
  requireExactKeys(value.centerline, [
    'sourceId', 'dataVersion', 'catalogIdentity', 'corridorIdentity', 'sourceAsOf',
    'queryFeatureCount', 'matchedAnalysisSegmentCount', 'connectedNodeChain', 'maximumMatchDistanceM',
    'method', 'transportSemantics', 'topologyAuthority', 'grantsModeAuthority',
    'grantsAccessibilityAuthority', 'grantsRoutingAuthority', 'grantsSafetyAuthority',
    'exactRouteIncluded', 'sourceEdgeIdsIncluded',
  ], 'aggregate report centerline');
  requireExactKeys(value.hin, ['status', 'networkVintage', 'crashDataPeriod', 'meaning'], 'aggregate report HIN');
  requireExactKeys(value.rawCrash, ['status', 'reason'], 'aggregate report raw crash');
  requireExactKeys(value.accessibility, ['status', 'reason'], 'aggregate report accessibility');
  requireExactKeys(value.execution, [
    'algorithmVersion', 'durationMs', 'maximumRssBytes', 'resumedPartitions',
  ], 'aggregate report execution');
  const semantic = structuredClone(value);
  const declaredIdentity = semantic.semanticIdentity;
  delete semantic.semanticIdentity;
  delete semantic.completedAt;
  delete semantic.execution;
  if (value.schema !== 'known-route-corridor-aggregate/v2'
    || value.status !== 'partial'
    || !exactTimestamp(value.completedAt)
    || declaredIdentity !== identityOf(semantic)
    || value.publicRoute.labelIncluded !== false
    || !digest(value.publicRoute.sessionIdentity)
    || ['exactGeometryIncluded', 'endpointsIncluded', 'privateUserRoute', 'citywideValidityClaim']
      .some((key) => value.publicRoute[key] !== false)
    || typeof value.warehouse.schema !== 'string' || !value.warehouse.schema
    || typeof value.warehouse.receiptSchema !== 'string' || !value.warehouse.receiptSchema
    || !digest(value.warehouse.receiptIdentity)
    || !digest(value.warehouse.receiptDigest)
    || !digest(value.warehouse.manifestIdentity)
    || !digest(value.warehouse.partitionSetIdentity)
    || !digest(value.warehouse.currentSnapshotId)
    || !nonnegativeInteger(value.warehouse.partitionCount) || value.warehouse.partitionCount < 1
    || !nonnegativeInteger(value.warehouse.canonicalRowsRead)
    || !nonnegativeInteger(value.warehouse.activeRowCount)
    || Object.values(value.warehouse.coverage).some((entry) => typeof entry !== 'string' || !entry)
    || value.warehouse.servingEligible !== false
    || value.centerline.sourceId !== 'philadelphia-street-centerline'
    || typeof value.centerline.dataVersion !== 'string' || !value.centerline.dataVersion
    || !digest(value.centerline.catalogIdentity)
    || typeof value.centerline.corridorIdentity !== 'string' || !value.centerline.corridorIdentity
    || !exactTimestamp(value.centerline.sourceAsOf)
    || !nonnegativeInteger(value.centerline.queryFeatureCount)
    || !nonnegativeInteger(value.centerline.matchedAnalysisSegmentCount)
    || value.centerline.matchedAnalysisSegmentCount < 1
    || value.centerline.connectedNodeChain !== true
    || !nonnegativeNumber(value.centerline.maximumMatchDistanceM)
    || typeof value.centerline.method !== 'string' || !value.centerline.method
    || typeof value.centerline.transportSemantics !== 'string' || !value.centerline.transportSemantics
    || value.centerline.topologyAuthority !== 'reference-only'
    || ['grantsModeAuthority', 'grantsAccessibilityAuthority', 'grantsRoutingAuthority',
      'grantsSafetyAuthority', 'exactRouteIncluded', 'sourceEdgeIdsIncluded']
      .some((key) => value.centerline[key] !== false)
    || value.hin.status !== 'partial'
    || !nonnegativeInteger(value.hin.networkVintage)
    || !Array.isArray(value.hin.crashDataPeriod) || value.hin.crashDataPeriod.length !== 2
    || value.hin.crashDataPeriod.some((year) => !nonnegativeInteger(year))
    || typeof value.hin.meaning !== 'string' || !value.hin.meaning
    || value.rawCrash.status !== 'unavailable' || typeof value.rawCrash.reason !== 'string' || !value.rawCrash.reason
    || value.accessibility.status !== 'unavailable'
    || typeof value.accessibility.reason !== 'string' || !value.accessibility.reason
    || value.dimensionsCombinedIntoSafetyScore !== false
    || value.execution.algorithmVersion !== KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION
    || !nonnegativeInteger(value.execution.durationMs)
    || !nonnegativeInteger(value.execution.maximumRssBytes)
    || !nonnegativeInteger(value.execution.resumedPartitions)
    || value.execution.resumedPartitions > value.warehouse.partitionCount) {
    throw new Error('Known Route aggregate report schema, identity, lineage, or authority is invalid.');
  }
  validateFinalizedEvidence(value.reportedIncidentEvidence, value.warehouse.canonicalRowsRead);
  validatePrivacyDeclaration(value.privacy);
  validateSafeArtifact(value);
  return value;
}

export function createKnownRouteEvidenceFinalHandoff({
  checkpoint,
  warehouseReceipt,
  m2Governance,
  publicCenterlineRequest,
} = {}) {
  validateKnownRouteEvidenceCheckpoint(checkpoint);
  if (!checkpoint.completion || checkpoint.completedPartitions !== checkpoint.partitionCount) {
    throw new Error('Known Route final handoff requires a completed checkpoint.');
  }
  validateM2GovernanceProjection(m2Governance);
  const clocks = {
    sourceAsOf: warehouseReceipt?.clocks?.source_as_of,
    retrievedAt: warehouseReceipt?.clocks?.retrieved_at,
    builtAt: checkpoint.startedAt,
    observedAt: checkpoint.completion.completedAt,
  };
  if (!publicCenterlineRequest || !monotonicClocks(clocks)) {
    throw new Error('Known Route final handoff consent or four-clock order is invalid.');
  }
  const handoff = {
    schema: KNOWN_ROUTE_EVIDENCE_HANDOFF_SCHEMA,
    warehouseIdentity: checkpoint.warehouseIdentity,
    routeIdentity: checkpoint.routeIdentity,
    centerlineDataVersion: checkpoint.centerlineDataVersion,
    catalogIdentity: checkpoint.catalogIdentity,
    corridorIdentity: checkpoint.corridorIdentity,
    completedPartitions: checkpoint.completedPartitions,
    partitionCount: checkpoint.partitionCount,
    startedAt: checkpoint.startedAt,
    completion: { ...checkpoint.completion },
    accumulator: structuredClone(checkpoint.accumulator),
    dataQuality: {
      partitionCompletion: true,
      accumulatorValidated: true,
      unavailableIsZero: false,
      partialIsCurrent: false,
      staleIsCurrent: false,
    },
    lineage: {
      warehouseIdentity: checkpoint.warehouseIdentity,
      warehouseReceiptDigest: checkpoint.warehouseReceiptDigest,
      warehouseManifestIdentity: checkpoint.warehouseManifestIdentity,
      partitionSetIdentity: checkpoint.partitionSetIdentity,
      routeIdentity: checkpoint.routeIdentity,
      catalogIdentity: checkpoint.catalogIdentity,
      corridorIdentity: checkpoint.corridorIdentity,
      algorithmVersion: checkpoint.algorithmVersion,
    },
    consent: { publicCenterlineRequest: true },
    clocks,
    governance: { m2: structuredClone(m2Governance) },
    authority: {
      centerlineTopology: 'reference-only',
      mode: false,
      accessibility: false,
      routing: false,
      safety: false,
      m2RouteEvidence: false,
    },
    privacy: privacyDeclaration(),
  };
  handoff.identity = identityOf(handoff);
  validateKnownRouteEvidenceFinalHandoff(handoff, { checkpoint });
  return handoff;
}

export function validateKnownRouteEvidenceFinalHandoff(value, { checkpoint } = {}) {
  validateKnownRouteEvidenceCheckpoint(checkpoint);
  requireExactKeys(value, HANDOFF_KEYS, 'final handoff');
  requireExactKeys(value.completion, COMPLETION_KEYS, 'final handoff completion');
  requireExactKeys(value.dataQuality, [
    'partitionCompletion', 'accumulatorValidated', 'unavailableIsZero', 'partialIsCurrent', 'staleIsCurrent',
  ], 'final handoff dataQuality');
  requireExactKeys(value.lineage, HANDOFF_LINEAGE_KEYS, 'final handoff lineage');
  requireExactKeys(value.consent, ['publicCenterlineRequest'], 'final handoff consent');
  requireExactKeys(value.clocks, ['sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt'], 'final handoff clocks');
  requireExactKeys(value.governance, ['m2'], 'final handoff governance');
  requireExactKeys(value.authority, HANDOFF_AUTHORITY_KEYS, 'final handoff authority');
  const candidate = structuredClone(value);
  const declaredIdentity = candidate?.identity;
  delete candidate?.identity;
  if (value?.schema !== KNOWN_ROUTE_EVIDENCE_HANDOFF_SCHEMA
    || declaredIdentity !== identityOf(candidate)
    || !digest(value.warehouseIdentity)
    || !digest(value.routeIdentity)
    || !digest(value.catalogIdentity)
    || typeof value.centerlineDataVersion !== 'string' || !value.centerlineDataVersion
    || typeof value.corridorIdentity !== 'string' || !value.corridorIdentity
    || !Number.isInteger(value.completedPartitions)
    || value.completedPartitions !== value.partitionCount
    || value.completedPartitions !== checkpoint.completedPartitions
    || value.partitionCount !== checkpoint.partitionCount
    || !exactTimestamp(value.startedAt)
    || value.startedAt !== checkpoint.startedAt
    || value.completion?.state !== 'complete'
    || stableText(value.completion) !== stableText(checkpoint.completion)
    || value.dataQuality?.partitionCompletion !== true
    || value.dataQuality?.accumulatorValidated !== true
    || value.dataQuality?.unavailableIsZero !== false
    || value.dataQuality?.partialIsCurrent !== false
    || value.dataQuality?.staleIsCurrent !== false
    || value.consent?.publicCenterlineRequest !== true
    || !monotonicClocks(value.clocks)
    || value.startedAt !== value.clocks.builtAt
    || value.completion.completedAt !== value.clocks.observedAt
    || value.lineage?.warehouseIdentity !== value.warehouseIdentity
    || ['warehouseIdentity', 'warehouseReceiptDigest', 'warehouseManifestIdentity', 'partitionSetIdentity',
      'routeIdentity', 'catalogIdentity'].some((key) => !digest(value.lineage?.[key]))
    || value.lineage?.warehouseReceiptDigest !== checkpoint.warehouseReceiptDigest
    || value.lineage?.warehouseManifestIdentity !== checkpoint.warehouseManifestIdentity
    || value.lineage?.partitionSetIdentity !== checkpoint.partitionSetIdentity
    || value.lineage?.routeIdentity !== value.routeIdentity
    || value.lineage?.catalogIdentity !== value.catalogIdentity
    || value.lineage?.corridorIdentity !== value.corridorIdentity
    || value.lineage?.algorithmVersion !== KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION
    || value.warehouseIdentity !== checkpoint.warehouseIdentity
    || value.routeIdentity !== checkpoint.routeIdentity
    || value.centerlineDataVersion !== checkpoint.centerlineDataVersion
    || value.catalogIdentity !== checkpoint.catalogIdentity
    || value.corridorIdentity !== checkpoint.corridorIdentity
    || value.lineage.algorithmVersion !== checkpoint.algorithmVersion
    || stableText(value.accumulator) !== stableText(checkpoint.accumulator)
    || value.authority?.centerlineTopology !== 'reference-only'
    || ['mode', 'accessibility', 'routing', 'safety', 'm2RouteEvidence'].some((key) => value.authority?.[key] !== false)) {
    throw new Error('Known Route final handoff header, lineage, consent, clock, or authority is invalid.');
  }
  validateAccumulatorSemantics(value.accumulator);
  validateM2GovernanceProjection(value.governance?.m2);
  validatePrivacyDeclaration(value.privacy);
  validateSafeArtifact(value);
  return value;
}

export function validateKnownRouteEvidenceArtifactSet({ checkpoint, report, handoff } = {}) {
  validateKnownRouteEvidenceCheckpoint(checkpoint);
  validateKnownRouteEvidenceAggregateReport(report);
  validateKnownRouteEvidenceFinalHandoff(handoff, { checkpoint });
  if (report.completedAt !== checkpoint.completion?.completedAt
    || report.publicRoute.sessionIdentity !== checkpoint.routeIdentity
    || report.warehouse.receiptIdentity !== checkpoint.warehouseIdentity
    || report.warehouse.receiptDigest !== checkpoint.warehouseReceiptDigest
    || report.warehouse.manifestIdentity !== checkpoint.warehouseManifestIdentity
    || report.warehouse.partitionSetIdentity !== checkpoint.partitionSetIdentity
    || report.warehouse.partitionCount !== checkpoint.partitionCount
    || report.warehouse.canonicalRowsRead !== checkpoint.accumulator.rowsRead
    || report.centerline.dataVersion !== checkpoint.centerlineDataVersion
    || report.centerline.catalogIdentity !== checkpoint.catalogIdentity
    || report.centerline.corridorIdentity !== checkpoint.corridorIdentity
    || report.execution.algorithmVersion !== checkpoint.algorithmVersion
    || report.execution.durationMs !== checkpoint.completion?.durationMs
    || report.execution.maximumRssBytes !== checkpoint.completion?.maximumRssBytes
    || report.execution.resumedPartitions !== checkpoint.completion?.resumedPartitions) {
    throw new Error('Known Route final artifact lineage bindings are inconsistent.');
  }
  return { checkpoint, report, handoff };
}

export function createKnownRouteEvidenceP6Checkpoint({ legacyCheckpoint, projection } = {}) {
  validateKnownRouteEvidenceCheckpoint(legacyCheckpoint);
  validateKnownRouteEvidenceP6Projection(projection);
  const checkpoint = {
    schema: KNOWN_ROUTE_EVIDENCE_P6_CHECKPOINT_SCHEMA,
    legacyCheckpointIdentity: legacyCheckpoint.checkpointIdentity,
    routeIdentity: projection.identity.routeIdentity,
    aggregateRouteIdentity: projection.identity.aggregateRouteIdentity,
    corridorIdentity: projection.identity.corridorIdentity,
    centerlineIdentity: projection.identity.centerlineIdentity,
    aggregateCatalogIdentity: projection.identity.aggregateCatalogIdentity,
    dataVersion: projection.identity.dataVersion,
    crashAccessibilityProducerIdentity: projection.identity.crashAccessibilityProducerIdentity,
    modeLegalityQualityProducerIdentity: projection.identity.modeLegalityQualityProducerIdentity,
    projectionIdentity: projection.projectionIdentity,
    authority: p6AuthorityDeclaration(),
    privacy: privacyDeclaration(),
  };
  checkpoint.identity = identityOf(checkpoint);
  validateKnownRouteEvidenceP6Checkpoint(checkpoint, { legacyCheckpoint, projection });
  return checkpoint;
}

export function validateKnownRouteEvidenceP6Checkpoint(value, { legacyCheckpoint, projection } = {}) {
  validateKnownRouteEvidenceCheckpoint(legacyCheckpoint);
  validateKnownRouteEvidenceP6Projection(projection);
  requireExactKeys(value, P6_CHECKPOINT_KEYS, 'P6 checkpoint');
  requireExactKeys(value.authority, P6_AUTHORITY_KEYS, 'P6 checkpoint authority');
  const candidate = structuredClone(value);
  const declaredIdentity = candidate.identity;
  delete candidate.identity;
  if (value.schema !== KNOWN_ROUTE_EVIDENCE_P6_CHECKPOINT_SCHEMA
    || declaredIdentity !== identityOf(candidate)
    || value.legacyCheckpointIdentity !== legacyCheckpoint.checkpointIdentity
    || value.routeIdentity !== projection.identity.routeIdentity
    || value.aggregateRouteIdentity !== legacyCheckpoint.routeIdentity
    || value.aggregateRouteIdentity !== projection.identity.aggregateRouteIdentity
    || value.corridorIdentity !== legacyCheckpoint.corridorIdentity
    || value.corridorIdentity !== projection.identity.corridorIdentity
    || value.centerlineIdentity !== projection.identity.centerlineIdentity
    || value.aggregateCatalogIdentity !== legacyCheckpoint.catalogIdentity
    || value.aggregateCatalogIdentity !== projection.identity.aggregateCatalogIdentity
    || value.dataVersion !== legacyCheckpoint.centerlineDataVersion
    || value.dataVersion !== projection.identity.dataVersion
    || value.crashAccessibilityProducerIdentity
      !== projection.identity.crashAccessibilityProducerIdentity
    || value.modeLegalityQualityProducerIdentity
      !== projection.identity.modeLegalityQualityProducerIdentity
    || value.projectionIdentity !== projection.projectionIdentity
    || Object.values(value.authority).some((entry) => entry !== false)) {
    throw new Error('Known Route P6 checkpoint identity or authority binding is invalid.');
  }
  validatePrivacyDeclaration(value.privacy);
  validateSafeArtifact(value);
  return value;
}

export function createSafeKnownRouteAggregateReportV3({ legacyReport, projection } = {}) {
  validateKnownRouteEvidenceAggregateReport(legacyReport);
  validateKnownRouteEvidenceP6Projection(projection);
  if (legacyReport.publicRoute.sessionIdentity !== projection.identity.aggregateRouteIdentity
    || legacyReport.centerline.corridorIdentity !== projection.identity.corridorIdentity
    || legacyReport.centerline.catalogIdentity !== projection.identity.aggregateCatalogIdentity
    || legacyReport.centerline.dataVersion !== projection.identity.dataVersion
    || legacyReport.semanticIdentity !== projection.identity.aggregateSemanticIdentity) {
    throw new Error('Known Route P6 report does not bind to the exact legacy aggregate identity.');
  }
  const report = {
    schema: KNOWN_ROUTE_EVIDENCE_P6_REPORT_SCHEMA,
    status: 'partial',
    completedAt: legacyReport.completedAt,
    legacySemanticIdentity: legacyReport.semanticIdentity,
    projection: structuredClone(projection),
    crossDimensionAggregation: false,
    authority: p6AuthorityDeclaration(),
    privacy: privacyDeclaration(),
  };
  report.semanticIdentity = identityOf(report);
  validateKnownRouteEvidenceAggregateReportV3(report, { legacyReport, projection });
  return report;
}

export function validateKnownRouteEvidenceAggregateReportV3(value, { legacyReport, projection } = {}) {
  validateKnownRouteEvidenceAggregateReport(legacyReport);
  validateKnownRouteEvidenceP6Projection(projection);
  requireExactKeys(value, P6_REPORT_KEYS, 'P6 aggregate report');
  requireExactKeys(value.authority, P6_AUTHORITY_KEYS, 'P6 aggregate report authority');
  const candidate = structuredClone(value);
  const declaredIdentity = candidate.semanticIdentity;
  delete candidate.semanticIdentity;
  if (value.schema !== KNOWN_ROUTE_EVIDENCE_P6_REPORT_SCHEMA
    || value.status !== 'partial'
    || !exactTimestamp(value.completedAt)
    || declaredIdentity !== identityOf(candidate)
    || value.legacySemanticIdentity !== legacyReport.semanticIdentity
    || value.completedAt !== legacyReport.completedAt
    || stableText(value.projection) !== stableText(projection)
    || value.projection?.schema !== KNOWN_ROUTE_EVIDENCE_P6_SCHEMA
    || value.projection?.identity?.aggregateRouteIdentity !== legacyReport.publicRoute.sessionIdentity
    || value.projection?.identity?.corridorIdentity !== legacyReport.centerline.corridorIdentity
    || value.projection?.identity?.aggregateCatalogIdentity !== legacyReport.centerline.catalogIdentity
    || value.projection?.identity?.dataVersion !== legacyReport.centerline.dataVersion
    || value.projection?.identity?.aggregateSemanticIdentity !== legacyReport.semanticIdentity
    || value.crossDimensionAggregation !== false
    || Object.values(value.authority).some((entry) => entry !== false)) {
    throw new Error('Known Route P6 aggregate report identity, lineage, or authority is invalid.');
  }
  validateKnownRouteEvidenceP6Projection(value.projection);
  validatePrivacyDeclaration(value.privacy);
  validateSafeArtifact(value);
  return value;
}

export function validateKnownRouteEvidenceP6ArtifactSet({
  legacyCheckpoint,
  legacyReport,
  projection,
  checkpoint,
  report,
} = {}) {
  validateKnownRouteEvidenceP6Checkpoint(checkpoint, { legacyCheckpoint, projection });
  validateKnownRouteEvidenceAggregateReportV3(report, { legacyReport, projection });
  if (legacyReport.publicRoute.sessionIdentity !== legacyCheckpoint.routeIdentity
    || legacyReport.centerline.corridorIdentity !== legacyCheckpoint.corridorIdentity
    || checkpoint.projectionIdentity !== report.projection.projectionIdentity
    || checkpoint.routeIdentity !== report.projection.identity.routeIdentity
    || checkpoint.aggregateRouteIdentity !== report.projection.identity.aggregateRouteIdentity
    || checkpoint.corridorIdentity !== report.projection.identity.corridorIdentity
    || checkpoint.centerlineIdentity !== report.projection.identity.centerlineIdentity
    || checkpoint.aggregateCatalogIdentity !== report.projection.identity.aggregateCatalogIdentity
    || checkpoint.dataVersion !== report.projection.identity.dataVersion
    || checkpoint.crashAccessibilityProducerIdentity
      !== report.projection.identity.crashAccessibilityProducerIdentity
    || checkpoint.modeLegalityQualityProducerIdentity
      !== report.projection.identity.modeLegalityQualityProducerIdentity) {
    throw new Error('Known Route P6 checkpoint/report bindings are inconsistent.');
  }
  return { checkpoint, report };
}

export async function publishKnownRouteFinalArtifacts({ outputRoot, artifacts, failAfterPublish = null } = {}) {
  const entries = Object.entries(artifacts || {});
  if (!entries.length || entries.some(([name]) => !/^[a-z0-9][a-z0-9.-]*\.json$/.test(name))) {
    throw new Error('Known Route final artifact set is invalid.');
  }
  await fs.mkdir(outputRoot, { recursive: true });
  await recoverKnownRouteFinalTransaction(outputRoot);
  const serialized = new Map(entries.map(([name, value]) => [name, jsonBytes(value)]));
  let allEqual = true;
  for (const [name] of entries) {
    const existing = await readBytesIfPresent(path.join(outputRoot, name));
    if (!existing || !existing.equals(serialized.get(name))) allEqual = false;
  }
  if (allEqual) return { idempotent: true };

  const transactionRoot = path.join(outputRoot, FINAL_TRANSACTION_DIRECTORY);
  const candidateRoot = path.join(transactionRoot, 'candidates');
  const backupRoot = path.join(transactionRoot, 'backups');
  await fs.mkdir(candidateRoot, { recursive: true });
  await fs.mkdir(backupRoot, { recursive: true });
  const journal = { schema: 'known-route-final-transaction/v1', entries: [] };
  try {
    for (const [name] of entries) {
      const destination = path.join(outputRoot, name);
      journal.entries.push({ name, hadExisting: Boolean(await readBytesIfPresent(destination)) });
      await fs.writeFile(path.join(candidateRoot, name), serialized.get(name), { flag: 'wx' });
    }
    await writeJsonAtomic(path.join(transactionRoot, 'journal.json'), journal);
  } catch (error) {
    await fs.rm(transactionRoot, { recursive: true, force: true });
    throw error;
  }
  let published = 0;
  try {
    for (const { name, hadExisting } of journal.entries) {
      const destination = path.join(outputRoot, name);
      if (hadExisting) await fs.rename(destination, path.join(backupRoot, name));
      await fs.rename(path.join(candidateRoot, name), destination);
      published += 1;
      if (failAfterPublish === published) throw new Error('Injected Known Route final publication failure.');
    }
    await fs.rm(transactionRoot, { recursive: true, force: true });
    return { idempotent: false };
  } catch (error) {
    await recoverKnownRouteFinalTransaction(outputRoot);
    throw error;
  }
}

export async function recoverKnownRouteFinalTransaction(outputRoot) {
  const transactionRoot = path.join(outputRoot, FINAL_TRANSACTION_DIRECTORY);
  const journalPath = path.join(transactionRoot, 'journal.json');
  let journal;
  try {
    journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      if (await pathPresent(transactionRoot)) await fs.rm(transactionRoot, { recursive: true, force: true });
      return false;
    }
    throw new Error(`Known Route final transaction journal is unreadable: ${error?.message || error}`);
  }
  if (journal?.schema !== 'known-route-final-transaction/v1' || !Array.isArray(journal.entries)) {
    throw new Error('Known Route final transaction journal is invalid.');
  }
  for (const entry of [...journal.entries].reverse()) {
    if (!entry || !/^[a-z0-9][a-z0-9.-]*\.json$/.test(entry.name) || typeof entry.hadExisting !== 'boolean') {
      throw new Error('Known Route final transaction entry is invalid.');
    }
    const destination = path.join(outputRoot, entry.name);
    const backup = path.join(transactionRoot, 'backups', entry.name);
    const backupPresent = Boolean(await readBytesIfPresent(backup));
    if (backupPresent) {
      await fs.rm(destination, { force: true });
      await fs.rename(backup, destination);
    } else if (!entry.hadExisting) {
      await fs.rm(destination, { force: true });
    }
  }
  await fs.rm(transactionRoot, { recursive: true, force: true });
  return true;
}

export async function writeJsonAtomic(destination, value) {
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporary, jsonBytes(value), { flag: 'wx' });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function identityOf(value) {
  return `sha256:${createHash('sha256').update(stableText(value)).digest('hex')}`;
}

export function stableText(value) {
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableText(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeAccumulator(accumulator) {
  return {
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
  };
}

function validateAccumulatorSemantics(accumulator) {
  requireExactKeys(accumulator, ACCUMULATOR_KEYS, 'accumulator');
  requireExactKeys(accumulator.excluded, EXCLUSION_KEYS, 'accumulator exclusions');
  if (!nonnegativeInteger(accumulator.rowsRead)
    || !nonnegativeInteger(accumulator.eligibleGeneralizedRows)
    || !nonnegativeInteger(accumulator.contributingRows)
    || accumulator.contributingRows > accumulator.eligibleGeneralizedRows
    || !accumulator.excluded
    || Object.keys(accumulator.excluded).sort().join('|') !== [...EXCLUSION_KEYS].sort().join('|')
    || EXCLUSION_KEYS.some((key) => !nonnegativeInteger(accumulator.excluded[key]))
    || !Array.isArray(accumulator.segments) || !accumulator.segments.length) {
    throw new Error('Known Route checkpoint accumulator is invalid.');
  }
  const preEligibilityExcluded = ['nonActive', 'coordinateUnavailable', 'precisionUnavailable', 'categoryUnavailable', 'malformed']
    .reduce((sum, key) => sum + accumulator.excluded[key], 0);
  if (preEligibilityExcluded + accumulator.eligibleGeneralizedRows !== accumulator.rowsRead
    || accumulator.contributingRows + accumulator.excluded.outsideUncertaintyCorridor
      + accumulator.excluded.ambiguousNonAdjacent !== accumulator.eligibleGeneralizedRows) {
    throw new Error('Known Route checkpoint accumulator totals do not reconcile.');
  }
  for (const segment of accumulator.segments) {
    requireExactKeys(segment, ACCUMULATOR_SEGMENT_KEYS, 'accumulator segment');
    if (typeof segment.analysisSegmentId !== 'string' || !/^segment-\d{3}$/.test(segment.analysisSegmentId)
      || typeof segment.streetLabel !== 'string' || !segment.streetLabel
      || !nonnegativeNumber(segment.contributionUnits)
      || !nonnegativeInteger(segment.contributingRows)
      || !Array.isArray(segment.categories)
      || segment.categories.some((entry) => !Array.isArray(entry) || entry.length !== 2
        || typeof entry[0] !== 'string' || !entry[0] || !nonnegativeNumber(entry[1]))) {
      throw new Error('Known Route checkpoint segment is invalid.');
    }
    const categoryTotal = segment.categories.reduce((sum, entry) => sum + entry[1], 0);
    if (Math.abs(categoryTotal - segment.contributionUnits) > 1e-6) {
      throw new Error('Known Route checkpoint segment category contributions do not reconcile.');
    }
  }
  return accumulator;
}

function validateM2GovernanceProjection(value) {
  requireExactKeys(value, M2_GOVERNANCE_KEYS, 'M2 governance');
  requireExactKeys(value.identity, ['data.mart_artifact_identity', 'data.source_vintage'], 'M2 governance identity');
  requireExactKeys(value.revision, ['generated_at', 'protocol.sha256'], 'M2 governance revision');
  requireExactKeys(value.dq, [
    'canonical_rows_seen', 'tract', 'fixed-grid', 'unknown_category', 'invalid_event_time', 'non_active',
  ], 'M2 governance DQ');
  requireExactKeys(value.dq.tract, ['admitted', 'ambiguous_excluded', 'unmapped_excluded'], 'M2 tract DQ');
  requireExactKeys(value.dq['fixed-grid'], ['admitted', 'unavailable_excluded'], 'M2 fixed-grid DQ');
  requireExactKeys(value.outcome, ['promotionStatus', 'selectedModel', 'availability'], 'M2 outcome');
  if (!digest(value.identity['data.mart_artifact_identity'])
    || !digest(value.identity['data.source_vintage'])
    || !exactTimestamp(value.revision.generated_at)
    || !sha256Hex(value.revision['protocol.sha256'])
    || !digest(value.receiptDigest)
    || typeof value.canonicalPath !== 'string' || !path.isAbsolute(value.canonicalPath)
    || typeof value.evidenceRoot !== 'string' || !path.isAbsolute(value.evidenceRoot)
    || !commit(value.implementationTip) || !commit(value.executionRecordTip) || !commit(value.cumulativeTip)
    || value.implementationTip === value.executionRecordTip
    || value.executionRecordTip === value.cumulativeTip
    || value.implementationTip === value.cumulativeTip
    || ['canonical_rows_seen', 'unknown_category', 'invalid_event_time', 'non_active']
      .some((key) => !nonnegativeInteger(value.dq[key]))
    || ['admitted', 'ambiguous_excluded', 'unmapped_excluded']
      .some((key) => !nonnegativeInteger(value.dq.tract[key]))
    || ['admitted', 'unavailable_excluded']
      .some((key) => !nonnegativeInteger(value.dq['fixed-grid'][key]))
    || value.dqRechecked !== true
    || value.outcome?.promotionStatus !== 'not-promoted'
    || value.outcome?.availability !== 'unavailable'
    || value.outcome?.selectedModel !== null
    || value.routeEvidenceAuthority !== false) {
    throw new Error('Known Route M2 governance projection is invalid.');
  }
  return value;
}

function validatePartitionBinding(binding, index) {
  requireExactKeys(binding, PARTITION_BINDING_KEYS, `partition binding ${index}`);
  if (binding.partition !== index
    || binding.path !== `canonical/part-${String(index).padStart(3, '0')}.jsonl`
    || !nonnegativeInteger(binding.rowCount)
    || !nonnegativeInteger(binding.bytes) || binding.bytes < 1
    || !digest(binding.sha256)) {
    throw new Error(`Known Route checkpoint partition binding ${index} is invalid.`);
  }
}

function copyPartitionBinding(binding) {
  return {
    partition: binding.partition,
    path: binding.path,
    rowCount: binding.rowCount,
    bytes: binding.bytes,
    sha256: binding.sha256,
  };
}

function privacyDeclaration() {
  return {
    containsEventRows: false,
    containsEventCoordinates: false,
    containsGeneralizedLocations: false,
    containsAddresses: false,
    containsSourceRecordIds: false,
    containsRawRoute: false,
    containsRouteCoordinates: false,
    containsRouteEndpoints: false,
    containsCenterlineSourceEdgeIds: false,
  };
}

function p6AuthorityDeclaration() {
  return Object.fromEntries(P6_AUTHORITY_KEYS.map((key) => [key, false]));
}

function validatePrivacyDeclaration(value) {
  requireExactKeys(value, PRIVACY_KEYS, 'privacy declaration');
  if (PRIVACY_KEYS.some((key) => value[key] !== false)) {
    throw new Error('Known Route privacy declaration is invalid.');
  }
  return value;
}

function validateFinalizedEvidence(value, expectedRows) {
  requireExactKeys(value, ['schema', 'status', 'method', 'route', 'excluded', 'segments'], 'reported incident evidence');
  requireExactKeys(value.method, [
    'schema', 'maximumDistanceM', 'nonAdjacentAmbiguityDifferenceM', 'contribution', 'precision',
  ], 'reported incident method');
  requireExactKeys(value.route, [
    'contributionUnits', 'contributingRows', 'rowsRead', 'eligibleGeneralizedRows',
  ], 'reported incident route');
  requireExactKeys(value.excluded, EXCLUSION_KEYS, 'reported incident exclusions');
  if (typeof value.schema !== 'string' || !value.schema
    || !['partial', 'admitted-zero'].includes(value.status)
    || typeof value.method.schema !== 'string' || !value.method.schema
    || !nonnegativeNumber(value.method.maximumDistanceM)
    || !nonnegativeNumber(value.method.nonAdjacentAmbiguityDifferenceM)
    || typeof value.method.contribution !== 'string' || !value.method.contribution
    || typeof value.method.precision !== 'string' || !value.method.precision
    || !nonnegativeNumber(value.route.contributionUnits)
    || !nonnegativeInteger(value.route.contributingRows)
    || !nonnegativeInteger(value.route.rowsRead) || value.route.rowsRead !== expectedRows
    || !nonnegativeInteger(value.route.eligibleGeneralizedRows)
    || value.route.contributingRows > value.route.eligibleGeneralizedRows
    || EXCLUSION_KEYS.some((key) => !nonnegativeInteger(value.excluded[key]))
    || !Array.isArray(value.segments) || !value.segments.length
    || (value.route.contributingRows > 0) !== (value.status === 'partial')) {
    throw new Error('Known Route reported incident evidence is invalid.');
  }
  const preEligibilityExcluded = ['nonActive', 'coordinateUnavailable', 'precisionUnavailable', 'categoryUnavailable', 'malformed']
    .reduce((sum, key) => sum + value.excluded[key], 0);
  if (preEligibilityExcluded + value.route.eligibleGeneralizedRows !== value.route.rowsRead
    || value.route.contributingRows + value.excluded.outsideUncertaintyCorridor
      + value.excluded.ambiguousNonAdjacent !== value.route.eligibleGeneralizedRows) {
    throw new Error('Known Route reported incident evidence totals do not reconcile.');
  }
  for (const segment of value.segments) {
    requireExactKeys(segment, ACCUMULATOR_SEGMENT_KEYS, 'reported incident segment');
    if (typeof segment.analysisSegmentId !== 'string' || !/^segment-\d{3}$/.test(segment.analysisSegmentId)
      || typeof segment.streetLabel !== 'string' || !segment.streetLabel
      || !nonnegativeNumber(segment.contributionUnits)
      || !nonnegativeInteger(segment.contributingRows)
      || !Array.isArray(segment.categories)) {
      throw new Error('Known Route reported incident segment is invalid.');
    }
    let categoryTotal = 0;
    for (const category of segment.categories) {
      requireExactKeys(category, ['category', 'contributionUnits'], 'reported incident category');
      if (typeof category.category !== 'string' || !category.category
        || !nonnegativeNumber(category.contributionUnits)) {
        throw new Error('Known Route reported incident category is invalid.');
      }
      categoryTotal += category.contributionUnits;
    }
    if (Math.abs(categoryTotal - segment.contributionUnits) > 1e-6) {
      throw new Error('Known Route reported incident category contributions do not reconcile.');
    }
  }
  const segmentTotal = value.segments.reduce((sum, segment) => sum + segment.contributionUnits, 0);
  if (Math.abs(segmentTotal - value.route.contributionUnits) > 1e-6) {
    throw new Error('Known Route reported incident route contributions do not reconcile.');
  }
  return value;
}

function validateSafeArtifact(value) {
  const text = JSON.stringify(value);
  if (/"(?:source_record_id|generalized_location|routeInput|matchedEdges|coordinates|longitude|latitude)"\s*:/i.test(text)) {
    throw new Error('Known Route safe artifact contains a forbidden row, location, route, or source identifier field.');
  }
}

function monotonicClocks(value) {
  const clocks = [value?.sourceAsOf, value?.retrievedAt, value?.builtAt, value?.observedAt];
  return clocks.every(exactTimestamp)
    && clocks.every((clock, index) => index === 0 || Date.parse(clock) >= Date.parse(clocks[index - 1]));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readBytesIfPresent(file) {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathPresent(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function digest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function sha256Hex(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function commit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
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

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requireExactKeys(value, expectedKeys, label) {
  if (!hasExactKeys(value, expectedKeys)) {
    throw new Error(`Known Route ${label} has an invalid closed schema.`);
  }
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
