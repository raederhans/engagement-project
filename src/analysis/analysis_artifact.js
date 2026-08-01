import { decodeCrimeViewState, encodeCrimeViewState } from '../state/crime_view_state.js';

export const ANALYSIS_ARTIFACT_KIND = 'engagement-analysis-artifact';
export const ANALYSIS_ARTIFACT_SCHEMA_VERSION = 1;
export const ANALYSIS_TITLE_MAX_LENGTH = 120;
const VIEW_STATE_KEYS = new Set([
  'queryMode', 'startMonth', 'durationMonths', 'radius', 'selectedGroups',
  'selectedDrilldownCodes', 'selectedDistrictCode', 'selectedTractGEOID',
  'overlayTractsLines', 'centerLonLat', 'centerBLonLat', 'addressA', 'addressB',
  'per10k', 'classMethod', 'classBins', 'classPalette', 'classOpacity',
  'classCustomBreaks',
]);
const ARTIFACT_KEYS = new Set([
  'kind', 'schemaVersion', 'id', 'title', 'createdAt', 'updatedAt',
  'viewState', 'resultSummary', 'provenance',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value, label, maxLength) {
  if (typeof value !== 'string') throw new Error(`Invalid analysis artifact ${label}.`);
  const text = value.trim();
  if (!text) throw new Error(`Invalid analysis artifact ${label}.`);
  if (text.length > maxLength) throw new Error(`Invalid analysis artifact ${label}: maximum length is ${maxLength}.`);
  return text;
}

function requireTimestamp(value, label) {
  const text = requireText(value, label, 64);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new Error(`Invalid analysis artifact ${label}.`);
  }
  return text;
}

function requireDate(value, label) {
  const text = requireText(value, label, 10);
  const date = new Date(`${text}T00:00:00Z`);
  if (
    !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(text)
    || Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== text
  ) {
    throw new Error(`Invalid analysis artifact ${label}.`);
  }
  return text;
}

function requireKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Invalid analysis artifact ${label}: unsupported field ${key}.`);
  }
}

function requireNumber(value, label, { min = -Infinity, max = Infinity, integer = false, nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`Invalid analysis artifact ${label}.`);
  }
  return value;
}

function normalizeTitle(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return (text || 'Untitled analysis').slice(0, ANALYSIS_TITLE_MAX_LENGTH);
}

function normalizeViewStateForCreation(value) {
  if (!isPlainObject(value)) throw new Error('Invalid analysis artifact view state.');
  return decodeCrimeViewState(encodeCrimeViewState(value));
}

function validateViewState(value, { allowOmittedFields = false } = {}) {
  if (!isPlainObject(value)) throw new Error('Invalid analysis artifact view state.');
  requireKeys(value, VIEW_STATE_KEYS, 'view state');
  const canonical = normalizeViewStateForCreation(value);
  const expected = allowOmittedFields
    ? Object.fromEntries(Object.keys(value).map((key) => [key, canonical[key]]))
    : canonical;
  if (JSON.stringify(stableJson(value)) !== JSON.stringify(stableJson(expected))) {
    throw new Error('Invalid analysis artifact view state.');
  }
  if (canonical.queryMode === 'buffer' && !canonical.centerLonLat) {
    throw new Error('Invalid analysis artifact view state: buffer mode requires Point A.');
  }
  if (canonical.queryMode === 'district' && !/^\d{2}$/.test(canonical.selectedDistrictCode || '')) {
    throw new Error('Invalid analysis artifact view state: district mode requires a district selection.');
  }
  if (canonical.queryMode === 'tract' && !/^\d{11}$/.test(canonical.selectedTractGEOID || '')) {
    throw new Error('Invalid analysis artifact view state: tract mode requires a tract selection.');
  }
  return canonical;
}

function validateViewStateForCreation(value) {
  if (!isPlainObject(value)) throw new Error('Invalid analysis artifact view state.');
  const viewState = Object.fromEntries(
    Object.entries(value).filter(([key]) => VIEW_STATE_KEYS.has(key)),
  );
  return validateViewState(viewState, { allowOmittedFields: true });
}

function normalizeTopRow(value) {
  if (!isPlainObject(value)) throw new Error('Invalid analysis artifact comparison top result.');
  requireKeys(value, new Set(['text_general_code', 'n']), 'comparison top result');
  return {
    text_general_code: requireText(value.text_general_code, 'comparison offense label', 160),
    n: requireNumber(value.n, 'comparison offense count', { min: 0, max: 1_000_000_000 }),
  };
}

function normalizeComparisonPoint(value, label) {
  if (value == null) return null;
  if (!isPlainObject(value)) throw new Error(`Invalid analysis artifact comparison ${label}.`);
  requireKeys(value, new Set(['label', 'total', 'per10k', 'top3', 'delta30']), `comparison ${label}`);
  if (!Array.isArray(value.top3) || value.top3.length > 3) {
    throw new Error(`Invalid analysis artifact comparison ${label} top results.`);
  }
  return {
    label: requireText(value.label, `comparison ${label} label`, 160),
    total: requireNumber(value.total, `comparison ${label} total`, { min: 0, max: 1_000_000_000 }),
    per10k: requireNumber(value.per10k, `comparison ${label} rate`, { min: 0, max: 1_000_000_000, nullable: true }),
    top3: value.top3.map(normalizeTopRow),
    delta30: requireNumber(value.delta30, `comparison ${label} delta`, { min: -1_000_000, max: 1_000_000, nullable: true }),
  };
}

function normalizeComparisonPointForCreation(value, label) {
  if (value == null) return null;
  if (!isPlainObject(value)) throw new Error(`Invalid analysis artifact comparison ${label}.`);
  return normalizeComparisonPoint({
    label: value.label || label,
    total: value.total,
    per10k: value.per10k ?? null,
    top3: value.top3 ?? [],
    delta30: value.delta30 ?? null,
  }, label);
}

function normalizeResultSummaryForCreation(value) {
  if (value == null) return null;
  if (!isPlainObject(value?.comparison)) throw new Error('Invalid analysis artifact comparison.');
  return {
    generatedAt: value.generatedAt,
    comparison: {
      a: normalizeComparisonPointForCreation(value.comparison.a, 'Point A'),
      b: normalizeComparisonPointForCreation(value.comparison.b, 'Point B'),
    },
  };
}

function normalizeResultSummary(value) {
  if (value == null) return null;
  if (!isPlainObject(value)) throw new Error('Invalid analysis artifact result summary.');
  requireKeys(value, new Set(['generatedAt', 'comparison']), 'result summary');
  const generatedAt = requireTimestamp(value.generatedAt, 'result generation timestamp');
  if (!isPlainObject(value.comparison)) throw new Error('Invalid analysis artifact comparison.');
  requireKeys(value.comparison, new Set(['a', 'b']), 'comparison');
  if (!Object.hasOwn(value.comparison, 'a') || !Object.hasOwn(value.comparison, 'b')) {
    throw new Error('Invalid analysis artifact comparison.');
  }
  return {
    generatedAt,
    comparison: {
      a: normalizeComparisonPoint(value.comparison.a, 'Point A'),
      b: normalizeComparisonPoint(value.comparison.b, 'Point B'),
    },
  };
}

function normalizeProvenance(value) {
  if (value == null) return {};
  if (!isPlainObject(value)) throw new Error('Invalid analysis artifact provenance.');
  requireKeys(value, new Set(['coverage', 'sources', 'tractSnapshot']), 'provenance');
  const provenance = {};
  if (value.coverage != null) {
    if (!isPlainObject(value.coverage)) throw new Error('Invalid analysis artifact provenance coverage.');
    requireKeys(value.coverage, new Set(['min', 'max']), 'provenance coverage');
    provenance.coverage = {
      min: value.coverage.min == null ? null : requireDate(value.coverage.min, 'coverage minimum'),
      max: value.coverage.max == null ? null : requireDate(value.coverage.max, 'coverage maximum'),
    };
  }
  if (value.sources != null) {
    if (!Array.isArray(value.sources) || value.sources.length > 32) {
      throw new Error('Invalid analysis artifact provenance sources.');
    }
    provenance.sources = value.sources.map((source) => requireText(source, 'source identifier', 160));
  }
  if (value.tractSnapshot != null) {
    const snapshot = value.tractSnapshot;
    if (!isPlainObject(snapshot)) throw new Error('Invalid analysis artifact tract snapshot provenance.');
    requireKeys(snapshot, new Set([
      'schemaVersion', 'start', 'end', 'generatedAt', 'coverageDate', 'rowCount',
      'sourceDataset', 'tractSource', 'geographyIdentity',
    ]), 'tract snapshot provenance');
    const normalizedSnapshot = {
      schemaVersion: requireNumber(snapshot.schemaVersion, 'tract snapshot schema version', { min: 1, max: 100, integer: true }),
      start: requireDate(snapshot.start, 'tract snapshot start'),
      end: requireDate(snapshot.end, 'tract snapshot end'),
      generatedAt: requireTimestamp(snapshot.generatedAt, 'tract snapshot generation timestamp'),
      coverageDate: requireDate(snapshot.coverageDate, 'tract snapshot coverage date'),
      rowCount: requireNumber(snapshot.rowCount, 'tract snapshot row count', { min: 1, max: 100_000, integer: true }),
      sourceDataset: requireText(snapshot.sourceDataset, 'tract snapshot source dataset', 160),
      tractSource: requireText(snapshot.tractSource, 'tract snapshot tract source', 240),
      geographyIdentity: requireText(snapshot.geographyIdentity, 'tract snapshot geography identity', 96),
    };
    const identity = normalizedSnapshot.geographyIdentity.match(/^fnv1a32:(\d+):[0-9a-f]{8}$/);
    if (
      normalizedSnapshot.start >= normalizedSnapshot.end
      || normalizedSnapshot.coverageDate < normalizedSnapshot.start
      || normalizedSnapshot.coverageDate >= normalizedSnapshot.end
      || normalizedSnapshot.generatedAt.slice(0, 10) < normalizedSnapshot.coverageDate
      || !identity
      || Number(identity[1]) !== normalizedSnapshot.rowCount
    ) {
      throw new Error('Invalid analysis artifact tract snapshot provenance semantics.');
    }
    provenance.tractSnapshot = normalizedSnapshot;
  }
  return provenance;
}

function normalizeProvenanceForCreation(value) {
  if (value == null) return {};
  if (!isPlainObject(value)) throw new Error('Invalid analysis artifact provenance.');
  const normalized = {};
  const coverage = value.coverage || (
    value.coverageMin != null || value.coverageMax != null
      ? { min: value.coverageMin ?? null, max: value.coverageMax ?? null }
      : null
  );
  if (coverage) normalized.coverage = coverage;
  if (value.sources != null) normalized.sources = value.sources;
  if (value.tractSnapshot != null) normalized.tractSnapshot = value.tractSnapshot;
  return normalizeProvenance(normalized);
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableJson(value[key])]),
  );
}

export function validateAnalysisArtifact(value) {
  if (!isPlainObject(value)) throw new Error('Invalid analysis artifact.');
  requireKeys(value, ARTIFACT_KEYS, 'root');
  if (value.kind !== ANALYSIS_ARTIFACT_KIND) throw new Error('Invalid analysis artifact kind.');
  if (value.schemaVersion !== ANALYSIS_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported analysis artifact schema version: ${value.schemaVersion}.`);
  }
  const artifact = {
    kind: ANALYSIS_ARTIFACT_KIND,
    schemaVersion: ANALYSIS_ARTIFACT_SCHEMA_VERSION,
    id: requireText(value.id, 'id', 160),
    title: requireText(value.title, 'title', ANALYSIS_TITLE_MAX_LENGTH),
    createdAt: requireTimestamp(value.createdAt, 'creation timestamp'),
    updatedAt: requireTimestamp(value.updatedAt, 'update timestamp'),
    viewState: validateViewState(value.viewState),
    resultSummary: normalizeResultSummary(value.resultSummary),
    provenance: normalizeProvenance(value.provenance),
  };
  if (Date.parse(artifact.updatedAt) < Date.parse(artifact.createdAt)) {
    throw new Error('Invalid analysis artifact timestamps.');
  }
  return artifact;
}

export function createAnalysisArtifact(input, {
  createId = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
} = {}) {
  const timestamp = now();
  return validateAnalysisArtifact({
    kind: ANALYSIS_ARTIFACT_KIND,
    schemaVersion: ANALYSIS_ARTIFACT_SCHEMA_VERSION,
    id: createId(),
    title: normalizeTitle(input?.title),
    createdAt: timestamp,
    updatedAt: timestamp,
    viewState: validateViewStateForCreation(input?.viewState),
    resultSummary: normalizeResultSummaryForCreation(input?.resultSummary ?? null),
    provenance: normalizeProvenanceForCreation(input?.provenance ?? {}),
  });
}

export function renameAnalysisArtifact(value, title, {
  now = () => new Date().toISOString(),
} = {}) {
  const artifact = validateAnalysisArtifact(value);
  return validateAnalysisArtifact({
    ...artifact,
    title: normalizeTitle(title),
    updatedAt: now(),
  });
}

export function canSaveAnalysis(state) {
  if (state?.coverageStatus !== 'ready') return false;
  if (state.queryMode === 'district') return /^\d{2}$/.test(state.selectedDistrictCode || '');
  if (state.queryMode === 'tract') return /^\d{11}$/.test(state.selectedTractGEOID || '');
  return Array.isArray(state.centerLonLat)
    && state.centerLonLat.length === 2
    && state.centerLonLat.every(Number.isFinite)
    && state.centerLonLat[0] >= -180
    && state.centerLonLat[0] <= 180
    && state.centerLonLat[1] >= -90
    && state.centerLonLat[1] <= 90;
}

export function deriveAnalysisDataStatus(savedProvenance, currentProvenance) {
  if (!isPlainObject(savedProvenance) || !isPlainObject(currentProvenance)) return 'unknown';
  const saved = JSON.stringify(stableJson(normalizeProvenanceForCreation(savedProvenance)));
  const current = JSON.stringify(stableJson(normalizeProvenanceForCreation(currentProvenance)));
  return saved === current ? 'current' : 'provenance-mismatch';
}
