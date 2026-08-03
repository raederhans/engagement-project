// Placeholder for chart modules (time series, top-N, and heatmap views).
import dayjs from 'dayjs';
import { renderMonthly } from './line_monthly.js';
import { renderTopN } from './bar_topn.js';
import { render7x24 } from './heat_7x24.js';
import {
  fetchMonthlySeriesCity,
  fetchMonthlySeriesBuffer,
  fetchTopTypesBuffer,
  fetch7x24Buffer,
  fetchTopTypesByDistrict,
  fetch7x24District,
  fetchMonthlyTract,
  fetchTopTypesTract,
  fetch7x24Tract,
} from '../api/crime.js';
import '../i18n/crime_charts.js';
import { onLanguageChange, t } from '../i18n/index.js';

export function getCrimeChartCopy() {
  return Object.freeze({
    citywide: t('chart.citywide'),
    selectedArea: t('chart.selectedArea'),
    topOffenseTypes: t('chart.topOffenseTypes'),
    heatmap: t('chart.heatmap'),
    hourValue: (hour, count) => t('chart.hourValue', { hour, count }),
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
  sinks.status(payload.statusKey ? t(payload.statusKey) : '', payload.statusKey ? { key: payload.statusKey } : undefined);
  sinks.monthly(payload.cityRows, payload.areaRows, copy);
  sinks.top(payload.topRows, copy);
  sinks.heat(payload.heatMatrix, copy);
  return true;
}

export function createChartLocaleCache() {
  let payload = null;
  return Object.freeze({
    store(nextPayload) { payload = nextPayload; },
    refresh(sinks) { return renderCachedCharts(payload, sinks); },
  });
}

const defaultChartLocaleCache = createChartLocaleCache();

onLanguageChange(() => {
  if (typeof document !== 'undefined') defaultChartLocaleCache.refresh(createDefaultChartSinks());
});

function byMonthRows(rows) {
  return (rows || []).map((r) => ({ m: dayjs(r.m).format('YYYY-MM'), n: Number(r.n) || 0 }));
}

function buildMatrix(dowHrRows) {
  const m = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const r of dowHrRows || []) {
    const d = Number(r.dow);
    const h = Number(r.hr);
    const n = Number(r.n) || 0;
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
    status.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
    pane.appendChild(status);
  }
  return status;
}

function createDefaultChartSinks() {
  return {
    status(message) {
      getStatusElement().textContent = message;
    },
    monthly(cityRows, areaRows) {
      const canvas = document.getElementById('chart-monthly');
      const context = canvas?.getContext?.('2d');
      if (!context) throw new Error('chart canvas missing: #chart-monthly');
      renderMonthly(context, cityRows, areaRows, getCrimeChartCopy());
    },
    top(rows) {
      const canvas = document.getElementById('chart-topn');
      const context = canvas?.getContext?.('2d');
      if (!context) throw new Error('chart canvas missing: #chart-topn');
      renderTopN(context, rows, getCrimeChartCopy());
    },
    heat(matrix) {
      const canvas = document.getElementById('chart-7x24');
      const context = canvas?.getContext?.('2d');
      if (!context) throw new Error('chart canvas missing: #chart-7x24');
      render7x24(context, matrix, getCrimeChartCopy());
    },
    error(error, {
      report = true,
      message = t('chart.unavailable', { message: error?.message || error }),
    } = {}) {
      if (report) console.error(error);
      getStatusElement().innerText = message;
    },
  };
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

/**
 * Fetch and render all charts using the provided filters.
 * @param {{start:string,end:string,types?:string[],center3857:[number,number],radiusM:number}} params
 */
export async function updateAllCharts(
  { start, end, types = [], drilldownCodes = [], center3857, radiusM, queryMode, selectedDistrictCode, selectedTractGEOID },
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

  try {
    let city, bufOrArea, topn, heat;
    if (queryMode === 'district' && selectedDistrictCode) {
      [city, topn, heat] = await Promise.all([
        chartFetchers.fetchMonthlySeriesCity({ start, end, types, dc_dist: selectedDistrictCode, signal }),
        chartFetchers.fetchTopTypesByDistrict({ start, end, types, dc_dist: selectedDistrictCode, limit: 12, signal }),
        chartFetchers.fetch7x24District({ start, end, types, dc_dist: selectedDistrictCode, signal }),
      ]);
      bufOrArea = { rows: [] }; // no buffer series overlay in district mode
    } else if (queryMode === 'buffer') {
      if (!center3857) {
        if (!isFresh()) return { applied: false };
        localeCache?.store({ kind: 'status', statusKey: 'chart.pickCenterTip' });
        chartSinks.status(t('chart.pickCenterTip'));
        return { applied: true };
      }
      [city, bufOrArea, topn, heat] = await Promise.all([
        chartFetchers.fetchMonthlySeriesCity({ start, end, types, signal }),
        chartFetchers.fetchMonthlySeriesBuffer({ start, end, types, center3857, radiusM, signal }),
        chartFetchers.fetchTopTypesBuffer({ start, end, types, center3857, radiusM, limit: 12, signal }),
        chartFetchers.fetch7x24Buffer({ start, end, types, center3857, radiusM, signal }),
      ]);
    } else if (queryMode === 'tract' && selectedTractGEOID) {
      const codes = (Array.isArray(drilldownCodes) && drilldownCodes.length) ? drilldownCodes : types;
      [city, bufOrArea, topn, heat] = await Promise.all([
        chartFetchers.fetchMonthlySeriesCity({ start, end, types, signal }),
        chartFetchers.fetchMonthlyTract({ start, end, geoid: selectedTractGEOID, codes, signal }),
        chartFetchers.fetchTopTypesTract({ start, end, types: codes, tractGEOID: selectedTractGEOID, limit: 12, signal }),
        chartFetchers.fetch7x24Tract({ start, end, types: codes, tractGEOID: selectedTractGEOID, signal }),
      ]);
    } else {
      // Fallback: only citywide series
      [city] = await Promise.all([
        chartFetchers.fetchMonthlySeriesCity({ start, end, types, signal }),
      ]);
      topn = { rows: [] };
      heat = { rows: [] };
      bufOrArea = { rows: [] };
    }

    if (!isFresh()) return { applied: false };

    const cityRows = Array.isArray(city?.rows) ? city.rows : city;
    const bufRows = Array.isArray(bufOrArea?.rows) ? bufOrArea.rows : bufOrArea;
    const topRows = Array.isArray(topn?.rows) ? topn.rows : topn;
    const heatRows = Array.isArray(heat?.rows) ? heat.rows : heat;

    let statusKey = null;
    const allZeroCity = (Array.isArray(cityRows) && cityRows.length > 0) ? cityRows.every(r => Number(r.n||0) === 0) : false;
    const noneTop = !Array.isArray(topRows) || topRows.length === 0;
    const noneHeat = !Array.isArray(heatRows) || heatRows.length === 0;
    if (queryMode === 'tract' && (Array.isArray(bufRows) ? bufRows.length === 0 : true) && noneTop && noneHeat) {
      statusKey = 'chart.noTractIncidents';
    } else if (allZeroCity && noneTop && noneHeat) {
      statusKey = 'crime.noIncidents';
    }
    const copy = getCrimeChartCopy();
    localeCache?.store({
      kind: 'charts',
      cityRows: byMonthRows(cityRows),
      areaRows: byMonthRows(bufRows),
      topRows,
      heatMatrix: buildMatrix(heatRows),
      statusKey,
    });
    chartSinks.status(statusKey ? t(statusKey) : '', statusKey ? { key: statusKey } : undefined);
    if (!isFresh()) return { applied: false };
    chartSinks.monthly(byMonthRows(cityRows), byMonthRows(bufRows), copy);
    if (!isFresh()) return { applied: false };
    chartSinks.top(topRows, copy);
    if (!isFresh()) return { applied: false };
    chartSinks.heat(buildMatrix(heatRows), copy);
    if (!isFresh()) return { applied: false };
    return { applied: true };
  } catch (e) {
    if (!isFresh() || isAbortError(e)) return { applied: false };
    localeCache?.store({ kind: 'error', error: e });
    chartSinks.error(e, {
      message: t('chart.unavailable', { message: e?.message || e }),
    });
    throw e;
  }
}
