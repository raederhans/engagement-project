import { onLanguageChange, setTranslatedText, t } from '../i18n/index.js';
import { localizeOffenseCode } from '../i18n/crime_offenses.js';
import { formatCrimeIncidentDate } from '../i18n/date.js';

const MAX_TABLE_ROWS = 200;

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
  showIntent?.('crime');
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
    offense: localizeOffenseCode(properties.text_general_code) || t('summary.metricUnavailable'),
    occurred: formatCrimeIncidentDate(properties.dispatch_date_time) || t('summary.metricUnavailable'),
    location: String(properties.location_block || t('summary.metricUnavailable')),
    district: String(properties.dc_dist || t('summary.metricUnavailable')),
  };
}

function createCell(documentRef, tagName, text, scope) {
  const cell = documentRef.createElement(tagName);
  if (scope) cell.scope = scope;
  cell.textContent = text;
  return cell;
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
} = {}) {
  if (!root || !documentRef?.createElement) return null;
  const status = root.querySelector('[data-crime-list-status]');
  const body = root.querySelector('[data-crime-list-body]');
  const caption = root.querySelector('[data-crime-list-caption]');
  const tokens = new Map();
  let lastFeatures = [];
  let lastTotal = 0;
  let incidentsUnavailable = false;

  const renderCurrentIncidents = () => {
    body?.replaceChildren?.();
    for (const feature of lastFeatures) {
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
    const count = describeCrimeListCount(lastTotal, lastFeatures.length);
    setTranslatedText(status, count.key, count.params);
  };

  const renderIncidents = (features, total) => {
    incidentsUnavailable = false;
    const admitted = Array.isArray(features) ? features : [];
    lastFeatures = admitted.slice(0, MAX_TABLE_ROWS);
    const reportedTotal = Number.isInteger(Number(total)) && Number(total) >= admitted.length
      ? Number(total)
      : admitted.length;
    lastTotal = reportedTotal;
    renderCurrentIncidents();
  };

  const releaseLanguage = onLanguageChange(() => {
    setTranslatedText(caption, 'crime.list.caption');
    if (incidentsUnavailable) {
      setTranslatedText(status, 'resultMeta.unavailable');
      return;
    }
    renderCurrentIncidents();
  });

  return Object.freeze({
    loading(scope) {
      const token = resultMeta[scope]?.loading?.() ?? null;
      tokens.set(scope, token);
      if (scope === 'incidents') {
        incidentsUnavailable = false;
        setTranslatedText(status, 'crime.list.loading');
      }
      return token;
    },
    incidents(payload) {
      renderIncidents(payload?.geo?.features || [], payload?.count);
    },
    ready(scope, provenance, availability = 'current') {
      return resultMeta[scope]?.ready?.(provenance, {
        token: tokens.get(scope),
        availability,
      }) ?? true;
    },
    failed(scope, error) {
      if (scope === 'incidents') {
        incidentsUnavailable = false;
        setTranslatedText(status, 'crime.list.failed');
      }
      return resultMeta[scope]?.failed?.(error, { token: tokens.get(scope) }) ?? false;
    },
    unavailable(scope) {
      resultMeta[scope]?.clear?.();
      if (scope === 'incidents') {
        incidentsUnavailable = true;
        lastFeatures = [];
        lastTotal = 0;
        body?.replaceChildren?.();
        setTranslatedText(status, 'resultMeta.unavailable');
      }
    },
    clear(scope) {
      resultMeta[scope]?.clear?.();
      if (scope === 'incidents') renderIncidents([], 0);
    },
    focusResults() {
      resolveCrimeListFocusTarget({ root, documentRef })?.focus?.({ preventScroll: true });
    },
    destroy() {
      releaseLanguage?.();
    },
  });
}
