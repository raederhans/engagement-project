import { t } from '../i18n/index.js';
import { formatCalendarDate } from '../i18n/date.js';
import { registerMessagePairs } from '../i18n/messages.js';
export { normalizeCrimeDataSources } from './crime_data_sources.js';

registerMessagePairs({
  'scope.live': ['Data available', '数据可用'],
  'scope.fallback': ['Fallback', '备用'],
  'scope.local': ['Local', '本地'],
  'scope.sample': ['Sample', '示例'],
  'scope.demo': ['Demo', '演示'],
  'scope.dataset.incidents': ['Incidents', '事件'],
  'scope.dataset.districts': ['Districts', '分局'],
  'scope.dataset.tracts': ['Tracts', '普查区'],
  'scope.dataset.demographics': ['Demographics', '人口统计'],
  'scope.dataset.tractCrime': ['Tract crime', '普查区犯罪数据'],
  'scope.source.publishedFallback': ['Published fallback', '已发布备用数据'],
  'scope.source.publicApi': ['Public API', '公共 API'],
  'scope.source.validatedTractSnapshot': ['Validated tract snapshot', '已验证的普查区快照'],
  'scope.through': ['records through {date}', '记录截至 {date}'],
  'scope.sourceDetail': ['{dataset}: {kind} {source}{date}', '{dataset}：{kind} {source}{date}'],
  'scope.crime.live': ['Historical reported records are available{date}. This is not a live alert.', '可查看历史上报记录{date}；这不是实时警报。'],
  'scope.crime.fallback': ['Philadelphia crime view uses published fallback data{date}.', '费城犯罪数据视图使用已发布的备用数据{date}。'],
  'scope.crime.liveCoverage': [' through {date}', '，截至 {date}'],
  'scope.crime.fallbackCoverage': ['; incident coverage is through {date}', '；事件数据覆盖至 {date}'],
  'scope.diary.localLabel': ['Local', '本地'],
  'scope.diary.localAccessible': ['My Routes ratings are saved only on this device.', '“我的路线”评分仅保存在此设备上。'],
  'scope.diary.localDetails': ['Saved on this device · not shared online', '保存在此设备 · 不会在线共享'],
  'scope.diary.sampleTruth': ['Static, invented, read-only examples—not real-time, user-submitted, or safety ratings.', '静态虚构的只读示例；不是实时信息、用户提交内容或安全评级。'],
  'scope.diary.sampleLabel': ['Static samples', '静态示例'],
  'scope.diary.demoLabel': ['Demo', '演示'],
  'scope.diary.demoAccessible': ['Live Route uses demo routes; ratings are saved on this device after Save and are not shared online.', '“当前路线”使用演示路线；评分在保存后仅存于此设备，不会在线共享。'],
  'scope.diary.demoDetails': ['Published demo routes · ratings save on this device · not shared online', '已发布演示路线 · 评分保存在此设备 · 不会在线共享'],
});

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
  const shortLabel = `${t(hasFallback ? 'scope.fallback' : 'scope.live')}${shortDate ? ` · ${t('scope.through', { date: shortDate })}` : ''}`;
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
    const sampleTruth = t('scope.diary.sampleTruth');
    return withLocaleResolver({
      mode: 'diary',
      kind: 'sample',
      shortLabel: t('scope.diary.sampleLabel'),
      accessibleLabel: sampleTruth,
      details: Object.freeze([sampleTruth]),
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
