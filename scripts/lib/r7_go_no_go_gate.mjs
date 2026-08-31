import { createHash } from 'node:crypto';

import { admitKnownRouteEvidenceReadiness } from './known_route_evidence_readiness.mjs';

export const R7_GO_NO_GO_REPORT_SCHEMA = 'R7GoNoGoReport/v1';

const FUTURE_CANDIDATE_VOCABULARY = Object.freeze([
  'fastest',
  'balanced',
  'lower-modeled-exposure',
]);
const GATE_IDS = Object.freeze([
  'incidents-crash-separation',
  'manual-calibration',
  'walking-legality',
  'approved-sensitivity-stability',
  'cross-dimension-combination-forbidden',
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AUTHORITY = Object.freeze({
  route_generation: false,
  route_choice: false,
  routing: false,
  safety: false,
  deployment: false,
});

export function evaluateR7GoNoGoGate({ evaluated_at: evaluatedAt, readiness } = {}) {
  timestamp(evaluatedAt, 'evaluated_at');
  const evidence = admitKnownRouteEvidenceReadiness(readiness);
  const dimension = new Map(evidence.dimensions.map((entry) => [entry.dimension_id, entry]));
  const gates = [
    gate(GATE_IDS[0], evidence.incidents_crash_separated === true
      && dimension.has('reported-incidents') && dimension.has('raw-crash'),
    'Reported incidents and raw crash remain distinct evidence dimensions.'),
    gate(GATE_IDS[1], dimension.get('manual-calibration')?.status === 'available',
      'Manual calibration requires an admitted exact receipt.'),
    gate(GATE_IDS[2], dimension.get('walking-legality')?.status === 'available',
      'At least walking legality requires an admitted exact receipt.'),
    gate(GATE_IDS[3], evidence.sensitivity.status === 'available'
      && evidence.sensitivity.approved_scenarios.length >= 2
      && evidence.sensitivity.stable_under_approved_scenarios === true,
    'At least two pre-approved sensitivity scenarios must be available and stable.'),
    gate(GATE_IDS[4], evidence.cross_dimension_combination === 'forbidden',
      'Evidence dimensions must not be collapsed into a combined safety value.'),
  ];
  const passed = gates.every(({ status }) => status === 'PASS');
  const core = {
    schema: R7_GO_NO_GO_REPORT_SCHEMA,
    evaluated_at: evaluatedAt,
    evidence_readiness_identity: evidence.readiness_identity,
    availability: passed ? 'AVAILABLE' : 'UNAVAILABLE',
    decision: passed ? 'GO' : 'NO-GO',
    hard_gates: gates,
    future_candidate_contract: {
      vocabulary: [...FUTURE_CANDIDATE_VOCABULARY],
      required_fields: ['travel_time_cost', 'evidence_coverage'],
      activated: false,
    },
    output_boundary: {
      generated: false,
      prohibited: [
        'route candidates',
        'route rankings',
        'route winner',
        'safest claim',
        'combined safety value',
      ],
    },
    authority: { ...AUTHORITY },
  };
  return admitR7GoNoGoReport({ ...core, report_identity: identity(core) });
}

export function admitR7GoNoGoReport(value) {
  exactKeys(value, [
    'schema', 'evaluated_at', 'evidence_readiness_identity', 'availability', 'decision',
    'hard_gates', 'future_candidate_contract', 'output_boundary', 'authority',
    'report_identity',
  ], 'R7 go/no-go report');
  if (value.schema !== R7_GO_NO_GO_REPORT_SCHEMA
    || !['AVAILABLE', 'UNAVAILABLE'].includes(value.availability)
    || !['GO', 'NO-GO'].includes(value.decision)
    || stable(value.authority) !== stable(AUTHORITY)) {
    throw new TypeError('R7 go/no-go report schema or authority boundary drifted.');
  }
  timestamp(value.evaluated_at, 'evaluated_at');
  requireDigest(value.evidence_readiness_identity, 'evidence_readiness_identity');
  if (!Array.isArray(value.hard_gates) || value.hard_gates.length !== GATE_IDS.length) {
    throw new TypeError('R7 hard-gate inventory drifted.');
  }
  for (const [index, entry] of value.hard_gates.entries()) {
    exactKeys(entry, ['gate_id', 'status', 'reason'], `hard_gates[${index}]`);
    if (entry.gate_id !== GATE_IDS[index]
      || !['PASS', 'FAIL'].includes(entry.status)
      || typeof entry.reason !== 'string' || entry.reason.length < 1) {
      throw new TypeError('R7 hard-gate result drifted.');
    }
  }
  const passed = value.hard_gates.every(({ status }) => status === 'PASS');
  if (value.decision !== (passed ? 'GO' : 'NO-GO')
    || value.availability !== (passed ? 'AVAILABLE' : 'UNAVAILABLE')) {
    throw new TypeError('R7 decision does not mechanically follow hard gates.');
  }
  exactKeys(value.future_candidate_contract, [
    'vocabulary', 'required_fields', 'activated',
  ], 'future candidate contract');
  if (stable(value.future_candidate_contract.vocabulary) !== stable(FUTURE_CANDIDATE_VOCABULARY)
    || stable(value.future_candidate_contract.required_fields)
      !== stable(['travel_time_cost', 'evidence_coverage'])
    || value.future_candidate_contract.activated !== false) {
    throw new TypeError('R7 future candidate contract drifted or was activated.');
  }
  exactKeys(value.output_boundary, ['generated', 'prohibited'], 'R7 output boundary');
  if (value.output_boundary.generated !== false
    || !Array.isArray(value.output_boundary.prohibited)
    || value.output_boundary.prohibited.length !== 5) {
    throw new TypeError('R7 output boundary must remain report-only.');
  }
  const copy = structuredClone(value);
  delete copy.report_identity;
  requireDigest(value.report_identity, 'report_identity');
  if (value.report_identity !== identity(copy)) throw new TypeError('R7 report identity drifted.');
  rejectGeneratedOutputKeys(value);
  return deepFreeze(structuredClone(value));
}

export function r7FutureCandidateVocabulary() {
  return [...FUTURE_CANDIDATE_VOCABULARY];
}

function gate(gateId, passed, reason) {
  return { gate_id: gateId, status: passed ? 'PASS' : 'FAIL', reason };
}

function rejectGeneratedOutputKeys(value) {
  const forbiddenKeys = new Set([
    'routes', 'alternatives', 'ranking', 'rankings', 'winner', 'safest',
    'score', 'scores', 'combined_safety_score',
  ]);
  const visit = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    for (const [key, child] of Object.entries(entry)) {
      if (forbiddenKeys.has(key.toLowerCase())) {
        throw new TypeError(`R7 report contains forbidden generated-output key: ${key}.`);
      }
      visit(child);
    }
  };
  visit(value);
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

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stable(Object.keys(value).sort()) !== stable([...keys].sort())) {
    throw new TypeError(`${label} keys drifted.`);
  }
}

function requireDigest(value, label) {
  if (!SHA256.test(value || '')) throw new TypeError(`${label} must be a SHA-256 identity.`);
}

function timestamp(value, label) {
  if (!CLOCK.test(value || '') || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an exact UTC timestamp.`);
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
