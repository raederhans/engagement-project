const DATASET_LABELS = Object.freeze({
  incidents: 'Incidents',
  districts: 'Districts',
  tracts: 'Tracts',
  demographics: 'Demographics',
  'tract-crime': 'Tract crime',
});

function formatDate(value, { includeYear = true } = {}) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

function normalizeSource(source) {
  if (!source?.dataset || !source?.kind) return null;
  return Object.freeze({
    dataset: String(source.dataset),
    kind: source.kind === 'fallback' ? 'fallback' : 'live',
    source: String(source.source || (source.kind === 'fallback' ? 'Published fallback' : 'Public API')),
    asOf: source.asOf ? String(source.asOf) : null,
  });
}

function sourceDetail(source, coverageMax) {
  const label = DATASET_LABELS[source.dataset] || source.dataset;
  const kind = source.kind === 'fallback' ? 'fallback' : 'live';
  const date = formatDate(source.asOf || (source.dataset === 'incidents' ? coverageMax : null));
  return `${label}: ${kind} ${source.source}${date ? ` · through ${date}` : ''}`;
}

export function describeCrimeDataScope({ coverageMax = null, sources = [] } = {}) {
  const normalizedSources = sources.map(normalizeSource).filter(Boolean);
  const hasFallback = normalizedSources.some((source) => source.kind === 'fallback');
  const kind = hasFallback ? 'fallback' : 'live';
  const shortDate = formatDate(coverageMax, { includeYear: false });
  const longDate = formatDate(coverageMax);
  const shortLabel = `${hasFallback ? 'Fallback' : 'Live'}${shortDate ? ` · ${shortDate}` : ''}`;
  const accessibleLabel = hasFallback
    ? `Philadelphia crime view uses published fallback data${longDate ? `; incident coverage is through ${longDate}` : ''}.`
    : `Live Philadelphia crime data${longDate ? ` through ${longDate}` : ''}.`;

  return Object.freeze({
    mode: 'crime',
    kind,
    shortLabel,
    accessibleLabel,
    details: Object.freeze(normalizedSources.map((source) => sourceDetail(source, coverageMax))),
  });
}

export function describeDiaryDataScope(viewMode = 'live') {
  if (viewMode === 'history') {
    return Object.freeze({
      mode: 'diary',
      kind: 'local',
      shortLabel: 'Local',
      accessibleLabel: 'My Routes ratings are saved only on this device.',
      details: Object.freeze(['Saved on this device · not shared online']),
    });
  }
  if (viewMode === 'community') {
    return Object.freeze({
      mode: 'diary',
      kind: 'sample',
      shortLabel: 'Sample',
      accessibleLabel: 'Sample Community is illustrative, read-only sample data.',
      details: Object.freeze(['Illustrative sample · read-only · not shared']),
    });
  }
  return Object.freeze({
    mode: 'diary',
    kind: 'sample',
    shortLabel: 'Demo',
    accessibleLabel: 'Live Route uses demo routes; ratings are saved on this device after Save and are not shared online.',
    details: Object.freeze(['Published demo routes · ratings save on this device · not shared online']),
  });
}
