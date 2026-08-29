import { spatialArtifactIdentity } from './crime_event_spatial.mjs';
import { partitionForSourceId } from './crime_event_source.mjs';

export const SPATIAL_ATTRIBUTION_COMPARISON_SCHEMA =
  'engagement-spatial-attribution-method-comparison/v2';
export const SPATIAL_ATTRIBUTION_ACCUMULATOR_SCHEMA =
  'engagement-spatial-attribution-accumulator/v2';
export const SPATIAL_ATTRIBUTION_METHOD_CONFIG_SCHEMA =
  'engagement-spatial-attribution-method-config/v2';
export const SPATIAL_ATTRIBUTION_METHOD_RESULT_SCHEMA =
  'engagement-spatial-attribution-method-result/v2';
export const SPATIAL_ATTRIBUTION_CANDIDATE_WEIGHTS_SCHEMA =
  'engagement-spatial-attribution-candidate-weights/v1';
export const SPATIAL_ATTRIBUTION_FOOTPRINT_REFERENCE_SCHEMA =
  'engagement-spatial-uncertainty-footprint-reference/v1';
export const DEFAULT_SPATIAL_ATTRIBUTION_TOLERANCE = 1e-9;

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SHA256_VALUE_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/;
const TRACT_PATTERN = /^\d{11}$/;
const FIXED_GRID_PATTERN = /^epsg3857-500m:-?\d+:-?\d+$/;
const METHOD_ORDER = Object.freeze([
  'tract-fail-closed',
  'fixed-grid-500m',
  'fractional',
  'area-kernel',
]);
const WEIGHTED_METHODS = new Set(['fractional', 'area-kernel']);
const CONFIG_KEYS = Object.freeze([
  'schema',
  'method',
  'method_version',
  'unit_type',
  'assignment',
  'spatial_semantics',
  'weight_basis',
  'candidate_weights',
  'candidate_weight_contract_identity',
  'input_artifact_identity',
  'configured_unavailable_reason',
  'tolerance',
  'acs_weighting',
  'known_route_segment_kernel',
  'integer_m2_mart_contract',
  'method_identity',
  'config_identity',
]);
const CANDIDATE_INPUT_KEYS = Object.freeze([
  'schema',
  'row_identity',
  'method',
  'method_config_identity',
  'input_artifact_identity',
  'uncertainty_footprint',
  'weight_basis',
  'acs_weighting',
  'known_route_segment_kernel_used',
  'candidate_weights',
  'input_identity',
]);
const CANDIDATE_WEIGHT_KEYS = Object.freeze(['unit_id', 'weight']);
const FOOTPRINT_KEYS = Object.freeze([
  'schema', 'identity', 'status', 'supplied_by', 'geometry_included',
]);
const RESULT_KEYS = Object.freeze([
  'schema',
  'method',
  'method_version',
  'unit_type',
  'assignment',
  'availability',
  'weight_basis',
  'candidate_weight_contract_identity',
  'input_artifact_identity',
  'unavailable_reason',
  'acs_weighting',
  'known_route_segment_kernel',
  'integer_m2_mart_contract',
  'method_identity',
  'config_identity',
  'input_rows',
  'assigned_rows',
  'excluded_rows',
  'weighted_mass',
  'tolerance',
  'exclusions',
  'aggregates',
  'result_identity',
]);
const COMPARISON_KEYS = Object.freeze([
  'schema',
  'exact_input',
  'input_rows',
  'source_spatial_rows',
  'methods',
  'privacy',
  'governance',
  'comparison_identity',
]);
const EXACT_INPUT_KEYS = Object.freeze([
  'protocol', 'm1', 'm2',
]);
const PROTOCOL_INPUT_KEYS = Object.freeze(['schema', 'sha256']);
const M1_INPUT_KEYS = Object.freeze([
  'receipt_schema',
  'receipt_identity',
  'receipt_sha256',
  'warehouse_schema',
  'warehouse_current_snapshot_id',
  'canonical',
]);
const M1_CANONICAL_KEYS = Object.freeze([
  'partition_count', 'row_count', 'bytes', 'sha256',
]);
const M2_INPUT_KEYS = Object.freeze([
  'mart_schema',
  'manifest_sha256',
  'artifact_identity',
  'part_bindings_identity',
  'part_count',
  'row_count',
  'bytes',
  'admission',
  'artifact_policy',
]);
const M2_ADMISSION_KEYS = Object.freeze([
  'canonical_rows_seen',
  'tract',
  'fixed-grid',
  'unknown_category',
  'invalid_event_time',
  'non_active',
]);
const M2_TRACT_ADMISSION_KEYS = Object.freeze([
  'admitted', 'ambiguous_excluded', 'unmapped_excluded',
]);
const M2_GRID_ADMISSION_KEYS = Object.freeze(['admitted', 'unavailable_excluded']);
const PRIVACY = Object.freeze({
  aggregate_only: true,
  coordinates_included: false,
  generalized_locations_included: false,
  raw_events_included: false,
  source_record_ids_included: false,
  uncertainty_footprints_included: false,
});
const GOVERNANCE = Object.freeze({
  integer_m2_mart_contract: 'independent-unchanged',
  evaluation_contract: 'unchanged',
  serving_contract: 'unchanged',
  forecast_contract: 'unchanged',
  acs_weighting: 'forbidden',
  demographic_ranking_authority: false,
  serving_authority: false,
  forecast_authority: false,
  promotion_authority: false,
  known_route_segment_kernel: 'not-area-attribution',
});

const METHOD_BLUEPRINTS = Object.freeze([
  Object.freeze({
    method: 'tract-fail-closed',
    method_version: 'crime-event-tract-fail-closed/v1',
    unit_type: 'tract',
    assignment: 'integer',
    spatial_semantics: 'canonical-spatial-tract-mapped-only-ambiguous-and-unmapped-excluded',
    weight_basis: 'canonical-unit-mass',
    candidate_weights: 'forbidden',
    candidate_weight_contract_identity: null,
  }),
  Object.freeze({
    method: 'fixed-grid-500m',
    method_version: 'epsg3857-square-grid-v1',
    unit_type: 'fixed-grid',
    assignment: 'integer',
    spatial_semantics: 'canonical-spatial-grid-mapped-only-epsg3857-square-grid-v1-500m',
    weight_basis: 'canonical-unit-mass',
    candidate_weights: 'forbidden',
    candidate_weight_contract_identity: null,
  }),
  Object.freeze({
    method: 'fractional',
    method_version: 'fractional-area-attribution/v2',
    unit_type: 'tract',
    assignment: 'weighted',
    spatial_semantics: 'caller-supplied-admitted-uncertainty-footprint-and-normalized-tract-candidates',
    weight_basis: 'caller-supplied-fractional-area-overlap',
    candidate_weights: 'required',
    candidate_weight_contract_identity: spatialArtifactIdentity({
      schema: SPATIAL_ATTRIBUTION_CANDIDATE_WEIGHTS_SCHEMA,
      method: 'fractional',
      normalization: 'finite-nonnegative-sum-to-one',
      unit_type: 'tract',
      geometry_derivation: 'outside-comparator',
    }),
  }),
  Object.freeze({
    method: 'area-kernel',
    method_version: 'area-kernel-attribution/v2',
    unit_type: 'tract',
    assignment: 'weighted',
    spatial_semantics: 'caller-supplied-admitted-area-uncertainty-footprint-and-normalized-tract-kernel-mass',
    weight_basis: 'caller-supplied-area-kernel-mass',
    candidate_weights: 'required',
    candidate_weight_contract_identity: spatialArtifactIdentity({
      schema: SPATIAL_ATTRIBUTION_CANDIDATE_WEIGHTS_SCHEMA,
      method: 'area-kernel',
      normalization: 'finite-nonnegative-sum-to-one',
      unit_type: 'tract',
      geometry_derivation: 'outside-comparator',
      known_route_segment_kernel: 'forbidden',
    }),
  }),
]);

const BLUEPRINT_BY_METHOD = new Map(METHOD_BLUEPRINTS.map((value) => [value.method, value]));
const ACCUMULATOR_STATES = new WeakMap();

export class SpatialAttributionContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpatialAttributionContractError';
    this.code = code;
  }
}

export function createSpatialAttributionMethodConfigs({
  tolerance = DEFAULT_SPATIAL_ATTRIBUTION_TOLERANCE,
  fractionalInputArtifactIdentity = null,
  areaKernelInputArtifactIdentity = null,
} = {}) {
  requireTolerance(tolerance);
  for (const [label, identity] of [
    ['fractional', fractionalInputArtifactIdentity],
    ['area-kernel', areaKernelInputArtifactIdentity],
  ]) {
    if (identity !== null && !DIGEST_PATTERN.test(identity || '')) {
      throw contractError(
        'input-artifact-identity-invalid',
        `${label} input artifact identity must be an exact SHA-256 digest or null.`,
      );
    }
  }
  const configs = METHOD_BLUEPRINTS.map((blueprint) => {
    const inputArtifactIdentity = blueprint.method === 'fractional'
      ? fractionalInputArtifactIdentity
      : blueprint.method === 'area-kernel'
        ? areaKernelInputArtifactIdentity
        : null;
    const methodEvidence = methodIdentityEvidence(blueprint);
    const config = {
      schema: SPATIAL_ATTRIBUTION_METHOD_CONFIG_SCHEMA,
      ...blueprint,
      input_artifact_identity: inputArtifactIdentity,
      configured_unavailable_reason: WEIGHTED_METHODS.has(blueprint.method)
        && inputArtifactIdentity === null
        ? 'uncertainty-footprint-artifact-unavailable'
        : null,
      tolerance,
      acs_weighting: 'forbidden',
      known_route_segment_kernel: 'not-area-attribution',
      integer_m2_mart_contract: 'independent-unchanged',
      method_identity: spatialArtifactIdentity(methodEvidence),
    };
    config.config_identity = spatialArtifactIdentity(config);
    return deepFreeze(config);
  });
  return deepFreeze(configs);
}

export const SPATIAL_ATTRIBUTION_METHOD_CONFIGS = createSpatialAttributionMethodConfigs();

export function createSpatialAttributionCandidateWeights({
  rowIdentity,
  method,
  uncertaintyFootprintIdentity,
  candidateWeights,
  methodConfigs = SPATIAL_ATTRIBUTION_METHOD_CONFIGS,
} = {}) {
  const configs = admitMethodConfigs(methodConfigs);
  const config = configs.get(method);
  if (!config || !WEIGHTED_METHODS.has(method)) {
    throw contractError('candidate-method-invalid', 'Candidate weights require fractional or area-kernel method.');
  }
  if (!DIGEST_PATTERN.test(config.input_artifact_identity || '')) {
    throw contractError(
      'input-artifact-unavailable',
      'Candidate weights require an exact identity-bound uncertainty input artifact.',
    );
  }
  requireRowIdentity(rowIdentity);
  if (!DIGEST_PATTERN.test(uncertaintyFootprintIdentity || '')) {
    throw contractError(
      'footprint-identity-invalid',
      'Candidate weights require an admitted uncertainty footprint identity.',
    );
  }
  const normalized = normalizeCandidateWeights(candidateWeights, config.tolerance);
  if (!normalized.ok) throw contractError(normalized.reason, normalized.message);
  const value = {
    schema: SPATIAL_ATTRIBUTION_CANDIDATE_WEIGHTS_SCHEMA,
    row_identity: rowIdentity,
    method,
    method_config_identity: config.config_identity,
    input_artifact_identity: config.input_artifact_identity,
    uncertainty_footprint: {
      schema: SPATIAL_ATTRIBUTION_FOOTPRINT_REFERENCE_SCHEMA,
      identity: uncertaintyFootprintIdentity,
      status: 'admitted',
      supplied_by: 'caller',
      geometry_included: false,
    },
    weight_basis: config.weight_basis,
    acs_weighting: 'forbidden',
    known_route_segment_kernel_used: false,
    candidate_weights: normalized.weights,
  };
  value.input_identity = spatialArtifactIdentity(value);
  return deepFreeze(value);
}

export function createSpatialAttributionAccumulator({
  exactInput,
  methodConfigs = SPATIAL_ATTRIBUTION_METHOD_CONFIGS,
} = {}) {
  const configs = admitMethodConfigs(methodConfigs);
  const admittedExactInput = admitExactInput(exactInput);
  const eligibleDenominator = analysisEligibleDenominator(admittedExactInput);
  const handle = Object.freeze({ schema: SPATIAL_ATTRIBUTION_ACCUMULATOR_SCHEMA });
  ACCUMULATOR_STATES.set(handle, {
    exactInput: admittedExactInput,
    configs,
    rowsAdded: 0,
    lastRowOrder: null,
    finalized: false,
    sourceSpatialRows: emptySourceSpatialRows(),
    methods: new Map(METHOD_ORDER.map((method) => [
      method,
      createMethodAccumulator(
        configs.get(method),
        eligibleDenominator,
      ),
    ])),
  });
  return handle;
}

export function addSpatialAttributionEligibleRow(accumulator, row, {
  fractional = null,
  areaKernel = null,
} = {}) {
  const state = requireAccumulatorState(accumulator);
  if (state.finalized) {
    throw contractError('accumulator-finalized', 'Spatial attribution accumulator is already finalized.');
  }
  assertAnalysisEligibleRow(row);
  if (state.rowsAdded >= analysisEligibleDenominator(state.exactInput)) {
    throw contractError(
      'eligible-denominator-exceeded',
      'Spatial attribution rows exceed the declared analysis-eligible denominator.',
    );
  }
  const rowIdentity = row.source_record_id;
  const rowOrder = sourceRowOrder(
    rowIdentity,
    state.exactInput.m1.canonical.partition_count,
  );
  if (state.lastRowOrder !== null
    && compareSourceRowOrder(rowOrder, state.lastRowOrder) <= 0) {
    throw contractError(
      'row-order-invalid',
      'Streaming spatial attribution rows must follow canonical partition and numeric ID order.',
    );
  }
  const tractState = classifyTractState(row.spatial?.tract);
  const gridState = classifyGridState(row.spatial?.grid);
  state.sourceSpatialRows.tract[tractState.status] += 1;
  state.sourceSpatialRows.fixed_grid[gridState.status] += 1;

  addIntegerAssignment(
    state.methods.get('tract-fail-closed'),
    tractState.status === 'mapped' ? tractState.unitId : null,
    tractState.status === 'mapped' ? null : tractExclusionReason(tractState.status),
  );
  addIntegerAssignment(
    state.methods.get('fixed-grid-500m'),
    gridState.status === 'mapped' ? gridState.unitId : null,
    gridState.status === 'mapped' ? null : gridExclusionReason(gridState.status),
  );

  for (const [method, candidate] of [
    ['fractional', fractional],
    ['area-kernel', areaKernel],
  ]) {
    const methodAccumulator = state.methods.get(method);
    const inspected = inspectCandidateInput(candidate, {
      rowIdentity,
      config: state.configs.get(method),
      tractState,
    });
    if (!inspected.ok) excludeRow(methodAccumulator, inspected.reason);
    else addWeightedAssignment(methodAccumulator, inspected.weights);
  }
  state.lastRowOrder = rowOrder;
  state.rowsAdded += 1;
  return accumulator;
}

export function finalizeSpatialAttributionAccumulator(accumulator) {
  const state = requireAccumulatorState(accumulator);
  if (state.finalized) {
    throw contractError('accumulator-finalized', 'Spatial attribution accumulator is already finalized.');
  }
  if (state.rowsAdded !== analysisEligibleDenominator(state.exactInput)) {
    throw contractError(
      'eligible-denominator-mismatch',
      'Spatial attribution rows do not match the declared analysis-eligible denominator.',
    );
  }
  const comparison = {
    schema: SPATIAL_ATTRIBUTION_COMPARISON_SCHEMA,
    exact_input: structuredClone(state.exactInput),
    input_rows: state.rowsAdded,
    source_spatial_rows: structuredClone(state.sourceSpatialRows),
    methods: METHOD_ORDER.map((method) => finalizeMethodAccumulator(state.methods.get(method))),
    privacy: { ...PRIVACY },
    governance: { ...GOVERNANCE },
  };
  comparison.comparison_identity = spatialArtifactIdentity(comparison);
  const admitted = admitSpatialAttributionComparison(comparison, {
    methodConfigs: [...state.configs.values()],
  });
  state.finalized = true;
  return admitted;
}

export function compareSpatialAttributionMethods({
  exactInput,
  rows,
  candidateInputs = [],
  methodConfigs = SPATIAL_ATTRIBUTION_METHOD_CONFIGS,
} = {}) {
  if (!Array.isArray(rows)) {
    throw contractError('rows-invalid', 'Spatial attribution comparison requires an array of canonical rows.');
  }
  if (!Array.isArray(candidateInputs)) {
    throw contractError('candidate-inputs-invalid', 'Spatial attribution candidate inputs must be an array.');
  }
  const accumulator = createSpatialAttributionAccumulator({ exactInput, methodConfigs });
  const partitionCount = requireAccumulatorState(accumulator)
    .exactInput.m1.canonical.partition_count;
  const sortedRows = admitRows(rows, partitionCount);
  const candidates = indexCandidateInputs(
    candidateInputs,
    new Set(sortedRows.map(({ rowIdentity }) => rowIdentity)),
  );
  for (const { rowIdentity, row } of sortedRows) {
    addSpatialAttributionEligibleRow(accumulator, row, {
      fractional: candidates.get(candidateKey(rowIdentity, 'fractional')),
      areaKernel: candidates.get(candidateKey(rowIdentity, 'area-kernel')),
    });
  }
  return finalizeSpatialAttributionAccumulator(accumulator);
}

export function admitSpatialAttributionComparison(value, {
  methodConfigs = SPATIAL_ATTRIBUTION_METHOD_CONFIGS,
} = {}) {
  const configs = admitMethodConfigs(methodConfigs);
  const candidate = structuredClone(value);
  requireExactKeys(candidate, COMPARISON_KEYS, 'comparison');
  if (candidate.schema !== SPATIAL_ATTRIBUTION_COMPARISON_SCHEMA
    || !nonnegativeInteger(candidate.input_rows)) {
    throw contractError('comparison-invalid', 'Spatial attribution comparison header is invalid.');
  }
  const exactInput = admitExactInput(candidate.exact_input);
  if (candidate.input_rows !== analysisEligibleDenominator(exactInput)) {
    throw contractError(
      'eligible-denominator-mismatch',
      'Spatial attribution method input rows must equal the analysis-eligible denominator.',
    );
  }
  validateSourceSpatialRows(candidate.source_spatial_rows, candidate.input_rows);
  validateM2SpatialBaseline(candidate.source_spatial_rows, exactInput.m2.admission);
  if (!Array.isArray(candidate.methods) || candidate.methods.length !== METHOD_ORDER.length) {
    throw contractError('comparison-methods-invalid', 'Spatial attribution comparison must contain four methods.');
  }
  candidate.methods.forEach((result, index) => validateMethodResult(
    result,
    configs.get(METHOD_ORDER[index]),
    candidate.input_rows,
  ));
  if (!sameValue(candidate.privacy, PRIVACY) || !sameValue(candidate.governance, GOVERNANCE)) {
    throw contractError(
      'comparison-boundary-invalid',
      'Spatial attribution privacy or governance boundary is invalid.',
    );
  }
  const declaredIdentity = candidate.comparison_identity;
  delete candidate.comparison_identity;
  if (!DIGEST_PATTERN.test(declaredIdentity || '')
    || declaredIdentity !== spatialArtifactIdentity(candidate)) {
    throw contractError('comparison-identity-drift', 'Spatial attribution comparison identity drifted.');
  }
  candidate.comparison_identity = declaredIdentity;
  return deepFreeze(candidate);
}

function admitMethodConfigs(value) {
  if (!Array.isArray(value) || value.length !== METHOD_ORDER.length) {
    throw contractError('method-config-invalid', 'Exactly four spatial attribution method configs are required.');
  }
  const byMethod = new Map();
  for (const raw of value) {
    const config = structuredClone(raw);
    requireExactKeys(config, CONFIG_KEYS, 'method config');
    const blueprint = BLUEPRINT_BY_METHOD.get(config.method);
    if (!blueprint || byMethod.has(config.method)) {
      throw contractError('method-config-invalid', 'Spatial attribution method configs must be unique and supported.');
    }
    requireTolerance(config.tolerance);
    const weightedConfigAvailable = WEIGHTED_METHODS.has(config.method)
      && DIGEST_PATTERN.test(config.input_artifact_identity || '');
    const validArtifactBoundary = WEIGHTED_METHODS.has(config.method)
      ? (weightedConfigAvailable
        ? config.configured_unavailable_reason === null
        : config.input_artifact_identity === null
          && config.configured_unavailable_reason
            === 'uncertainty-footprint-artifact-unavailable')
      : config.input_artifact_identity === null && config.configured_unavailable_reason === null;
    if (config.schema !== SPATIAL_ATTRIBUTION_METHOD_CONFIG_SCHEMA
      || Object.keys(blueprint).some((key) => !sameValue(config[key], blueprint[key]))
      || !validArtifactBoundary
      || config.acs_weighting !== 'forbidden'
      || config.known_route_segment_kernel !== 'not-area-attribution'
      || config.integer_m2_mart_contract !== 'independent-unchanged') {
      throw contractError('method-config-invalid', `Spatial attribution method config ${config.method} is invalid.`);
    }
    const expectedMethodIdentity = spatialArtifactIdentity(methodIdentityEvidence(blueprint));
    const declaredConfigIdentity = config.config_identity;
    delete config.config_identity;
    if (config.method_identity !== expectedMethodIdentity
      || !DIGEST_PATTERN.test(declaredConfigIdentity || '')
      || declaredConfigIdentity !== spatialArtifactIdentity(config)) {
      throw contractError('method-config-identity-drift', `Spatial attribution method config ${config.method} identity drifted.`);
    }
    config.config_identity = declaredConfigIdentity;
    byMethod.set(config.method, deepFreeze(config));
  }
  if (METHOD_ORDER.some((method) => !byMethod.has(method))) {
    throw contractError('method-config-invalid', 'Spatial attribution method config set is incomplete.');
  }
  return new Map(METHOD_ORDER.map((method) => [method, byMethod.get(method)]));
}

function methodIdentityEvidence(blueprint) {
  return {
    schema: SPATIAL_ATTRIBUTION_METHOD_RESULT_SCHEMA,
    method: blueprint.method,
    method_version: blueprint.method_version,
    unit_type: blueprint.unit_type,
    assignment: blueprint.assignment,
    spatial_semantics: blueprint.spatial_semantics,
    weight_basis: blueprint.weight_basis,
  };
}

function admitRows(rows, partitionCount) {
  const admitted = [];
  const identities = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw contractError('row-invalid', 'Each spatial attribution input row must be a canonical event object.');
    }
    const rowIdentity = row.source_record_id;
    requireRowIdentity(rowIdentity);
    if (identities.has(rowIdentity)) {
      throw contractError('row-identity-duplicate', 'Spatial attribution input row identities must be unique.');
    }
    identities.add(rowIdentity);
    admitted.push({
      rowIdentity,
      rowOrder: sourceRowOrder(rowIdentity, partitionCount),
      row,
    });
  }
  return admitted.sort((left, right) => compareSourceRowOrder(left.rowOrder, right.rowOrder));
}

function admitExactInput(value) {
  const exactInput = structuredClone(value);
  requireExactKeys(exactInput, EXACT_INPUT_KEYS, 'exact input');
  requireExactKeys(exactInput.protocol, PROTOCOL_INPUT_KEYS, 'exact input protocol');
  requireExactKeys(exactInput.m1, M1_INPUT_KEYS, 'exact input M1');
  requireExactKeys(exactInput.m1.canonical, M1_CANONICAL_KEYS, 'exact input M1 canonical');
  requireExactKeys(exactInput.m2, M2_INPUT_KEYS, 'exact input M2');
  requireExactKeys(exactInput.m2.admission, M2_ADMISSION_KEYS, 'exact input M2 admission');
  requireExactKeys(
    exactInput.m2.admission.tract,
    M2_TRACT_ADMISSION_KEYS,
    'exact input M2 tract admission',
  );
  requireExactKeys(
    exactInput.m2.admission['fixed-grid'],
    M2_GRID_ADMISSION_KEYS,
    'exact input M2 fixed-grid admission',
  );
  requireExactKeys(exactInput.m2.artifact_policy, ['event_level_data_included'], 'exact input M2 artifact policy');
  const canonical = exactInput.m1.canonical;
  const admission = exactInput.m2.admission;
  const countValues = [
    canonical.partition_count,
    canonical.row_count,
    canonical.bytes,
    exactInput.m2.part_count,
    exactInput.m2.row_count,
    exactInput.m2.bytes,
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
  if (exactInput.protocol.schema !== 'engagement-spatial-attribution-protocol/v2'
    || !SHA256_VALUE_PATTERN.test(exactInput.protocol.sha256 || '')
    || !versionedSchema(exactInput.m1.receipt_schema)
    || !DIGEST_PATTERN.test(exactInput.m1.receipt_identity || '')
    || !SHA256_VALUE_PATTERN.test(exactInput.m1.receipt_sha256 || '')
    || !versionedSchema(exactInput.m1.warehouse_schema)
    || !DIGEST_PATTERN.test(exactInput.m1.warehouse_current_snapshot_id || '')
    || !SHA256_VALUE_PATTERN.test(canonical.sha256 || '')
    || !versionedSchema(exactInput.m2.mart_schema)
    || !SHA256_VALUE_PATTERN.test(exactInput.m2.manifest_sha256 || '')
    || !DIGEST_PATTERN.test(exactInput.m2.artifact_identity || '')
    || !DIGEST_PATTERN.test(exactInput.m2.part_bindings_identity || '')
    || countValues.some((count) => !nonnegativeInteger(count))
    || canonical.partition_count === 0
    || exactInput.m2.part_count === 0
    || exactInput.m2.artifact_policy.event_level_data_included !== false) {
    throw contractError('exact-input-invalid', 'Spatial attribution exact input is invalid.');
  }
  if (canonical.row_count !== admission.canonical_rows_seen) {
    throw contractError(
      'producer-denominator-mismatch',
      'M1 canonical and M2 admission canonical denominators do not match.',
    );
  }
  const eligible = analysisEligibleDenominator(exactInput);
  const tractTotal = Object.values(admission.tract).reduce(countSum, 0);
  const gridTotal = Object.values(admission['fixed-grid']).reduce(countSum, 0);
  if (!nonnegativeInteger(eligible) || tractTotal !== eligible || gridTotal !== eligible) {
    throw contractError(
      'eligibility-denominator-mismatch',
      'M2 spatial admission must reconcile to the derived analysis-eligible denominator.',
    );
  }
  return deepFreeze(exactInput);
}

function analysisEligibleDenominator(exactInput) {
  const admission = exactInput.m2.admission;
  return exactInput.m1.canonical.row_count
    - admission.non_active
    - admission.invalid_event_time
    - admission.unknown_category;
}

function assertAnalysisEligibleRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw contractError('row-invalid', 'Spatial attribution eligible row must be a canonical event object.');
  }
  requireRowIdentity(row.source_record_id);
  if (row.lifecycle?.state !== 'active'
    || !exactTimestamp(row.event_at)
    || row.normalized_category?.status !== 'mapped'
    || typeof row.normalized_category.theme_id !== 'string') {
    throw contractError(
      'row-not-analysis-eligible',
      'Spatial attribution methods accept only active rows with valid time and mapped category.',
    );
  }
}

function requireAccumulatorState(value) {
  const state = ACCUMULATOR_STATES.get(value);
  if (!state) {
    throw contractError('accumulator-invalid', 'Spatial attribution accumulator handle is invalid.');
  }
  return state;
}

function requireRowIdentity(value) {
  const match = typeof value === 'string' && value.length <= 256
    ? value.match(/^cartodb:(\d+)$/)
    : null;
  const sourceId = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw contractError(
      'row-identity-invalid',
      'Spatial attribution row identity must be cartodb:<positive safe integer>.',
    );
  }
  return sourceId;
}

function sourceRowOrder(rowIdentity, partitionCount) {
  const sourceId = requireRowIdentity(rowIdentity);
  return {
    partition: partitionForSourceId(sourceId, partitionCount),
    sourceId,
  };
}

function compareSourceRowOrder(left, right) {
  return left.partition - right.partition || left.sourceId - right.sourceId;
}

function indexCandidateInputs(inputs, rowIdentities) {
  const indexed = new Map();
  for (const input of inputs) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || typeof input.row_identity !== 'string'
      || !WEIGHTED_METHODS.has(input.method)) {
      throw contractError('candidate-input-invalid', 'Spatial attribution candidate input header is invalid.');
    }
    if (!rowIdentities.has(input.row_identity)) {
      throw contractError('candidate-row-unknown', 'Spatial attribution candidate input references an unknown row.');
    }
    const key = candidateKey(input.row_identity, input.method);
    if (indexed.has(key)) {
      throw contractError('candidate-input-duplicate', 'Spatial attribution candidate inputs must be unique per row and method.');
    }
    indexed.set(key, input);
  }
  return indexed;
}

function inspectCandidateInput(value, { rowIdentity, config, tractState }) {
  if (config.configured_unavailable_reason !== null
    || !DIGEST_PATTERN.test(config.input_artifact_identity || '')) {
    return unavailable(config.configured_unavailable_reason || 'input-artifact-unavailable');
  }
  if (value == null) return unavailable('uncertainty-footprint-artifact-unavailable');
  if (!hasExactKeys(value, CANDIDATE_INPUT_KEYS)
    || value.schema !== SPATIAL_ATTRIBUTION_CANDIDATE_WEIGHTS_SCHEMA
    || value.row_identity !== rowIdentity
    || value.method !== config.method) {
    return unavailable('invalid-candidate-input');
  }
  if (value.method_config_identity !== config.config_identity) {
    return unavailable('method-config-mismatch');
  }
  if (value.input_artifact_identity !== config.input_artifact_identity) {
    return unavailable('input-artifact-identity-mismatch');
  }
  if (value.weight_basis !== config.weight_basis || value.acs_weighting !== 'forbidden') {
    return unavailable('forbidden-weight-basis');
  }
  if (value.known_route_segment_kernel_used !== false) {
    return unavailable('known-route-segment-kernel-forbidden');
  }
  if (!hasExactKeys(value.uncertainty_footprint, FOOTPRINT_KEYS)
    || value.uncertainty_footprint.schema !== SPATIAL_ATTRIBUTION_FOOTPRINT_REFERENCE_SCHEMA
    || !DIGEST_PATTERN.test(value.uncertainty_footprint.identity || '')
    || value.uncertainty_footprint.status !== 'admitted'
    || value.uncertainty_footprint.supplied_by !== 'caller'
    || value.uncertainty_footprint.geometry_included !== false) {
    return unavailable('invalid-uncertainty-footprint');
  }
  const normalized = normalizeCandidateWeights(value.candidate_weights, config.tolerance);
  if (!normalized.ok) return unavailable(normalized.reason);
  const identityEvidence = {
    ...value,
    candidate_weights: normalized.weights,
  };
  delete identityEvidence.input_identity;
  if (!DIGEST_PATTERN.test(value.input_identity || '')
    || value.input_identity !== spatialArtifactIdentity(identityEvidence)) {
    return unavailable('candidate-input-identity-drift');
  }
  if (tractState.status === 'invalid') return unavailable('invalid-tract-state');
  const positiveUnits = normalized.weights.filter(({ weight }) => weight >= config.tolerance);
  if (tractState.status !== 'mapped' && (positiveUnits.length < 2
    || positiveUnits.some(({ weight }) => weight > 1 - config.tolerance))) {
    return unavailable('non-probabilistic-uncertain-row');
  }
  if (tractState.status === 'ambiguous') {
    const suppliedUnits = normalized.weights.map(({ unit_id: unitId }) => unitId).sort();
    if (!sameValue(suppliedUnits, tractState.candidates)) {
      return unavailable('ambiguous-candidate-mismatch');
    }
  }
  if (tractState.status === 'mapped'
    && !positiveUnits.some(({ unit_id: unitId }) => unitId === tractState.unitId)) {
    return unavailable('mapped-tract-candidate-mismatch');
  }
  return { ok: true, weights: normalized.weights };
}

function normalizeCandidateWeights(value, tolerance) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) {
    return invalidWeights('invalid-candidate-weights', 'Candidate weights must be a non-empty bounded array.');
  }
  const units = new Set();
  const weights = [];
  for (const candidate of value) {
    if (!hasExactKeys(candidate, CANDIDATE_WEIGHT_KEYS)
      || !TRACT_PATTERN.test(candidate.unit_id || '')) {
      return invalidWeights('invalid-candidate-weights', 'Candidate weight unit is invalid.');
    }
    if (units.has(candidate.unit_id)) {
      return invalidWeights('duplicate-unit', 'Candidate weight units must be unique.');
    }
    units.add(candidate.unit_id);
    if (!Number.isFinite(candidate.weight) || candidate.weight < 0) {
      return invalidWeights('invalid-weight', 'Candidate weights must be finite and nonnegative.');
    }
    weights.push({ unit_id: candidate.unit_id, weight: candidate.weight });
  }
  weights.sort((left, right) => compareText(left.unit_id, right.unit_id));
  const total = stableSum(weights.map(({ weight }) => weight));
  if (!Number.isFinite(total) || Math.abs(total - 1) > tolerance) {
    return invalidWeights('mass-not-conserved', 'Candidate weight mass must sum to one within tolerance.');
  }
  const lastPositiveIndex = weights.findLastIndex(({ weight }) => weight > 0);
  if (lastPositiveIndex < 0) {
    return invalidWeights('mass-not-conserved', 'Candidate weight mass must be positive.');
  }
  let normalizedPrefix = 0;
  const normalized = weights.map((candidate, index) => {
    let weight = candidate.weight === 0 ? 0 : candidate.weight / total;
    if (index === lastPositiveIndex) weight = 1 - normalizedPrefix;
    else normalizedPrefix += weight;
    if (!Number.isFinite(weight) || weight < 0) {
      return null;
    }
    return { unit_id: candidate.unit_id, weight: canonicalNumber(weight) };
  });
  if (normalized.some((candidate) => candidate == null)) {
    return invalidWeights('invalid-weight', 'Normalized candidate weights must be finite and nonnegative.');
  }
  return { ok: true, weights: normalized };
}

function createMethodAccumulator(config, inputRows) {
  return {
    config,
    inputRows,
    massScale: BigInt(Math.round(1 / config.tolerance)),
    assignedRows: 0,
    exclusions: new Map(),
    contributions: new Map(),
  };
}

function addIntegerAssignment(accumulator, unitId, reason) {
  if (reason) {
    excludeRow(accumulator, reason);
    return;
  }
  accumulator.assignedRows += 1;
  addUnitContribution(accumulator, unitId, accumulator.massScale);
}

function addWeightedAssignment(accumulator, weights) {
  accumulator.assignedRows += 1;
  for (const { unitId, quanta } of quantizeWeights(weights, accumulator.massScale)) {
    if (quanta > 0n) addUnitContribution(accumulator, unitId, quanta);
  }
}

function addUnitContribution(accumulator, unitId, massQuanta) {
  const aggregate = accumulator.contributions.get(unitId) || {
    contributingRows: 0,
    massQuanta: 0n,
  };
  aggregate.contributingRows += 1;
  aggregate.massQuanta += massQuanta;
  accumulator.contributions.set(unitId, aggregate);
}

function excludeRow(accumulator, reason) {
  accumulator.exclusions.set(reason, (accumulator.exclusions.get(reason) || 0) + 1);
}

function finalizeMethodAccumulator(accumulator) {
  const { config } = accumulator;
  const aggregates = [...accumulator.contributions.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([unitId, aggregate]) => ({
      unit_id: unitId,
      contributing_rows: aggregate.contributingRows,
      weighted_mass: quantaToNumber(aggregate.massQuanta, accumulator.massScale),
    }));
  const excludedRows = accumulator.inputRows - accumulator.assignedRows;
  const exclusions = [...accumulator.exclusions.entries()]
    .map(([reason, rows]) => ({ reason, rows }))
    .sort((left, right) => compareText(left.reason, right.reason));
  const result = {
    schema: SPATIAL_ATTRIBUTION_METHOD_RESULT_SCHEMA,
    method: config.method,
    method_version: config.method_version,
    unit_type: config.unit_type,
    assignment: config.assignment,
    availability: availability(accumulator.inputRows, accumulator.assignedRows),
    weight_basis: config.weight_basis,
    candidate_weight_contract_identity: config.candidate_weight_contract_identity,
    input_artifact_identity: config.input_artifact_identity,
    unavailable_reason: unavailableReason(
      accumulator.inputRows,
      accumulator.assignedRows,
      exclusions,
      config.configured_unavailable_reason,
    ),
    acs_weighting: config.acs_weighting,
    known_route_segment_kernel: config.known_route_segment_kernel,
    integer_m2_mart_contract: config.integer_m2_mart_contract,
    method_identity: config.method_identity,
    config_identity: config.config_identity,
    input_rows: accumulator.inputRows,
    assigned_rows: accumulator.assignedRows,
    excluded_rows: excludedRows,
    weighted_mass: accumulator.assignedRows > 0 ? accumulator.assignedRows : null,
    tolerance: config.tolerance,
    exclusions,
    aggregates,
  };
  result.result_identity = spatialArtifactIdentity(result);
  return result;
}

function validateMethodResult(value, config, inputRows) {
  requireExactKeys(value, RESULT_KEYS, `method result ${config.method}`);
  if (value.schema !== SPATIAL_ATTRIBUTION_METHOD_RESULT_SCHEMA
    || value.method !== config.method
    || value.method_version !== config.method_version
    || value.unit_type !== config.unit_type
    || value.assignment !== config.assignment
    || value.weight_basis !== config.weight_basis
    || value.candidate_weight_contract_identity !== config.candidate_weight_contract_identity
    || value.input_artifact_identity !== config.input_artifact_identity
    || value.unavailable_reason !== unavailableReason(
      inputRows,
      value.assigned_rows,
      value.exclusions,
      config.configured_unavailable_reason,
    )
    || value.acs_weighting !== 'forbidden'
    || value.known_route_segment_kernel !== 'not-area-attribution'
    || value.integer_m2_mart_contract !== 'independent-unchanged'
    || value.method_identity !== config.method_identity
    || value.config_identity !== config.config_identity
    || value.tolerance !== config.tolerance
    || value.input_rows !== inputRows
    || !nonnegativeInteger(value.assigned_rows)
    || !nonnegativeInteger(value.excluded_rows)
    || value.assigned_rows + value.excluded_rows !== inputRows
    || (value.assigned_rows > 0
      ? !finiteNonnegative(value.weighted_mass)
      : value.weighted_mass !== null)
    || value.availability !== availability(inputRows, value.assigned_rows)) {
    throw contractError('method-result-invalid', `Spatial attribution method result ${config.method} is invalid.`);
  }
  validateExclusions(value.exclusions, value.excluded_rows);
  validateAggregates(value.aggregates, value, config);
  const declaredIdentity = value.result_identity;
  const evidence = structuredClone(value);
  delete evidence.result_identity;
  if (!DIGEST_PATTERN.test(declaredIdentity || '')
    || declaredIdentity !== spatialArtifactIdentity(evidence)) {
    throw contractError('method-result-identity-drift', `Spatial attribution method result ${config.method} identity drifted.`);
  }
}

function validateExclusions(value, expectedRows) {
  if (!Array.isArray(value)) {
    throw contractError('method-exclusions-invalid', 'Spatial attribution method exclusions are invalid.');
  }
  let previous = null;
  let rows = 0;
  for (const exclusion of value) {
    if (!hasExactKeys(exclusion, ['reason', 'rows'])
      || typeof exclusion.reason !== 'string' || !exclusion.reason
      || exclusion.reason <= (previous || '')
      || !nonnegativeInteger(exclusion.rows) || exclusion.rows === 0) {
      throw contractError('method-exclusions-invalid', 'Spatial attribution method exclusions are invalid.');
    }
    previous = exclusion.reason;
    rows += exclusion.rows;
  }
  if (rows !== expectedRows) {
    throw contractError('method-exclusions-invalid', 'Spatial attribution method exclusion rows do not reconcile.');
  }
}

function validateAggregates(value, result, config) {
  if (!Array.isArray(value)) {
    throw contractError('method-aggregates-invalid', 'Spatial attribution method aggregates are invalid.');
  }
  let previous = null;
  const masses = [];
  for (const aggregate of value) {
    const validUnit = config.unit_type === 'fixed-grid'
      ? FIXED_GRID_PATTERN.test(aggregate?.unit_id || '')
      : TRACT_PATTERN.test(aggregate?.unit_id || '');
    if (!hasExactKeys(aggregate, ['unit_id', 'contributing_rows', 'weighted_mass'])
      || !validUnit
      || aggregate.unit_id <= (previous || '')
      || !nonnegativeInteger(aggregate.contributing_rows)
      || aggregate.contributing_rows === 0
      || aggregate.contributing_rows > result.assigned_rows
      || !finiteNonnegative(aggregate.weighted_mass)
      || aggregate.weighted_mass === 0) {
      throw contractError('method-aggregates-invalid', 'Spatial attribution method aggregates are invalid.');
    }
    previous = aggregate.unit_id;
    masses.push(aggregate.weighted_mass);
  }
  if (result.assigned_rows === 0) {
    if (result.weighted_mass !== null || value.length !== 0) {
      throw contractError('method-mass-not-conserved', 'Unavailable spatial attribution mass must remain null.');
    }
    return;
  }
  const aggregateMass = stableSum(masses);
  const allowedDrift = config.tolerance * Math.max(1, result.assigned_rows);
  if (Math.abs(aggregateMass - result.weighted_mass) > allowedDrift
    || Math.abs(result.weighted_mass - result.assigned_rows) > allowedDrift
    || value.length === 0) {
    throw contractError('method-mass-not-conserved', 'Spatial attribution method weighted mass does not reconcile.');
  }
}

function classifyTractState(value) {
  if (value?.status === 'mapped' && TRACT_PATTERN.test(value.geoid || '')) {
    return { status: 'mapped', unitId: value.geoid, candidates: [value.geoid] };
  }
  if (value?.status === 'ambiguous' && value.geoid == null
    && Array.isArray(value.candidates) && value.candidates.length > 0
    && value.candidates.every((candidate) => TRACT_PATTERN.test(candidate))) {
    const candidates = [...new Set(value.candidates)].sort();
    if (candidates.length === value.candidates.length && sameValue(candidates, value.candidates)) {
      return { status: 'ambiguous', unitId: null, candidates };
    }
  }
  if (value?.status === 'unmapped' && value.geoid == null
    && Array.isArray(value.candidates) && value.candidates.length === 0) {
    return { status: 'unmapped', unitId: null, candidates: [] };
  }
  return { status: 'invalid', unitId: null, candidates: [] };
}

function classifyGridState(value) {
  if (value?.status === 'mapped'
    && value.scheme === 'epsg3857-square-grid-v1'
    && value.projectedCellSizeM === 500
    && FIXED_GRID_PATTERN.test(value.gridId || '')) {
    return { status: 'mapped', unitId: value.gridId };
  }
  if (value?.status === 'unavailable' && value.gridId == null
    && value.scheme === 'epsg3857-square-grid-v1'
    && value.projectedCellSizeM === 500) {
    return { status: 'unavailable', unitId: null };
  }
  return { status: 'invalid', unitId: null };
}

function emptySourceSpatialRows() {
  return {
    tract: { mapped: 0, ambiguous: 0, unmapped: 0, invalid: 0 },
    fixed_grid: { mapped: 0, unavailable: 0, invalid: 0 },
  };
}

function validateSourceSpatialRows(value, expectedRows) {
  if (!hasExactKeys(value, ['tract', 'fixed_grid'])
    || !hasExactKeys(value.tract, ['mapped', 'ambiguous', 'unmapped', 'invalid'])
    || !hasExactKeys(value.fixed_grid, ['mapped', 'unavailable', 'invalid'])) {
    throw contractError('source-spatial-rows-invalid', 'Spatial attribution source denominators are invalid.');
  }
  const tractTotal = Object.values(value.tract).reduce(countSum, 0);
  const gridTotal = Object.values(value.fixed_grid).reduce(countSum, 0);
  if (tractTotal !== expectedRows || gridTotal !== expectedRows) {
    throw contractError('source-spatial-rows-invalid', 'Spatial attribution source denominators do not reconcile.');
  }
}

function validateM2SpatialBaseline(sourceSpatialRows, admission) {
  if (sourceSpatialRows.tract.invalid !== 0
    || sourceSpatialRows.fixed_grid.invalid !== 0
    || sourceSpatialRows.tract.mapped !== admission.tract.admitted
    || sourceSpatialRows.tract.ambiguous !== admission.tract.ambiguous_excluded
    || sourceSpatialRows.tract.unmapped !== admission.tract.unmapped_excluded
    || sourceSpatialRows.fixed_grid.mapped !== admission['fixed-grid'].admitted
    || sourceSpatialRows.fixed_grid.unavailable
      !== admission['fixed-grid'].unavailable_excluded) {
    throw contractError(
      'm2-spatial-baseline-mismatch',
      'Spatial attribution eligible-row states drifted from the exact M2 admission baseline.',
    );
  }
}

function tractExclusionReason(status) {
  if (status === 'ambiguous') return 'tract-ambiguous';
  if (status === 'unmapped') return 'tract-unmapped';
  return 'invalid-tract-state';
}

function gridExclusionReason(status) {
  return status === 'unavailable' ? 'grid-unavailable' : 'invalid-grid-state';
}

function availability(inputRows, assignedRows) {
  if (inputRows > 0 && assignedRows === inputRows) return 'available';
  if (assignedRows > 0) return 'partial';
  return 'unavailable';
}

function unavailableReason(inputRows, assignedRows, exclusions, configuredReason) {
  if (assignedRows > 0) return null;
  if (configuredReason) return configuredReason;
  if (inputRows === 0) return 'no-input-rows';
  if (Array.isArray(exclusions) && exclusions.length === 1) return exclusions[0].reason;
  return 'no-admitted-assignments';
}

function requireTolerance(value) {
  if (!Number.isFinite(value) || value < 1e-12 || value > 1e-6) {
    throw contractError(
      'tolerance-invalid',
      'Spatial attribution tolerance must be finite and within [1e-12, 1e-6].',
    );
  }
}

function requireExactKeys(value, keys, label) {
  if (!hasExactKeys(value, keys)) {
    throw contractError('schema-mismatch', `Spatial attribution ${label} has unexpected or missing fields.`);
  }
}

function hasExactKeys(value, keys) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function contractError(code, message) {
  return new SpatialAttributionContractError(code, message);
}

function unavailable(reason) {
  return { ok: false, reason };
}

function invalidWeights(reason, message) {
  return { ok: false, reason, message };
}

function candidateKey(rowIdentity, method) {
  return `${rowIdentity}\u0000${method}`;
}

function exactTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function versionedSchema(value) {
  return typeof value === 'string' && value.length > 3 && value.length <= 256
    && /^[A-Za-z0-9][A-Za-z0-9._:/+-]*\/v\d+$/.test(value);
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function countSum(total, value) {
  if (!nonnegativeInteger(value)) {
    throw contractError('source-spatial-rows-invalid', 'Spatial attribution source count is invalid.');
  }
  return total + value;
}

function stableSum(values) {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const adjusted = value - compensation;
    const next = sum + adjusted;
    compensation = (next - sum) - adjusted;
    sum = next;
  }
  return canonicalNumber(sum);
}

function quantizeWeights(weights, massScale) {
  const scale = Number(massScale);
  const values = weights.map(({ unit_id: unitId, weight }) => {
    const scaled = weight * scale;
    const floor = Math.floor(scaled);
    return {
      unitId,
      quanta: BigInt(floor),
      remainder: scaled - floor,
    };
  });
  const floorTotal = values.reduce((sum, value) => sum + value.quanta, 0n);
  const remaining = massScale - floorTotal;
  if (remaining < 0n || remaining > BigInt(values.length)) {
    throw contractError(
      'weight-quantization-invalid',
      'Normalized candidate weights cannot be deterministically quantized.',
    );
  }
  const ranked = values.map((value, index) => ({ ...value, index }))
    .sort((left, right) => right.remainder - left.remainder
      || compareText(left.unitId, right.unitId));
  for (let index = 0; index < Number(remaining); index += 1) {
    values[ranked[index].index].quanta += 1n;
  }
  return values.map(({ unitId, quanta }) => ({ unitId, quanta }));
}

function quantaToNumber(value, scale) {
  return canonicalNumber(Number(value) / Number(scale));
}

function canonicalNumber(value) {
  return Object.is(value, -0) ? 0 : value;
}

function sameValue(left, right) {
  return spatialArtifactIdentity({ value: left }) === spatialArtifactIdentity({ value: right });
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
