import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const SPATIAL_ATTRIBUTION_PROTOCOL_V3_SCHEMA = 'engagement-spatial-attribution-protocol/v3';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SCENARIOS = Object.freeze([
  'fractional-uniform-50m',
  'kernel-gaussian-100m',
  'kernel-gaussian-250m',
]);

export async function loadSpatialAttributionProtocolV3(path = new URL(
  '../data/spatial_attribution_protocol.v3.json',
  import.meta.url,
)) {
  const bytes = await readFile(path);
  if (bytes.includes(13) || bytes.at(-1) !== 10) {
    throw new TypeError('Spatial attribution protocol v3 bytes must be LF-only and end in one LF.');
  }
  const protocol = JSON.parse(bytes.toString('utf8'));
  validateSpatialAttributionProtocolV3(protocol);
  return Object.freeze({
    protocol: deepFreeze(protocol),
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  });
}

export function validateSpatialAttributionProtocolV3(protocol) {
  exactKeys(protocol, [
    'schema', 'schema_version', 'frozen_at', 'frozen_before_weighted_analysis', 'supersedes',
    'exact_input_gate', 'geography_gate', 'uncertainty_footprint', 'approved_scenarios',
    'required_comparison', 'decision_boundary', 'privacy', 'authority',
  ], 'spatial protocol v3');
  if (protocol.schema !== SPATIAL_ATTRIBUTION_PROTOCOL_V3_SCHEMA
    || protocol.schema_version !== 3
    || protocol.frozen_before_weighted_analysis !== true
    || protocol.supersedes.status !== 'historical-immutable') {
    throw new TypeError('Spatial attribution v3 version, freeze point, or v2 history drifted.');
  }
  if (protocol.exact_input_gate.evaluation_protocol_sha256
    !== 'sha256:997aaf5389ab401d0a87e74b749ab4079e26315d4bb8787ad4e1b7051b457dde') {
    throw new TypeError('Spatial attribution v3 must bind the exact 997aaf evaluation protocol.');
  }
  for (const key of [
    'm1_receipt_identity', 'm1_receipt_sha256', 'evaluation_protocol_sha256',
    'mart_manifest_sha256', 'mart_artifact_identity', 'mart_part_bindings_identity',
  ]) {
    if (!SHA256.test(protocol.exact_input_gate[key] || '')) {
      throw new TypeError(`Spatial attribution v3 ${key} is invalid.`);
    }
  }
  if (protocol.exact_input_gate.canonical_row_count !== 3586620
    || protocol.exact_input_gate.mart_part_count !== 128
    || protocol.exact_input_gate.mart_row_count !== 1611918
    || protocol.exact_input_gate.mart_bytes !== 825033042) {
    throw new TypeError('Spatial attribution v3 exact input inventory drifted.');
  }
  if (stable(protocol.approved_scenarios.map(({ id }) => id)) !== stable(SCENARIOS)
    || protocol.approved_scenarios[0].method !== 'fractional'
    || protocol.approved_scenarios.slice(1).some(({ method }) => method !== 'area-kernel')) {
    throw new TypeError('Spatial attribution v3 approved scenarios drifted.');
  }
  if (protocol.geography_gate.official_centerline.current_status !== 'unavailable'
    || protocol.geography_gate.official_centerline.exact_schema_catalog_and_geometry_identity_required !== true
    || protocol.geography_gate.official_centerline.authority !== 'reference-only') {
    throw new TypeError('Spatial attribution v3 centerline boundary drifted.');
  }
  if (protocol.uncertainty_footprint.schema !== 'UncertaintyFootprintArtifact/v1'
    || protocol.uncertainty_footprint.canonical_event_mutation !== false
    || protocol.uncertainty_footprint.known_route_segment_kernel !== 'forbidden') {
    throw new TypeError('Spatial attribution v3 uncertainty contract drifted.');
  }
  if (protocol.required_comparison.stability_gate.all_approved_scenarios_required !== true
    || protocol.decision_boundary.unstable_result !== 'fixed-grid-500m-remains-primary'
    || protocol.decision_boundary.forecast_promotion !== false
    || protocol.privacy.aggregate_only !== true
    || Object.entries(protocol.privacy).some(([key, value]) => key !== 'aggregate_only' && value !== false)
    || Object.values(protocol.authority).some((value) => value !== false)) {
    throw new TypeError('Spatial attribution v3 privacy, gate, or authority boundary drifted.');
  }
  return protocol;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stable(Object.keys(value).sort()) !== stable([...keys].sort())) {
    throw new TypeError(`${label} contains unknown or missing fields.`);
  }
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
