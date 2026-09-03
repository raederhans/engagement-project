import {
  getLanguage,
  onLanguageChange,
  t,
} from '../i18n/index.js';
import { localizeOffenseCode } from '../i18n/crime_offenses.js';
import { formatCalendarDate } from '../i18n/date.js';
import { normalizeCrimeDataSources } from './crime_data_sources.js';

const QUERY_MODES = new Set(['buffer', 'district', 'tract', 'citywide']);
const ADMIN_LEVELS = new Set(['districts', 'tracts']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATASET_KEYS = Object.freeze({
  incidents: 'scope.dataset.incidents',
  districts: 'scope.dataset.districts',
  tracts: 'scope.dataset.tracts',
  demographics: 'scope.dataset.demographics',
  'tract-crime': 'scope.dataset.tractCrime',
});
const KIND_KEYS = Object.freeze({
  live: 'scope.live',
  fallback: 'scope.fallback',
});
const MODE_KEYS = Object.freeze({
  buffer: 'resultMeta.mode.buffer',
  district: 'resultMeta.mode.district',
  tract: 'resultMeta.mode.tract',
  citywide: 'resultMeta.mode.citywide',
});
const ADMIN_KEYS = Object.freeze({
  districts: 'resultMeta.admin.districts',
  tracts: 'resultMeta.admin.tracts',
});
const RESULT_KEYS = Object.freeze({
  boundary: 'resultMeta.result.boundary',
  incidents: 'resultMeta.result.incidents',
  charts: 'resultMeta.result.charts',
  summary: 'resultMeta.result.summary',
  'incident-query': 'resultMeta.result.incidentQuery',
});
const RETRY_KEYS = Object.freeze({
  boundary: 'resultMeta.retry.boundary',
  incidents: 'resultMeta.retry.incidents',
  charts: 'resultMeta.retry.charts',
  summary: 'resultMeta.retry.summary',
});

const COPY = Object.freeze({
  en: Object.freeze({
    'resultMeta.current': 'Current result',
    'resultMeta.partial': 'Partial result · some data unavailable',
    'resultMeta.loading': 'Updating result…',
    'resultMeta.stale': 'Previous result · update failed',
    'resultMeta.unavailable': 'Result unavailable',
    'resultMeta.retry': 'Retry result query',
    'resultMeta.retry.boundary': 'Retry map result',
    'resultMeta.retry.incidents': 'Retry incidents',
    'resultMeta.retry.charts': 'Retry chart result',
    'resultMeta.retry.summary': 'Retry summary',
    'resultMeta.details': 'Result details',
    'incidents.dataDetails': 'Data scope and notes',
    'resultMeta.generated': 'Generated {value}',
    'resultMeta.source': '{dataset}: {provider} ({kind}){asOf}',
    'resultMeta.coverage': 'Coverage {start} to {end}{asOf}',
    'resultMeta.scope': '{mode}: {selection}{radius}{offenses}',
    'resultMeta.scope.citywide': 'Citywide map · geography {adminLevel} · tract overlay {overlay}{offenses}',
    'resultMeta.radius': ' · radius {value}',
    'resultMeta.offenses': ' · offenses {value}',
    'resultMeta.asOf': ' · as of {value}',
    'resultMeta.mode.buffer': 'Buffer analysis',
    'resultMeta.mode.district': 'District analysis',
    'resultMeta.mode.tract': 'Tract analysis',
    'resultMeta.mode.citywide': 'Citywide',
    'resultMeta.admin.districts': 'police districts',
    'resultMeta.admin.tracts': 'census tracts',
    'resultMeta.overlay.shown': 'shown',
    'resultMeta.overlay.hidden': 'hidden',
    'resultMeta.result.boundary': 'Map boundaries',
    'resultMeta.result.incidents': 'Incident details',
    'resultMeta.result.charts': 'Charts',
    'resultMeta.result.summary': 'Summary',
    'resultMeta.result.incidentQuery': 'Incident query',
    'scope.live': 'Data',
    'scope.fallback': 'Fallback',
    'scope.dataset.incidents': 'Incidents',
    'scope.dataset.districts': 'Districts',
    'scope.dataset.tracts': 'Tracts',
    'scope.dataset.demographics': 'Demographics',
    'scope.dataset.tractCrime': 'Tract crime',
    'resultMeta.limit.boundaryPartial': 'Some map layers are unavailable.',
    'resultMeta.limit.incidentsPartial': 'Some incident details are unavailable.',
    'resultMeta.limit.chartsPartial': 'Some chart views are unavailable.',
    'resultMeta.limit.summaryPartial': 'Some summary metrics are unavailable.',
    'resultMeta.limit.reportedRecords': 'Counts use source records; one record is not guaranteed to equal one unique incident.',
    'resultMeta.limit.generalizedLocations': 'Incident locations are generalized to the hundred block by the source.',
  }),
  'zh-CN': Object.freeze({
    'resultMeta.current': '当前结果',
    'resultMeta.partial': '部分结果 · 部分数据不可用',
    'resultMeta.loading': '正在更新结果…',
    'resultMeta.stale': '先前结果 · 更新失败',
    'resultMeta.unavailable': '结果不可用',
    'resultMeta.retry': '重试结果查询',
    'resultMeta.retry.boundary': '重试地图结果',
    'resultMeta.retry.incidents': '重试事件详情',
    'resultMeta.retry.charts': '重试图表结果',
    'resultMeta.retry.summary': '重试摘要',
    'resultMeta.details': '结果详情',
    'incidents.dataDetails': '数据范围与说明',
    'resultMeta.generated': '生成于 {value}',
    'resultMeta.source': '{dataset}：{provider}（{kind}）{asOf}',
    'resultMeta.coverage': '覆盖范围 {start} 至 {end}{asOf}',
    'resultMeta.scope': '{mode}：{selection}{radius}{offenses}',
    'resultMeta.scope.citywide': '全市地图 · 地理单元 {adminLevel} · 普查区叠加层{overlay}{offenses}',
    'resultMeta.radius': ' · 半径 {value}',
    'resultMeta.offenses': ' · 类别 {value}',
    'resultMeta.asOf': ' · 截至 {value}',
    'resultMeta.mode.buffer': '缓冲区分析',
    'resultMeta.mode.district': '分局分析',
    'resultMeta.mode.tract': '普查区分析',
    'resultMeta.mode.citywide': '全市',
    'resultMeta.admin.districts': '警察分局',
    'resultMeta.admin.tracts': '人口普查区',
    'resultMeta.overlay.shown': '已显示',
    'resultMeta.overlay.hidden': '未显示',
    'resultMeta.result.boundary': '地图边界',
    'resultMeta.result.incidents': '事件详情',
    'resultMeta.result.charts': '图表',
    'resultMeta.result.summary': '摘要',
    'resultMeta.result.incidentQuery': '事件查询',
    'scope.live': '数据',
    'scope.fallback': '备用',
    'scope.dataset.incidents': '事件',
    'scope.dataset.districts': '分局',
    'scope.dataset.tracts': '普查区',
    'scope.dataset.demographics': '人口统计',
    'scope.dataset.tractCrime': '普查区犯罪数据',
    'resultMeta.limit.boundaryPartial': '部分地图图层暂不可用。',
    'resultMeta.limit.incidentsPartial': '部分事件详情暂不可用。',
    'resultMeta.limit.chartsPartial': '部分图表暂不可用。',
    'resultMeta.limit.summaryPartial': '部分摘要指标暂不可用。',
    'resultMeta.limit.reportedRecords': '数量按来源记录计算；一条记录不一定等于一起唯一案件。',
    'resultMeta.limit.generalizedLocations': '事件位置由数据源泛化到百号街区，并非精确门牌。',
  }),
});

function cleanText(value) {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  return text || null;
}

function interpolate(template, params = {}) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    Object.hasOwn(params, key) ? String(params[key]) : match
  ));
}

function localCopy(key, params, translate = t) {
  const translated = translate(key, params);
  if (translated !== key) return translated;
  const template = COPY[getLanguage()]?.[key] ?? COPY.en[key] ?? key;
  return interpolate(template, params);
}

function translatedCode(value, keys, copy) {
  const key = keys[value];
  return key ? copy(key) : cleanText(value) || '';
}

function resultLabel(result, copy) {
  const value = cleanText(result?.label ?? result?.kind ?? result?.type);
  return translatedCode(value, RESULT_KEYS, copy);
}

function selectionLabel(selection) {
  return Array.isArray(selection) ? selection.join(', ') : String(selection);
}

function prepareView(provenance, availability, { translate, formatDate }) {
  const copy = (key, params = {}) => localCopy(key, params, translate);
  const dated = (value) => formatDate(value) || value;
  const asOf = (value) => value ? copy('resultMeta.asOf', { value: dated(value) }) : '';
  const statusKey = availability === 'stale'
    ? 'resultMeta.stale'
    : availability === 'partial' ? 'resultMeta.partial' : 'resultMeta.current';
  const scope = provenance.scope;
  const radius = scope.radius == null ? '' : copy('resultMeta.radius', { value: scope.radius });
  const offenses = scope.offenseCodes.length
    ? copy('resultMeta.offenses', { value: scope.offenseCodes.map((code) => localizeOffenseCode(code)).join(', ') })
    : '';
  const scopeText = scope.queryMode === 'citywide'
    ? copy('resultMeta.scope.citywide', {
      adminLevel: translatedCode(scope.adminLevel, ADMIN_KEYS, copy),
      overlay: copy(scope.overlayTractsLines ? 'resultMeta.overlay.shown' : 'resultMeta.overlay.hidden'),
      offenses,
    })
    : copy('resultMeta.scope', {
      mode: translatedCode(scope.queryMode, MODE_KEYS, copy),
      selection: selectionLabel(scope.selection),
      radius,
      offenses,
    });
  return Object.freeze({
    status: copy(statusKey),
    result: resultLabel(provenance.result, copy),
    generated: copy('resultMeta.generated', { value: dated(provenance.generatedAt) }),
    sources: provenance.sources.map((source) => copy('resultMeta.source', {
      dataset: translatedCode(source.dataset, DATASET_KEYS, copy),
      provider: source.provider,
      kind: translatedCode(source.kind, KIND_KEYS, copy),
      asOf: asOf(source.asOf),
    })).join(' · '),
    coverage: copy('resultMeta.coverage', {
      start: dated(provenance.coverage.start),
      end: dated(provenance.coverage.end),
      asOf: asOf(provenance.coverage.asOf),
    }),
    scope: scopeText,
    limitations: provenance.limitations.map((key) => localCopy(key, {}, translate)).join(' · '),
  });
}

function noopPresenter() {
  return Object.freeze({
    loading: () => null,
    ready: () => false,
    failed: () => false,
    cancel: () => false,
    clear: () => false,
    getAvailability: () => 'unavailable',
    getProvenance: () => null,
    destroy() {},
  });
}

export function createCrimeResultMetaPresenter({
  root = globalThis.document?.querySelector?.('[data-result-meta]'),
  translate = t,
  formatDate = formatCalendarDate,
  languageChange = onLanguageChange,
  onRetry = () => {},
} = {}) {
  if (!root?.querySelector) return noopPresenter();
  const nodes = Object.fromEntries([
    'status', 'result', 'generated', 'sources', 'coverage', 'scope', 'limitations', 'retry', 'details',
  ].map((name) => [name, root.querySelector(`[data-result-meta-${name}]`)]));
  const surface = cleanText(root.dataset?.resultMeta);
  const retryKey = RETRY_KEYS[surface] || 'resultMeta.retry';
  const detailsKey = surface === 'incidents' ? 'incidents.dataDetails' : 'resultMeta.details';
  let provenance = null;
  let availability = 'unavailable';
  let failure = null;
  let activeToken = null;
  let pendingState = null;
  let destroyed = false;

  const setRetryLabel = () => {
    if (!nodes.retry) return;
    const label = localCopy(retryKey, {}, translate);
    nodes.retry.setAttribute?.('aria-label', label);
    nodes.retry.textContent = label;
  };

  const commit = (view) => {
    for (const key of ['status', 'result', 'generated', 'sources', 'coverage', 'scope', 'limitations']) {
      if (nodes[key]) nodes[key].textContent = view[key];
    }
    root.dataset.availability = availability;
    root.setAttribute?.('aria-busy', 'false');
    if (nodes.retry) nodes.retry.hidden = availability === 'current';
  };

  const renderUnavailable = ({ retry = Boolean(failure) } = {}) => {
    root.dataset.availability = availability;
    root.setAttribute?.('aria-busy', 'false');
    if (nodes.status) nodes.status.textContent = localCopy('resultMeta.unavailable', {}, translate);
    for (const key of ['result', 'generated', 'sources', 'coverage', 'scope', 'limitations']) {
      if (nodes[key]) nodes[key].textContent = '';
    }
    if (nodes.retry) nodes.retry.hidden = !retry;
  };

  const redraw = (options = {}) => {
    if (!provenance || destroyed) return false;
    const view = prepareView(provenance, availability, {
      translate: options.translate || translate,
      formatDate: options.formatDate || formatDate,
    });
    commit(view);
    return true;
  };

  const matchesToken = (token) => (
    activeToken === null ? token == null : token === activeToken
  );
  const finishPending = () => {
    activeToken = null;
    pendingState = null;
  };

  const onRetryClick = () => {
    if (!destroyed) onRetry();
  };
  if (nodes.retry) {
    nodes.retry.addEventListener?.('click', onRetryClick);
    setRetryLabel();
    nodes.retry.hidden = true;
  }
  if (nodes.details) nodes.details.textContent = localCopy(detailsKey, {}, translate);
  const releaseLanguage = languageChange?.(() => {
    setRetryLabel();
    if (nodes.details) nodes.details.textContent = localCopy(detailsKey, {}, translate);
    if (activeToken !== null) {
      root.setAttribute?.('aria-busy', 'true');
      if (nodes.status) nodes.status.textContent = localCopy('resultMeta.loading', {}, translate);
      if (nodes.retry) nodes.retry.hidden = true;
      return;
    }
    if (provenance) redraw();
    else renderUnavailable();
  }) || (() => {});

  return Object.freeze({
    loading() {
      if (destroyed) return null;
      const token = Symbol(`crime-result-${surface || 'surface'}`);
      activeToken = token;
      pendingState = { provenance, availability, failure };
      root.setAttribute?.('aria-busy', 'true');
      if (nodes.status) nodes.status.textContent = localCopy('resultMeta.loading', {}, translate);
      if (nodes.retry) nodes.retry.hidden = true;
      return token;
    },
    ready(nextProvenance, options = {}) {
      const nextAvailability = options.availability || 'current';
      if (destroyed
        || !matchesToken(options.token)
        || !Object.isFrozen(nextProvenance)
        || !['current', 'partial'].includes(nextAvailability)) return false;
      const view = prepareView(nextProvenance, nextAvailability, {
        translate: options.translate || translate,
        formatDate: options.formatDate || formatDate,
      });
      provenance = nextProvenance;
      availability = nextAvailability;
      failure = null;
      finishPending();
      commit(view);
      return true;
    },
    failed(error, options = {}) {
      if (destroyed || !matchesToken(options.token)) return false;
      failure = error || new Error('Unknown result error');
      availability = provenance ? 'stale' : 'unavailable';
      finishPending();
      if (provenance) redraw();
      else renderUnavailable({ retry: true });
      return true;
    },
    cancel(token) {
      if (destroyed || activeToken === null || token !== activeToken) return false;
      ({ provenance, availability, failure } = pendingState);
      finishPending();
      if (provenance) redraw();
      else renderUnavailable();
      return true;
    },
    clear() {
      if (destroyed) return false;
      provenance = null;
      failure = null;
      availability = 'unavailable';
      finishPending();
      renderUnavailable({ retry: false });
      return true;
    },
    getAvailability: () => availability,
    getProvenance: () => provenance,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      finishPending();
      nodes.retry?.removeEventListener?.('click', onRetryClick);
      releaseLanguage?.();
    },
  });
}

export function normalizeCrimeRefreshResult(result) {
  if (result?.status === 'idle') {
    return { status: 'idle', succeeded: [], failed: [] };
  }
  if (result?.status === 'unavailable') {
    return {
      status: 'unavailable',
      reason: result.reason || 'unavailable',
      succeeded: [],
      failed: [],
    };
  }
  if (result?.status === 'partial') {
    return {
      status: 'partial',
      succeeded: [...(result.succeeded || [])],
      failed: [...(result.failed || [])],
    };
  }
  if (result?.status === 'failed') return { status: 'failed' };
  if (result?.status === 'live' || result?.applied === true) return { status: 'live' };
  return { status: 'superseded' };
}

export function classifyCrimeRefreshJobs(entries) {
  const succeeded = [];
  const failed = [];
  let superseded = false;
  for (const entry of entries) {
    const name = entry?.name;
    const result = entry?.result;
    if (!name || !result) continue;
    if (result.status === 'rejected') {
      failed.push(name);
      continue;
    }
    const value = result.value;
    if (!value || value.status === 'failed') failed.push(name);
    else if (value.status === 'superseded' || value.applied === false) superseded = true;
    else if (value.status === 'partial') {
      succeeded.push(name);
      failed.push(name);
    } else if (value.status === 'live' || value.status === 'success' || value.applied === true) {
      succeeded.push(name);
    } else failed.push(name);
  }
  if (superseded) return { status: 'superseded', succeeded: [], failed: [] };
  const uniqueSucceeded = [...new Set(succeeded)];
  const uniqueFailed = [...new Set(failed)];
  return {
    status: uniqueSucceeded.length && uniqueFailed.length
      ? 'partial'
      : uniqueFailed.length ? 'failed' : 'live',
    succeeded: uniqueSucceeded,
    failed: uniqueFailed,
  };
}

function validDate(value, label) {
  const text = cleanText(value);
  const parsed = Date.parse(`${text}T00:00:00.000Z`);
  if (!text || !DATE_PATTERN.test(text) || Number.isNaN(parsed)
    || new Date(parsed).toISOString().slice(0, 10) !== text) {
    throw new Error(`Invalid crime result ${label}.`);
  }
  return text;
}

function previousCalendarDay(value) {
  const endExclusive = validDate(value, 'coverage end');
  const date = new Date(`${endExclusive}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normalizeSources(sources) {
  return Object.freeze(normalizeCrimeDataSources(sources).map((source) => (
    source.asOf
      ? Object.freeze({ ...source, asOf: validDate(source.asOf, 'source asOf') })
      : source
  )));
}

function validTimestamp(value) {
  const text = cleanText(value);
  const parsed = Date.parse(text || '');
  if (!text || Number.isNaN(parsed) || new Date(parsed).toISOString() !== text) {
    throw new Error('Invalid crime result generatedAt timestamp.');
  }
  return text;
}

function immutableCopy(value, seen = new WeakSet()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Crime result cannot contain circular data.');
    seen.add(value);
    const copy = value.map((item) => immutableCopy(item, seen));
    seen.delete(value);
    return Object.freeze(copy);
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Crime result must contain only plain structured data.');
  }
  if (seen.has(value)) throw new Error('Crime result cannot contain circular data.');
  seen.add(value);
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) copy[key] = immutableCopy(item, seen);
  }
  seen.delete(value);
  return Object.freeze(copy);
}

function normalizeCoverage(coverage) {
  if (!coverage || typeof coverage !== 'object') throw new Error('Crime result coverage is required.');
  const start = validDate(coverage.start, 'coverage start');
  const end = validDate(coverage.end, 'coverage end');
  if (start > end) throw new Error('Crime result coverage start cannot be after coverage end.');
  return Object.freeze({
    start,
    end,
    ...(cleanText(coverage.asOf) ? { asOf: validDate(coverage.asOf, 'coverage asOf') } : {}),
  });
}

function normalizeSelection(selection) {
  if (Array.isArray(selection)) {
    if (selection.length !== 2 || !selection.every(Number.isFinite)) {
      throw new Error('Crime result scope selection coordinates are invalid.');
    }
    return Object.freeze([...selection]);
  }
  const text = cleanText(selection);
  if (!text) throw new Error('Crime result scope selection is required.');
  return text;
}

function uniqueText(values) {
  return Object.freeze(Array.isArray(values)
    ? [...new Set(values.map(cleanText).filter(Boolean))]
    : []);
}

function normalizeScope(scope) {
  const queryMode = cleanText(scope?.queryMode);
  if (!QUERY_MODES.has(queryMode)) throw new Error('Invalid crime result scope queryMode.');
  const normalized = {
    queryMode,
    selection: normalizeSelection(scope.selection),
    offenseCodes: uniqueText(scope.offenseCodes),
  };
  if (queryMode === 'citywide') {
    const adminLevel = cleanText(scope.adminLevel);
    if (!ADMIN_LEVELS.has(adminLevel)) throw new Error('Invalid citywide crime result adminLevel.');
    normalized.adminLevel = adminLevel;
    normalized.overlayTractsLines = Boolean(scope.overlayTractsLines);
  }
  if (scope.radius != null && cleanText(scope.radius) !== null) {
    const radius = Number(scope.radius);
    if (queryMode !== 'buffer') throw new Error('Crime result radius is only valid for buffer scope.');
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('Invalid crime result scope radius.');
    normalized.radius = radius;
  }
  return Object.freeze(normalized);
}

export function createCrimeResultProvenance({
  result,
  generatedAt,
  sources = [],
  coverage,
  scope,
  limitations = [],
} = {}) {
  if (!result || typeof result !== 'object') throw new Error('Crime result is required.');
  return Object.freeze({
    result: immutableCopy(result),
    generatedAt: validTimestamp(generatedAt),
    sources: normalizeSources(sources),
    coverage: normalizeCoverage(coverage),
    scope: normalizeScope(scope),
    limitations: uniqueText(limitations),
  });
}

function summarizePoint(point, value, retainedGeneratedAt) {
  const summary = {
    point,
    status: value.status,
    stale: Boolean(value.stale),
    total: value.total,
    per10k: value.per10k,
  };
  if (value.metricStatus && typeof value.metricStatus === 'object') {
    summary.metricStatus = value.metricStatus;
  }
  if (value.errors && typeof value.errors === 'object') summary.errors = value.errors;
  const retainedAt = cleanText(value.retainedGeneratedAt ?? retainedGeneratedAt);
  if (retainedAt) summary.retainedGeneratedAt = validTimestamp(retainedAt);
  return summary;
}

function summarize(name, value = {}) {
  const result = { kind: name, status: value.status || (value.applied === true ? 'success' : 'unknown') };
  if (name === 'boundary') result.featureCount = Number(value.featureCount) || 0;
  if (name === 'incidents') {
    result.count = Number.isFinite(Number(value.count)) ? Number(value.count) : value.geo?.features?.length || 0;
  }
  if (name === 'charts') {
    result.succeeded = [...(value.succeeded || [])];
    result.failed = [...(value.failed || [])];
  }
  if (name === 'summary') {
    const retainedGeneratedAt = cleanText(value.retainedGeneratedAt);
    if (retainedGeneratedAt) result.retainedGeneratedAt = validTimestamp(retainedGeneratedAt);
    result.points = ['a', 'b'].flatMap((point) => value[point]
      ? [summarizePoint(point.toUpperCase(), value[point], retainedGeneratedAt)]
      : []);
  }
  return result;
}

export function createCrimeRefreshProvenance({
  name,
  value,
  snapshot,
  sources,
  coverageMax,
  generatedAt,
} = {}) {
  const {
    queryMode, selectedDistrictCode, selectedTractGEOID,
    centerLonLat, centerBLonLat, radiusM, adminLevel, per10k, start, end,
  } = snapshot;
  const selection = queryMode === 'district'
    ? selectedDistrictCode || 'Philadelphia districts'
    : queryMode === 'tract'
      ? selectedTractGEOID || 'Philadelphia tracts'
      : centerBLonLat
        ? `A ${centerLonLat?.join(', ') || 'unset'} · B ${centerBLonLat.join(', ')}`
        : centerLonLat || 'Philadelphia';
  const summaryUsesPopulation = name === 'summary' && (
    per10k
    || ['a', 'b'].some((point) => (
      ['available', 'stale'].includes(value?.[point]?.metricStatus?.population)
    ))
  );
  const sourceSets = {
    boundary: adminLevel === 'tracts'
      ? new Set(['tracts', 'demographics', 'tract-crime'])
      : new Set(['districts', ...(snapshot.overlayTractsLines ? ['tracts'] : [])]),
    incidents: new Set(['incidents']),
    charts: new Set(['incidents']),
    summary: new Set([
      'incidents',
      ...(summaryUsesPopulation ? ['tracts', 'demographics'] : []),
    ]),
  };
  const limitations = [
    'resultMeta.limit.reportedRecords',
    'resultMeta.limit.generalizedLocations',
    ...(value?.status === 'partial' ? [`resultMeta.limit.${name}Partial`] : []),
  ];
  return createCrimeResultProvenance({
    result: summarize(name, value),
    generatedAt,
    sources: (sources || []).filter(({ dataset }) => sourceSets[name]?.has(dataset)),
    coverage: {
      start,
      end: previousCalendarDay(end),
      ...(coverageMax ? { asOf: coverageMax } : {}),
    },
    scope: name === 'boundary'
      ? {
        queryMode: 'citywide',
        selection: 'Philadelphia',
        adminLevel,
        overlayTractsLines: Boolean(snapshot.overlayTractsLines),
        offenseCodes: snapshot.resolvedOffenseCodes || snapshot.types,
      }
      : {
        queryMode,
        selection,
        ...(queryMode === 'buffer' ? { radius: radiusM } : {}),
        offenseCodes: snapshot.resolvedOffenseCodes || snapshot.types,
      },
    limitations,
  });
}
