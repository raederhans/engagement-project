import dayjs from "dayjs";
import { fetchCountBuffer, fetchTopTypesBuffer } from "../api/crime.js";
import { estimatePopInBuffer } from "../utils/pop_buffer.js";
import { escapeHtml } from "../utils/html.js";
import { applyTranslations, onLanguageChange, t } from '../i18n/index.js';
import { formatCalendarDate } from '../i18n/date.js';
import { localizeOffenseCode } from '../i18n/crime_offenses.js';
import { populationEstimate } from '../data/acs_population.js';

function localized(key, params = {}) {
  const serialized = Object.keys(params).length
    ? ` data-i18n-params="${escapeHtml(JSON.stringify(params))}"`
    : '';
  return `<span data-i18n="${key}"${serialized}>${escapeHtml(t(key, params))}</span>`;
}

function detailText(key, params = {}) {
  return escapeHtml(t(key, params));
}

const DEFAULT_FETCHERS = {
  fetchCountBuffer,
  fetchTopTypesBuffer,
  estimatePopInBuffer,
};

function cloneResolvedSource(metadata) {
  if (!metadata || typeof metadata !== 'object' || !String(metadata.dataset || '').trim()) {
    return null;
  }
  return structuredClone(metadata);
}

function reportResolvedSource(callback, metadata) {
  if (typeof callback !== 'function') return;
  try {
    callback(structuredClone(metadata));
  } catch {}
}

function mergeResolvedSources(...collections) {
  const merged = new Map();
  for (const source of collections.flat()) {
    const normalized = cloneResolvedSource(source);
    if (!normalized) continue;
    const key = [
      normalized.dataset,
      normalized.kind,
      normalized.provider,
      normalized.asOf || '',
    ].join('\u0000');
    merged.set(key, normalized);
  }
  return [...merged.values()];
}

let lastComparison = null;
let lastExportableComparison = null;
let savedComparisonActive = false;
let refreshDefaultCompareView = null;

onLanguageChange(() => refreshDefaultCompareView?.());

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
  const tractMode = filters.queryMode === 'tract' && /^\d{11}$/.test(filters.selectedTractGEOID || '');
  const districtMode = filters.queryMode === 'district' && /^\d{2}$/.test(filters.selectedDistrictCode || '');
  const publicAreaMode = tractMode || districtMode;
  return JSON.stringify({
    start: filters.start || null,
    end: filters.end || null,
    types: [...(filters.types || [])].map(String).sort(),
    center3857: publicAreaMode ? null : filters.center3857 || null,
    centerB3857: publicAreaMode ? null : filters.centerB3857 || null,
    radiusM: publicAreaMode ? null : Number(filters.radiusM ?? filters.radius) || null,
    adminLevel: filters.adminLevel || null,
    per10k: Boolean(filters.per10k),
    addressA: publicAreaMode ? null : filters.addressA || null,
    addressB: publicAreaMode ? null : filters.addressB || null,
    queryMode: filters.queryMode || 'buffer',
    selectedDistrictCode: districtMode ? filters.selectedDistrictCode : null,
    selectedTractGEOID: filters.selectedTractGEOID || null,
  });
}

export function getLastComparison(filters) {
  if (!lastExportableComparison) return null;
  if (filters && lastExportableComparison.filterKey !== buildComparisonFilterKey(filters)) return null;
  return publicComparison(lastExportableComparison.comparison);
}

export function getLastComparisonSnapshot(filters) {
  if (!lastExportableComparison) return null;
  if (filters && lastExportableComparison.filterKey !== buildComparisonFilterKey(filters)) return null;
  return {
    filterKey: lastExportableComparison.filterKey,
    generatedAt: lastExportableComparison.generatedAt,
    comparison: publicComparison(lastExportableComparison.comparison),
  };
}

function publicComparison(comparison) {
  const normalize = (point) => point ? structuredClone({
    label: point.label,
    total: point.total,
    per10k: point.per10k,
    top3: point.top3 || [],
    delta30: point.delta30,
    ...(point.population && typeof point.population === 'object'
      ? { population: point.population }
      : {}),
  }) : null;
  return { a: normalize(comparison?.a), b: normalize(comparison?.b) };
}

function formatDateRange(start, end) {
  if (!start || !end) return t('summary.selectedWindow');
  const first = dayjs(start);
  const last = dayjs(end).subtract(1, 'day');
  if (!first.isValid() || !last.isValid()) return t('summary.selectedWindow');
  const firstDate = first.format('YYYY-MM-DD');
  const lastDate = last.format('YYYY-MM-DD');
  if (first.year() === last.year()) {
    return `${formatCalendarDate(firstDate, { includeYear: false })} – ${formatCalendarDate(lastDate)}`;
  }
  return `${formatCalendarDate(firstDate)} – ${formatCalendarDate(lastDate)}`;
}

function markPreviousResult(value, status) {
  if (status !== 'stale') return value;
  return `${value} <span class="crime-summary__previous-result">${localized('summary.previousResult')}</span>`;
}

function rateMetricStatus(point) {
  if (point?.per10k == null) return 'unavailable';
  const statuses = [point?.metricStatus?.count, point?.metricStatus?.population];
  return statuses.includes('stale') ? 'stale' : 'available';
}

function renderComparisonPoint(label, point) {
  if (!point) return '';
  const countValue = point.total == null
    ? detailText('summary.metricUnavailable')
    : localized('summary.incidents', { count: point.total });
  const count = markPreviousResult(countValue, point.metricStatus?.count);
  return `
    <div class="crime-comparison-point">
      <strong>${escapeHtml(point.label || label)}</strong>
      <span>${count}</span>
    </div>`;
}

function finiteMetric(value, formatter) {
  if (value == null || value === '') return detailText('summary.metricUnavailable');
  const number = Number(value);
  return Number.isFinite(number)
    ? formatter(number)
    : detailText('summary.metricUnavailable');
}

function averagePer30Days(total, start, end) {
  if (total == null || total === '' || !start || !end) return null;
  const count = Number(total);
  if (!Number.isFinite(count)) return null;
  const first = dayjs(start);
  const last = dayjs(end);
  if (!first.isValid() || !last.isValid()) return null;
  const days = last.diff(first, 'day', true);
  if (!Number.isFinite(days) || days <= 0) return null;
  return (count * 30) / days;
}

function comparisonInsight(a, b) {
  if (a?.total == null || b?.total == null) return detailText('summary.metricUnavailable');
  const aTotal = Number(a.total);
  const bTotal = Number(b.total);
  if (!Number.isFinite(aTotal) || !Number.isFinite(bTotal)) return detailText('summary.metricUnavailable');
  const difference = aTotal - bTotal;
  if (difference === 0) return detailText('summary.sameIncidents');
  const relative = bTotal > 0 ? (Math.abs(difference) / bTotal) * 100 : null;
  const direction = difference > 0 ? 'moreIncidents' : 'fewerIncidents';
  return detailText(`summary.${direction}${relative == null ? '' : 'Relative'}`, {
    label: a?.label || t('summary.selectedArea'),
    count: Math.abs(difference),
    other: b?.label || t('summary.comparisonArea'),
    percent: relative?.toFixed(1),
  });
}

function renderCategoryItems(point) {
  const total = point?.total == null ? null : Number(point.total);
  const rows = Array.isArray(point?.top3) ? point.top3.slice(0, 3) : [];
  const result = rows.length
    ? `<ol>${rows.map((row) => {
        const rawCount = row?.n == null ? null : Number(row.n);
        const count = Number.isFinite(rawCount) ? Math.max(0, rawCount) : null;
        const share = count != null && Number.isFinite(total) && total > 0
          ? Math.min(100, (count / total) * 100)
          : null;
        const value = count == null || share == null
          ? detailText('summary.metricUnavailable')
          : detailText('summary.categoryValue', { count, share: share.toFixed(1) });
        return `<li>
          <div class="crime-comparison-category__label">
            <span>${escapeHtml(localizeOffenseCode(row?.text_general_code) || t('summary.noCategory'))}</span>
            <span>${value}</span>
          </div>
          ${share == null ? '' : `<progress class="crime-comparison-category__track" max="100" value="${share.toFixed(1)}" aria-hidden="true"></progress>`}
        </li>`;
      }).join('')}</ol>`
    : `<p class="crime-comparison-categories__empty">${detailText('summary.noCategoryData')}</p>`;
  return point?.metricStatus?.top === 'stale'
    ? `${result}<p class="crime-summary__previous-result">${localized('summary.previousResult')}</p>`
    : result;
}

function renderCategoryList(point, fallbackLabel) {
  const label = point?.label || fallbackLabel;
  return `<section class="crime-comparison-categories__area">
    <h5>${escapeHtml(label)}</h5>
    ${renderCategoryItems(point)}
  </section>`;
}

function renderComparisonDetails(a, b, { start, end } = {}) {
  const aLabel = a?.label || t('summary.selectedArea');
  const bLabel = b?.label || t('summary.comparisonArea');
  const totalA = markPreviousResult(
    finiteMetric(a?.total, (value) => String(value)),
    a?.metricStatus?.count,
  );
  const totalB = markPreviousResult(
    finiteMetric(b?.total, (value) => String(value)),
    b?.metricStatus?.count,
  );
  const rateA = markPreviousResult(
    finiteMetric(a?.per10k, (value) => value.toFixed(1)),
    rateMetricStatus(a),
  );
  const rateB = markPreviousResult(
    finiteMetric(b?.per10k, (value) => value.toFixed(1)),
    rateMetricStatus(b),
  );
  const averageA = markPreviousResult(
    finiteMetric(averagePer30Days(a?.total, start, end), (value) => value.toFixed(1)),
    a?.metricStatus?.count,
  );
  const averageB = markPreviousResult(
    finiteMetric(averagePer30Days(b?.total, start, end), (value) => value.toFixed(1)),
    b?.metricStatus?.count,
  );
  const insight = markPreviousResult(
    comparisonInsight(a, b),
    [a?.metricStatus?.count, b?.metricStatus?.count].includes('stale') ? 'stale' : 'available',
  );

  return `<details class="crime-comparison-details">
    <summary>${detailText('summary.detailedComparison')}</summary>
    <div class="crime-comparison-details__body">
      <p class="crime-comparison-details__insight">${insight}</p>
      <div class="crime-comparison-table-wrap">
        <table class="crime-comparison-table" aria-label="${escapeHtml(t('summary.detailedComparisonTable'))}" data-i18n-aria-label="summary.detailedComparisonTable">
          <thead><tr>
            <th scope="col">${detailText('summary.metric')}</th>
            <th scope="col">${escapeHtml(aLabel)}</th>
            <th scope="col">${escapeHtml(bLabel)}</th>
          </tr></thead>
          <tbody>
            <tr><th scope="row">${detailText('summary.reportedMetric')}</th><td>${totalA}</td><td>${totalB}</td></tr>
            <tr><th scope="row">${detailText('summary.per10kMetric')}</th><td>${rateA}</td><td>${rateB}</td></tr>
            <tr><th scope="row">${detailText('summary.average30Metric')}</th><td>${averageA}</td><td>${averageB}</td></tr>
          </tbody>
        </table>
      </div>
      <section class="crime-comparison-categories" aria-label="${escapeHtml(t('summary.topCategories'))}">
        <h4>${detailText('summary.topCategories')}</h4>
        <div class="crime-comparison-categories__grid">
          ${renderCategoryList(a, t('summary.selectedArea'))}
          ${renderCategoryList(b, t('summary.comparisonArea'))}
        </div>
      </section>
      <p class="crime-comparison-details__notice">${detailText('summary.detailsNotice')}</p>
    </div>
  </details>`;
}

function populationValue(metric, field, formatter = String) {
  const value = metric?.[field];
  if (value == null || value === '') return detailText('summary.metricUnavailable');
  return formatter(value);
}

function renderPopulationEvidence(a, b) {
  const points = [a, b].filter((point) => point?.population && typeof point.population === 'object');
  if (!points.length) return '';
  const usesBufferApproximation = points.some(
    (point) => point.population.method === 'centroid-in-buffer-whole-tract-sum',
  );
  const renderPoint = (point) => {
    const population = point.population;
    const estimate = populationValue(population, 'estimate', (value) => Number(value).toLocaleString());
    const moe90 = population.moe90 == null && population.method === 'centroid-in-buffer-whole-tract-sum'
      ? detailText('summary.populationMoeBufferUnavailable')
      : populationValue(population, 'moe90', (value) => `±${Number(value).toLocaleString()}`);
    return `<section class="crime-comparison-categories__area">
      <h5>${escapeHtml(point.label || t('summary.selectedArea'))}</h5>
      <dl class="crime-summary__metrics">
        <div><dt>${detailText('summary.populationEstimate')}</dt><dd>${estimate}</dd></div>
        <div><dt>${detailText('summary.populationMoe90')}</dt><dd>${moe90}</dd></div>
        <div><dt>${detailText('summary.populationVintage')}</dt><dd>${escapeHtml(populationValue(population, 'vintage'))}</dd></div>
      </dl>
    </section>`;
  };
  return `<section class="crime-comparison-categories" aria-label="${escapeHtml(t('summary.populationEvidence'))}">
    <h4>${detailText('summary.populationEvidence')}</h4>
    <div class="crime-comparison-categories__grid">${points.map(renderPoint).join('')}</div>
    ${usesBufferApproximation ? `<p class="crime-comparison-details__notice">${detailText('summary.populationBufferMethod')}</p>` : ''}
    <p class="crime-comparison-details__notice">${detailText('summary.populationUncertaintyBoundary')}</p>
  </section>`;
}

export function bindComparisonDisclosure(details, state) {
  if (!details || !state) return false;
  details.open = Boolean(state.open);
  details.addEventListener?.('toggle', () => {
    state.open = Boolean(details.open);
  });
  return true;
}

export function buildCrimeSummaryHtml({ a, b } = {}, {
  start,
  end,
  coverageDate,
} = {}) {
  if (!a) {
    return `<p class="crime-summary__empty" data-i18n="crime.summaryEmpty">${t('crime.summaryEmpty')}</p>`;
  }
  const topCategory = markPreviousResult(
    escapeHtml(localizeOffenseCode(a.top3?.[0]?.text_general_code) || t('summary.noCategory')),
    a.metricStatus?.top,
  );
  const average30 = averagePer30Days(a.total, start, end);
  const average30Value = average30 == null
    ? detailText('summary.metricUnavailable')
    : localized('summary.average30Value', { count: average30.toFixed(1) });
  const average30Label = markPreviousResult(average30Value, a.metricStatus?.count);
  const coverageLabel = coverageDate && dayjs(coverageDate).isValid()
    ? formatCalendarDate(coverageDate)
    : t('summary.latestDate');
  const comparison = b ? `
    <div class="crime-comparison" aria-label="${t('summary.areaComparisonLabel')}" data-i18n-aria-label="summary.areaComparisonLabel">
      <h3 data-i18n="summary.areaComparison">${t('summary.areaComparison')}</h3>
      ${renderComparisonPoint(t('summary.selectedArea'), a)}
      ${renderComparisonPoint(t('summary.comparisonArea'), b)}
      ${renderComparisonDetails(a, b, { start, end })}
    </div>` : '';
  const partialNotice = [a, b].filter(Boolean).some((point) => (
    point.stale || (point.status && point.status !== 'success')
  ))
    ? `<p class="crime-summary__status crime-summary__status--partial">${localized('summary.partialNotice')}</p>`
    : '';
  const primaryTitle = markPreviousResult(
    a.total == null
      ? detailText('summary.metricUnavailable')
      : localized('summary.reportedIncidents', { count: a.total }),
    a.metricStatus?.count,
  );

  return `
    <section class="crime-summary" aria-labelledby="crime-summary-title">
      <p class="crime-summary__eyebrow" data-i18n="summary.eyebrow">${t('summary.eyebrow')}</p>
      ${partialNotice}
      <h2 id="crime-summary-title">${primaryTitle}</h2>
      <dl class="crime-summary__metrics">
        <div><dt data-i18n="summary.mostCommon">${t('summary.mostCommon')}</dt><dd>${topCategory}</dd></div>
        <div><dt data-i18n="summary.average30Metric">${t('summary.average30Metric')}</dt><dd>${average30Label}</dd></div>
      </dl>
      <section class="crime-summary-categories" aria-label="${escapeHtml(t('summary.selectionCategories'))}" data-i18n-aria-label="summary.selectionCategories">
        <h3 data-i18n="summary.selectionCategories">${t('summary.selectionCategories')}</h3>
        ${renderCategoryItems(a)}
      </section>
      <p class="crime-summary__context">${localized('summary.context', { range: formatDateRange(start, end), coverage: coverageLabel })}</p>
      <p class="crime-summary__notice" data-i18n="summary.notice">${t('summary.notice')}</p>
      ${comparison}
      ${renderPopulationEvidence(a, b)}
    </section>`;
}

function createDefaultCompareView(context = {}) {
  const element = document.getElementById('compare-card');
  if (!element) return null;
  const comparisonDisclosureState = { open: false };
  const render = (commit) => {
    refreshDefaultCompareView = commit;
    commit();
  };
  return {
    pending() {
      if (savedComparisonActive) return;
      render(() => {
        element.innerHTML = `<div class="crime-summary__loading" role="status" data-i18n="summary.updating">${t('summary.updating')}</div>`;
        applyTranslations(element);
      });
    },
    success(result) {
      render(() => {
        if (!result?.b) comparisonDisclosureState.open = false;
        element.innerHTML = buildCrimeSummaryHtml(result, context);
        applyTranslations(element);
        bindComparisonDisclosure(element.querySelector?.('.crime-comparison-details'), comparisonDisclosureState);
      });
    },
    error(error) {
      if (savedComparisonActive) return;
      render(() => {
        element.innerHTML = `<div class="crime-summary__status crime-summary__status--error">${localized('summary.failed', { message: error?.message || error })}</div>`;
        applyTranslations(element);
      });
    },
    empty(message, key = null) {
      render(() => {
        element.innerHTML = `<div class="crime-summary__status crime-summary__status--empty">${escapeHtml(key ? t(key) : message)}</div>`;
      });
    },
  };
}

export function renderSavedComparison(resultSummary, { view } = {}) {
  const compareView = view ?? createDefaultCompareView();
  if (!compareView) return false;
  if (!resultSummary?.generatedAt || !resultSummary?.comparison) {
    savedComparisonActive = false;
    compareView.empty?.(t('summary.savedEmpty'), 'summary.savedEmpty');
    return false;
  }
  savedComparisonActive = true;
  compareView.success(resultSummary.comparison);
  return true;
}

export function clearCurrentComparison({ view } = {}) {
  const compareView = view ?? createDefaultCompareView();
  if (!compareView) return false;
  lastComparison = null;
  lastExportableComparison = null;
  savedComparisonActive = false;
  compareView.success({ a: null, b: null });
  return true;
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function errorMessage(error) {
  return error?.message || String(error);
}

function retainedMetric(point, metric) {
  if (!point) return undefined;
  if (metric === 'count') return point.total;
  if (metric === 'top') return point.top3;
  if (metric === 'population') return point.population;
  return undefined;
}

function resolveMetric(settlement, point, metric, normalize = (value) => value) {
  if (settlement.status === 'fulfilled') {
    const value = normalize(settlement.value);
    if (value != null) return { value, status: 'available', error: null };
  }
  const retained = retainedMetric(point, metric);
  const error = settlement.status === 'rejected'
    ? errorMessage(settlement.reason)
    : `${metric} unavailable`;
  if (retained != null) {
    return { value: structuredClone(retained), status: 'stale', error };
  }
  return { value: null, status: 'unavailable', error };
}

function failedPoint(label, retained, error) {
  const message = errorMessage(error);
  const count = retainedMetric(retained, 'count');
  const top = retainedMetric(retained, 'top');
  const population = retainedMetric(retained, 'population');
  const metricStatus = {
    count: count == null ? 'unavailable' : 'stale',
    top: top == null ? 'unavailable' : 'stale',
    population: population == null ? 'unavailable' : 'stale',
  };
  return {
    label,
    status: 'failed',
    stale: Object.values(metricStatus).includes('stale'),
    total: count ?? null,
    per10k: null,
    top3: top == null ? null : structuredClone(top),
    population: population ?? null,
    delta30: null,
    metricStatus,
    errors: { point: message },
  };
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
    queryMode = 'buffer',
    selectedDistrictCode = null,
    selectedTractGEOID = null,
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
    onSourceResolved,
  } = {},
) {
  const compareFetchers = { ...DEFAULT_FETCHERS, ...fetchers };
  const compareView = view ?? createDefaultCompareView({ start, end, coverageDate });
  if (!compareView) return null;
  const isFresh = () => !signal?.aborted && shouldApply();
  if (!isFresh()) return { applied: false };
  const filterKey = buildComparisonFilterKey({
    start, end, types, center3857, centerB3857, radiusM, queryMode,
    selectedDistrictCode, selectedTractGEOID, adminLevel, per10k, addressA, addressB,
  });
  const retainedComparison = lastComparison?.filterKey === filterKey
    ? lastComparison
    : null;
  const resolvedPopulationSources = new Map();
  const capturePopulationSource = (metadata) => {
    const source = cloneResolvedSource(metadata);
    if (!source) return;
    resolvedPopulationSources.set(source.dataset, source);
  };

  try {
    if (!retainedComparison) compareView.pending();

    const readPoint = async (pointCenter, label, retainedPoint) => {
      if (!pointCenter) return null;
      const populationRequested = adminLevel === 'tracts';
      const [countResult, topResult, populationResult] = await Promise.allSettled([
        compareFetchers.fetchCountBuffer({ start, end, types, center3857: pointCenter, radiusM, signal }),
        compareFetchers.fetchTopTypesBuffer({ start, end, types, center3857: pointCenter, radiusM, limit: 3, signal }),
        populationRequested
          ? compareFetchers.estimatePopInBuffer({
              center3857: pointCenter,
              radiusM,
              signal,
              onSourceResolved: capturePopulationSource,
            })
          : Promise.resolve(null),
      ]);
      const count = resolveMetric(countResult, retainedPoint, 'count', (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      });
      const top = resolveMetric(topResult, retainedPoint, 'top', (response) => {
        const rows = Array.isArray(response?.rows) ? response.rows : response;
        if (!Array.isArray(rows)) return null;
        return rows.map((row) => {
          const countValue = row?.n == null ? null : Number(row.n);
          return {
            text_general_code: row?.text_general_code,
            n: Number.isFinite(countValue) ? countValue : null,
          };
        });
      });
      const population = populationRequested
        ? resolveMetric(populationResult, retainedPoint, 'population', (response) => {
            if (response?.population && typeof response.population === 'object') {
              return populationEstimate(response.population) == null
                ? null
                : structuredClone(response.population);
            }
            const value = Number(response?.pop);
            return Number.isFinite(value) ? value : null;
          })
        : { value: null, status: 'unavailable', error: null };
      const applicable = populationRequested
        ? [count, top, population]
        : [count, top];
      const failures = applicable.filter((item) => item.status !== 'available').length;
      const status = failures === applicable.length
        ? 'failed'
        : failures > 0 ? 'partial' : 'success';
      const populationPointEstimate = populationEstimate(population.value);
      const per10kValue = count.value != null && populationPointEstimate > 0
        ? (count.value / populationPointEstimate) * 10000
        : null;
      return {
        label,
        status,
        stale: [count, top, population].some((metric) => metric.status === 'stale'),
        total: count.value,
        per10k: per10kValue,
        top3: top.value,
        population: population.value,
        delta30: null,
        metricStatus: {
          count: count.status,
          top: top.status,
          population: population.status,
        },
        errors: Object.fromEntries([
          ['count', count.error],
          ['top', top.error],
          ['population', population.error],
        ].filter(([, message]) => message)),
      };
    };
    const [aResult, bResult] = await Promise.allSettled([
      readPoint(center3857, addressA || 'Point A', retainedComparison?.comparison?.a),
      readPoint(centerB3857, addressB || 'Point B', retainedComparison?.comparison?.b),
    ]);
    if (!isFresh()) return { applied: false };
    const a = aResult.status === 'fulfilled'
      ? aResult.value
      : failedPoint(addressA || 'Point A', retainedComparison?.comparison?.a, aResult.reason);
    const b = bResult.status === 'fulfilled'
      ? bResult.value
      : failedPoint(addressB || 'Point B', retainedComparison?.comparison?.b, bResult.reason);
    const requestedPoints = [a, b].filter(Boolean);
    const status = requestedPoints.every((point) => point.status === 'failed')
      ? 'failed'
      : requestedPoints.some((point) => point.status !== 'success') ? 'partial' : 'success';
    const stale = requestedPoints.some((point) => point.stale);
    const stalePopulation = requestedPoints.some((point) => (
      point.metricStatus?.population === 'stale'
    ));
    const currentPopulation = requestedPoints.some((point) => (
      point.metricStatus?.population === 'available'
    ));
    const currentPopulationSources = currentPopulation
      ? [...resolvedPopulationSources.values()]
      : [];
    for (const source of currentPopulationSources) {
      reportResolvedSource(onSourceResolved, source);
    }
    const sourceLineage = mergeResolvedSources(
      currentPopulationSources,
      stalePopulation ? retainedComparison?.sources || [] : [],
    );
    const result = {
      ...(a || {}),
      applied: true,
      status,
      stale,
      retainedGeneratedAt: stale ? retainedComparison?.generatedAt ?? null : null,
      sourceLineage,
      metricStatus: Object.fromEntries(requestedPoints.map((point, index) => [index === 0 ? 'a' : 'b', point.metricStatus])),
      errors: Object.fromEntries(requestedPoints.map((point, index) => [index === 0 ? 'a' : 'b', point.errors])),
      a,
      b,
    };
    if (status === 'success') {
      const currentComparison = {
        filterKey,
        generatedAt: now(),
        comparison: { a, b },
        sources: sourceLineage.map((source) => structuredClone(source)),
      };
      lastComparison = currentComparison;
      lastExportableComparison = currentComparison;
    } else {
      lastExportableComparison = null;
    }
    savedComparisonActive = false;
    if (status === 'failed' && !requestedPoints.some((point) => point.stale)) {
      compareView.error(new Error(requestedPoints
        .flatMap((point) => Object.values(point.errors || {}))
        .join('; ') || 'Comparison unavailable'));
    } else {
      compareView.success(result);
    }
    return result;
  } catch (e) {
    if (!isFresh() || isAbortError(e)) return { applied: false };
    lastExportableComparison = null;
    if (!retainedComparison) compareView.error(e);
    return null;
  }
}

