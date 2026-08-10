import {
  canonicalSerialize,
  composeEvidenceBundle,
  EVIDENCE_BUNDLE_SCHEMA_VERSION,
} from './evidence_bundle.js';
import {
  EVIDENCE_BUNDLE_PUBLIC_SCOPE,
  EVIDENCE_BUNDLE_V2_SCHEMA_VERSION,
  validateEvidenceBundleV2,
} from './evidence_bundle_v2.js';
import { createAnalysisArtifact } from './analysis_artifact.js';

export const EVIDENCE_BUNDLE_DEFAULT_MAX_BYTES = 1_000_000;

const previewRecords = new WeakMap();

function fail(message) {
  throw new TypeError(`Evidence Bundle import rejected: ${message}`);
}

function schemaMajor(schemaVersion) {
  const match = /^engagement-evidence-bundle\/v(\d+)$/.exec(schemaVersion || '');
  if (!match) fail('schemaVersion is invalid');
  const major = Number(match[1]);
  if (![1, 2].includes(major)) fail(`unknown major version ${major}`);
  return major;
}

function decodeInput(raw, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) fail('maxBytes is invalid');
  let bytes;
  if (typeof raw === 'string') bytes = new TextEncoder().encode(raw);
  else if (raw instanceof Uint8Array) bytes = raw;
  else fail('input must be UTF-8 text or bytes');
  if (bytes.byteLength > maxBytes) fail(`size exceeds ${maxBytes} bytes`);
  let text;
  try {
    text = typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('input is not valid UTF-8');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('input is not valid JSON');
  }
  return { value, byteLength: bytes.byteLength };
}

async function validateV1Checksums(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) fail('v1 bundle must be an object');
  const rootKeys = new Set([
    'schemaVersion', 'generatedAt', 'snapshotIdentity', 'query', 'result', 'provenance',
    'limitations', 'privacy', 'checksums',
  ]);
  for (const key of Object.keys(bundle)) {
    if (!rootKeys.has(key)) fail(`bundle.${key} is not allowed by schema v1`);
  }
  for (const key of rootKeys) {
    if (!Object.hasOwn(bundle, key)) fail(`v1 bundle is missing ${key}`);
  }
  const expected = await composeEvidenceBundle({
    schemaVersion: bundle.schemaVersion,
    generatedAt: bundle.generatedAt,
    query: bundle.query,
    result: bundle.result,
    provenance: bundle.provenance,
    limitations: bundle.limitations,
    privacy: bundle.privacy,
  });
  if (canonicalSerialize(expected) !== canonicalSerialize(bundle)) {
    fail('checksum or canonical content mismatch for v1 bundle');
  }
  return expected;
}

function assertValidImportedTimeRange(bundle) {
  const { start, endExclusive } = bundle.query.timeRange;
  const valid = (value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)
      && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!valid(start) || !valid(endExclusive) || start >= endExclusive) fail('query has an invalid time range');
  if (bundle.schemaVersion === EVIDENCE_BUNDLE_SCHEMA_VERSION) {
    for (const source of bundle.provenance.sources) {
      const coverageStart = source.coverage.start;
      const coverageEnd = source.coverage.end;
      if ((coverageStart !== null && !valid(coverageStart))
        || (coverageEnd !== null && !valid(coverageEnd))
        || (coverageStart && coverageEnd && coverageStart > coverageEnd)) {
        fail('source coverage has an invalid time range');
      }
    }
  }
}

function assertScope(actual, expected) {
  if (canonicalSerialize(actual) !== canonicalSerialize(expected)) fail('scope conflict');
}

function monthRecovery(query) {
  const { start, endExclusive } = query.timeRange;
  if (!/^\d{4}-\d{2}-01$/.test(start) || !/^\d{4}-\d{2}-01$/.test(endExclusive)) {
    return { recoverable: false, reason: 'time-range-is-not-a-whole-month-window' };
  }
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = endExclusive.split('-').map(Number);
  const durationMonths = (endYear - startYear) * 12 + endMonth - startMonth;
  if (![3, 6, 12, 24].includes(durationMonths)) {
    return { recoverable: false, reason: 'time-range-is-not-a-supported-local-window' };
  }
  return { recoverable: true, startMonth: start.slice(0, 7), durationMonths };
}

function queryViewState(query) {
  const month = monthRecovery(query);
  if (!month.recoverable) return month;
  const shared = {
    queryMode: query.geography.mode,
    startMonth: month.startMonth,
    durationMonths: month.durationMonths,
    selectedDrilldownCodes: query.offenseCodes,
    per10k: query.display.per10k,
  };
  if (query.geography.mode === 'district') {
    return {
      recoverable: true,
      viewState: { ...shared, selectedDistrictCode: query.geography.districtCode.padStart(2, '0') },
    };
  }
  if (query.geography.mode === 'tract') {
    return {
      recoverable: true,
      viewState: { ...shared, selectedTractGEOID: query.geography.tractGEOID },
    };
  }
  return { recoverable: false, reason: 'exact-buffer-selection-was-excluded-for-privacy' };
}

function resultSummary(bundle, major) {
  if (bundle.result.status === 'unavailable') return null;
  const resultGeneratedAt = major === 2 ? bundle.activity.analysisGeneratedAt : null;
  if (!resultGeneratedAt) return null;
  const convert = (point, label) => point ? {
    label,
    total: point.total,
    per10k: point.per10k ?? null,
    top3: (point.topOffenses || []).slice(0, 3).map((row) => ({
      text_general_code: row.offenseCode,
      n: row.count,
    })),
    delta30: null,
  } : null;
  return {
    generatedAt: resultGeneratedAt,
    comparison: {
      a: convert(bundle.result.comparison.a, 'Imported Point A'),
      b: convert(bundle.result.comparison.b, 'Imported Point B'),
    },
  };
}

function legacyArtifactProvenance(bundle) {
  const starts = bundle.provenance.sources.map((source) => source.coverage.start).filter(Boolean).sort();
  const ends = bundle.provenance.sources.map((source) => source.coverage.end).filter(Boolean).sort();
  return {
    sources: bundle.provenance.sources.map((source) => source.id),
    ...(starts.length || ends.length ? {
      coverage: { min: starts[0] || null, max: ends.at(-1) || null },
    } : {}),
  };
}

function v2ArtifactProvenance(bundle, sourceAdapter) {
  if (typeof sourceAdapter?.toArtifactProvenance !== 'function') {
    return { recoverable: false, reason: 'source-adapter-recovery-projection-is-unavailable' };
  }
  let provenance;
  try {
    provenance = sourceAdapter.toArtifactProvenance(structuredClone(bundle.provenance.sources));
  } catch (error) {
    fail(`source recovery projection failed: ${error?.message || error}`);
  }
  return { recoverable: true, provenance };
}

function recoveredArtifact(bundle, major, sourceAdapter, { createId, now }) {
  const queryState = queryViewState(bundle.query);
  if (!queryState.recoverable) return queryState;
  const provenanceResult = major === 1
    ? { recoverable: true, provenance: legacyArtifactProvenance(bundle) }
    : v2ArtifactProvenance(bundle, sourceAdapter);
  if (!provenanceResult.recoverable) return provenanceResult;
  const geography = bundle.query.geography.mode === 'district'
    ? `District ${bundle.query.geography.districtCode.padStart(2, '0')}`
    : `Tract ${bundle.query.geography.tractGEOID}`;
  return {
    recoverable: true,
    artifact: createAnalysisArtifact({
      title: `Imported ${geography} analysis`,
      viewState: queryState.viewState,
      resultSummary: resultSummary(bundle, major),
      provenance: provenanceResult.provenance,
    }, { createId, now }),
  };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

function sourceImportSummary(bundle, major) {
  const sources = bundle.provenance.sources;
  return {
    sourceStatuses: [...new Set(sources.map(({ status }) => status))].sort(),
    sourceCoverage: sources.map((source) => ({
      sourceId: source.id,
      start: source.coverage.start,
      end: source.coverage.end,
    })),
    sourceStatusReasons: major === 2
      ? sources.map((source) => ({ sourceId: source.id, reason: source.statusReason }))
      : sources.map((source) => ({ sourceId: source.id, reason: null })),
  };
}

export async function previewEvidenceBundleImport(raw, {
  maxBytes = EVIDENCE_BUNDLE_DEFAULT_MAX_BYTES,
  expectedScope = EVIDENCE_BUNDLE_PUBLIC_SCOPE,
  sourceAdapter,
  createId = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
} = {}) {
  const { value, byteLength } = decodeInput(raw, maxBytes);
  const major = schemaMajor(value?.schemaVersion);
  let bundle;
  let scope;
  if (major === 1) {
    bundle = await validateV1Checksums(value);
    scope = EVIDENCE_BUNDLE_PUBLIC_SCOPE;
  } else {
    bundle = await validateEvidenceBundleV2(value, { sourceAdapter });
    scope = bundle.scope;
  }
  assertValidImportedTimeRange(bundle);
  assertScope(scope, expectedScope);
  const recovered = recoveredArtifact(bundle, major, sourceAdapter, { createId, now });
  const artifacts = recovered.recoverable ? [recovered.artifact] : [];
  const sourceSummary = sourceImportSummary(bundle, major);
  const preview = deepFreeze({
    kind: 'evidence-bundle-import-preview',
    schemaVersion: bundle.schemaVersion,
    sourceMajor: major,
    byteLength,
    snapshotIdentity: bundle.snapshotIdentity,
    scope: structuredClone(scope),
    summary: {
      queryType: bundle.query.type,
      geographyMode: bundle.query.geography.mode,
      geography: structuredClone(bundle.query.geography),
      timeRange: structuredClone(bundle.query.timeRange),
      resultStatus: bundle.result.status,
      sourceCount: bundle.provenance.sources.length,
      ...sourceSummary,
      limitations: structuredClone(bundle.limitations),
    },
    recovery: {
      status: recovered.recoverable ? 'ready' : 'not-recoverable',
      reason: recovered.reason || null,
      artifactCount: artifacts.length,
    },
    notices: [
      'This preview does not change local analysis storage.',
      'Checksums only compare covered content; v1 excludes documented volatile fields, and no checksum proves correctness, trust, freshness, or official status.',
      'Applying restores only public analysis state and reconstructable query context; it does not refresh remote data.',
    ],
  });
  previewRecords.set(preview, { artifacts });
  return preview;
}

export async function applyEvidenceBundleImport(preview, { repository } = {}) {
  const record = previewRecords.get(preview);
  if (!record) fail('apply requires an unmodified preview from this session');
  if (preview.recovery.status !== 'ready' || record.artifacts.length === 0) {
    fail(`preview is not recoverable: ${preview.recovery.reason || 'unknown reason'}`);
  }
  if (!repository || typeof repository.saveManyAtomic !== 'function') {
    fail('an atomic analysis repository is required');
  }
  const artifacts = await repository.saveManyAtomic(record.artifacts);
  return Object.freeze({
    status: 'applied',
    artifactCount: artifacts.length,
    artifactIds: Object.freeze(artifacts.map((artifact) => artifact.id)),
    remoteRefresh: false,
  });
}

export const EVIDENCE_BUNDLE_SUPPORTED_SCHEMA_VERSIONS = Object.freeze([
  EVIDENCE_BUNDLE_SCHEMA_VERSION,
  EVIDENCE_BUNDLE_V2_SCHEMA_VERSION,
]);
