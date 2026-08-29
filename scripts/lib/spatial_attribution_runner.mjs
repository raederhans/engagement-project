import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAreaIntelligenceMartForEvaluation } from './area_intelligence_evaluation.mjs';
import { consumeCrimeWarehouseAdmissionReceipt } from './crime_event_warehouse.mjs';
import {
  addSpatialAttributionAuditRow,
  createSpatialAttributionAuditAccumulator,
  finalizeSpatialAttributionAuditAccumulator,
  isSpatialAttributionAnalysisEligible,
} from './spatial_attribution_audit.mjs';
import {
  addSpatialAttributionEligibleRow,
  createSpatialAttributionAccumulator,
  finalizeSpatialAttributionAccumulator,
  SPATIAL_ATTRIBUTION_METHOD_CONFIGS,
} from './spatial_attribution_methods.mjs';
import {
  buildSpatialAttributionReport,
  spatialAttributionValueIdentity,
} from './spatial_attribution_report.mjs';

export const SPATIAL_ATTRIBUTION_BUNDLE_SCHEMA =
  'engagement-spatial-attribution-evidence-bundle/v2';

const PROTOCOL_SCHEMA = 'engagement-spatial-attribution-protocol/v2';
const MART_SCHEMA = 'engagement-area-intelligence-feature-mart/v2';
const RECEIPT_SCHEMA = 'engagement-phl-crime-warehouse-receipt/v3';
const WAREHOUSE_SCHEMA = 'engagement-phl-crime-event-warehouse/v1';
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FROZEN_PROTOCOL_PURPOSE =
  'Aggregate-only comparison of exact canonical tract and fixed-grid attribution coverage while preserving ambiguous, unmapped, and unavailable states.';
const FROZEN_METHOD_SEMANTICS = Object.freeze({
  'tract-fail-closed': Object.freeze({
    assignment: 'integer',
    unassigned_policy: 'exclude-and-audit-never-force-assign',
  }),
  'fixed-grid-500m': Object.freeze({
    assignment: 'integer',
    cell_size_m: 500,
    unassigned_policy: 'exclude-and-audit-never-force-assign',
  }),
  fractional: Object.freeze({
    assignment: 'weighted',
    required_input: 'identity-bound-versioned-uncertainty-footprint-artifact',
    missing_input_result: 'unavailable',
    missing_input_reason: 'uncertainty-footprint-artifact-unavailable',
  }),
  'area-kernel': Object.freeze({
    assignment: 'weighted',
    required_input: 'identity-bound-versioned-uncertainty-footprint-artifact',
    missing_input_result: 'unavailable',
    missing_input_reason: 'uncertainty-footprint-artifact-unavailable',
    known_route_segment_kernel: 'forbidden',
  }),
});
const FROZEN_DENOMINATORS = Object.freeze({
  canonical: 'all admission-validated canonical rows',
  analysis_eligible: 'active rows with a parseable event time and mapped normalized category',
  relationship: 'tract and fixed-grid are parallel observations over the same eligible events and must never be added as unique events',
  required_status_matrix: 'tract mapped|ambiguous|unmapped by fixed-grid mapped|unavailable',
});
const FROZEN_WEIGHTED_ATTRIBUTION_CONTRACT = Object.freeze({
  tolerance: 1e-9,
  weights: 'finite-nonnegative-and-sum-to-one-before-rounding',
  candidate_units: 'unique-and-stably-sorted',
  acs_weighting: 'forbidden',
  current_exact_input_artifact: 'unavailable',
});
const FROZEN_SOURCE_DIMENSION_JOIN = Object.freeze({
  schema: 'engagement-spatial-source-dimension-join/v1',
  key: Object.freeze([
    'canonical.lineage.source_snapshot_id',
    'canonical.source_ids.cartodb_id',
  ]),
  cardinality: 'exactly-one-validated-source-occurrence-per-canonical-event',
  occurrence_policy: 'latest-occurrence-selected-and-transform-validated-by-official-warehouse-admission',
  district_field: 'dc_dist',
  psa_field: 'psa',
  missing_value_policy: 'null-is-unavailable-never-zero',
  snapshot_mismatch_policy: 'district-and-psa-unavailable',
  output_policy: 'aggregate-counts-only-no-source-or-event-identifiers',
});
const FROZEN_STRATA = Object.freeze({
  one_dimension_at_a_time: true,
  dimensions: Object.freeze([
    'year', 'normalized_category', 'district', 'psa', 'tract_status', 'grid_status',
    'boundary_status', 'acs_population_band', 'acs_temporal_compatibility', 'road',
  ]),
  acs_population_bands: Object.freeze({
    interval_semantics: 'lower-inclusive-upper-exclusive',
    low: Object.freeze({ lower_inclusive: 0, upper_exclusive: 2500 }),
    medium: Object.freeze({ lower_inclusive: 2500, upper_exclusive: 4500 }),
    high: Object.freeze({ lower_inclusive: 4500, upper_exclusive: null }),
  }),
  acs_policy: 'population band only when ACS valueStatus is available, temporal alignment is within-period, and modelInputEligible is true',
  road_policy: Object.freeze({
    status: 'unavailable',
    reason: 'versioned-road-geometry-binding-unavailable',
  }),
});
const FROZEN_ARTIFACT_POLICY = Object.freeze({
  aggregate_only: true,
  forbidden: Object.freeze([
    'event-level records',
    'source identifiers',
    'coordinates',
    'generalized locations',
    'raw source rows',
    'uncertainty footprint geometry',
    'candidate geography lists',
  ]),
  unavailable_is_zero: false,
  default_output: 'task-owned .dfev1 directory with no-overwrite atomic publication',
});
const FROZEN_AUTHORITY = Object.freeze({
  local_audit: true,
  serving: false,
  forecast: false,
  promotion: false,
  scientific: false,
  causal: false,
  safety: false,
});
const FROZEN_FORBIDDEN_CLAIMS = Object.freeze([
  'individual victim probability',
  'absolute safety',
  'safety score',
  'safest area',
  'safest route',
  'causal effect',
  'precise incident location',
]);
export async function runSpatialAttributionEvidence({
  warehouseRoot,
  martRoot,
  outputRoot,
  protocolPath,
  evaluationProtocolPath,
} = {}, runtime = {}) {
  const dependencies = runtimeDependencies(runtime);
  const output = await assertTaskOwnedOutput(outputRoot, dependencies);
  const protocolBytes = await dependencies.fileSystem.readFile(requiredPath(protocolPath, 'protocolPath'));
  const protocol = parseProtocol(protocolBytes);
  const protocolSha256 = digestBytes(protocolBytes);
  validateSpatialAttributionProtocol(protocol, dependencies.methodConfigs);

  const martGate = await dependencies.validateMart({
    martRoot: requiredPath(martRoot, 'martRoot'),
    protocolPath: requiredPath(evaluationProtocolPath, 'evaluationProtocolPath'),
  });
  const exactInput = exactInputFrom(protocol, protocolSha256, martGate);
  assertExactInputMatchesProtocol(exactInput, protocol, martGate);

  const auditAccumulator = dependencies.createAuditAccumulator({ exact_input: exactInput });
  const methodAccumulator = dependencies.createMethodAccumulator({
    exactInput,
    methodConfigs: dependencies.methodConfigs,
  });
  const admitted = await dependencies.consumeWarehouse(
    requiredPath(warehouseRoot, 'warehouseRoot'),
    {
      accumulateCanonicalEvent(payload) {
        dependencies.addAuditRow(auditAccumulator, payload);
        if (dependencies.isEligible(payload.canonical_event)) {
          dependencies.addEligibleRow(methodAccumulator, payload.canonical_event);
        }
      },
    },
  );
  assertReceiptMatchesExactInput(admitted, exactInput.m1);

  const denominatorAudit = dependencies.finalizeAudit(auditAccumulator);
  const methodComparison = dependencies.finalizeMethods(methodAccumulator);
  const denominatorBytes = jsonBytes(denominatorAudit);
  const methodBytes = jsonBytes(methodComparison);
  const report = dependencies.buildReport({
    denominatorAudit,
    methodComparison,
    observedInputBytes: {
      denominator_audit: digestBytes(denominatorBytes),
      method_comparison: digestBytes(methodBytes),
    },
  });
  const reportBytes = jsonBytes(report);
  const artifacts = [
    artifactDescriptor('denominator-audit.json', denominatorAudit, denominatorBytes, 'audit_identity'),
    artifactDescriptor('method-comparison.json', methodComparison, methodBytes, 'comparison_identity'),
    artifactDescriptor('report.json', report, reportBytes, 'artifact_identity'),
  ];
  const manifestCore = {
    schema: SPATIAL_ATTRIBUTION_BUNDLE_SCHEMA,
    protocol: { schema: protocol.schema, sha256: protocolSha256 },
    exact_input: structuredClone(exactInput),
    artifacts,
    authority: {
      serving: false,
      forecast: false,
      promotion: false,
      scientific: false,
      causal: false,
      safety: false,
    },
  };
  const manifest = {
    ...manifestCore,
    bundle_identity: spatialAttributionValueIdentity(manifestCore),
  };
  const files = new Map([
    ['denominator-audit.json', denominatorBytes],
    ['method-comparison.json', methodBytes],
    ['report.json', reportBytes],
    ['manifest.json', jsonBytes(manifest)],
  ]);
  await publishBundle(output, files, dependencies);
  return Object.freeze({
    outputRoot: output.final,
    manifest: Object.freeze(structuredClone(manifest)),
  });
}

function runtimeDependencies(runtime) {
  return {
    fileSystem: runtime.fileSystem || fs,
    workspaceRoot: path.resolve(runtime.workspaceRoot || MODULE_ROOT),
    randomId: runtime.randomId || randomUUID,
    validateMart: runtime.validateMart || validateAreaIntelligenceMartForEvaluation,
    consumeWarehouse: runtime.consumeWarehouse || consumeCrimeWarehouseAdmissionReceipt,
    methodConfigs: runtime.methodConfigs || SPATIAL_ATTRIBUTION_METHOD_CONFIGS,
    createAuditAccumulator: runtime.createAuditAccumulator || createSpatialAttributionAuditAccumulator,
    addAuditRow: runtime.addAuditRow || addSpatialAttributionAuditRow,
    finalizeAudit: runtime.finalizeAudit || finalizeSpatialAttributionAuditAccumulator,
    isEligible: runtime.isEligible || isSpatialAttributionAnalysisEligible,
    createMethodAccumulator: runtime.createMethodAccumulator || createSpatialAttributionAccumulator,
    addEligibleRow: runtime.addEligibleRow || addSpatialAttributionEligibleRow,
    finalizeMethods: runtime.finalizeMethods || finalizeSpatialAttributionAccumulator,
    buildReport: runtime.buildReport || buildSpatialAttributionReport,
  };
}

function parseProtocol(bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Spatial attribution protocol is not valid JSON: ${error.message}`);
  }
  return value;
}

function validateSpatialAttributionProtocol(protocol, methodConfigs) {
  exactKeys(protocol, [
    'schema', 'schema_version', 'frozen_at', 'frozen_before_real_data_analysis',
    'purpose', 'exact_input_gate', 'denominators', 'methods',
    'weighted_attribution_contract', 'strata', 'artifact_policy', 'authority',
    'forbidden_claims',
  ], 'Spatial attribution protocol');
  if (protocol.schema !== PROTOCOL_SCHEMA
    || protocol.schema_version !== 2
    || protocol.frozen_before_real_data_analysis !== true
    || !Number.isFinite(Date.parse(protocol.frozen_at))
    || protocol.purpose !== FROZEN_PROTOCOL_PURPOSE) {
    throw new Error('Spatial attribution protocol failed its frozen v2 policy gate.');
  }
  exactKeys(protocol.exact_input_gate, ['m1', 'm2'], 'Spatial attribution exact input gate');
  validatePinnedM1(protocol.exact_input_gate.m1);
  validatePinnedM2(protocol.exact_input_gate.m2);
  validateProtocolMethods(protocol.methods, methodConfigs);
  validateProtocolPolicies(protocol);
  exactKeys(protocol.authority, [
    'local_audit', 'serving', 'forecast', 'promotion', 'scientific', 'causal', 'safety',
  ], 'Spatial attribution protocol authority');
  if (stable(protocol.authority) !== stable(FROZEN_AUTHORITY)) {
    throw new Error('Spatial attribution protocol authority is invalid.');
  }
}

function validateProtocolMethods(methods, methodConfigs) {
  if (!Array.isArray(methods) || methods.length !== methodConfigs.length) {
    throw new Error('Spatial attribution protocol method inventory is invalid.');
  }
  const methodKeys = {
    'tract-fail-closed': [
      'id', 'version', 'method_identity', 'config_identity', 'assignment', 'unassigned_policy',
    ],
    'fixed-grid-500m': [
      'id', 'version', 'method_identity', 'config_identity', 'assignment', 'cell_size_m', 'unassigned_policy',
    ],
    fractional: [
      'id', 'version', 'method_identity', 'config_identity', 'assignment', 'required_input',
      'missing_input_result', 'missing_input_reason',
    ],
    'area-kernel': [
      'id', 'version', 'method_identity', 'config_identity', 'assignment', 'required_input',
      'missing_input_result', 'missing_input_reason', 'known_route_segment_kernel',
    ],
  };
  for (let index = 0; index < methodConfigs.length; index += 1) {
    const declared = methods[index];
    const config = methodConfigs[index];
    exactKeys(declared, methodKeys[config.method], `Spatial attribution method ${config.method}`);
    const expectedSemantics = FROZEN_METHOD_SEMANTICS[config.method];
    const observedSemantics = Object.fromEntries(
      Object.keys(expectedSemantics || {}).map((key) => [key, declared[key]]),
    );
    if (!expectedSemantics
      || declared.id !== config.method
      || declared.version !== config.method_version
      || declared.method_identity !== config.method_identity
      || declared.config_identity !== config.config_identity
      || declared.assignment !== config.assignment
      || stable(observedSemantics) !== stable(expectedSemantics)) {
      throw new Error(`Spatial attribution protocol method identity drifted for ${config.method}.`);
    }
  }
}

function validateProtocolPolicies(protocol) {
  exactKeys(protocol.denominators, [
    'canonical', 'analysis_eligible', 'relationship', 'required_status_matrix',
  ], 'Spatial attribution denominator policy');
  exactKeys(protocol.weighted_attribution_contract, [
    'tolerance', 'weights', 'candidate_units', 'acs_weighting', 'current_exact_input_artifact',
  ], 'Spatial attribution weighted attribution contract');
  exactKeys(protocol.strata, [
    'one_dimension_at_a_time', 'source_dimension_join', 'dimensions',
    'acs_population_bands', 'acs_policy', 'road_policy',
  ], 'Spatial attribution strata policy');
  exactKeys(protocol.strata.source_dimension_join, [
    'schema', 'key', 'cardinality', 'occurrence_policy', 'district_field', 'psa_field',
    'missing_value_policy', 'snapshot_mismatch_policy', 'output_policy',
  ], 'Spatial attribution source dimension join');
  exactKeys(protocol.strata.acs_population_bands, [
    'interval_semantics', 'low', 'medium', 'high',
  ], 'Spatial attribution ACS population bands');
  for (const name of ['low', 'medium', 'high']) {
    exactKeys(protocol.strata.acs_population_bands[name], [
      'lower_inclusive', 'upper_exclusive',
    ], `Spatial attribution ACS ${name} band`);
  }
  exactKeys(protocol.strata.road_policy, ['status', 'reason'], 'Spatial attribution road policy');
  exactKeys(protocol.artifact_policy, [
    'aggregate_only', 'forbidden', 'unavailable_is_zero', 'default_output',
  ], 'Spatial attribution artifact policy');
  const observedStrata = {
    one_dimension_at_a_time: protocol.strata.one_dimension_at_a_time,
    dimensions: protocol.strata.dimensions,
    acs_population_bands: protocol.strata.acs_population_bands,
    acs_policy: protocol.strata.acs_policy,
    road_policy: protocol.strata.road_policy,
  };
  if (stable(protocol.denominators) !== stable(FROZEN_DENOMINATORS)
    || stable(protocol.weighted_attribution_contract)
      !== stable(FROZEN_WEIGHTED_ATTRIBUTION_CONTRACT)
    || stable(protocol.strata.source_dimension_join) !== stable(FROZEN_SOURCE_DIMENSION_JOIN)
    || stable(observedStrata) !== stable(FROZEN_STRATA)
    || stable(protocol.artifact_policy) !== stable(FROZEN_ARTIFACT_POLICY)
    || stable(protocol.forbidden_claims) !== stable(FROZEN_FORBIDDEN_CLAIMS)) {
    throw new Error('Spatial attribution protocol policy vocabulary is invalid.');
  }
}

function validatePinnedM1(m1) {
  exactKeys(m1, [
    'receipt_schema', 'receipt_identity', 'receipt_sha256', 'warehouse_schema',
    'warehouse_current_snapshot_id', 'canonical',
  ], 'Spatial attribution M1 gate');
  exactKeys(m1.canonical, ['partition_count', 'row_count', 'bytes', 'sha256'], 'Spatial attribution M1 canonical gate');
  if (m1.receipt_schema !== RECEIPT_SCHEMA
    || m1.warehouse_schema !== WAREHOUSE_SCHEMA
    || !DIGEST.test(m1.receipt_identity || '')
    || !DIGEST.test(m1.receipt_sha256 || '')
    || !DIGEST.test(m1.warehouse_current_snapshot_id || '')
    || !DIGEST.test(m1.canonical.sha256 || '')
    || !positiveInteger(m1.canonical.partition_count)
    || !nonnegativeInteger(m1.canonical.row_count)
    || !nonnegativeInteger(m1.canonical.bytes)) {
    throw new Error('Spatial attribution protocol M1 gate is invalid.');
  }
}

function validatePinnedM2(m2) {
  exactKeys(m2, [
    'evaluation_protocol', 'mart_schema', 'manifest_sha256', 'artifact_identity',
    'part_bindings_identity', 'part_count', 'row_count', 'bytes', 'admission',
  ], 'Spatial attribution M2 gate');
  exactKeys(m2.evaluation_protocol, ['schema', 'sha256'], 'Spatial attribution M2 evaluation protocol gate');
  if (m2.mart_schema !== MART_SCHEMA
    || !DIGEST.test(m2.evaluation_protocol.sha256 || '')
    || !DIGEST.test(m2.manifest_sha256 || '')
    || !DIGEST.test(m2.artifact_identity || '')
    || !DIGEST.test(m2.part_bindings_identity || '')
    || !nonnegativeInteger(m2.part_count)
    || !nonnegativeInteger(m2.row_count)
    || !nonnegativeInteger(m2.bytes)
    || !m2.admission || typeof m2.admission !== 'object') {
    throw new Error('Spatial attribution protocol M2 gate is invalid.');
  }
  validateAdmission(m2.admission);
}

function validateAdmission(admission) {
  exactKeys(admission, [
    'canonical_rows_seen', 'tract', 'fixed-grid', 'unknown_category',
    'invalid_event_time', 'non_active',
  ], 'Spatial attribution M2 admission');
  exactKeys(admission.tract, [
    'admitted', 'ambiguous_excluded', 'unmapped_excluded',
  ], 'Spatial attribution M2 tract admission');
  exactKeys(admission['fixed-grid'], [
    'admitted', 'unavailable_excluded',
  ], 'Spatial attribution M2 fixed-grid admission');
  const values = [
    admission.canonical_rows_seen,
    admission.tract.admitted,
    admission.tract.ambiguous_excluded,
    admission.tract.unmapped_excluded,
    admission['fixed-grid'].admitted,
    admission['fixed-grid'].unavailable_excluded,
    admission.unknown_category,
    admission.invalid_event_time,
    admission.non_active,
  ];
  const eligible = admission.canonical_rows_seen
    - admission.unknown_category - admission.invalid_event_time - admission.non_active;
  if (values.some((value) => !nonnegativeInteger(value)) || eligible < 0
    || admission.tract.admitted + admission.tract.ambiguous_excluded
      + admission.tract.unmapped_excluded !== eligible
    || admission['fixed-grid'].admitted + admission['fixed-grid'].unavailable_excluded !== eligible) {
    throw new Error('Spatial attribution M2 admission denominators do not conserve.');
  }
}

function exactInputFrom(protocol, protocolSha256, martGate) {
  const manifest = martGate?.martManifest;
  const inventory = martGate?.martInventory;
  if (!manifest || !inventory || !Array.isArray(inventory.parts)) {
    throw new Error('Area Intelligence mart validator returned an incomplete exact inventory.');
  }
  return {
    protocol: { schema: protocol.schema, sha256: protocolSha256 },
    m1: structuredClone(protocol.exact_input_gate.m1),
    m2: {
      mart_schema: manifest.schema,
      manifest_sha256: normalizeDigest(martGate.martManifestIdentity),
      artifact_identity: manifest.artifact_identity,
      part_bindings_identity: inventory.part_bindings_identity,
      part_count: inventory.parts.length,
      row_count: inventory.row_count,
      bytes: inventory.bytes,
      admission: structuredClone(manifest.admission),
      artifact_policy: {
        event_level_data_included: manifest.artifact_policy?.event_level_data_included,
      },
    },
  };
}

function assertExactInputMatchesProtocol(exactInput, protocol, martGate) {
  const expected = protocol.exact_input_gate.m2;
  const observed = exactInput.m2;
  const expectedEvaluationSha = expected.evaluation_protocol.sha256;
  const observedEvaluationSha = normalizeDigest(martGate.protocolIdentity);
  if (expected.evaluation_protocol.schema !== martGate.protocol?.schema
    || expectedEvaluationSha !== observedEvaluationSha
    || stable({
      mart_schema: expected.mart_schema,
      manifest_sha256: expected.manifest_sha256,
      artifact_identity: expected.artifact_identity,
      part_bindings_identity: expected.part_bindings_identity,
      part_count: expected.part_count,
      row_count: expected.row_count,
      bytes: expected.bytes,
      admission: expected.admission,
      artifact_policy: { event_level_data_included: false },
    }) !== stable(observed)) {
    throw new Error('Validated M2 mart drifted from the frozen spatial attribution protocol.');
  }
}

function assertReceiptMatchesExactInput(admitted, expected) {
  const receipt = admitted?.receipt;
  const observed = {
    receipt_schema: receipt?.schema,
    receipt_identity: receipt?.identity,
    receipt_sha256: normalizeDigest(admitted?.sha256),
    warehouse_schema: receipt?.warehouse?.schema,
    warehouse_current_snapshot_id: receipt?.warehouse?.current_snapshot_id,
    canonical: {
      partition_count: receipt?.artifacts?.canonical?.partition_count,
      row_count: receipt?.counts?.canonical_rows,
      bytes: receipt?.artifacts?.canonical?.bytes,
      sha256: receipt?.artifacts?.canonical?.sha256,
    },
  };
  if (stable(observed) !== stable(expected)) {
    throw new Error('Admitted M1 receipt drifted from the frozen spatial attribution exact input.');
  }
}

function artifactDescriptor(name, value, bytes, identityKey) {
  if (!DIGEST.test(value?.[identityKey] || '')) {
    throw new Error(`Spatial attribution ${name} producer identity is invalid.`);
  }
  return {
    path: name,
    schema: value.schema,
    identity: value[identityKey],
    bytes: bytes.length,
    sha256: digestBytes(bytes),
  };
}

async function assertTaskOwnedOutput(outputRoot, dependencies) {
  const resolved = path.resolve(requiredPath(outputRoot, 'outputRoot'));
  const workspaceReal = await dependencies.fileSystem.realpath(dependencies.workspaceRoot);
  const relative = path.relative(workspaceReal, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
    || relative.split(path.sep)[0] !== '.dfev1') {
    throw new Error('Spatial attribution output must be a task-owned .dfev1 directory in the current worktree.');
  }
  if (await lstatOrNull(dependencies.fileSystem, resolved)) {
    throw new Error('Spatial attribution output directory already exists.');
  }
  const parent = path.dirname(resolved);
  const parentStat = await dependencies.fileSystem.lstat(parent).catch(() => null);
  if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('Spatial attribution output parent must be a pre-existing real directory.');
  }
  const parentReal = await dependencies.fileSystem.realpath(parent);
  const parentRelative = path.relative(workspaceReal, parentReal);
  if (parentRelative.startsWith('..') || path.isAbsolute(parentRelative)
    || parentRelative.split(path.sep)[0] !== '.dfev1') {
    throw new Error('Spatial attribution output parent resolves outside the current worktree .dfev1 directory.');
  }
  return { final: resolved, parent: parentReal };
}

async function publishBundle(output, files, dependencies) {
  const prefix = `.spatial-attribution-staging-${dependencies.randomId()}-`;
  const staging = path.join(output.parent, `${prefix}bundle`);
  await dependencies.fileSystem.mkdir(staging, { recursive: false });
  try {
    for (const [name, bytes] of files) {
      await dependencies.fileSystem.writeFile(path.join(staging, name), bytes, { flag: 'wx' });
    }
    await dependencies.fileSystem.rename(staging, output.final);
  } catch (error) {
    await cleanupOwnedStaging(staging, output.parent, prefix, dependencies.fileSystem);
    throw error;
  }
}

async function cleanupOwnedStaging(staging, parent, prefix, fileSystem) {
  const resolved = path.resolve(staging);
  if (path.dirname(resolved) !== path.resolve(parent) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error('Refused to clean an unverified spatial attribution staging directory.');
  }
  await fileSystem.rm(resolved, { recursive: true, force: true });
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stable(Object.keys(value).sort()) !== stable([...keys].sort())) {
    throw new Error(`${label} has missing or unknown fields.`);
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function digestBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function normalizeDigest(value) {
  if (typeof value !== 'string') return value;
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requiredPath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required.`);
  return value;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

async function lstatOrNull(fileSystem, target) {
  return fileSystem.lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
}
