import { onLanguageChange, setTranslatedText, t } from '../i18n/index.js';
import { localizeOffenseCode } from '../i18n/crime_offenses.js';
import { formatCrimeIncidentDate } from '../i18n/date.js';

const MAX_TABLE_ROWS = 200;

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
  const incidentPane = root?.closest?.('[data-result-pane]');
  if (incidentPane && !incidentPane.hidden && !incidentPane.inert) {
    return documentRef?.getElementById?.('crime-list-results-title') || incidentPane;
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
  let incidentsUnavailable = false;

  const renderIncidents = (features) => {
    incidentsUnavailable = false;
    lastFeatures = Array.isArray(features) ? features.slice(0, MAX_TABLE_ROWS) : [];
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
    setTranslatedText(status, lastFeatures.length ? 'crime.list.count' : 'crime.list.empty', {
      count: lastFeatures.length,
    });
  };

  const releaseLanguage = onLanguageChange(() => {
    setTranslatedText(caption, 'crime.list.caption');
    if (incidentsUnavailable) {
      setTranslatedText(status, 'resultMeta.unavailable');
      return;
    }
    setTranslatedText(status, lastFeatures.length ? 'crime.list.count' : 'crime.list.empty', {
      count: lastFeatures.length,
    });
    renderIncidents(lastFeatures);
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
      renderIncidents(payload?.geo?.features || []);
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
        body?.replaceChildren?.();
        setTranslatedText(status, 'resultMeta.unavailable');
      }
    },
    clear(scope) {
      resultMeta[scope]?.clear?.();
      if (scope === 'incidents') renderIncidents([]);
    },
    focusResults() {
      resolveCrimeListFocusTarget({ root, documentRef })?.focus?.({ preventScroll: true });
    },
    destroy() {
      releaseLanguage?.();
    },
  });
}
