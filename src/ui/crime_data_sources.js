import { CARTO_SQL_BASE } from '../config.js';

function cleanText(value) {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  return text || null;
}

function provenComparisonTime(snapshot) {
  const value = snapshot?.comparison?.a ? snapshot.generatedAt : null;
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value ? value : null;
}

export function buildCrimeEvidenceSource({
  coverageMin = null,
  coverageMax = null,
  comparisonSnapshot = null,
} = {}) {
  return {
    id: 'philadelphia-reported-crime',
    dataset: 'incidents_part1_part2',
    status: 'available',
    url: CARTO_SQL_BASE,
    provider: 'City of Philadelphia via CARTO',
    vintage: coverageMax || null,
    asOf: coverageMax || null,
    retrievedAt: provenComparisonTime(comparisonSnapshot),
    revisionPolicy: 'Provider records may be revised after retrieval; this bundle does not include a revision timeline.',
    coverage: {
      start: coverageMin || null,
      end: coverageMax || null,
      geography: 'Philadelphia',
    },
    snapshotIdentity: coverageMin && coverageMax
      ? `coverage:${coverageMin}:${coverageMax}`
      : null,
  };
}

export function normalizeCrimeDataSources(sources = []) {
  if (!Array.isArray(sources)) return Object.freeze([]);
  return Object.freeze(sources.flatMap((source) => {
    const dataset = cleanText(source?.dataset);
    const provider = cleanText(source?.provider ?? source?.source);
    if (!dataset || !provider || !['live', 'fallback'].includes(source?.kind)) return [];
    const normalized = { dataset, kind: source.kind, provider };
    const asOf = cleanText(source.asOf);
    if (asOf) normalized.asOf = asOf;
    return [Object.freeze(normalized)];
  }));
}
