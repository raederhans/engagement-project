import { strictRealCompactJsonParse } from '../../../src/route_generation/real_compact_graph/strict_json_v1.js';

const ACCEPTED_RD_B_CONTRACT = null;
const INSTALLED_RD_C_AUTHORIZATION_RECEIPTS = Object.freeze([]);

export {
  compileSyntheticConstructionObservation,
} from '../../../src/route_generation/real_compact_graph/contract_v1.js';

function fail(message) {
  throw new TypeError(`Real compact graph compiler: ${message}`);
}

function productionDependencyUnavailable(serializedInput) {
  strictRealCompactJsonParse(serializedInput);
  if (ACCEPTED_RD_B_CONTRACT === null
    && INSTALLED_RD_C_AUTHORIZATION_RECEIPTS.length === 0) {
    fail('dependency-contract-unavailable and authority-unavailable: no accepted exact RD-B route-graph-candidate/v1 one-integer-millimetre-cost bridge and no accepted versioned RD-C authorization/proposal receipt contract are installed; the RD-C owner registry is empty; caller Source Health current, self-consistent admission JSON, hashes, reviewedBy text, or brands cannot increase authority');
  }
  fail('dependency-contract-unavailable: production success remains closed until the supervisor supplies accepted exact RD-B and RD-C contracts');
}

/**
 * Production compilation is intentionally unavailable. The primitive JSON is
 * parsed only to preserve the hostile-ingress boundary; none of its caller
 * claims are interpreted as authorization or Source Health authority.
 */
export function compileAdmittedRealCompactGraph(serializedInput) {
  return productionDependencyUnavailable(serializedInput);
}

/**
 * No production artifact schema is frozen while the RD-B/RD-C bridge is under
 * review. Artifact-like caller bytes therefore reach the same unavailable
 * dependency/authority boundary and cannot be admitted by hash or branding.
 */
export function parseAdmittedRealCompactGraphArtifact(serializedArtifact) {
  return productionDependencyUnavailable(serializedArtifact);
}
