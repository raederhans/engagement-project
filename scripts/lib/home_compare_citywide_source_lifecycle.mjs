import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { validateHomeCompareSourceRegistry } from '../../src/home_compare/source_registry.js';
import { validateCrimeWarehouseAdmissionReceipt } from './crime_event_warehouse.mjs';
import { assertTaskOwnedDfev1Path } from './dfev1_path.mjs';
import { validateHin2025Receipt } from './hin_2025_receipt.mjs';
import { validateHin2025Snapshot } from './hin_2025_snapshot.mjs';

export const HOME_COMPARE_CITYWIDE_LIFECYCLE_SCHEMA =
  'engagement-home-compare-citywide-source-lifecycle/v1';
export const HOME_COMPARE_CITYWIDE_SOURCE_RECEIPT_SCHEMA =
  'engagement-home-compare-citywide-source-receipt/v1';
export const HOME_COMPARE_SOURCE_SMOKE_SCHEMA = 'engagement-home-compare-source-smoke/v1';
export const HOME_COMPARE_SOURCE_IDS = Object.freeze([
  'citygeo-address-locator',
  'opa-current-property',
  'opa-assessment-history',
  'real-estate-transfers',
  'philly311-requests',
  'li-property-history',
  'vacant-property-indicators',
  'philadelphia-reported-crime',
  'vision-zero-hin-2025',
]);

const OBSERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FRESHNESS_DAYS = Object.freeze({
  'citygeo-address-locator': 1,
  'opa-current-property': 2,
  'opa-assessment-history': 45,
  'real-estate-transfers': 7,
  'philly311-requests': 2,
  'li-property-history': 3,
  'vacant-property-indicators': 45,
  'philadelphia-reported-crime': 14,
  'vision-zero-hin-2025': 366,
});
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const OBSERVATION_KEYS = [
  'sourceId', 'status', 'dataset', 'transport', 'retrievedAt', 'sourceAsOf',
  'revision', 'rowCount', 'schemaFields', 'missingFields', 'dq',
];
const MANIFEST_KEYS = [
  'schema', 'generatedAt', 'status', 'semanticIdentity', 'observations',
  'routing', 'privacy', 'limitations',
];
const AUTHORITY = Object.freeze({
  product_authority: false,
  publication_authority: false,
  redistribution_authority: false,
  safety_authority: false,
  routing_authority: false,
});
const CLAIMS = Object.freeze({
  full_snapshot_claimed: false,
  current_safety_claimed: false,
  raw_crash_data_claimed: false,
  routing_claimed: false,
});

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;

const schema = JSON.parse(await fs.readFile(
  new URL('../data/home_compare_citywide_source_lifecycle.schema.json', import.meta.url),
  'utf8',
));
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateSchema = ajv.compile(schema);

export async function loadHomeCompareCitywideLifecycleInputs({
  registryPath,
  observationPath,
  m1Root,
  m1ReceiptPath,
  hinSnapshotPath,
  hinReceiptPath,
  validationClock,
  expectedObservationIdentity,
  expectedObservationSha256,
  m1Validator = validateCrimeWarehouseAdmissionReceipt,
  hinSnapshotValidator = validateHin2025Snapshot,
  hinReceiptValidator = validateHin2025Receipt,
} = {}) {
  const validationTime = exactTimestamp(validationClock, 'validation clock');
  const registryArtifact = await readJsonArtifact(registryPath, 'Home Compare source registry');
  const registry = validateHomeCompareSourceRegistry(registryArtifact.value);
  validateRegistryLicenceBoundary(registry);
  const observationArtifact = await readJsonArtifact(observationPath, 'Home Compare source observation');
  const observation = validateObservationManifest(
    observationArtifact.value,
    registry,
    validationTime,
  );
  if (!SHA256.test(expectedObservationIdentity || '')
    || observation.semanticIdentity !== expectedObservationIdentity) {
    throw new Error('Home Compare source observation does not match the explicitly expected semantic identity.');
  }
  if (!SHA256.test(expectedObservationSha256 || '')
    || observationArtifact.sha256 !== expectedObservationSha256) {
    throw new Error('Home Compare source observation does not match the explicitly expected exact file SHA-256.');
  }
  const m1Admission = await loadExactM1Admission({
    root: m1Root,
    receiptPath: m1ReceiptPath,
    validator: m1Validator,
  });
  const hinAdmission = await loadExactHinAdmission({
    snapshotPath: hinSnapshotPath,
    receiptPath: hinReceiptPath,
    snapshotValidator: hinSnapshotValidator,
    receiptValidator: hinReceiptValidator,
  });
  return Object.freeze({
    registry: Object.freeze({
      value: registry,
      sha256: registryArtifact.sha256,
      bytes: registryArtifact.bytes,
    }),
    observation: Object.freeze({
      value: observation,
      sha256: observationArtifact.sha256,
      bytes: observationArtifact.bytes,
    }),
    m1Admission,
    hinAdmission,
  });
}

export function buildHomeCompareCitywideSourceLifecycle({
  registry,
  observation,
  m1Admission,
  hinAdmission,
} = {}) {
  validateArtifactEnvelope(registry, 'registry');
  validateArtifactEnvelope(observation, 'observation');
  const admittedRegistry = validateHomeCompareSourceRegistry(registry.value);
  validateRegistryLicenceBoundary(admittedRegistry);
  const admittedObservation = validateObservationManifest(
    observation.value,
    admittedRegistry,
    observation.value.generatedAt,
  );
  validateM1AdmissionShape(m1Admission);
  validateHinAdmissionShape(hinAdmission);

  const receipts = admittedRegistry.sources.map((source, ordinal) => {
    const observed = admittedObservation.observations[ordinal];
    if (source.id === 'philadelphia-reported-crime') {
      return createM1Receipt(source, observed, ordinal, admittedObservation, m1Admission);
    }
    if (source.id === 'vision-zero-hin-2025') {
      return createHinReceipt(source, observed, ordinal, admittedObservation, hinAdmission);
    }
    return createBoundedMetadataReceipt(source, observed, ordinal, admittedObservation);
  });
  if (stableStringify(receipts.map(({ source_id: sourceId }) => sourceId))
    !== stableStringify(HOME_COMPARE_SOURCE_IDS)) {
    throw new Error('Citywide lifecycle source order drifted from the nine-source registry.');
  }
  assertIndependentIdentities(receipts);
  const evidence = {
    schema: HOME_COMPARE_CITYWIDE_LIFECYCLE_SCHEMA,
    registry: {
      schema: admittedRegistry.schema,
      sha256: registry.sha256,
      bytes: registry.bytes,
    },
    observation: {
      schema: admittedObservation.schema,
      semantic_identity: admittedObservation.semanticIdentity,
      sha256: observation.sha256,
      bytes: observation.bytes,
      generated_at: admittedObservation.generatedAt,
    },
    status: receipts.every(({ status }) => status === 'unavailable') ? 'unavailable' : 'partial',
    scope: 'philadelphia-citywide-aggregate-metadata',
    receipts,
    privacy: {
      aggregate_metadata_only: true,
      source_rows_included: false,
      private_values_included: false,
    },
    authority: { ...AUTHORITY },
    limitations: [
      'Bounded metadata observations are not full source snapshots, completeness proof, or product authority.',
      'PPD and HIN entries only reuse their separately validated local admission receipts.',
      'No output authorizes publication, redistribution, safety inference, routing, or row-level serving.',
    ],
  };
  const lifecycle = { ...evidence, identity: identityOf(evidence) };
  return validateHomeCompareCitywideSourceLifecycle(lifecycle);
}

export function validateHomeCompareCitywideSourceLifecycle(value) {
  if (!validateSchema(value)) {
    throw new Error(`Citywide lifecycle schema validation failed: ${ajv.errorsText(validateSchema.errors)}`);
  }
  if (stableStringify(value.receipts.map(({ source_id: sourceId }) => sourceId))
    !== stableStringify(HOME_COMPARE_SOURCE_IDS)) {
    throw new Error('Citywide lifecycle must contain the complete ordered nine-source set.');
  }
  if (stableStringify(value.authority) !== stableStringify(AUTHORITY)
    || value.privacy.aggregate_metadata_only !== true
    || value.privacy.source_rows_included !== false
    || value.privacy.private_values_included !== false) {
    throw new Error('Citywide lifecycle changed its privacy or authority boundary.');
  }
  for (const receipt of value.receipts) {
    validateSourceReceiptSemantics(receipt);
    validateSourceReceiptIdentity(receipt);
  }
  assertIndependentIdentities(value.receipts);
  const evidence = structuredClone(value);
  delete evidence.identity;
  if (value.identity !== identityOf(evidence)) {
    throw new Error('Citywide lifecycle identity drifted from its exact receipt set.');
  }
  return Object.freeze(structuredClone(value));
}

export async function writeHomeCompareCitywideSourceLifecycle(outputPath, lifecycle, {
  workspace = process.cwd(),
  fileSystem = fs,
} = {}) {
  const target = await assertTaskOwnedDfev1Path(outputPath, {
    workspace,
    label: 'Home Compare citywide lifecycle output',
  });
  const admitted = validateHomeCompareCitywideSourceLifecycle(lifecycle);
  const text = `${JSON.stringify(admitted, null, 2)}\n`;
  let existing;
  try {
    existing = await fileSystem.readFile(target);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (existing) {
    if (existing.equals(Buffer.from(text))) {
      return Object.freeze({ status: 'idempotent', outputPath: target, bytes: existing.length });
    }
    throw new Error('Home Compare citywide lifecycle output already exists with different bytes; refusing overwrite.');
  }
  await fileSystem.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  let result;
  try {
    await fileSystem.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
    try {
      await fileSystem.link(temporary, target);
      result = Object.freeze({
        status: 'published',
        outputPath: target,
        bytes: Buffer.byteLength(text),
      });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = await fileSystem.readFile(target);
      if (!current.equals(Buffer.from(text))) {
        throw new Error('Home Compare citywide lifecycle output already exists with different bytes; refusing overwrite.');
      }
      result = Object.freeze({ status: 'idempotent', outputPath: target, bytes: current.length });
    }
  } finally {
    await fileSystem.rm(temporary, { force: true });
  }
  return result;
}

export function validateObservationManifest(value, registry, validationClock) {
  exactObject(value, MANIFEST_KEYS, 'source observation manifest');
  if (value.schema !== HOME_COMPARE_SOURCE_SMOKE_SCHEMA || !['partial', 'unavailable'].includes(value.status)
    || !SHA256.test(value.semanticIdentity || '') || !Array.isArray(value.observations)
    || value.observations.length !== HOME_COMPARE_SOURCE_IDS.length) {
    throw new Error('Home Compare source observation manifest contract is invalid.');
  }
  const generatedAt = exactTimestamp(value.generatedAt, 'observation generatedAt');
  const validatedAt = exactTimestamp(validationClock, 'validation clock');
  const age = Date.parse(validatedAt) - Date.parse(generatedAt);
  if (age < 0 || age > OBSERVATION_MAX_AGE_MS) {
    throw new Error('Home Compare source observation manifest is stale or future-dated.');
  }
  if (stableStringify(value.routing) !== stableStringify(registry.routing)
    || stableStringify(value.privacy) !== stableStringify(registry.privacy)) {
    throw new Error('Home Compare source observation privacy or routing contract drifted.');
  }
  if (!Array.isArray(value.limitations) || value.limitations.length !== 2
    || value.limitations.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('Home Compare source observation limitations are invalid.');
  }
  const observations = value.observations.map((observed, index) => {
    const source = registry.sources[index];
    validateObservation(observed, source, generatedAt);
    return observed;
  });
  const computedStatus = observations.every(({ status }) => status === 'unavailable')
    ? 'unavailable' : 'partial';
  if (value.status !== computedStatus) throw new Error('Home Compare source observation aggregate status drifted.');
  const semantic = {
    schema: value.schema,
    status: value.status,
    observations: observations.map(({ retrievedAt: _clock, ...observed }) => observed),
    routing: value.routing,
    privacy: value.privacy,
  };
  if (value.semanticIdentity !== identityOf(semantic)) {
    throw new Error('Home Compare source observation semantic identity drifted.');
  }
  return structuredClone(value);
}

async function loadExactM1Admission({ root, receiptPath, validator }) {
  requirePath(root, 'M1 root');
  const artifact = await readJsonArtifact(receiptPath, 'M1 admission receipt');
  const admitted = await validator(root);
  if (!admitted?.receipt || !admitted.path || admitted.bytes !== artifact.bytes
    || admitted.sha256 !== artifact.sha256
    || path.resolve(admitted.path) !== path.resolve(receiptPath)
    || stableStringify(admitted.receipt) !== stableStringify(artifact.value)) {
    throw new Error('M1 admission receipt path, bytes, hash, or validated identity drifted.');
  }
  const result = {
    receipt: structuredClone(admitted.receipt),
    receipt_artifact: { sha256: artifact.sha256, bytes: artifact.bytes },
  };
  validateM1AdmissionShape(result);
  return Object.freeze(result);
}

async function loadExactHinAdmission({
  snapshotPath,
  receiptPath,
  snapshotValidator,
  receiptValidator,
}) {
  const snapshotArtifact = await readJsonArtifact(snapshotPath, 'HIN snapshot');
  const receiptArtifact = await readJsonArtifact(receiptPath, 'HIN receipt');
  snapshotValidator(snapshotArtifact.value);
  const receipt = receiptValidator(receiptArtifact.value, { snapshot: snapshotArtifact.value });
  if (stableStringify(receipt) !== stableStringify(receiptArtifact.value)
    || receipt.artifact?.bytes !== snapshotArtifact.bytes
    || receipt.artifact?.identity !== snapshotArtifact.sha256) {
    throw new Error('HIN snapshot and receipt are not an exact validated byte pair.');
  }
  const result = {
    receipt: structuredClone(receipt),
    snapshot_artifact: { sha256: snapshotArtifact.sha256, bytes: snapshotArtifact.bytes },
    receipt_artifact: { sha256: receiptArtifact.sha256, bytes: receiptArtifact.bytes },
  };
  validateHinAdmissionShape(result);
  return Object.freeze(result);
}

function createBoundedMetadataReceipt(source, observed, ordinal, manifest) {
  const registryIdentity = identityOf(source);
  const schemaIdentity = identityOf(observed.schemaFields);
  const sourceFreshness = freshness(observed.sourceAsOf, manifest.generatedAt, FRESHNESS_DAYS[source.id]);
  const geocoder = source.id === 'citygeo-address-locator';
  const unavailable = geocoder || observed.status === 'unavailable' || sourceFreshness.status === 'stale';
  const status = unavailable ? 'unavailable' : 'partial';
  const flags = [...observed.dq];
  if (geocoder) flags.push('citywide-geocoder-snapshot-unavailable');
  if (sourceFreshness.status === 'stale') flags.push('source-stale-fail-closed');
  flags.push(
    'exact-payload-not-admitted',
    'mutable-row-count-is-not-monotonic-or-completeness-authority',
    'redistribution-licence-not-admitted',
  );
  const semantic = sourceReceiptSemantic({
    source,
    ordinal,
    registryIdentity,
    status,
    evidenceKind: 'bounded-metadata-observation',
    sourceRevision: observed.revision,
    payloadIdentity: null,
    schemaIdentity,
    freshnessValue: sourceFreshness,
    coverage: {
      scope: 'citywide',
      status: unavailable ? 'unavailable' : 'bounded-metadata-only',
      row_count: unavailable ? null : observed.rowCount,
      available_zero: false,
      exact_payload: false,
      completeness_admitted: false,
    },
    dq: {
      status: unavailable ? 'unavailable' : 'partial',
      observed_field_count: observed.schemaFields.length,
      missing_fields: [...observed.missingFields],
      flags: uniqueSorted(flags),
    },
    reuse: emptyReuse(),
  });
  return finishSourceReceipt(semantic, {
    source_as_of: observed.sourceAsOf,
    retrieved_at: observed.retrievedAt,
    built_at: null,
    observed_at: manifest.generatedAt,
  });
}

function createM1Receipt(source, observed, ordinal, manifest, admission) {
  const receipt = admission.receipt;
  if (receipt.source?.source_table !== source.dataset
    || receipt.source?.revision !== receipt.warehouse?.current_snapshot_id
    || receipt.serving_eligible !== false
    || receipt.authority?.serving_authority !== false
    || receipt.authority?.integration_authority !== false) {
    throw new Error('PPD M1 admission source or authority does not match the Home Compare registry.');
  }
  validateClockNotAfter(receipt.clocks?.observed_at, manifest.generatedAt, 'PPD M1 observation clock');
  const sourceFreshness = freshness(
    receipt.clocks.source_as_of,
    manifest.generatedAt,
    FRESHNESS_DAYS[source.id],
  );
  const unavailable = sourceFreshness.status === 'stale';
  const rowCount = unavailable ? null : receipt.counts?.canonical_rows;
  finiteCount(receipt.counts?.canonical_rows, 'PPD M1 canonical row count');
  const observationFlags = [];
  if (observed.revision === null) observationFlags.push('bounded-observation-source-revision-unavailable');
  if (observed.rowCount !== null && observed.rowCount !== receipt.counts.canonical_rows) {
    observationFlags.push('bounded-observation-count-differs-from-exact-m1-no-delta-claim');
  }
  const semantic = sourceReceiptSemantic({
    source,
    ordinal,
    registryIdentity: identityOf(source),
    status: unavailable ? 'unavailable' : rowCount === 0 ? 'available-zero' : 'available',
    evidenceKind: 'm1-warehouse-admission-receipt',
    sourceRevision: receipt.source.revision,
    payloadIdentity: receipt.artifacts?.canonical?.sha256,
    schemaIdentity: receipt.artifacts?.current_source_manifest?.sha256,
    freshnessValue: sourceFreshness,
    coverage: {
      scope: 'citywide',
      status: unavailable ? 'unavailable' : 'complete-exact-receipt',
      row_count: rowCount,
      available_zero: !unavailable && rowCount === 0,
      exact_payload: true,
      completeness_admitted: !unavailable,
    },
    dq: {
      status: unavailable ? 'unavailable' : 'pass',
      observed_field_count: observed.schemaFields.length,
      missing_fields: [...observed.missingFields],
      flags: uniqueSorted([
        'exact-m1-warehouse-admission-receipt-reused',
        'serving-authority-false',
        ...observationFlags,
        ...(unavailable ? ['source-stale-fail-closed'] : []),
      ]),
    },
    reuse: {
      kind: 'm1-warehouse-admission-receipt',
      receipt_identity: receipt.identity,
      receipt_sha256: admission.receipt_artifact.sha256,
      receipt_bytes: admission.receipt_artifact.bytes,
      payload_sha256: receipt.artifacts.canonical.sha256,
      payload_bytes: receipt.artifacts.canonical.bytes,
    },
  });
  return finishSourceReceipt(semantic, receipt.clocks);
}

function createHinReceipt(source, observed, ordinal, manifest, admission) {
  const receipt = admission.receipt;
  if (receipt.source?.layerName !== source.dataset.split('/')[0]
    || !sameArcgisLayerUrl(receipt.source?.layerUrl, source.api_url)) {
    throw new Error('HIN admission source does not match the Home Compare registry.');
  }
  validateClockNotAfter(receipt.artifact?.retrievedAt, manifest.generatedAt, 'HIN retrieval clock');
  const sourceFreshness = freshness(
    receipt.source.sourceAsOf,
    manifest.generatedAt,
    FRESHNESS_DAYS[source.id],
  );
  const expectedObservationRevision = `arcgis-last-edit:${Date.parse(receipt.source.sourceAsOf)}`;
  const revisionDrift = observed.revision !== null && observed.revision !== expectedObservationRevision;
  const unavailable = sourceFreshness.status === 'stale' || revisionDrift;
  const reviewComplete = receipt.review?.status === 'admitted-after-review'
    && receipt.review.reviewedAt !== null
    && receipt.review.reviewedBy !== null
    && receipt.artifact.builtAt !== null
    && receipt.artifact.buildClockStatus === 'recorded-at-admitted-build';
  const reviewIncomplete = !unavailable && !reviewComplete;
  const rowCount = unavailable ? null : receipt.artifact.featureCount;
  finiteCount(receipt.artifact.featureCount, 'HIN feature count');
  const observationFlags = [];
  if (observed.revision === null) observationFlags.push('bounded-observation-source-revision-unavailable');
  if (revisionDrift) {
    observationFlags.push('bounded-observation-revision-differs-from-exact-hin-fail-closed');
  }
  if (observed.rowCount !== null && observed.rowCount !== receipt.artifact.featureCount) {
    observationFlags.push('bounded-observation-count-differs-from-exact-hin-no-delta-claim');
  }
  const semantic = sourceReceiptSemantic({
    source,
    ordinal,
    registryIdentity: identityOf(source),
    status: unavailable ? 'unavailable' : reviewIncomplete ? 'partial'
      : rowCount === 0 ? 'available-zero' : 'available',
    evidenceKind: 'hin-snapshot-receipt',
    sourceRevision: `arcgis-data-edit:${receipt.source.sourceAsOf}`,
    payloadIdentity: receipt.artifact.identity,
    schemaIdentity: identityOf(receipt.source.fields),
    freshnessValue: sourceFreshness,
    coverage: {
      scope: 'citywide',
      status: unavailable ? 'unavailable' : reviewIncomplete
        ? 'exact-receipt-review-incomplete' : 'complete-exact-receipt',
      row_count: rowCount,
      available_zero: !unavailable && !reviewIncomplete && rowCount === 0,
      exact_payload: true,
      completeness_admitted: !unavailable && !reviewIncomplete,
    },
    dq: {
      status: unavailable ? 'unavailable' : reviewIncomplete ? 'partial' : 'pass',
      observed_field_count: observed.schemaFields.length,
      missing_fields: [...observed.missingFields],
      flags: uniqueSorted([
        'exact-hin-snapshot-and-receipt-reused',
        'snapshot-local-identities-not-exported',
        'not-raw-crash-data',
        'not-current-safety-evidence',
        ...(reviewIncomplete ? [
          'hin-lifecycle-review-incomplete',
          'hin-build-clock-not-recorded',
          'hin-review-clock-not-recorded',
        ] : []),
        ...observationFlags,
        ...(unavailable ? ['source-stale-fail-closed'] : []),
      ]),
    },
    reuse: {
      kind: 'hin-snapshot-receipt',
      receipt_identity: receipt.artifact.identity,
      receipt_sha256: admission.receipt_artifact.sha256,
      receipt_bytes: admission.receipt_artifact.bytes,
      payload_sha256: admission.snapshot_artifact.sha256,
      payload_bytes: admission.snapshot_artifact.bytes,
    },
  });
  return finishSourceReceipt(semantic, {
    source_as_of: receipt.source.sourceAsOf,
    retrieved_at: receipt.artifact.retrievedAt,
    built_at: receipt.artifact.builtAt,
    observed_at: manifest.generatedAt,
  });
}

function sourceReceiptSemantic({
  source,
  ordinal,
  registryIdentity,
  status,
  evidenceKind,
  sourceRevision,
  payloadIdentity,
  schemaIdentity,
  freshnessValue,
  coverage,
  dq,
  reuse,
}) {
  return {
    schema: HOME_COMPARE_CITYWIDE_SOURCE_RECEIPT_SCHEMA,
    source_id: source.id,
    ordinal,
    registry_source_identity: registryIdentity,
    status,
    evidence_kind: evidenceKind,
    identity: {
      source_revision: sourceRevision,
      payload_identity: payloadIdentity,
      schema_identity: schemaIdentity,
    },
    freshness: freshnessValue,
    coverage,
    dq,
    licence: {
      status: 'not-admitted-for-redistribution',
      redistribution_authority: false,
    },
    reuse,
    claims: { ...CLAIMS },
    authority: { ...AUTHORITY },
  };
}

function finishSourceReceipt(semantic, clocks) {
  const semanticIdentity = sourceSemanticIdentityOf(semantic);
  const evidence = {
    ...semantic,
    semantic_identity: semanticIdentity,
    clocks: normalizeClocks(clocks),
  };
  return { ...evidence, receipt_identity: identityOf(evidence) };
}

function validateObservation(value, source, generatedAt) {
  exactObject(value, OBSERVATION_KEYS, `observation ${source.id}`);
  if (value.sourceId !== source.id || value.dataset !== source.dataset
    || value.transport !== source.transport || !['partial', 'unavailable'].includes(value.status)) {
    throw new Error(`Observation source identity drifted for ${source.id}.`);
  }
  stringArray(value.schemaFields, `${source.id} schemaFields`, 250);
  stringArray(value.missingFields, `${source.id} missingFields`, 250);
  stringArray(value.dq, `${source.id} dq`, 50);
  const expectedMissing = source.expected_fields.filter((field) => !value.schemaFields.includes(field));
  if (stableStringify(value.missingFields) !== stableStringify(expectedMissing)) {
    throw new Error(`Observation schema drift declaration is invalid for ${source.id}.`);
  }
  if (value.retrievedAt !== null) validateClockNotAfter(value.retrievedAt, generatedAt, `${source.id} retrievedAt`);
  if (value.sourceAsOf !== null) {
    const ceiling = value.retrievedAt || generatedAt;
    validateClockNotAfter(value.sourceAsOf, ceiling, `${source.id} sourceAsOf`);
  }
  if (value.revision !== null && (typeof value.revision !== 'string' || !value.revision.trim()
    || value.revision.length > 240)) throw new Error(`${source.id} revision is invalid.`);
  if (value.rowCount !== null) finiteCount(value.rowCount, `${source.id} row count`);
  if (value.status === 'partial') {
    if (value.retrievedAt === null || expectedMissing.length || value.rowCount === null
      && source.id !== 'citygeo-address-locator') {
      throw new Error(`Partial observation contract is invalid for ${source.id}.`);
    }
  } else if (value.rowCount !== null || expectedMissing.length === 0 && value.retrievedAt === null) {
    throw new Error(`Unavailable observation must keep row count null for ${source.id}.`);
  }
}

function validateSourceReceiptIdentity(receipt) {
  const expectedOrdinal = HOME_COMPARE_SOURCE_IDS.indexOf(receipt.source_id);
  if (expectedOrdinal !== receipt.ordinal) throw new Error(`Source receipt ordinal drifted for ${receipt.source_id}.`);
  const semantic = structuredClone(receipt);
  delete semantic.semantic_identity;
  delete semantic.clocks;
  delete semantic.receipt_identity;
  if (receipt.semantic_identity !== sourceSemanticIdentityOf(semantic)) {
    throw new Error(`Source semantic identity drifted for ${receipt.source_id}.`);
  }
  const evidence = structuredClone(receipt);
  delete evidence.receipt_identity;
  if (receipt.receipt_identity !== identityOf(evidence)) {
    throw new Error(`Source receipt identity drifted for ${receipt.source_id}.`);
  }
  if (receipt.status === 'unavailable'
    && (receipt.coverage.row_count !== null || receipt.coverage.available_zero !== false)) {
    throw new Error(`Unavailable source ${receipt.source_id} was conflated with zero.`);
  }
  if (receipt.status === 'available-zero'
    && (receipt.coverage.row_count !== 0 || receipt.coverage.available_zero !== true
      || receipt.coverage.completeness_admitted !== true)) {
    throw new Error(`Available-zero source ${receipt.source_id} lacks complete exact evidence.`);
  }
  if (stableStringify(receipt.authority) !== stableStringify(AUTHORITY)
    || stableStringify(receipt.claims) !== stableStringify(CLAIMS)
    || receipt.licence.redistribution_authority !== false) {
    throw new Error(`Source receipt ${receipt.source_id} changed authority or claim boundaries.`);
  }
  normalizeClocks(receipt.clocks);
}

function validateSourceReceiptSemantics(receipt) {
  const exactKind = receipt.source_id === 'philadelphia-reported-crime'
    ? 'm1-warehouse-admission-receipt'
    : receipt.source_id === 'vision-zero-hin-2025'
      ? 'hin-snapshot-receipt'
      : null;
  if (exactKind === null) {
    if (receipt.evidence_kind !== 'bounded-metadata-observation'
      || receipt.reuse.kind !== 'none'
      || Object.entries(receipt.reuse).some(([key, value]) => key !== 'kind' && value !== null)
      || receipt.identity.payload_identity !== null
      || receipt.coverage.exact_payload !== false
      || receipt.coverage.completeness_admitted !== false
      || !['partial', 'unavailable'].includes(receipt.status)) {
      throw new Error(`Bounded metadata source ${receipt.source_id} changed its evidence mapping.`);
    }
    if (receipt.source_id === 'citygeo-address-locator' && receipt.status !== 'unavailable') {
      throw new Error('Citywide geocoder source must remain unavailable.');
    }
    return;
  }
  if (receipt.evidence_kind !== exactKind || receipt.reuse.kind !== exactKind
    || receipt.coverage.exact_payload !== true
    || !SHA256.test(receipt.identity.payload_identity || '')
    || !SHA256.test(receipt.reuse.receipt_identity || '')
    || !SHA256.test(receipt.reuse.receipt_sha256 || '')
    || !SHA256.test(receipt.reuse.payload_sha256 || '')
    || !Number.isSafeInteger(receipt.reuse.receipt_bytes)
    || !Number.isSafeInteger(receipt.reuse.payload_bytes)) {
    throw new Error(`Exact source ${receipt.source_id} changed its receipt reuse mapping.`);
  }
  if (receipt.status === 'unavailable') {
    if (receipt.coverage.status !== 'unavailable' || receipt.coverage.completeness_admitted !== false) {
      throw new Error(`Unavailable exact source ${receipt.source_id} changed coverage semantics.`);
    }
  } else if (receipt.source_id === 'vision-zero-hin-2025' && receipt.status === 'partial') {
    if (receipt.coverage.status !== 'exact-receipt-review-incomplete'
      || receipt.coverage.completeness_admitted !== false
      || receipt.dq.status !== 'partial'
      || !receipt.dq.flags.includes('hin-lifecycle-review-incomplete')) {
      throw new Error('Partial HIN exact source changed its incomplete-review semantics.');
    }
  } else if (receipt.coverage.status !== 'complete-exact-receipt'
    || receipt.coverage.completeness_admitted !== true) {
    throw new Error(`Exact source ${receipt.source_id} lacks admitted complete receipt coverage.`);
  }
}

function sourceSemanticIdentityOf(value) {
  const evidence = structuredClone(value);
  delete evidence.freshness;
  return identityOf(evidence);
}

function validateM1AdmissionShape(value) {
  validateArtifactEnvelope(value?.receipt_artifact, 'M1 receipt artifact');
  const receipt = value?.receipt;
  if (!receipt || receipt.schema !== 'engagement-phl-crime-warehouse-receipt/v3'
    || !SHA256.test(receipt.identity || '')
    || !SHA256.test(receipt.source?.revision || '')
    || !SHA256.test(receipt.artifacts?.canonical?.sha256 || '')
    || !SHA256.test(receipt.artifacts?.current_source_manifest?.sha256 || '')
    || !Number.isSafeInteger(receipt.artifacts?.canonical?.bytes)
    || receipt.artifacts.canonical.bytes < 0) {
    throw new Error('M1 admission evidence shape is invalid.');
  }
}

function validateHinAdmissionShape(value) {
  validateArtifactEnvelope(value?.snapshot_artifact, 'HIN snapshot artifact');
  validateArtifactEnvelope(value?.receipt_artifact, 'HIN receipt artifact');
  const receipt = value?.receipt;
  if (!receipt || receipt.schema !== 'phl-hin-2025-receipt-v1'
    || receipt.artifact?.identity !== value.snapshot_artifact.sha256
    || receipt.artifact?.bytes !== value.snapshot_artifact.bytes
    || !Number.isSafeInteger(receipt.artifact?.featureCount)
    || receipt.artifact.featureCount < 0
    || !['legacy-admitted', 'admitted-after-review'].includes(receipt.review?.status)
    || !['not-recorded-in-legacy-snapshot', 'recorded-at-admitted-build']
      .includes(receipt.artifact?.buildClockStatus)) {
    throw new Error('HIN admission evidence shape is invalid.');
  }
  const reviewed = receipt.review.status === 'admitted-after-review';
  if (reviewed !== (receipt.review.reviewedAt !== null
      && receipt.review.reviewedBy !== null
      && receipt.artifact.builtAt !== null
      && receipt.artifact.buildClockStatus === 'recorded-at-admitted-build')) {
    throw new Error('HIN admission review and build clocks are inconsistent.');
  }
  if (!reviewed && (receipt.review.reviewedAt !== null
      || receipt.review.reviewedBy !== null
      || receipt.artifact.builtAt !== null
      || receipt.artifact.buildClockStatus !== 'not-recorded-in-legacy-snapshot')) {
    throw new Error('Legacy HIN admission must preserve missing review and build clocks.');
  }
}

function sameArcgisLayerUrl(left, right) {
  try {
    const first = new URL(left);
    const second = new URL(right);
    if (first.protocol !== 'https:' || second.protocol !== 'https:'
      || first.username || second.username || first.password || second.password
      || first.search || second.search || first.hash || second.hash) return false;
    return first.href.toLowerCase() === second.href.toLowerCase();
  } catch {
    return false;
  }
}

function validateArtifactEnvelope(value, label) {
  if (!value || !SHA256.test(value.sha256 || '') || !Number.isSafeInteger(value.bytes) || value.bytes <= 0) {
    throw new Error(`${label} identity or byte count is invalid.`);
  }
}

function validateRegistryLicenceBoundary(registry) {
  const limitation = registry?.terms?.limitation || '';
  if (!/restrict/i.test(limitation) || !/republication/i.test(limitation)
    || !/written permission/i.test(limitation)) {
    throw new Error('Home Compare registry redistribution licence boundary is not admitted.');
  }
}

function freshness(sourceAsOf, observedAt, maxAgeDays) {
  if (sourceAsOf === null) return { status: 'unavailable', max_age_days: maxAgeDays, age_days: null };
  const source = Date.parse(exactTimestamp(sourceAsOf, 'source-as-of clock'));
  const observed = Date.parse(exactTimestamp(observedAt, 'observation clock'));
  if (source > observed) throw new Error('Source-as-of clock is future-dated.');
  const ageDays = (observed - source) / 86_400_000;
  return {
    status: ageDays > maxAgeDays ? 'stale' : 'current',
    max_age_days: maxAgeDays,
    age_days: ageDays,
  };
}

function normalizeClocks(value) {
  const keys = ['source_as_of', 'retrieved_at', 'built_at', 'observed_at'];
  exactObject(value, keys, 'source receipt clocks');
  const result = {};
  for (const key of keys) result[key] = value[key] === null ? null : exactTimestamp(value[key], key);
  if (result.observed_at === null) throw new Error('Source receipt observed_at is required.');
  for (const key of ['source_as_of', 'retrieved_at', 'built_at']) {
    if (result[key] && result[key] > result.observed_at) throw new Error(`Source receipt ${key} is future-dated.`);
  }
  if (result.source_as_of && result.retrieved_at && result.source_as_of > result.retrieved_at) {
    throw new Error('Source receipt source_as_of is after retrieved_at.');
  }
  return result;
}

function emptyReuse() {
  return {
    kind: 'none',
    receipt_identity: null,
    receipt_sha256: null,
    receipt_bytes: null,
    payload_sha256: null,
    payload_bytes: null,
  };
}

function assertIndependentIdentities(receipts) {
  for (const field of ['semantic_identity', 'receipt_identity']) {
    if (new Set(receipts.map((receipt) => receipt[field])).size !== receipts.length) {
      throw new Error(`Every citywide source requires an independent ${field}.`);
    }
  }
}

function exactTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a finite ISO timestamp.`);
  }
  const normalized = new Date(value).toISOString();
  if (value !== normalized) throw new Error(`${label} must use canonical ISO timestamp form.`);
  return normalized;
}

function validateClockNotAfter(value, ceiling, label) {
  const clock = exactTimestamp(value, label);
  if (clock > exactTimestamp(ceiling, `${label} ceiling`)) throw new Error(`${label} is future-dated.`);
  return clock;
}

function finiteCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a finite non-negative integer.`);
  return value;
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (stableStringify(actual) !== stableStringify(expected)) throw new Error(`${label} contains unknown or missing fields.`);
}

function stringArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum
    || value.some((item) => typeof item !== 'string' || !item || item.length > 800)) {
    throw new Error(`${label} must be a bounded string array.`);
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function identityOf(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Undefined values cannot participate in lifecycle identity.');
  return serialized;
}

async function readJsonArtifact(filePath, label) {
  requirePath(filePath, label);
  const bytes = await fs.readFile(path.resolve(filePath));
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not strict JSON: ${error.message}`);
  }
  return {
    value,
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function requirePath(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} path is required.`);
}
