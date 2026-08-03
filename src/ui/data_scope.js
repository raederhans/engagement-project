import '../i18n/p1.js';
import { getLanguage, t } from '../i18n/index.js';

const DATASET_LABEL_KEYS = Object.freeze({
  incidents: 'scope.dataset.incidents',
  districts: 'scope.dataset.districts',
  tracts: 'scope.dataset.tracts',
  demographics: 'scope.dataset.demographics',
  'tract-crime': 'scope.dataset.tractCrime',
});

function formatDate(value, { includeYear = true } = {}) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(getLanguage() === 'zh-CN' ? 'zh-CN' : 'en-US', {
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
    source: source.sourceKey
      ? t(source.sourceKey)
      : String(source.source || t(source.kind === 'fallback' ? 'scope.source.publishedFallback' : 'scope.source.publicApi')),
    asOf: source.asOf ? String(source.asOf) : null,
  });
}

function sourceDetail(source, coverageMax) {
  const label = t(DATASET_LABEL_KEYS[source.dataset] || source.dataset);
  const kind = t(source.kind === 'fallback' ? 'scope.fallback' : 'scope.live').toLowerCase();
  const date = formatDate(source.asOf || (source.dataset === 'incidents' ? coverageMax : null));
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
  const shortDate = formatDate(coverageMax, { includeYear: false });
  const longDate = formatDate(coverageMax);
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
