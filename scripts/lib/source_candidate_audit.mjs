import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ACS_OUTPUT_PATH,
  buildSnapshot as buildAcsEstimateSnapshot,
  fetchOfficialRows,
} from '../fetch_acs_tracts.mjs';
import {
  ACS_VRE_OUTPUT_PATH,
  acquireRows as acquireOfficialVreRows,
  buildVreSnapshot,
} from '../fetch_acs_vre_b01003.mjs';
import {
  acquireOfficialHin2025,
  normalizeHin2025Snapshot,
  renderHin2025Snapshot,
} from './hin_2025_snapshot.mjs';
import {
  compareHin2025SemanticSnapshots,
  snapshotIdentity,
  validateHin2025Receipt,
} from './hin_2025_receipt.mjs';

export const SOURCE_CANDIDATE_AUDIT_SCHEMA = 'engagement-source-candidate-audit/v1';
export const HIN_CANDIDATE_RECEIPT_SCHEMA = 'phl-hin-2025-candidate-receipt/v1';
export const SOURCE_CANDIDATE_REQUEST_TIMEOUT_MS = 45_000;

const HIN_SNAPSHOT_PATH = path.join('public', 'data', 'hin_2025.snapshot.json');
const HIN_RECEIPT_PATH = path.join('public', 'data', 'hin_2025.receipt.json');

const SOURCE_DEFINITIONS = Object.freeze({
  acsEstimates: Object.freeze({
    sourceId: 'acs-tract-population',
    owner: 'U.S. Census Bureau',
    committedPath: ACS_OUTPUT_PATH,
    candidateName: 'acs_tracts_2024_pa101.candidate.json',
    sourceAsOf: '2024-12-31',
    contract: Object.freeze({
      release: '2024 ACS 5-year',
      period: '2020-2024',
      tableId: 'B01003',
      geography: 'Philadelphia County complete census tracts (state 42, county 101)',
      variables: Object.freeze(['B01003_001E', 'B01003_001M']),
    }),
  }),
  acsVre: Object.freeze({
    sourceId: 'acs-tract-population-vre',
    owner: 'U.S. Census Bureau',
    committedPath: ACS_VRE_OUTPUT_PATH,
    candidateName: 'acs_vre_b01003_2024_pa101.candidate.json',
    sourceAsOf: '2024-12-31',
    contract: Object.freeze({
      release: '2024 ACS 5-year',
      period: '2020-2024',
      tableId: 'B01003',
      summaryLevel: '140',
      geographyVintage: '2020 Census',
      replicateCount: 80,
    }),
  }),
  hin2025: Object.freeze({
    sourceId: 'hin-2025',
    owner: 'City of Philadelphia Office of Transportation and Infrastructure Systems',
    committedPath: HIN_SNAPSHOT_PATH,
    committedReceiptPath: HIN_RECEIPT_PATH,
    candidateName: 'hin_2025.candidate.snapshot.json',
    candidateReceiptName: 'hin_2025.candidate.receipt.json',
    contract: Object.freeze({
      itemId: '7e416319784a463fa0d8b528d7ccf511',
      layerId: 0,
      layerName: 'high_injury_network_2025',
      networkVintage: 2025,
      crashDataPeriod: Object.freeze([2019, 2023]),
    }),
  }),
});

const OWNED_OUTPUT_FILES = Object.freeze([
  SOURCE_DEFINITIONS.acsEstimates.candidateName,
  SOURCE_DEFINITIONS.acsVre.candidateName,
  SOURCE_DEFINITIONS.hin2025.candidateName,
  SOURCE_DEFINITIONS.hin2025.candidateReceiptName,
  'source-candidate-audit.json',
  'source-candidate-audit.md',
]);

const ACS_ESTIMATE_MANIFEST_FIELDS = Object.freeze([
  'dataset', 'vintage', 'period', 'geography', 'source', 'sourceUrl',
  'rowCount', 'variables', 'hashContract',
]);
const ACS_VRE_MANIFEST_FIELDS = Object.freeze([
  'dataset', 'release', 'period', 'geographyVintage', 'geography', 'summaryLevel',
  'tableId', 'indicator', 'replicateCount', 'source', 'sourceUrl',
  'documentationUrl', 'geographyUrl', 'accessedAt', 'rowCount', 'hashContract',
]);

export function compareAcsEstimateCandidates(committed, candidate) {
  return compareAcsCandidates(committed, candidate, ACS_ESTIMATE_MANIFEST_FIELDS);
}

export function compareAcsVreCandidates(committed, candidate) {
  return compareAcsCandidates(committed, candidate, ACS_VRE_MANIFEST_FIELDS);
}

function compareAcsCandidates(committed, candidate, manifestFields) {
  const reasons = [];
  if (committed?.schemaVersion !== candidate?.schemaVersion) reasons.push('snapshot-schema');
  for (const field of manifestFields) {
    if (JSON.stringify(committed?.manifest?.[field]) !== JSON.stringify(candidate?.manifest?.[field])) {
      reasons.push(`manifest-${field}`);
    }
  }
  if (committed?.manifest?.rowsSha256 !== candidate?.manifest?.rowsSha256
    || JSON.stringify(committed?.rows) !== JSON.stringify(candidate?.rows)) {
    reasons.push('row-content');
  }
  return Object.freeze({ changed: reasons.length > 0, reasons: Object.freeze(reasons) });
}

export function createHinCandidateReceipt({ candidate, comparison, observedAt } = {}) {
  const checkedAt = exactTimestamp(observedAt, 'HIN candidate audit observedAt');
  const identity = snapshotIdentity(candidate);
  return Object.freeze({
    schema: HIN_CANDIDATE_RECEIPT_SCHEMA,
    source: Object.freeze({
      sourceId: SOURCE_DEFINITIONS.hin2025.sourceId,
      owner: SOURCE_DEFINITIONS.hin2025.owner,
      itemId: SOURCE_DEFINITIONS.hin2025.contract.itemId,
      layerId: SOURCE_DEFINITIONS.hin2025.contract.layerId,
      layerName: SOURCE_DEFINITIONS.hin2025.contract.layerName,
      sourceAsOf: candidate.meta.layerDataEditedAt,
      sourceAsOfMeaning: 'ArcGIS layer dataLastEditDate; not the crash-data period, retrieval, build, review, or audit time.',
      networkVintage: candidate.meta.networkVintage,
      crashDataPeriod: Object.freeze([...candidate.meta.crashDataPeriod]),
    }),
    artifact: Object.freeze({
      schema: candidate.schema,
      identity: identity.identity,
      bytes: identity.bytes,
      retrievedAt: candidate.meta.retrievedAt,
      builtAt: null,
      featureCount: candidate.meta.featureCount,
      geometryCounts: Object.freeze({ ...candidate.meta.geometryCounts }),
    }),
    audit: Object.freeze({
      observedAt: checkedAt,
      status: comparison.changed ? 'review-required' : 'unchanged',
      reasons: Object.freeze([...comparison.reasons]),
    }),
    admission: Object.freeze({
      status: 'not-admitted',
      requiresHumanReview: comparison.changed,
      reviewedAt: null,
      reviewedBy: null,
    }),
  });
}

export async function auditSourceCandidates({
  outputDirectory,
  repositoryRoot = process.cwd(),
  observedAt = new Date().toISOString(),
  acquisitions = {},
} = {}) {
  const checkedAt = exactTimestamp(observedAt, 'source candidate audit observedAt');
  if (typeof outputDirectory !== 'string' || !outputDirectory.trim()) {
    throw new TypeError('source candidate audit outputDirectory is required');
  }
  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  await Promise.all(OWNED_OUTPUT_FILES.map((name) => (
    rm(path.join(outputRoot, name), { force: true })
  )));

  const acquireAcsEstimates = acquisitions.acsEstimates || (async () => (
    buildAcsEstimateSnapshot(
      await fetchOfficialRows({ timeoutMs: SOURCE_CANDIDATE_REQUEST_TIMEOUT_MS }),
      { retrievedAt: checkedAt },
    )
  ));
  const acquireAcsVre = acquisitions.acsVre || (async () => (
    buildVreSnapshot(
      await acquireOfficialVreRows(null, { timeoutMs: SOURCE_CANDIDATE_REQUEST_TIMEOUT_MS }),
      { retrievedAt: checkedAt },
    )
  ));
  const acquireHin2025 = acquisitions.hin2025 || (async () => (
    normalizeHin2025Snapshot({
      ...(await acquireOfficialHin2025({ timeoutMs: SOURCE_CANDIDATE_REQUEST_TIMEOUT_MS })),
      retrievedAt: checkedAt,
    })
  ));

  const results = [];
  results.push(await auditAcsSource({
    definition: SOURCE_DEFINITIONS.acsEstimates,
    repositoryRoot,
    outputRoot,
    observedAt: checkedAt,
    acquire: acquireAcsEstimates,
    compare: compareAcsEstimateCandidates,
  }));
  results.push(await auditAcsSource({
    definition: SOURCE_DEFINITIONS.acsVre,
    repositoryRoot,
    outputRoot,
    observedAt: checkedAt,
    acquire: acquireAcsVre,
    compare: compareAcsVreCandidates,
  }));
  results.push(await auditHinSource({
    definition: SOURCE_DEFINITIONS.hin2025,
    repositoryRoot,
    outputRoot,
    observedAt: checkedAt,
    acquire: acquireHin2025,
  }));

  const status = results.some((result) => result.status === 'audit-failed')
    ? 'failed'
    : results.some((result) => result.status === 'review-required')
      ? 'review-required'
      : 'unchanged';
  return Object.freeze({
    schema: SOURCE_CANDIDATE_AUDIT_SCHEMA,
    mode: 'candidate-only',
    observedAt: checkedAt,
    status,
    releaseGate: false,
    admission: Object.freeze({
      automatic: false,
      semanticChangesRequireHumanReview: true,
      rollbackSource: 'the prior committed snapshot/receipt remains untouched',
    }),
    sources: Object.freeze(results),
  });
}

async function auditAcsSource({
  definition, repositoryRoot, outputRoot, observedAt, acquire, compare,
}) {
  try {
    const committed = await readJson(path.resolve(repositoryRoot, definition.committedPath));
    const candidate = await acquire({ observedAt });
    const comparison = compare(committed, candidate);
    const candidateFile = comparison.changed ? definition.candidateName : null;
    if (candidateFile) await writeJson(path.join(outputRoot, candidateFile), candidate);
    return freezeResult({
      sourceId: definition.sourceId,
      owner: definition.owner,
      contract: definition.contract,
      committedPath: portablePath(definition.committedPath),
      status: comparison.changed ? 'review-required' : 'unchanged',
      changes: comparison.reasons,
      clocks: {
        sourceAsOf: definition.sourceAsOf,
        retrievedAt: candidate.manifest?.retrievedAt || null,
        builtAt: null,
        observedAt,
      },
      identity: {
        committed: committed.manifest?.rowsSha256 || null,
        candidate: candidate.manifest?.rowsSha256 || null,
      },
      candidate: candidateFile ? { snapshot: candidateFile, receipt: null } : null,
      admission: {
        status: comparison.changed ? 'pending-human-review' : 'unchanged',
        requiresHumanReview: comparison.changed,
        reviewedAt: null,
        reviewedBy: null,
      },
      error: null,
    });
  } catch (error) {
    return failedResult(definition, observedAt, error);
  }
}

async function auditHinSource({
  definition, repositoryRoot, outputRoot, observedAt, acquire,
}) {
  try {
    const committed = await readJson(path.resolve(repositoryRoot, definition.committedPath));
    const committedReceipt = await readJson(path.resolve(repositoryRoot, definition.committedReceiptPath));
    validateHin2025Receipt(committedReceipt, { snapshot: committed });
    const candidate = await acquire({ observedAt });
    const comparison = compareHin2025SemanticSnapshots(committed, candidate);
    const candidateIdentity = snapshotIdentity(candidate);
    let candidateFiles = null;
    if (comparison.changed) {
      const candidateReceipt = createHinCandidateReceipt({ candidate, comparison, observedAt });
      await writeFile(path.join(outputRoot, definition.candidateName), renderHin2025Snapshot(candidate).text, 'utf8');
      await writeJson(path.join(outputRoot, definition.candidateReceiptName), candidateReceipt);
      candidateFiles = {
        snapshot: definition.candidateName,
        receipt: definition.candidateReceiptName,
      };
    }
    return freezeResult({
      sourceId: definition.sourceId,
      owner: definition.owner,
      contract: definition.contract,
      committedPath: portablePath(definition.committedPath),
      committedReceiptPath: portablePath(definition.committedReceiptPath),
      status: comparison.changed ? 'review-required' : 'unchanged',
      changes: comparison.reasons,
      clocks: {
        sourceAsOf: candidate.meta.layerDataEditedAt,
        retrievedAt: candidate.meta.retrievedAt,
        builtAt: null,
        observedAt,
      },
      identity: {
        committed: committedReceipt.artifact.identity,
        candidate: candidateIdentity.identity,
      },
      candidate: candidateFiles,
      admission: {
        status: comparison.changed ? 'pending-human-review' : 'unchanged',
        requiresHumanReview: comparison.changed,
        reviewedAt: null,
        reviewedBy: null,
      },
      error: null,
    });
  } catch (error) {
    return failedResult(definition, observedAt, error);
  }
}

function failedResult(definition, observedAt, error) {
  return freezeResult({
    sourceId: definition.sourceId,
    owner: definition.owner,
    contract: definition.contract,
    committedPath: portablePath(definition.committedPath),
    ...(definition.committedReceiptPath
      ? { committedReceiptPath: portablePath(definition.committedReceiptPath) }
      : {}),
    status: 'audit-failed',
    changes: Object.freeze([]),
    clocks: { sourceAsOf: null, retrievedAt: null, builtAt: null, observedAt },
    identity: { committed: null, candidate: null },
    candidate: null,
    admission: {
      status: 'blocked-pending-human-review',
      requiresHumanReview: true,
      reviewedAt: null,
      reviewedBy: null,
    },
    error: boundedError(error),
  });
}

export function formatSourceCandidateAudit(report) {
  const lines = [
    '# Source candidate audit',
    '',
    `- Result: **${report.status}**`,
    `- Observed at: ${report.observedAt}`,
    '- Mode: candidate-only; not a release gate and not an admission action.',
    '',
  ];
  for (const source of report.sources) {
    lines.push(`## ${source.sourceId}: ${source.status}`, '');
    lines.push(`- Source owner: ${source.owner}`);
    lines.push(`- Human review required: ${source.admission.requiresHumanReview ? 'yes' : 'no'}`);
    lines.push(`- Changes: ${source.changes.length ? source.changes.join(', ') : 'none admitted'}`);
    if (source.candidate) lines.push(`- Candidate: ${source.candidate.snapshot}${source.candidate.receipt ? `; ${source.candidate.receipt}` : ''}`);
    if (source.error) lines.push(`- Audit error: ${source.error}`);
    lines.push('');
  }
  lines.push('No committed artifact was changed. Any semantic change remains pending explicit human review.', '');
  return lines.join('\n');
}

export async function writeSourceCandidateAudit(outputDirectory, report) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeJson(path.join(outputDirectory, 'source-candidate-audit.json'), report),
    writeFile(
      path.join(outputDirectory, 'source-candidate-audit.md'),
      formatSourceCandidateAudit(report),
      'utf8',
    ),
  ]);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function exactTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())
    || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} must be an exact ISO timestamp`);
  }
  return value;
}

function portablePath(value) {
  return String(value).replaceAll('\\', '/');
}

function boundedError(error) {
  return String(error?.message || error || 'unknown audit failure')
    .replace(/\s+/g, ' ')
    .slice(0, 1000);
}

function freezeResult(value) {
  return Object.freeze(structuredClone(value));
}
