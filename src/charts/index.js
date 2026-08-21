// Placeholder for chart modules (time series, top-N, and heatmap views).
import dayjs from 'dayjs';
import { clearMonthlyChart, renderMonthly } from './line_monthly.js';
import { clearTopNChart, renderTopN } from './bar_topn.js';
import { clearTemporalChart, render7x24 } from './heat_7x24.js';
import {
  admitCrimeResponse,
  fetchMonthlySeriesCity,
  fetchMonthlySeriesBuffer,
  fetchTopTypesBuffer,
  fetch7x24Buffer,
  fetchTopTypesByDistrict,
  fetch7x24District,
  fetchMonthlyTract,
  fetchMonthlySeriesTract,
  fetchTopTypesTract,
  fetch7x24Tract,
} from '../api/crime.js';
import { fetchTractStatsCachedFirst } from '../api/acs.js';
import { fetchTractsCachedFirst } from '../api/boundaries.js';
import { getTractPolygonAndBboxByGEOID } from '../utils/tract_geom.js';
import '../i18n/crime_charts.js';
import { applyTranslations, getLanguage, onLanguageChange, t } from '../i18n/index.js';
import { localizeOffenseCode } from '../i18n/crime_offenses.js';
import { buildResidentialStability } from '../analysis/residential_stability.js';
import { renderResidentialStability } from '../ui/residential_stability.js';

function renderAreaIntelligenceLoadFailure(error) {
  console.error(error);
  const content = document.querySelector('#area-intelligence [data-area-intelligence-content]');
  if (!content) return false;
  content.closest('.area-intelligence').dataset.modelStatus = 'invalid';
  content.setAttribute('role', 'status');
  content.textContent = t('chart.unavailable', { message: error?.message || error });
  return true;
}

const DEFAULT_CHART_PREFERENCES = Object.freeze({
  palette: 'blue',
  showLabels: true,
  monthlyView: 'indexed',
  topView: 'count',
  categoryLimit: 8,
  temporalView: 'heat',
  classification: 'quantile',
});

export function createChartPreferenceStore(initial = {}) {
  let preferences = { ...DEFAULT_CHART_PREFERENCES, ...initial };
  return Object.freeze({
    read() { return Object.freeze({ ...preferences }); },
    update(key, value) {
      if (!Object.hasOwn(DEFAULT_CHART_PREFERENCES, key)) return this.read();
      preferences = { ...preferences, [key]: key === 'categoryLimit' ? Number(value) : value };
      return this.read();
    },
  });
}

const defaultChartPreferences = createChartPreferenceStore();

export async function resolveSelectedTractGeometry({
  selectedTractGEOID,
  signal,
  fetchTracts = fetchTractsCachedFirst,
}) {
  const tracts = await fetchTracts({ signal });
  const polygon = getTractPolygonAndBboxByGEOID(tracts, selectedTractGEOID, { decimals: 6 });
  if (!polygon) throw new Error(`Tract ${selectedTractGEOID} not found`);
  return polygon.geojsonPolygon4326;
}

export function createTractSummaryFetchers({
  tractGEOID,
  fetchMonthly = fetchMonthlySeriesTract,
  fetchTop = fetchTopTypesTract,
  fetchStats = fetchTractStatsCachedFirst,
}) {
  return {
    async fetchCountBuffer({ start, end, types, signal }) {
      const response = await fetchMonthly({ start, end, types, tractGEOID, signal });
      return admitCrimeResponse('monthly', response).rows.reduce(
        (sum, row) => sum + Number(row.n),
        0,
      );
    },
    fetchTopTypesBuffer({ start, end, types, limit, signal }) {
      return fetchTop({ start, end, types, tractGEOID, limit, signal });
    },
    async estimatePopInBuffer({ signal, onSourceResolved }) {
      const stats = await fetchStats({ signal, onSourceResolved });
      const row = stats.find((candidate) => candidate.geoid === tractGEOID);
      if (!row) throw new Error(`Population for tract ${tractGEOID} not found`);
      return { pop: Number(row.pop) || 0, tractsChecked: 1 };
    },
  };
}

export function runTractSummary({ selectedTractGEOID, ...filters }, options, updateCompareImpl) {
  if (!/^\d{11}$/.test(selectedTractGEOID || '')) {
    throw new Error('A valid 11-digit census tract GEOID is required.');
  }
  return updateCompareImpl({
    ...filters,
    center3857: [0, 0],
    centerB3857: null,
    addressA: `${t('crime.area.tract')} ${selectedTractGEOID}`,
    addressB: null,
    radiusM: 1,
    queryMode: 'tract',
    selectedTractGEOID,
    adminLevel: 'tracts',
  }, {
    ...options,
    fetchers: createTractSummaryFetchers({ tractGEOID: selectedTractGEOID }),
  });
}

export function getCrimeChartCopy() {
  const whole = new Intl.NumberFormat(getLanguage(), { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(getLanguage(), { maximumFractionDigits: 1 });
  const signedPercent = (value) => Number.isFinite(value)
    ? `${value > 0 ? '+' : ''}${decimal.format(value)}%`
    : '—';
  return Object.freeze({
    citywide: t('chart.citywide'),
    selectedArea: t('chart.selectedArea'),
    offenseLabel: localizeOffenseCode,
    topOffenseTypes: t('chart.topOffenseTypes'),
    heatmap: t('chart.heatmap'),
    indexedAxis: t('chart.axis.indexed'),
    cityCountAxis: t('chart.axis.cityCount'),
    areaCountAxis: t('chart.axis.areaCount'),
    countAxis: t('chart.axis.count'),
    shareAxis: t('chart.axis.share'),
    cumulativeShare: t('chart.axis.cumulative'),
    weekdayTotal: t('chart.weekdayTotal'),
    hourTotal: t('chart.hourTotal'),
    monthValue: (series, count, index, indexed) => indexed
      ? t('chart.tooltip.month', { series, count: whole.format(count), index: decimal.format(index) })
      : `${series}: ${t('chart.tooltip.count', { count: whole.format(count) })}`,
    categoryValue: (count, share) => t('chart.tooltip.category', { count: whole.format(count), share: decimal.format(share) }),
    shareValue: (share) => t('chart.tooltip.share', { share: decimal.format(share) }),
    countValue: (count) => t('chart.tooltip.count', { count: whole.format(count) }),
    hourValue: (hour, count, day) => t('chart.hourValue', { day, hour, count: whole.format(count) }),
    hourLabel: (hour) => `${String(hour).padStart(2, '0')}:00`,
    hourShort: (hour) => `${hour}:00`,
    monthlyInsight(model) {
      if (model?.hasArea) return t('chart.insight.monthlyBoth', { city: signedPercent(model.cityChange), area: signedPercent(model.areaChange) });
      if (Number.isFinite(model?.cityChange)) return t('chart.insight.monthlyCity', { city: signedPercent(model.cityChange) });
      return t('chart.insight.noData');
    },
    topInsight(model) {
      if (!model?.topLabel || !model.topCount) return t('chart.insight.noData');
      return t('chart.insight.top', {
        category: model.topLabel,
        count: whole.format(model.topCount),
        share: decimal.format(model.topShare),
      });
    },
    temporalInsight(model) {
      if (!model?.peakCount) return t('chart.insight.noData');
      return t('chart.insight.peakPeriod', {
        day: this.weekdays[model.peakDay],
        hour: String(model.peakHour).padStart(2, '0'),
        count: whole.format(model.peakCount),
      });
    },
    weekdays: Object.freeze([
      t('chart.day.sun'),
      t('chart.day.mon'),
      t('chart.day.tue'),
      t('chart.day.wed'),
      t('chart.day.thu'),
      t('chart.day.fri'),
      t('chart.day.sat'),
    ]),
  });
}

function renderCachedCharts(payload, sinks) {
  if (!payload || !sinks) return false;
  if (payload.kind === 'status') {
    sinks.status(t(payload.statusKey), { key: payload.statusKey });
    return true;
  }
  if (payload.kind === 'error') {
    sinks.error(payload.error, {
      report: false,
      message: t('chart.unavailable', { message: payload.error?.message || payload.error }),
    });
    return true;
  }
  const copy = getCrimeChartCopy();
  const preferences = defaultChartPreferences.read();
  sinks.status(payload.statusKey ? t(payload.statusKey) : '', payload.statusKey ? { key: payload.statusKey } : undefined);
  if (payload.cityRows) sinks.monthly(payload.cityRows, payload.areaRows || [], copy, preferences);
  if (payload.cityRows) {
    const selectedRows = payload.residentialUsesAreaRows
      ? (payload.areaRows || [])
      : payload.cityRows;
    sinks.residential?.(buildResidentialStability({
      rows: selectedRows,
      start: payload.start,
      end: payload.end,
      coverageDate: payload.coverageDate,
    }));
  }
  if (payload.topRows) sinks.top(payload.topRows, copy, preferences);
  if (payload.heatMatrix) sinks.heat(payload.heatMatrix, copy, preferences);
  for (const failure of payload.failed || []) {
    sinks.error(failure.error, {
      chart: failure.chart,
      report: false,
      message: t('chart.unavailable', { message: failure.error?.message || failure.error }),
    });
  }
  return true;
}

export function createChartLocaleCache() {
  let payload = null;
  return Object.freeze({
    store(nextPayload) { payload = nextPayload; },
    refresh(sinks) { return renderCachedCharts(payload, sinks); },
    clear() { payload = null; },
  });
}

const defaultChartLocaleCache = createChartLocaleCache();

onLanguageChange(() => {
  if (typeof document !== 'undefined') defaultChartLocaleCache.refresh(createDefaultChartSinks());
});

function byMonthRows(rows) {
  return rows.map((r) => ({ m: dayjs(r.m).format('YYYY-MM'), n: Number(r.n) }));
}

function buildMatrix(dowHrRows) {
  const m = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of dowHrRows) {
    const d = Number(r.dow);
    const h = Number(r.hr);
    const n = Number(r.n);
    if (d >= 0 && d <= 6 && h >= 0 && h <= 23) m[d][h] = n;
  }
  return m;
}

const DEFAULT_FETCHERS = {
  fetchMonthlySeriesCity,
  fetchMonthlySeriesBuffer,
  fetchTopTypesBuffer,
  fetch7x24Buffer,
  fetchTopTypesByDistrict,
  fetch7x24District,
  fetchMonthlyTract,
  fetchTopTypesTract,
  fetch7x24Tract,
};

function getStatusElement() {
  const pane = document.getElementById('charts') || document.body;
  let status = document.getElementById('charts-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'charts-status';
    status.className = 'chart-status';
    pane.appendChild(status);
  }
  return status;
}

function writeInsight(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

let controlsBound = false;

function syncChartControls(preferences) {
  const charts = document.getElementById('charts');
  if (charts) charts.dataset.temporalView = preferences.temporalView;
  for (const button of document.querySelectorAll('[data-chart-setting][data-chart-value]')) {
    button.setAttribute('aria-pressed', String(preferences[button.dataset.chartSetting] === button.dataset.chartValue));
  }
  const classification = document.getElementById('chartClassificationSel');
  if (classification) classification.disabled = preferences.temporalView !== 'heat';
}

function bindChartControls() {
  if (typeof document === 'undefined') return;
  applyTranslations(document);
  if (controlsBound) return;
  controlsBound = true;
  const rerender = () => defaultChartLocaleCache.refresh(createDefaultChartSinks());
  for (const button of document.querySelectorAll('[data-chart-setting][data-chart-value]')) {
    button.addEventListener('click', () => {
      const next = defaultChartPreferences.update(button.dataset.chartSetting, button.dataset.chartValue);
      syncChartControls(next);
      rerender();
    });
  }
  for (const control of document.querySelectorAll('select[data-chart-setting], input[data-chart-setting]')) {
    control.addEventListener('change', () => {
      const value = control.type === 'checkbox' ? control.checked : control.value;
      const next = defaultChartPreferences.update(control.dataset.chartSetting, value);
      syncChartControls(next);
      rerender();
    });
  }
  syncChartControls(defaultChartPreferences.read());
}

function createDefaultChartSinks() {
  bindChartControls();
  return {
    status(message) {
      getStatusElement().textContent = message;
    },
    clear() {
      clearMonthlyChart();
      clearTopNChart();
      clearTemporalChart();
      for (const id of ['chart-monthly-insight', 'chart-topn-insight', 'chart-7x24-insight']) {
        writeInsight(id, '');
      }
      renderResidentialStability(null);
      void import('../area_intelligence/view.js')
        .then(({ clearAreaIntelligence }) => clearAreaIntelligence())
        .catch(renderAreaIntelligenceLoadFailure);
    },
    monthly(cityRows, areaRows, copy = getCrimeChartCopy(), preferences = defaultChartPreferences.read()) {
      const canvas = document.getElementById('chart-monthly');
      const context = canvas?.getContext?.('2d');
      if (!context) throw new Error('chart canvas missing: #chart-monthly');
      const model = renderMonthly(context, cityRows, areaRows, copy, { valueMode: preferences.monthlyView, palette: preferences.palette, showLabels: preferences.showLabels });
      writeInsight('chart-monthly-insight', copy.monthlyInsight(model.insight));
    },
    residential(model) {
      renderResidentialStability(model);
    },
    top(rows, copy = getCrimeChartCopy(), preferences = defaultChartPreferences.read()) {
      const canvas = document.getElementById('chart-topn');
      const context = canvas?.getContext?.('2d');
      if (!context) throw new Error('chart canvas missing: #chart-topn');
      const model = renderTopN(context, rows, copy, { valueMode: preferences.topView, categoryLimit: preferences.categoryLimit, palette: preferences.palette, showLabels: preferences.showLabels });
      writeInsight('chart-topn-insight', copy.topInsight(model.insight));
    },
    heat(matrix, copy = getCrimeChartCopy(), preferences = defaultChartPreferences.read()) {
      const canvas = document.getElementById('chart-7x24');
      const context = canvas?.getContext?.('2d');
      if (!context) throw new Error('chart canvas missing: #chart-7x24');
      const model = render7x24(context, matrix, copy, { view: preferences.temporalView, classification: preferences.classification, palette: preferences.palette, showLabels: preferences.showLabels });
      writeInsight('chart-7x24-insight', copy.temporalInsight(model.insight));
    },
    error(error, {
      chart,
      report = true,
      message = t('chart.unavailable', { message: error?.message || error }),
    } = {}) {
      if (report) console.error(error);
      const insightIds = {
        monthly: 'chart-monthly-insight',
        top: 'chart-topn-insight',
        heat: 'chart-7x24-insight',
      };
      const insight = chart ? document.getElementById(insightIds[chart]) : null;
      if (insight) {
        insight.setAttribute('role', 'status');
        insight.setAttribute('aria-live', 'polite');
        insight.textContent = message;
        return;
      }
      getStatusElement().innerText = message;
    },
  };
}

/**
 * Fetch and render all charts using the provided filters.
 * @param {{start:string,end:string,types?:string[],center3857:[number,number],radiusM:number}} params
 */
export async function updateAllCharts(
  { start, end, types = [], drilldownCodes = [], center3857, radiusM, queryMode, selectedDistrictCode, selectedTractGEOID, coverageDate = null },
  {
    signal,
    shouldApply = () => true,
    fetchers,
    sinks,
    chartCache,
  } = {},
) {
  const chartFetchers = { ...DEFAULT_FETCHERS, ...fetchers };
  const chartSinks = sinks ?? createDefaultChartSinks();
  const localeCache = chartCache === undefined
    ? (sinks ? null : defaultChartLocaleCache)
    : chartCache;
  const isFresh = () => !signal?.aborted && shouldApply();
  if (!sinks) {
    void import('../area_intelligence/view.js')
      .then(({ updateAreaIntelligence }) => updateAreaIntelligence({
        queryMode,
        selectedTractGEOID,
        shouldApply: isFresh,
      }))
      .catch(renderAreaIntelligenceLoadFailure);
  }

  if (queryMode === 'buffer' && !center3857) {
    if (!isFresh()) return { applied: false };
    localeCache?.store({ kind: 'status', statusKey: 'chart.pickCenterTip' });
    chartSinks.status(t('chart.pickCenterTip'));
    return { applied: true };
  }

  let monthlyTask;
  let topTask;
  let heatTask;
  if (queryMode === 'district' && selectedDistrictCode) {
    monthlyTask = (async () => ({
      city: await chartFetchers.fetchMonthlySeriesCity({ start, end, types, dc_dist: selectedDistrictCode, signal }),
      area: { rows: [] },
    }))();
    topTask = Promise.resolve().then(() => chartFetchers.fetchTopTypesByDistrict({ start, end, types, dc_dist: selectedDistrictCode, limit: 12, signal }));
    heatTask = Promise.resolve().then(() => chartFetchers.fetch7x24District({ start, end, types, dc_dist: selectedDistrictCode, signal }));
  } else if (queryMode === 'buffer') {
    monthlyTask = (async () => {
      const [city, area] = await Promise.all([
        chartFetchers.fetchMonthlySeriesCity({ start, end, types, signal }),
        chartFetchers.fetchMonthlySeriesBuffer({ start, end, types, center3857, radiusM, signal }),
      ]);
      return { city, area };
    })();
    topTask = Promise.resolve().then(() => chartFetchers.fetchTopTypesBuffer({ start, end, types, center3857, radiusM, limit: 12, signal }));
    heatTask = Promise.resolve().then(() => chartFetchers.fetch7x24Buffer({ start, end, types, center3857, radiusM, signal }));
  } else if (queryMode === 'tract' && selectedTractGEOID) {
    const codes = (Array.isArray(drilldownCodes) && drilldownCodes.length) ? drilldownCodes : types;
    monthlyTask = (async () => {
      const [city, area] = await Promise.all([
        chartFetchers.fetchMonthlySeriesCity({ start, end, types, signal }),
        chartFetchers.fetchMonthlyTract({ start, end, geoid: selectedTractGEOID, codes, signal }),
      ]);
      return { city, area };
    })();
    topTask = Promise.resolve().then(() => chartFetchers.fetchTopTypesTract({ start, end, types: codes, tractGEOID: selectedTractGEOID, limit: 12, signal }));
    heatTask = Promise.resolve().then(() => chartFetchers.fetch7x24Tract({ start, end, types: codes, tractGEOID: selectedTractGEOID, signal }));
  } else {
    monthlyTask = (async () => ({
      city: await chartFetchers.fetchMonthlySeriesCity({ start, end, types, signal }),
      area: { rows: [] },
    }))();
    topTask = Promise.resolve({ rows: [] });
    heatTask = Promise.resolve({ rows: [] });
  }

  const chartNames = ['monthly', 'top', 'heat'];
  const settled = await Promise.allSettled([monthlyTask, topTask, heatTask]);
  if (!isFresh() || settled.some((result) => result.status === 'rejected' && result.reason?.name === 'AbortError')) {
    return { applied: false };
  }

  const values = {};
  const failed = [];
  settled.forEach((result, index) => {
    const chart = chartNames[index];
    if (result.status === 'fulfilled') values[chart] = result.value;
    else failed.push({ chart, error: result.reason });
  });

  let monthly = null;
  let topRows = null;
  let heatRows = null;
  let heatMatrix = null;
  const admitChartValue = (chart, callback) => {
    if (!(chart in values)) return null;
    try {
      return callback();
    } catch (error) {
      delete values[chart];
      failed.push({ chart, error });
      return null;
    }
  };
  monthly = admitChartValue('monthly', () => ({
    cityRows: byMonthRows(admitCrimeResponse('monthly', values.monthly.city).rows),
    areaRows: byMonthRows(admitCrimeResponse('monthly', values.monthly.area).rows),
  }));
  topRows = admitChartValue('top', () => admitCrimeResponse('top', values.top).rows);
  heatRows = admitChartValue('heat', () => admitCrimeResponse('heat', values.heat).rows);
  if (heatRows) heatMatrix = buildMatrix(heatRows);
  let statusKey = null;
  if (failed.length === 0) {
    const allZeroCity = monthly?.cityRows.length > 0 && monthly.cityRows.every((row) => Number(row.n || 0) === 0);
    const noneTop = !topRows?.length;
    const noneHeat = !heatRows?.length;
    if (queryMode === 'tract' && !monthly?.areaRows.length && noneTop && noneHeat) {
      statusKey = 'chart.noTractIncidents';
    } else if (allZeroCity && noneTop && noneHeat) {
      statusKey = 'crime.noIncidents';
    }
  }

  const copy = getCrimeChartCopy();
  const preferences = defaultChartPreferences.read();
  chartSinks.status(statusKey ? t(statusKey) : '', statusKey ? { key: statusKey } : undefined);
  const renderers = {
    monthly: () => chartSinks.monthly(monthly.cityRows, monthly.areaRows, copy, preferences),
    top: () => chartSinks.top(topRows, copy, preferences),
    heat: () => chartSinks.heat(heatMatrix, copy, preferences),
  };
  for (const chart of chartNames) {
    if (!(chart in values)) continue;
    if (!isFresh()) return { applied: false };
    try {
      renderers[chart]();
    } catch (error) {
      delete values[chart];
      failed.push({ chart, error });
    }
  }
  const residentialUsesAreaRows = queryMode === 'buffer'
    || (queryMode === 'tract' && Boolean(selectedTractGEOID));
  if (values.monthly && isFresh()) {
    const selectedRows = residentialUsesAreaRows ? monthly.areaRows : monthly.cityRows;
    chartSinks.residential?.(buildResidentialStability({
      rows: selectedRows,
      start,
      end,
      coverageDate,
    }));
  }
  if (!isFresh()) return { applied: false };

  for (const failure of failed) {
    chartSinks.error(failure.error, {
      chart: failure.chart,
      report: false,
      message: t('chart.unavailable', { message: failure.error?.message || failure.error }),
    });
  }

  const succeeded = chartNames.filter((chart) => chart in values);
  const status = failed.length === 0 ? 'success' : succeeded.length === 0 ? 'failed' : 'partial';
  localeCache?.store({
    kind: 'charts',
    ...(values.monthly ? monthly : {}),
    ...(values.monthly ? {
      start,
      end,
      coverageDate,
      residentialUsesAreaRows,
    } : {}),
    ...(values.top ? { topRows } : {}),
    ...(values.heat ? { heatMatrix } : {}),
    failed,
    statusKey,
  });
  return {
    applied: true,
    status,
    succeeded,
    failed: failed.map(({ chart }) => chart),
  };
}

export function clearCrimeCharts({
  sinks = createDefaultChartSinks(),
  localeCache = defaultChartLocaleCache,
} = {}) {
  localeCache.clear();
  sinks.clear?.();
  sinks.status(t('chart.pickCenterTip'), { key: 'chart.pickCenterTip' });
  return true;
}
