import {
  getLanguage,
  onLanguageChange,
  setTranslatedText,
  t,
} from '../i18n/index.js';
import { localizeOffenseCode } from '../i18n/crime_offenses.js';
import { formatCrimeIncidentDate } from '../i18n/date.js';
import { describeOffense, listOffenseThemes } from '../utils/crime_taxonomy.js';

const MAX_TABLE_ROWS = 200;
const LIST_LEVELS = Object.freeze(['overview', 'categories', 'records', 'charts']);

export function describeCrimeListCount(total, displayed) {
  const normalizedDisplayed = Math.max(0, Number(displayed) || 0);
  const normalizedTotal = Math.max(normalizedDisplayed, Number(total) || 0);
  if (normalizedTotal === 0) return { key: 'crime.list.empty', params: {} };
  if (normalizedDisplayed < normalizedTotal) {
    return {
      key: 'crime.list.countTruncated',
      params: { displayed: normalizedDisplayed, total: normalizedTotal },
    };
  }
  return { key: 'crime.list.count', params: { count: normalizedTotal } };
}

/** Convert bounded source-category totals into the two non-record list levels. */
export function projectCrimeListSummary(rows, language = getLanguage()) {
  const normalizedLanguage = language === 'zh-CN' ? 'zh-CN' : 'en';
  const themeLabels = new Map(listOffenseThemes(normalizedLanguage).map(({ id, label }) => [id, label]));
  const categoryCounts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const offenseCode = String(row?.text_general_code || '').trim();
    const count = Number(row?.n);
    if (!offenseCode || !Number.isSafeInteger(count) || count < 0) continue;
    categoryCounts.set(offenseCode, (categoryCounts.get(offenseCode) || 0) + count);
  }
  const total = [...categoryCounts.values()].reduce((sum, count) => sum + count, 0);
  const themeCounts = new Map();
  const categories = [...categoryCounts].map(([offenseCode, count]) => {
    const description = describeOffense(offenseCode, normalizedLanguage);
    const themeId = description?.themeId || 'unmapped';
    const themeLabel = description?.themeLabel
      || (normalizedLanguage === 'zh-CN' ? '其他来源分类' : 'Other source categories');
    themeCounts.set(themeId, {
      id: themeId,
      label: themeLabels.get(themeId) || themeLabel,
      count: (themeCounts.get(themeId)?.count || 0) + count,
    });
    return {
      offenseCode,
      offenseLabel: description?.offenseLabel || offenseCode,
      themeId,
      themeLabel,
      count,
      share: total > 0 ? count / total : 0,
    };
  }).sort((a, b) => b.count - a.count || a.offenseLabel.localeCompare(b.offenseLabel));
  const themes = [...themeCounts.values()]
    .map((theme) => ({ ...theme, share: total > 0 ? theme.count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return Object.freeze({ total, themes, categories });
}

export async function runCrimeListRefresh({
  ownsList,
  showIntent,
  showStatus,
  settle,
  loadController,
  reportFailure,
  options = {},
} = {}) {
  if (!ownsList?.()) return { status: 'superseded' };
  showIntent?.('crime', { showSkeleton: false });
  showStatus?.({ mode: 'crime', phase: 'loading', label: 'Crime list' });
  let owner = null;
  try {
    owner = await loadController();
    if (!ownsList?.()) {
      owner?.setActive?.(false);
      return { status: 'superseded' };
    }
    const result = await owner.requestRefresh(options);
    if (!ownsList?.()) {
      owner?.setActive?.(false);
      return { status: 'superseded' };
    }
    const phase = ['live', 'partial', 'idle'].includes(result?.status) ? 'ready' : 'failed';
    showStatus?.({ mode: 'crime', phase, label: 'Crime list' });
    settle?.('crime', phase);
    return result;
  } catch (error) {
    if (!ownsList?.()) {
      owner?.setActive?.(false);
      return { status: 'superseded' };
    }
    reportFailure?.(error);
    showStatus?.({ mode: 'crime', phase: 'failed', label: 'Crime list' });
    settle?.('crime', 'failed');
    return { status: 'failed', succeeded: [], failed: ['list'] };
  }
}

function normalizeIncident(feature) {
  const properties = feature?.properties || {};
  return {
    timestamp: Date.parse(properties.dispatch_date_time || '') || 0,
    offenseCode: String(properties.text_general_code || ''),
    offense: localizeOffenseCode(properties.text_general_code) || t('summary.metricUnavailable'),
    occurred: formatCrimeIncidentDate(properties.dispatch_date_time) || t('summary.metricUnavailable'),
    location: String(properties.location_block || t('summary.metricUnavailable')),
    district: String(properties.dc_dist || t('summary.metricUnavailable')),
  };
}

export function sortCrimeListRows(rows, sort = 'count', kind = 'overview') {
  const values = [...(Array.isArray(rows) ? rows : [])];
  if (kind === 'records') {
    return values.sort((leftFeature, rightFeature) => {
      const left = normalizeIncident(leftFeature);
      const right = normalizeIncident(rightFeature);
      if (sort === 'oldest') return left.timestamp - right.timestamp;
      if (sort === 'offense') return left.offense.localeCompare(right.offense);
      if (sort === 'district') return left.district.localeCompare(right.district, undefined, { numeric: true });
      return right.timestamp - left.timestamp;
    });
  }
  if (sort === 'name') return values.sort((a, b) => (a.label || a.offenseLabel).localeCompare(b.label || b.offenseLabel));
  if (sort === 'theme') {
    return values.sort((a, b) => a.themeLabel.localeCompare(b.themeLabel)
      || b.count - a.count
      || a.offenseLabel.localeCompare(b.offenseLabel));
  }
  return values.sort((a, b) => b.count - a.count || (a.label || a.offenseLabel).localeCompare(b.label || b.offenseLabel));
}

function createCell(documentRef, tagName, text, scope, numeric = false) {
  const cell = documentRef.createElement(tagName);
  if (scope) cell.scope = scope;
  if (numeric) cell.setAttribute?.('data-numeric', 'true');
  cell.textContent = text;
  return cell;
}

function percent(value) {
  return `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)}%`;
}

export function resolveCrimeListFocusTarget({ root, documentRef = globalThis.document } = {}) {
  if (root && !root.hidden && !root.inert) {
    return root.querySelector?.('#crime-list-results-title')
      || documentRef?.getElementById?.('crime-list-results-title')
      || root;
  }
  const visiblePane = documentRef?.querySelector?.('[data-result-pane]:not([hidden])');
  return visiblePane?.querySelector?.('#compare-card') || visiblePane || null;
}

export function createCrimeListResultsView({
  root = globalThis.document?.querySelector?.('[data-crime-list-results]'),
  documentRef = globalThis.document,
  resultMeta = {},
  onQuickFilter = () => {},
  readFilterState = () => ({}),
} = {}) {
  if (!root || !documentRef?.createElement) return null;
  const status = root.querySelector('[data-crime-list-status]');
  const body = root.querySelector('[data-crime-list-body]');
  const caption = root.querySelector('[data-crime-list-caption]');
  const overviewBody = root.querySelector('[data-crime-list-overview-body]');
  const categoriesBody = root.querySelector('[data-crime-list-categories-body]');
  const recordsHint = root.querySelector('[data-crime-list-records-hint]');
  const filterContext = root.querySelector('[data-crime-list-filter-context]');
  const filterInputs = [...(root.querySelectorAll?.('[data-crime-list-filter]') || [])];
  const sortInputs = [...(root.querySelectorAll?.('[data-crime-list-sort]') || [])];
  const categoryChart = root.querySelector('[data-crime-list-category-chart]');
  const monthChart = root.querySelector('[data-crime-list-month-chart]');
  const levelInputs = [...(root.querySelectorAll?.('[data-crime-list-level]') || [])];
  const panels = [...(root.querySelectorAll?.('[data-crime-list-panel]') || [])];
  const tokens = new Map();
  let lastFeatures = [];
  let lastChartFeatures = [];
  let lastTotal = 0;
  let lastSummaryRows = [];
  let selectionAvailable = false;
  let incidentsUnavailable = false;
  let overviewUnavailable = false;
  let activeLevel = levelInputs.find((input) => input.checked)?.value || 'overview';
  const sortState = { overview: 'count', categories: 'count', records: 'newest' };

  const summary = () => projectCrimeListSummary(lastSummaryRows, getLanguage());

  const renderStatus = () => {
    if (overviewUnavailable && activeLevel !== 'records') {
      setTranslatedText(status, 'crime.list.failed');
      return;
    }
    if (activeLevel !== 'records') {
      setTranslatedText(status, 'crime.list.overviewCount', { count: summary().total });
      return;
    }
    if (!selectionAvailable) {
      setTranslatedText(status, 'crime.list.recordsNeedArea');
      return;
    }
    if (incidentsUnavailable) {
      setTranslatedText(status, 'resultMeta.unavailable');
      return;
    }
    const count = describeCrimeListCount(lastTotal, lastFeatures.length);
    setTranslatedText(status, count.key, count.params);
  };

  const renderSummary = () => {
    const projected = summary();
    overviewBody?.replaceChildren?.();
    for (const theme of sortCrimeListRows(projected.themes, sortState.overview, 'overview')) {
      const row = documentRef.createElement('tr');
      row.append(
        createCell(documentRef, 'th', theme.label, 'row'),
        createCell(documentRef, 'td', String(theme.count), '', true),
        createCell(documentRef, 'td', percent(theme.share), '', true),
      );
      overviewBody?.appendChild?.(row);
    }
    categoriesBody?.replaceChildren?.();
    for (const category of sortCrimeListRows(projected.categories, sortState.categories, 'categories')) {
      const row = documentRef.createElement('tr');
      row.append(
        createCell(documentRef, 'th', category.offenseLabel, 'row'),
        createCell(documentRef, 'td', category.themeLabel),
        createCell(documentRef, 'td', String(category.count), '', true),
        createCell(documentRef, 'td', percent(category.share), '', true),
      );
      categoriesBody?.appendChild?.(row);
    }
  };

  const renderBars = (host, rows, { emptyKey = null } = {}) => {
    host?.replaceChildren?.();
    if (!host) return;
    if (!rows.length) {
      if (emptyKey) setTranslatedText(host, emptyKey);
      return;
    }
    const max = Math.max(...rows.map((row) => row.count), 1);
    for (const row of rows) {
      const item = documentRef.createElement('div');
      item.className = 'crime-list-chart__row';
      const heading = documentRef.createElement('div');
      const label = documentRef.createElement('span');
      label.textContent = row.label;
      const value = documentRef.createElement('strong');
      value.textContent = String(row.count);
      heading.append(label, value);
      const track = documentRef.createElement('div');
      track.className = 'crime-list-chart__track';
      const bar = documentRef.createElement('span');
      bar.className = 'crime-list-chart__bar';
      bar.style.inlineSize = `${Math.max(2, (row.count / max) * 100)}%`;
      track.appendChild(bar);
      item.append(heading, track);
      host.appendChild(item);
    }
  };

  const renderCharts = () => {
    const projected = summary();
    renderBars(categoryChart, sortCrimeListRows(projected.categories, 'count', 'categories')
      .slice(0, 6)
      .map((row) => ({ label: row.offenseLabel, count: row.count })));
    const byMonth = new Map();
    for (const feature of lastChartFeatures) {
      const month = String(feature?.properties?.dispatch_date_time || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) byMonth.set(month, (byMonth.get(month) || 0) + 1);
    }
    renderBars(monthChart, [...byMonth].sort(([left], [right]) => left.localeCompare(right))
      .map(([label, count]) => ({ label, count })), { emptyKey: 'crime.list.monthChartUnavailable' });
  };

  const renderCurrentIncidents = () => {
    body?.replaceChildren?.();
    for (const feature of sortCrimeListRows(lastFeatures, sortState.records, 'records')) {
      const incident = normalizeIncident(feature);
      const row = documentRef.createElement('tr');
      row.append(
        createCell(documentRef, 'th', incident.offense, 'row'),
        createCell(documentRef, 'td', incident.occurred),
        createCell(documentRef, 'td', incident.location),
        createCell(documentRef, 'td', incident.district),
      );
      body?.appendChild?.(row);
    }
    setTranslatedText(caption, 'crime.list.caption');
  };

  const syncFilters = (snapshot = readFilterState?.() || {}) => {
    for (const input of filterInputs) {
      const key = input.dataset?.crimeListFilter;
      if (key === 'group') input.value = snapshot.selectedGroups?.length === 1 ? snapshot.selectedGroups[0] : '';
      if (key === 'start') {
        input.value = snapshot.startMonth || '';
        input.min = snapshot.coverageMin?.slice?.(0, 7) || '';
        input.max = snapshot.coverageMax?.slice?.(0, 7) || '';
      }
      if (key === 'duration') input.value = String(snapshot.durationMonths || 12);
      if (key === 'radius') {
        input.value = String(snapshot.radiusM || snapshot.radius || 400);
        input.disabled = snapshot.queryMode !== 'buffer' || !snapshot.centerLonLat;
      }
    }
    const contextKey = snapshot.queryMode === 'district'
      ? 'crime.list.filterContextDistrict'
      : snapshot.queryMode === 'tract'
        ? 'crime.list.filterContextTract'
        : snapshot.centerLonLat
          ? 'crime.list.filterContextPoint'
          : 'crime.list.filterContextCity';
    setTranslatedText(filterContext, contextKey);
  };

  const applyLevel = (level) => {
    activeLevel = LIST_LEVELS.includes(level) ? level : 'overview';
    for (const input of levelInputs) input.checked = input.value === activeLevel;
    for (const panel of panels) {
      const visible = panel.dataset?.crimeListPanel === activeLevel;
      panel.hidden = !visible;
      panel.inert = !visible;
      panel.setAttribute?.('aria-hidden', String(!visible));
    }
    renderStatus();
  };

  const setSelectionAvailable = (available) => {
    selectionAvailable = Boolean(available);
    const recordsInput = levelInputs.find((input) => input.value === 'records');
    if (recordsInput) {
      recordsInput.disabled = !selectionAvailable;
      recordsInput.setAttribute?.('aria-disabled', String(!selectionAvailable));
    }
    setTranslatedText(recordsHint, selectionAvailable ? 'crime.list.recordsReady' : 'crime.list.recordsNeedArea');
    if (!selectionAvailable && activeLevel === 'records') applyLevel('overview');
    else renderStatus();
  };

  const levelHandlers = levelInputs.map((input) => {
    const handler = () => {
      if (input.checked && !input.disabled) applyLevel(input.value);
    };
    input.addEventListener?.('change', handler);
    return [input, handler];
  });

  const filterHandlers = filterInputs.map((input) => {
    const handler = () => {
      const key = input.dataset?.crimeListFilter;
      const patch = key === 'group'
        ? { groups: input.value ? [input.value] : [] }
        : key === 'start'
          ? { startMonth: input.value || null }
          : key === 'duration'
            ? { durationMonths: Number(input.value) }
            : { radius: Number(input.value) };
      void onQuickFilter?.(patch);
    };
    input.addEventListener?.('change', handler);
    return [input, handler];
  });

  const sortHandlers = sortInputs.map((input) => {
    const handler = () => {
      sortState[input.dataset.crimeListSort] = input.value;
      renderSummary();
      renderCurrentIncidents();
      renderCharts();
    };
    input.addEventListener?.('change', handler);
    return [input, handler];
  });

  const releaseLanguage = onLanguageChange(() => {
    renderSummary();
    renderCurrentIncidents();
    renderCharts();
    syncFilters();
    setTranslatedText(recordsHint, selectionAvailable ? 'crime.list.recordsReady' : 'crime.list.recordsNeedArea');
    renderStatus();
  });

  setSelectionAvailable(false);
  applyLevel(activeLevel);
  syncFilters();

  return Object.freeze({
    loading(scope) {
      const token = resultMeta[scope]?.loading?.() ?? null;
      tokens.set(scope, token);
      if (scope === 'overview') {
        overviewUnavailable = false;
        setTranslatedText(status, 'crime.list.loadingOverview');
      }
      if (scope === 'incidents') {
        incidentsUnavailable = false;
        setTranslatedText(status, 'crime.list.loading');
      }
      return token;
    },
    overview(payload) {
      overviewUnavailable = false;
      lastSummaryRows = Array.isArray(payload?.rows) ? payload.rows : [];
      renderSummary();
      renderCharts();
      renderStatus();
    },
    incidents(payload) {
      incidentsUnavailable = false;
      const admitted = Array.isArray(payload?.geo?.features) ? payload.geo.features : [];
      lastFeatures = admitted.slice(0, MAX_TABLE_ROWS);
      lastChartFeatures = admitted;
      lastTotal = Number.isInteger(Number(payload?.count)) && Number(payload.count) >= admitted.length
        ? Number(payload.count)
        : admitted.length;
      renderSummary();
      renderCurrentIncidents();
      renderCharts();
      renderStatus();
    },
    setSelectionAvailable,
    syncFilters,
    ready(scope, provenance, availability = 'current') {
      return resultMeta[scope]?.ready?.(provenance, {
        token: tokens.get(scope),
        availability,
      }) ?? true;
    },
    failed(scope, error) {
      if (scope === 'overview') overviewUnavailable = true;
      if (scope === 'incidents') incidentsUnavailable = true;
      renderStatus();
      return resultMeta[scope]?.failed?.(error, { token: tokens.get(scope) }) ?? false;
    },
    unavailable(scope) {
      resultMeta[scope]?.clear?.();
      if (scope === 'incidents') {
        incidentsUnavailable = true;
        lastFeatures = [];
        lastChartFeatures = [];
        lastTotal = 0;
        body?.replaceChildren?.();
      }
      renderStatus();
    },
    clear(scope) {
      resultMeta[scope]?.clear?.();
      if (scope === 'incidents') {
        incidentsUnavailable = false;
        lastFeatures = [];
        lastChartFeatures = [];
        lastTotal = 0;
        body?.replaceChildren?.();
      }
      renderStatus();
    },
    focusResults() {
      resolveCrimeListFocusTarget({ root, documentRef })?.focus?.({ preventScroll: true });
    },
    destroy() {
      for (const [input, handler] of levelHandlers) input.removeEventListener?.('change', handler);
      for (const [input, handler] of filterHandlers) input.removeEventListener?.('change', handler);
      for (const [input, handler] of sortHandlers) input.removeEventListener?.('change', handler);
      releaseLanguage?.();
    },
  });
}
