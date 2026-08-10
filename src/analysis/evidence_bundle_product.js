import { buildEvidenceBundleSections } from './evidence_bundle.js';
import {
  buildEvidenceBundleV2Sections,
  composeEvidenceBundleV2,
} from './evidence_bundle_v2.js';
import {
  evidenceBundleSourceAdapter,
  projectSourceHealthEvidence,
} from './evidence_bundle_source_adapter.js';
import { createSourceHealthObservations } from '../source_health/source_health_adapters.js';
import { SOURCE_HEALTH_CATALOG } from '../source_health/source_health_catalog.js';
import { buildSourceHealthReadModel } from '../source_health/source_health_read_model.js';

const CRIME_SOURCE_ID = 'philadelphia-reported-crime';

function exactTimestamp(value, label) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be an exact ISO timestamp`);
  }
  return value;
}

function analysisTime(value, generatedAt) {
  if (value == null) return null;
  exactTimestamp(value, 'analysisGeneratedAt');
  if (value > generatedAt) throw new TypeError('analysisGeneratedAt must not be after generatedAt');
  return value;
}

/**
 * Product-only Crime writer. Heavy source and v2 modules remain behind the
 * feature-flagged dynamic import owned by the Crime panel.
 */
export async function composeCrimeEvidenceBundleV2({
  generatedAt = new Date().toISOString(),
  analysisGeneratedAt = null,
  filters = {},
  comparison = null,
  crimeCoverage = {},
} = {}) {
  exactTimestamp(generatedAt, 'generatedAt');
  const observations = createSourceHealthObservations({ crimeCoverage }, {
    now: new Date(generatedAt),
  });
  const sourceHealth = buildSourceHealthReadModel({
    catalog: SOURCE_HEALTH_CATALOG,
    observations,
  });
  const sources = projectSourceHealthEvidence(sourceHealth, [CRIME_SOURCE_ID]);
  const legacySections = buildEvidenceBundleSections({
    filters,
    comparison,
    source: { status: sources[0].status === 'unavailable' ? 'unavailable' : 'available' },
  });
  const input = buildEvidenceBundleV2Sections({
    generatedAt,
    analysisGeneratedAt: analysisTime(analysisGeneratedAt, generatedAt),
    query: legacySections.query,
    result: legacySections.result,
    sourceContractVersion: evidenceBundleSourceAdapter.contractVersion,
    sourceReadModels: sources,
    uncertainty: {
      status: legacySections.result.status === 'unavailable' ? 'unavailable' : 'partial',
      statements: [
        'Counts describe admitted historical aggregate records; no complete statistical interval is claimed.',
      ],
    },
    limitations: legacySections.limitations,
  });
  return composeEvidenceBundleV2(input, { sourceAdapter: evidenceBundleSourceAdapter });
}
