import dayjs from "dayjs";
import { fetchCountBuffer, fetchTopTypesBuffer } from "../api/crime.js";
import { estimatePopInBuffer } from "../utils/pop_buffer.js";
import { escapeHtml } from "../utils/html.js";
import { applyTranslations, t } from '../i18n/index.js';

function localized(key, params = {}) {
  const serialized = Object.keys(params).length
    ? ` data-i18n-params="${escapeHtml(JSON.stringify(params))}"`
    : '';
  return `<span data-i18n="${key}"${serialized}>${escapeHtml(t(key, params))}</span>`;
}

function fmtPct(v) {
  return v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

const DEFAULT_FETCHERS = {
  fetchCountBuffer,
  fetchTopTypesBuffer,
  estimatePopInBuffer,
};

let lastComparison = null;
let savedComparisonActive = false;

export function setCurrentAnalysisSelection(element, selectionKey) {
  if (!element) return false;
  const selected = Boolean(selectionKey);
  element.classList?.toggle?.('is-current-analysis', selected);
  if (selected) {
    element.dataset.selectionKey = selectionKey;
    element.setAttribute?.('aria-current', 'true');
  } else {
    if (element.dataset) delete element.dataset.selectionKey;
    element.removeAttribute?.('aria-current');
  }
  return selected;
}

export function buildComparisonFilterKey(filters = {}) {
  return JSON.stringify({
    start: filters.start || null,
    end: filters.end || null,
    types: [...(filters.types || [])].map(String).sort(),
    center3857: filters.center3857 || null,
    centerB3857: filters.centerB3857 || null,
    radiusM: Number(filters.radiusM ?? filters.radius) || null,
    adminLevel: filters.adminLevel || null,
    per10k: Boolean(filters.per10k),
    addressA: filters.addressA || null,
    addressB: filters.addressB || null,
  });
}

export function getLastComparison(filters) {
  if (!lastComparison) return null;
  if (filters && lastComparison.filterKey !== buildComparisonFilterKey(filters)) return null;
  return structuredClone(lastComparison.comparison);
}

export function getLastComparisonSnapshot(filters) {
  if (!lastComparison) return null;
  if (filters && lastComparison.filterKey !== buildComparisonFilterKey(filters)) return null;
  return structuredClone(lastComparison);
}

function formatDateRange(start, end) {
  const first = dayjs(start);
  const last = dayjs(end).subtract(1, 'day');
  if (!first.isValid() || !last.isValid()) return t('summary.selectedWindow');
  if (first.year() === last.year()) {
    return `${first.format('MMM D')} – ${last.format('MMM D, YYYY')}`;
  }
  return `${first.format('MMM D, YYYY')} – ${last.format('MMM D, YYYY')}`;
}

function renderComparisonPoint(label, point) {
  if (!point) return '';
  return `
    <div class="crime-comparison-point">
      <strong>${escapeHtml(point.label || label)}</strong>
      <span>${localized('summary.incidents', { count: Number(point.total) || 0 })}</span>
    </div>`;
}

export function buildCrimeSummaryHtml({ a, b } = {}, {
  start,
  end,
  coverageDate,
} = {}) {
  if (!a) {
    return `<p class="crime-summary__empty" data-i18n="crime.summaryEmpty">${t('crime.summaryEmpty')}</p>`;
  }
  const topCategory = a.top3?.[0]?.text_general_code || t('summary.noCategory');
  const coverageLabel = dayjs(coverageDate).isValid()
    ? dayjs(coverageDate).format('MMM D, YYYY')
    : t('summary.latestDate');
  const comparison = b ? `
    <div class="crime-comparison" aria-label="${t('summary.areaComparisonLabel')}" data-i18n-aria-label="summary.areaComparisonLabel">
      <h3 data-i18n="summary.areaComparison">${t('summary.areaComparison')}</h3>
      ${renderComparisonPoint(t('summary.selectedArea'), a)}
      ${renderComparisonPoint(t('summary.comparisonArea'), b)}
    </div>` : '';

  return `
    <section class="crime-summary" aria-labelledby="crime-summary-title">
      <p class="crime-summary__eyebrow" data-i18n="summary.eyebrow">${t('summary.eyebrow')}</p>
      <h2 id="crime-summary-title">${localized('summary.reportedIncidents', { count: Number(a.total) || 0 })}</h2>
      <dl class="crime-summary__metrics">
        <div><dt data-i18n="summary.mostCommon">${t('summary.mostCommon')}</dt><dd>${escapeHtml(topCategory)}</dd></div>
        <div><dt data-i18n="summary.last30">${t('summary.last30')}</dt><dd>${fmtPct(a.delta30)}</dd></div>
      </dl>
      <p class="crime-summary__context">${localized('summary.context', { range: formatDateRange(start, end), coverage: coverageLabel })}</p>
      <p class="crime-summary__notice" data-i18n="summary.notice">${t('summary.notice')}</p>
      ${comparison}
    </section>`;
}

function createDefaultCompareView(context = {}) {
  const element = document.getElementById('compare-card');
  if (!element) return null;
  return {
    pending() {
      if (savedComparisonActive) return;
      element.innerHTML = `<div class="crime-summary__loading" role="status" data-i18n="summary.updating">${t('summary.updating')}</div>`;
      applyTranslations(element);
    },
    success(result) {
      element.innerHTML = buildCrimeSummaryHtml(result, context);
      applyTranslations(element);
    },
    error(error) {
      if (savedComparisonActive) return;
      element.innerHTML = `<div style="color:#b91c1c; font:12px system-ui">${localized('summary.failed', { message: error?.message || error })}</div>`;
      applyTranslations(element);
    },
    empty(message) {
      element.innerHTML = `<div style="font:12px system-ui;color:#64748b">${escapeHtml(message)}</div>`;
    },
  };
}

export function renderSavedComparison(resultSummary, { view } = {}) {
  const compareView = view ?? createDefaultCompareView();
  if (!compareView) return false;
  if (!resultSummary?.generatedAt || !resultSummary?.comparison) {
    savedComparisonActive = false;
    compareView.empty?.(t('summary.savedEmpty'));
    return false;
  }
  savedComparisonActive = true;
  compareView.success(resultSummary.comparison);
  return true;
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

/**
 * Live compare card for buffers A and B.
 * @param {{start:string,end:string,types?:string[],center3857:[number,number],radiusM:number,adminLevel:string}} params
 */
export async function updateCompare(
  {
    start,
    end,
    types = [],
    center3857,
    centerB3857 = null,
    addressA = 'Point A',
    addressB = 'Point B',
    radiusM,
    adminLevel = 'districts',
    per10k = false,
    coverageDate = null,
  },
  {
    signal,
    shouldApply = () => true,
    fetchers,
    view,
    now = () => new Date().toISOString(),
  } = {},
) {
  const compareFetchers = { ...DEFAULT_FETCHERS, ...fetchers };
  const compareView = view ?? createDefaultCompareView({ start, end, coverageDate });
  if (!compareView) return null;
  const isFresh = () => !signal?.aborted && shouldApply();
  if (!isFresh()) return { applied: false };
  const filterKey = buildComparisonFilterKey({
    start, end, types, center3857, centerB3857, radiusM, adminLevel,
    per10k, addressA, addressB,
  });
  const retainedComparison = lastComparison?.filterKey === filterKey
    ? lastComparison
    : null;

  try {
    if (!retainedComparison) compareView.pending();

    const readPoint = async (pointCenter, label) => {
      if (!pointCenter) return null;
      const end30 = dayjs(end);
      const start30 = dayjs(end30).subtract(30, 'day').format('YYYY-MM-DD');
      const prior30Start = dayjs(start30).subtract(30, 'day').format('YYYY-MM-DD');
      const [total, topResponse, last30, prior30, population] = await Promise.all([
        compareFetchers.fetchCountBuffer({ start, end, types, center3857: pointCenter, radiusM, signal }),
        compareFetchers.fetchTopTypesBuffer({ start, end, types, center3857: pointCenter, radiusM, limit: 3, signal }),
        compareFetchers.fetchCountBuffer({ start: start30, end, types, center3857: pointCenter, radiusM, signal }),
        compareFetchers.fetchCountBuffer({ start: prior30Start, end: start30, types, center3857: pointCenter, radiusM, signal }),
        adminLevel === 'tracts'
          ? compareFetchers.estimatePopInBuffer({ center3857: pointCenter, radiusM, signal })
          : Promise.resolve({ pop: 0 }),
      ]);
      const topRows = Array.isArray(topResponse?.rows) ? topResponse.rows : topResponse;
      const top3 = (topRows || []).map((row) => ({
        text_general_code: row.text_general_code,
        n: Number(row.n) || 0,
      }));
      return {
        label,
        total,
        per10k: adminLevel === 'tracts' && population.pop > 0 ? (total / population.pop) * 10000 : null,
        top3,
        delta30: prior30 === 0 ? null : (last30 - prior30) / prior30,
      };
    };
    const [a, b] = await Promise.all([
      readPoint(center3857, addressA || 'Point A'),
      readPoint(centerB3857, addressB || 'Point B'),
    ]);
    if (!isFresh()) return { applied: false };
    const result = { a, b, ...(a || {}) };
    lastComparison = {
      filterKey,
      generatedAt: now(),
      comparison: { a, b },
    };
    savedComparisonActive = false;
    compareView.success(result);
    return { applied: true, ...result };
  } catch (e) {
    if (!isFresh() || isAbortError(e)) return { applied: false };
    if (!retainedComparison) compareView.error(e);
    return null;
  }
}

