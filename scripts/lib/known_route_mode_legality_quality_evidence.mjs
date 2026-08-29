import fs from 'node:fs/promises';
import {
  KNOWN_ROUTE_MODE_LEGALITY_QUALITY_SCHEMA,
  createKnownRouteModeLegalityQualityEvidence,
  validateKnownRouteModeLegalityQualityEvidence as validateRuntimeEvidence,
} from '../../src/routes_crime/known_route_mode_legality_quality.js';

export { KNOWN_ROUTE_MODE_LEGALITY_QUALITY_SCHEMA };

const schema = JSON.parse(await fs.readFile(
  new URL('../data/known_route_mode_legality_quality_evidence.schema.json', import.meta.url),
  'utf8',
));

export function buildKnownRouteModeLegalityQualityEvidence(inputs) {
  return validateKnownRouteModeLegalityQualityEvidence(
    createKnownRouteModeLegalityQualityEvidence(inputs),
  );
}

export function validateKnownRouteModeLegalityQualityEvidence(value) {
  return validateRuntimeEvidence(value);
}

export function knownRouteModeLegalityQualityEvidenceSchema() {
  return structuredClone(schema);
}
