import { createHash } from 'node:crypto';

export const UNCERTAINTY_FOOTPRINT_ARTIFACT_SCHEMA = 'UncertaintyFootprintArtifact/v1';
export const SPATIAL_SENSITIVITY_REPORT_SCHEMA = 'SpatialAttributionSensitivityReport/v1';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const METHODS = new Set(['fractional', 'area-kernel']);
const PUBLIC_METHODS = new Set(['tract-fail-closed', 'fixed-grid-500m', 'fractional', 'area-kernel']);
const TOLERANCE = 1e-9;

export function createUncertaintyFootprintArtifact(input) {
  exactKeys(input, [
    'frozen_at', 'source', 'geography', 'scenarios', 'assignments',
  ], 'uncertainty footprint input');
  const source = normalizeSource(input.source);
  const geography = normalizeGeography(input.geography);
  const scenarios = normalizeScenarios(input.scenarios);
  const assignments = normalizeAssignments(input.assignments, scenarios);
  const core = {
    schema: UNCERTAINTY_FOOTPRINT_ARTIFACT_SCHEMA,
    frozen_at: timestamp(input.frozen_at, 'frozen_at'),
    frozen_before_analysis: true,
    source,
    geography,
    scenarios,
    assignments,
    canonical_event_mutation: false,
    privacy: {
      task_owned_ignored_artifact: true,
      source_record_ids_included: false,
      event_ids_included: false,
      coordinates_included: false,
      geometry_in_public_report: false,
    },
    authority: { scientific: false, forecast: false, serving: false, safety: false },
  };
  return admitUncertaintyFootprintArtifact({ ...core, artifact_identity: identity(core) });
}

export function admitUncertaintyFootprintArtifact(value) {
  exactKeys(value, [
    'schema', 'frozen_at', 'frozen_before_analysis', 'source', 'geography', 'scenarios',
    'assignments', 'canonical_event_mutation', 'privacy', 'authority', 'artifact_identity',
  ], 'uncertainty footprint artifact');
  if (value.schema !== UNCERTAINTY_FOOTPRINT_ARTIFACT_SCHEMA
    || value.frozen_before_analysis !== true
    || value.canonical_event_mutation !== false) {
    throw new TypeError('Uncertainty footprint version or immutable-analysis boundary drifted.');
  }
  const normalized = createUncertaintyFootprintArtifactCore(value);
  requireDigest(value.artifact_identity, 'artifact_identity');
  if (value.artifact_identity !== identity(normalized)) {
    throw new TypeError('Uncertainty footprint artifact identity drifted.');
  }
  return deepFreeze(structuredClone(value));
}

export function footprintCandidateWeights(value, scenarioId) {
  const artifact = admitUncertaintyFootprintArtifact(value);
  if (!artifact.scenarios.some(({ id }) => id === scenarioId)) {
    throw new TypeError('Unknown uncertainty footprint scenario.');
  }
  return deepFreeze(artifact.assignments.map((assignment) => ({
    row_token: assignment.row_token,
    method: artifact.scenarios.find(({ id }) => id === scenarioId).method,
    scenario_id: scenarioId,
    input_artifact_identity: artifact.artifact_identity,
    candidate_weights: structuredClone(
      assignment.scenario_weights.find(({ scenario_id: id }) => id === scenarioId).weights,
    ),
    acs_weighting: 'forbidden',
    known_route_segment_kernel_used: false,
  })));
}

export function buildSpatialAttributionSensitivityReport({
  footprint,
  method_results: methodResults,
  population_slices: populationSlices,
  stability_gate: stabilityGate,
}) {
  const artifact = admitUncertaintyFootprintArtifact(footprint);
  const results = normalizeMethodResults(methodResults, artifact);
  const slices = normalizePopulationSlices(populationSlices);
  const gate = normalizeStabilityGate(stabilityGate);

  const tractFamily = results.filter(({ geography }) => geography === 'tract');
  const baseline = tractFamily.find(({ method }) => method === 'tract-fail-closed');
  const units = [...new Set(tractFamily.flatMap(({ aggregates }) => (
    aggregates.map(({ unit_id: unitId }) => unitId)
  )))].sort();
  const baselineRank = rankMap(baseline.aggregates);
  let maxRankShift = 0;
  const variationRows = units.map((unitId) => {
    const values = tractFamily.map((result) => aggregateValue(result, unitId));
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const baselineValue = aggregateValue(baseline, unitId);
    const relativeVariation = maximum === minimum
      ? 0
      : (maximum - minimum) / Math.max(1, baselineValue);
    for (const result of tractFamily) {
      const rank = rankMap(result.aggregates).get(unitId) ?? units.length;
      maxRankShift = Math.max(maxRankShift, Math.abs(rank - (baselineRank.get(unitId) ?? units.length)));
    }
    return {
      unit_id: unitId,
      minimum_mass: canonical(minimum),
      maximum_mass: canonical(maximum),
      relative_variation: canonical(relativeVariation),
      population_slice: slices.get(unitId) ?? 'unavailable',
    };
  });
  variationRows.sort((left, right) => (
    right.relative_variation - left.relative_variation || left.unit_id.localeCompare(right.unit_id)
  ));
  const maxTractVariation = variationRows[0]?.relative_variation ?? 0;
  const massConserved = results.every((result) => (
    result.status === 'available'
    && Math.abs(sum(result.aggregates.map(({ mass }) => mass)) - result.total_mass) <= TOLERANCE
  ));
  const stable = massConserved
    && maxTractVariation <= gate.maximum_tract_relative_variation
    && maxRankShift <= gate.maximum_rank_shift;
  const populationSummary = ['low', 'medium', 'high', 'unavailable'].map((slice) => {
    const rows = variationRows.filter(({ population_slice: value }) => value === slice);
    return {
      slice,
      tract_count: rows.length,
      maximum_relative_variation: canonical(Math.max(0, ...rows.map(({ relative_variation: value }) => value))),
    };
  });
  const core = {
    schema: SPATIAL_SENSITIVITY_REPORT_SCHEMA,
    footprint_identity: artifact.artifact_identity,
    source: structuredClone(artifact.source),
    method_results: results.map((result) => ({
      method: result.method,
      scenario_id: result.scenario_id,
      geography: result.geography,
      status: result.status,
      total_mass: result.status === 'available' ? result.total_mass : null,
      unit_count: result.status === 'available' ? result.aggregates.length : null,
      reason: result.reason,
    })),
    mass_conservation: { passed: massConserved, tolerance: TOLERANCE },
    ranking_change: { maximum_absolute_rank_shift: maxRankShift },
    maximum_tract_relative_variation: maxTractVariation,
    population_slices: populationSummary,
    sensitive_areas: variationRows.slice(0, 25),
    stability_gate: gate,
    stable_under_approved_scenarios: stable,
    prediction_geometry_decision: stable
      ? 'review-required-no-promotion'
      : 'fixed-grid-500m-remains-primary',
    tract_role: 'interpretation-and-acs-audit',
    privacy: {
      aggregate_only: true,
      event_rows_included: false,
      coordinates_included: false,
      uncertainty_geometry_included: false,
    },
    authority: { scientific: false, forecast: false, promotion: false, safety: false },
  };
  return deepFreeze({ ...core, report_identity: identity(core) });
}

function createUncertaintyFootprintArtifactCore(value) {
  const privacy = value.privacy;
  exactKeys(privacy, [
    'task_owned_ignored_artifact', 'source_record_ids_included', 'event_ids_included',
    'coordinates_included', 'geometry_in_public_report',
  ], 'uncertainty privacy');
  if (privacy.task_owned_ignored_artifact !== true
    || Object.entries(privacy).some(([key, entry]) => (
      key !== 'task_owned_ignored_artifact' && entry !== false
    ))) {
    throw new TypeError('Uncertainty footprint privacy boundary drifted.');
  }
  exactKeys(value.authority, ['scientific', 'forecast', 'serving', 'safety'], 'uncertainty authority');
  if (Object.values(value.authority).some((entry) => entry !== false)) {
    throw new TypeError('Uncertainty footprint grants no authority.');
  }
  return {
    schema: UNCERTAINTY_FOOTPRINT_ARTIFACT_SCHEMA,
    frozen_at: timestamp(value.frozen_at, 'frozen_at'),
    frozen_before_analysis: true,
    source: normalizeSource(value.source),
    geography: normalizeGeography(value.geography),
    scenarios: normalizeScenarios(value.scenarios),
    assignments: normalizeAssignments(value.assignments, normalizeScenarios(value.scenarios)),
    canonical_event_mutation: false,
    privacy: structuredClone(value.privacy),
    authority: structuredClone(value.authority),
  };
}

function normalizeSource(value) {
  exactKeys(value, [
    'receipt_identity', 'canonical_manifest_identity', 'coverage_start',
    'coverage_end_exclusive', 'generalized_location_precision', 'producer_identity',
  ], 'uncertainty source');
  for (const key of ['receipt_identity', 'canonical_manifest_identity', 'producer_identity']) {
    requireDigest(value[key], `source.${key}`);
  }
  const start = date(value.coverage_start, 'source.coverage_start');
  const end = date(value.coverage_end_exclusive, 'source.coverage_end_exclusive');
  if (start >= end) throw new TypeError('Uncertainty source coverage is invalid.');
  return {
    receipt_identity: value.receipt_identity,
    canonical_manifest_identity: value.canonical_manifest_identity,
    coverage_start: start,
    coverage_end_exclusive: end,
    generalized_location_precision: text(value.generalized_location_precision, 'generalized precision'),
    producer_identity: value.producer_identity,
  };
}

function normalizeGeography(value) {
  exactKeys(value, ['tract', 'fixed_grid', 'official_centerline'], 'uncertainty geography');
  const tract = geographyDescriptor(value.tract, 'tract');
  const fixedGrid = geographyDescriptor(value.fixed_grid, 'fixed_grid');
  const centerline = geographyDescriptor(value.official_centerline, 'official_centerline', true);
  if (centerline.official !== true || centerline.authority !== 'reference-only') {
    throw new TypeError('Centerline must be versioned official reference geometry only.');
  }
  return { tract, fixed_grid: fixedGrid, official_centerline: centerline };
}

function geographyDescriptor(value, label, centerline = false) {
  exactKeys(value, centerline
    ? ['source_id', 'dataset', 'vintage', 'crs', 'schema_identity', 'catalog_identity', 'official', 'authority']
    : ['source_id', 'dataset', 'vintage', 'crs', 'schema_identity', 'catalog_identity'], label);
  for (const key of ['source_id', 'dataset', 'vintage', 'crs']) {
    if (!IDENTIFIER.test(value[key] || '')) throw new TypeError(`${label}.${key} is invalid.`);
  }
  requireDigest(value.schema_identity, `${label}.schema_identity`);
  requireDigest(value.catalog_identity, `${label}.catalog_identity`);
  return structuredClone(value);
}

function normalizeScenarios(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 16) {
    throw new TypeError('Uncertainty footprint requires at least three pre-frozen scenarios.');
  }
  const ids = new Set();
  const scenarios = value.map((scenario, index) => {
    exactKeys(scenario, [
      'id', 'method', 'analysis_assumption', 'parameters', 'approved',
    ], `scenarios[${index}]`);
    if (!IDENTIFIER.test(scenario.id || '') || ids.has(scenario.id) || !METHODS.has(scenario.method)
      || scenario.approved !== true) {
      throw new TypeError('Uncertainty scenario identity, method, or approval is invalid.');
    }
    ids.add(scenario.id);
    const parameters = normalizeScenarioParameters(scenario.parameters, scenario.method);
    return {
      id: scenario.id,
      method: scenario.method,
      analysis_assumption: text(scenario.analysis_assumption, `scenarios[${index}].analysis_assumption`),
      parameters,
      approved: true,
    };
  });
  if (scenarios.filter(({ method }) => method === 'fractional').length < 1
    || scenarios.filter(({ method }) => method === 'area-kernel').length < 2) {
    throw new TypeError('Uncertainty scenarios require fractional and at least two area-kernel assumptions.');
  }
  return scenarios.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeScenarioParameters(value, method) {
  if (method === 'fractional') {
    exactKeys(value, ['shape', 'radius_m'], 'fractional scenario parameters');
    if (value.shape !== 'uniform-buffer') throw new TypeError('Fractional scenario shape is invalid.');
    positive(value.radius_m, 'fractional radius_m');
  } else {
    exactKeys(value, ['shape', 'bandwidth_m', 'truncation_m'], 'kernel scenario parameters');
    if (value.shape !== 'gaussian') throw new TypeError('Kernel scenario shape is invalid.');
    positive(value.bandwidth_m, 'kernel bandwidth_m');
    positive(value.truncation_m, 'kernel truncation_m');
    if (value.truncation_m < value.bandwidth_m) {
      throw new TypeError('Kernel truncation must not be narrower than bandwidth.');
    }
  }
  return structuredClone(value);
}

function normalizeAssignments(value, scenarios) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('Uncertainty footprint requires assignments.');
  }
  const tokens = new Set();
  const scenarioIds = scenarios.map(({ id }) => id);
  return value.map((assignment, index) => {
    exactKeys(assignment, ['row_token', 'scenario_weights'], `assignments[${index}]`);
    requireDigest(assignment.row_token, `assignments[${index}].row_token`);
    if (tokens.has(assignment.row_token)) throw new TypeError('Uncertainty row token is duplicated.');
    tokens.add(assignment.row_token);
    if (!Array.isArray(assignment.scenario_weights)
      || assignment.scenario_weights.length !== scenarios.length) {
      throw new TypeError('Every uncertainty row requires every pre-frozen scenario.');
    }
    const weights = assignment.scenario_weights.map((scenarioWeight, scenarioIndex) => {
      exactKeys(scenarioWeight, ['scenario_id', 'weights'], `scenario_weights[${scenarioIndex}]`);
      const normalized = normalizeWeights(scenarioWeight.weights);
      return { scenario_id: scenarioWeight.scenario_id, weights: normalized };
    }).sort((left, right) => left.scenario_id.localeCompare(right.scenario_id));
    if (stable(weights.map(({ scenario_id: id }) => id)) !== stable([...scenarioIds].sort())) {
      throw new TypeError('Uncertainty scenario assignment vocabulary drifted.');
    }
    return { row_token: assignment.row_token, scenario_weights: weights };
  }).sort((left, right) => left.row_token.localeCompare(right.row_token));
}

function normalizeWeights(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    throw new TypeError('Scenario weights must be a bounded nonempty array.');
  }
  const units = new Set();
  const weights = value.map((entry, index) => {
    exactKeys(entry, ['unit_id', 'weight'], `weights[${index}]`);
    if (!IDENTIFIER.test(entry.unit_id || '') || units.has(entry.unit_id)
      || !Number.isFinite(entry.weight) || entry.weight < 0) {
      throw new TypeError('Scenario weight unit or value is invalid.');
    }
    units.add(entry.unit_id);
    return { unit_id: entry.unit_id, weight: canonical(entry.weight) };
  }).sort((left, right) => left.unit_id.localeCompare(right.unit_id));
  if (Math.abs(sum(weights.map(({ weight }) => weight)) - 1) > TOLERANCE) {
    throw new TypeError('Scenario weights must conserve one unit of mass.');
  }
  return weights;
}

function normalizeMethodResults(value, artifact) {
  if (!Array.isArray(value) || value.length < 4) {
    throw new TypeError('Sensitivity report requires all four attribution methods.');
  }
  const scenarios = new Map(artifact.scenarios.map((scenario) => [scenario.id, scenario]));
  const seen = new Set();
  const results = value.map((result, index) => {
    exactKeys(result, [
      'method', 'scenario_id', 'geography', 'status', 'reason', 'total_mass', 'aggregates',
    ], `method_results[${index}]`);
    if (!PUBLIC_METHODS.has(result.method)
      || !['tract', 'fixed-grid'].includes(result.geography)
      || !['available', 'unavailable'].includes(result.status)) {
      throw new TypeError('Sensitivity method result vocabulary is invalid.');
    }
    const key = `${result.method}:${result.scenario_id ?? 'none'}`;
    if (seen.has(key)) throw new TypeError('Sensitivity method/scenario result is duplicated.');
    seen.add(key);
    if (['fractional', 'area-kernel'].includes(result.method)) {
      const scenario = scenarios.get(result.scenario_id);
      if (!scenario || scenario.method !== result.method || result.geography !== 'tract') {
        throw new TypeError('Sensitivity weighted result is not bound to an approved scenario.');
      }
    } else if (result.scenario_id !== null
      || (result.method === 'tract-fail-closed') !== (result.geography === 'tract')) {
      throw new TypeError('Sensitivity integer method binding drifted.');
    }
    const reason = text(result.reason, `method_results[${index}].reason`);
    if (result.status === 'unavailable') {
      if (result.total_mass !== null || !Array.isArray(result.aggregates) || result.aggregates.length !== 0) {
        throw new TypeError('Unavailable sensitivity result cannot contain inferred mass.');
      }
      return { ...structuredClone(result), reason };
    }
    nonnegative(result.total_mass, `method_results[${index}].total_mass`);
    if (!Array.isArray(result.aggregates) || result.aggregates.length === 0) {
      throw new TypeError('Available sensitivity result requires aggregates.');
    }
    const units = new Set();
    const aggregates = result.aggregates.map((aggregate, aggregateIndex) => {
      exactKeys(aggregate, ['unit_id', 'mass'], `aggregates[${aggregateIndex}]`);
      if (!IDENTIFIER.test(aggregate.unit_id || '') || units.has(aggregate.unit_id)) {
        throw new TypeError('Sensitivity aggregate unit is invalid or duplicated.');
      }
      nonnegative(aggregate.mass, `aggregates[${aggregateIndex}].mass`);
      units.add(aggregate.unit_id);
      return { unit_id: aggregate.unit_id, mass: canonical(aggregate.mass) };
    }).sort((left, right) => left.unit_id.localeCompare(right.unit_id));
    if (Math.abs(sum(aggregates.map(({ mass }) => mass)) - result.total_mass) > TOLERANCE) {
      throw new TypeError('Sensitivity method mass is not conserved.');
    }
    return { ...structuredClone(result), reason, total_mass: canonical(result.total_mass), aggregates };
  });
  for (const required of ['tract-fail-closed', 'fixed-grid-500m', 'fractional', 'area-kernel']) {
    if (!results.some(({ method }) => method === required)) {
      throw new TypeError(`Sensitivity report is missing ${required}.`);
    }
  }
  for (const scenario of artifact.scenarios) {
    if (!results.some(({ method, scenario_id: id }) => method === scenario.method && id === scenario.id)) {
      throw new TypeError(`Sensitivity report is missing approved scenario ${scenario.id}.`);
    }
  }
  if (results.some(({ status }) => status !== 'available')) {
    throw new TypeError('Complete sensitivity comparison requires every approved method/scenario available.');
  }
  return results;
}

function normalizePopulationSlices(value) {
  if (!Array.isArray(value)) throw new TypeError('Population slices must be an array.');
  const slices = new Map();
  for (const [index, entry] of value.entries()) {
    exactKeys(entry, ['unit_id', 'slice'], `population_slices[${index}]`);
    if (!IDENTIFIER.test(entry.unit_id || '') || slices.has(entry.unit_id)
      || !['low', 'medium', 'high', 'unavailable'].includes(entry.slice)) {
      throw new TypeError('Population slice entry is invalid or duplicated.');
    }
    slices.set(entry.unit_id, entry.slice);
  }
  return slices;
}

function normalizeStabilityGate(value) {
  exactKeys(value, [
    'maximum_tract_relative_variation', 'maximum_rank_shift', 'frozen_before_analysis',
  ], 'stability gate');
  if (value.frozen_before_analysis !== true
    || !Number.isFinite(value.maximum_tract_relative_variation)
    || value.maximum_tract_relative_variation < 0
    || value.maximum_tract_relative_variation > 1
    || !Number.isSafeInteger(value.maximum_rank_shift)
    || value.maximum_rank_shift < 0) {
    throw new TypeError('Spatial stability gate is invalid.');
  }
  return structuredClone(value);
}

function rankMap(aggregates) {
  return new Map([...aggregates]
    .sort((left, right) => right.mass - left.mass || left.unit_id.localeCompare(right.unit_id))
    .map(({ unit_id: unitId }, index) => [unitId, index + 1]));
}

function aggregateValue(result, unitId) {
  return result.aggregates.find(({ unit_id: id }) => id === unitId)?.mass ?? 0;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stable(Object.keys(value).sort()) !== stable([...keys].sort())) {
    throw new TypeError(`${label} contains unknown or missing fields.`);
  }
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} must be an exact UTC timestamp.`);
  }
  return value;
}
function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new TypeError(`${label} must be an exact date.`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) {
    throw new TypeError(`${label} must be bounded nonempty text.`);
  }
  return value;
}

function requireDigest(value, label) {
  if (!SHA256.test(value || '')) throw new TypeError(`${label} must be a prefixed lowercase SHA-256.`);
}

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be positive.`);
}

function nonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be finite and nonnegative.`);
}

function canonical(value) {
  return Number(value.toPrecision(15));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function identity(value) {
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
