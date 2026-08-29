import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createGeneralizedIncidentAccumulator,
  finalizeGeneralizedIncidentAccumulator,
} from '../../src/routes_crime/known_route_contributions.js';

export const KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION = 'known-route-generalized-incident-aggregate/v2';
export const KNOWN_ROUTE_EVIDENCE_CHECKPOINT_SCHEMA = 'known-route-evidence-checkpoint/v2';
export const KNOWN_ROUTE_EVIDENCE_HANDOFF_SCHEMA = 'engagement-known-route-evidence-handoff/v2';

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
    if (value.completedPartitions !== value.partitionCount
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
  validateSafeArtifact(report);
  return report;
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
  validateKnownRouteEvidenceFinalHandoff(handoff);
  return handoff;
}

export function validateKnownRouteEvidenceFinalHandoff(value) {
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
    || !exactTimestamp(value.startedAt)
    || value.completion?.state !== 'complete'
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
    || value.lineage?.routeIdentity !== value.routeIdentity
    || value.lineage?.catalogIdentity !== value.catalogIdentity
    || value.lineage?.corridorIdentity !== value.corridorIdentity
    || value.lineage?.algorithmVersion !== KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION
    || value.authority?.centerlineTopology !== 'reference-only'
    || ['mode', 'accessibility', 'routing', 'safety', 'm2RouteEvidence'].some((key) => value.authority?.[key] !== false)) {
    throw new Error('Known Route final handoff header, lineage, consent, clock, or authority is invalid.');
  }
  validateAccumulatorSemantics(value.accumulator);
  validateM2GovernanceProjection(value.governance?.m2);
  validateSafeArtifact(value);
  return value;
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
  if (!accumulator || !nonnegativeInteger(accumulator.rowsRead)
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
    if (typeof segment?.analysisSegmentId !== 'string' || !/^segment-\d{3}$/.test(segment.analysisSegmentId)
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
  if (!value || !isPlainObject(value.identity) || !isPlainObject(value.revision)
    || !digest(value.receiptDigest)
    || typeof value.canonicalPath !== 'string' || !path.isAbsolute(value.canonicalPath)
    || typeof value.evidenceRoot !== 'string' || !path.isAbsolute(value.evidenceRoot)
    || !commit(value.implementationTip) || !commit(value.executionRecordTip) || !commit(value.cumulativeTip)
    || value.implementationTip === value.executionRecordTip
    || value.executionRecordTip === value.cumulativeTip
    || value.implementationTip === value.cumulativeTip
    || !isPlainObject(value.dq) || value.dqRechecked !== true
    || value.outcome?.promotionStatus !== 'not-promoted'
    || value.outcome?.availability !== 'unavailable'
    || value.outcome?.selectedModel !== null
    || value.routeEvidenceAuthority !== false) {
    throw new Error('Known Route M2 governance projection is invalid.');
  }
  return value;
}

function validatePartitionBinding(binding, index) {
  if (binding?.partition !== index
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
