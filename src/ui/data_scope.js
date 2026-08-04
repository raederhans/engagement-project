import '../i18n/p1.js';
import { t } from '../i18n/index.js';
import { formatCalendarDate } from '../i18n/date.js';
export { normalizeCrimeDataSources } from './crime_data_sources.js';

const DATASET_LABEL_KEYS = Object.freeze({
  incidents: 'scope.dataset.incidents',
  districts: 'scope.dataset.districts',
  tracts: 'scope.dataset.tracts',
  demographics: 'scope.dataset.demographics',
  'tract-crime': 'scope.dataset.tractCrime',
});

function cleanText(value) {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  return text || null;
}

function normalizeSource(source) {
  if (!source?.dataset || !source?.kind) return null;
  const provider = cleanText(source.provider ?? source.source);
  return Object.freeze({
    dataset: String(source.dataset),
    kind: source.kind === 'fallback' ? 'fallback' : 'live',
    source: source.sourceKey
      ? t(source.sourceKey)
      : String(provider || t(source.kind === 'fallback' ? 'scope.source.publishedFallback' : 'scope.source.publicApi')),
    asOf: source.asOf ? String(source.asOf) : null,
  });
}

function sourceDetail(source, coverageMax) {
  const label = t(DATASET_LABEL_KEYS[source.dataset] || source.dataset);
  const kind = t(source.kind === 'fallback' ? 'scope.fallback' : 'scope.live').toLowerCase();
  const date = formatCalendarDate(source.asOf || (source.dataset === 'incidents' ? coverageMax : null));
  return t('scope.sourceDetail', {
    dataset: label,
    kind,
    source: source.source,
    date: date ? ` · ${t('scope.through', { date })}` : '',
  });
}

function withLocaleResolver(scope, resolve) {
  Object.defineProperty(scope, 'resolve', {
    value: resolve,
    enumerable: false,
  });
  return Object.freeze(scope);
}

export function describeCrimeDataScope({ coverageMax = null, sources = [] } = {}) {
  const normalizedSources = sources.map(normalizeSource).filter(Boolean);
  const hasFallback = normalizedSources.some((source) => source.kind === 'fallback');
  const kind = hasFallback ? 'fallback' : 'live';
  const shortDate = formatCalendarDate(coverageMax, { includeYear: false });
  const longDate = formatCalendarDate(coverageMax);
  const shortLabel = `${t(hasFallback ? 'scope.fallback' : 'scope.live')}${shortDate ? ` · ${shortDate}` : ''}`;
  const accessibleLabel = t(hasFallback ? 'scope.crime.fallback' : 'scope.crime.live', {
    date: longDate
      ? t(hasFallback ? 'scope.crime.fallbackCoverage' : 'scope.crime.liveCoverage', { date: longDate })
      : '',
  });

  return withLocaleResolver({
    mode: 'crime',
    kind,
    shortLabel,
    accessibleLabel,
    details: Object.freeze(normalizedSources.map((source) => sourceDetail(source, coverageMax))),
  }, () => describeCrimeDataScope({ coverageMax, sources }));
}

export function describeDiaryDataScope(viewMode = 'live') {
  if (viewMode === 'history') {
    return withLocaleResolver({
      mode: 'diary',
      kind: 'local',
      shortLabel: t('scope.diary.localLabel'),
      accessibleLabel: t('scope.diary.localAccessible'),
      details: Object.freeze([t('scope.diary.localDetails')]),
    }, () => describeDiaryDataScope(viewMode));
  }
  if (viewMode === 'community') {
    return withLocaleResolver({
      mode: 'diary',
      kind: 'sample',
      shortLabel: t('scope.diary.sampleLabel'),
      accessibleLabel: t('scope.diary.sampleAccessible'),
      details: Object.freeze([t('scope.diary.sampleDetails')]),
    }, () => describeDiaryDataScope(viewMode));
  }
  return withLocaleResolver({
    mode: 'diary',
    kind: 'sample',
    shortLabel: t('scope.diary.demoLabel'),
    accessibleLabel: t('scope.diary.demoAccessible'),
    details: Object.freeze([t('scope.diary.demoDetails')]),
  }, () => describeDiaryDataScope(viewMode));
}
