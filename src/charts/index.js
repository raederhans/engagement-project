// Placeholder for chart modules (time series, top-N, and heatmap views).
import dayjs from 'dayjs';
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
import '../i18n/crime_charts.js';
import { getLanguage, onLanguageChange, t } from '../i18n/index.js';
import { localizeOffenseCode } from '../i18n/crime_offenses.js';
import { buildResidentialStability } from '../analysis/residential_stability.js';
import '../i18n/crime_safety.js';

export {
  createTractSummaryFetchers,
  resolveSelectedTractGeometry,
  runTractSummary,
} from './tract_summary.js';

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
  const replayFailures = [...(payload.failed || [])];
  const renderSurface = (chart, render) => {
    try {
      render();
    } catch (error) {
      replayFailures.push({ chart, error });
    }
  };
  sinks.status(payload.statusKey ? t(payload.statusKey) : '', payload.statusKey ? { key: payload.statusKey } : undefined);
  if (payload.cityRows) {
    renderSurface('monthly', () => sinks.monthly(payload.cityRows, payload.areaRows || [], copy, preferences));
  }
  if (payload.cityRows) {
    const selectedRows = payload.residentialUsesAreaRows
      ? (payload.areaRows || [])
      : payload.cityRows;
    renderSurface('monthly', () => {
      sinks.residential?.(buildResidentialStability({
        rows: selectedRows,
        start: payload.start,
        end: payload.end,
        coverageDate: payload.coverageDate,
      }));
    });
  }
  if (payload.topRows) renderSurface('top', () => sinks.top(payload.topRows, copy, preferences));
  if (payload.heatMatrix) renderSurface('heat', () => sinks.heat(payload.heatMatrix, copy, preferences));
  for (const failure of replayFailures) {
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

let chartRendererModulePromise;
let defaultChartSinks = null;
let chartIntentBound = false;

function isChartsPaneOpen(documentRef = globalThis.document) {
  const pane = documentRef?.querySelector?.('[data-result-pane="charts"]')
    || documentRef?.getElementById?.('charts');
  if (!pane || pane.hidden || pane.inert) return false;
  if (pane.getAttribute?.('aria-hidden') === 'true') return false;
  return pane.style?.display !== 'none';
}

function createDormantChartSinks() {
  return {
    status() {},
    monthly() {},
    residential() {},
    top() {},
    heat() {},
    error() {},
  };
}

async function getDefaultChartSinks() {
  if (defaultChartSinks) return defaultChartSinks;
  if (!chartRendererModulePromise) {
    let ownedPromise;
    ownedPromise = import('./renderer.js')
      .then(({ createDefaultChartSinks }) => {
        defaultChartSinks = createDefaultChartSinks({
          getCopy: getCrimeChartCopy,
          readPreferences: () => defaultChartPreferences.read(),
          updatePreference: (key, value) => defaultChartPreferences.update(key, value),
          refreshCached: () => defaultChartLocaleCache.refresh(defaultChartSinks),
        });
        return defaultChartSinks;
      })
      .catch((error) => {
        if (chartRendererModulePromise === ownedPromise) chartRendererModulePromise = null;
        throw error;
      });
    chartRendererModulePromise = ownedPromise;
  }
  return chartRendererModulePromise;
}

async function refreshDefaultCharts({ requireVisible = true } = {}) {
  if (requireVisible && !isChartsPaneOpen()) return false;
  const sinks = await getDefaultChartSinks();
  if (requireVisible && !isChartsPaneOpen()) return false;
  return defaultChartLocaleCache.refresh(sinks);
}

function showChartRendererLoadError(error, documentRef = globalThis.document) {
  const pane = documentRef?.querySelector?.('[data-result-pane="charts"]')
    || documentRef?.getElementById?.('charts');
  let status = documentRef?.getElementById?.('charts-status');
  if (!status && pane?.appendChild && documentRef?.createElement) {
    status = documentRef.createElement('div');
    status.id = 'charts-status';
    status.className = 'chart-status';
    pane.appendChild(status);
  }
  if (!status) return false;
  status.setAttribute?.('role', 'status');
  status.setAttribute?.('aria-live', 'polite');
  status.textContent = t('chart.unavailable', { message: error?.message || error });
  return true;
}

function refreshDefaultChartsFromIntent() {
  return refreshDefaultCharts().catch((error) => {
    showChartRendererLoadError(error);
    return false;
  });
}

function bindChartIntent() {
  if (chartIntentBound || typeof document === 'undefined') return;
  chartIntentBound = true;
  document.addEventListener?.('click', (event) => {
    if (!event.target?.closest?.('[data-result-pane-target="charts"]')) return;
    queueMicrotask(() => { void refreshDefaultChartsFromIntent(); });
  });
}

bindChartIntent();
onLanguageChange(() => {
  if (typeof document !== 'undefined' && isChartsPaneOpen()) {
    void refreshDefaultChartsFromIntent();
  }
});

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
  bindChartIntent();
  const isFresh = () => !signal?.aborted && shouldApply();
  const chartSinks = sinks ?? (isChartsPaneOpen()
    ? await getDefaultChartSinks()
    : createDormantChartSinks());
  const localeCache = chartCache === undefined
    ? (sinks ? null : defaultChartLocaleCache)
    : chartCache;
  if (!isFresh()) return { applied: false };

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
  sinks = defaultChartSinks,
  localeCache = defaultChartLocaleCache,
} = {}) {
  localeCache.clear();
  sinks?.clear?.();
  sinks?.status?.(t('chart.pickCenterTip'), { key: 'chart.pickCenterTip' });
  return true;
}
