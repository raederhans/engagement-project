import { CRIME_VIEW_QUERY_KEYS } from '../state/crime_view_state.js';

const MODE_HELP = Object.freeze({
  crime: [
    'Pick a location or geography, then choose a verified time window.',
    'Offense groups and drilldown codes control which crime incidents are included.',
    'Open data details for source dates, limitations, and fallback status.',
  ],
  diary: [
    'Choose a route, simulate or finish a trip, then add a short safety rating.',
    'Diary entries are saved only in this browser unless you export a backup.',
    'Sample community results are demo data and are not shared submissions.',
  ],
});

export function getModeHelpItems(mode) {
  return [...MODE_HELP[mode === 'diary' ? 'diary' : 'crime']];
}
export function createModeUrlWriter({ getHref, replaceHref, getCrimeQuery }) {
  let crimeQuery = new URLSearchParams(getCrimeQuery?.() || '');

  return (mode) => {
    const normalized = mode === 'diary' ? 'diary' : 'crime';
    const url = new URL(getHref());
    if (normalized === 'diary') {
      crimeQuery = new URLSearchParams(getCrimeQuery?.() || crimeQuery);
    }
    for (const key of CRIME_VIEW_QUERY_KEYS) url.searchParams.delete(key);
    if (normalized === 'crime') {
      for (const [key, value] of crimeQuery) {
        if (CRIME_VIEW_QUERY_KEYS.has(key)) url.searchParams.set(key, value);
      }
    }
    url.searchParams.set('mode', normalized);
    replaceHref(url.href);
  };
}

function replaceHelp(helpCard, mode) {
  if (!helpCard) return;
  const normalized = mode === 'diary' ? 'diary' : 'crime';
  const title = normalized === 'diary' ? 'Diary Help' : 'Crime Help';
  const items = MODE_HELP[normalized].map((item) => `<li>${item}</li>`).join('');
  helpCard.innerHTML = `<summary>${title}</summary><ul>${items}</ul>`;
}
function removeSkeletons(documentRef) {
  for (const skeleton of documentRef.querySelectorAll?.('[data-mode-skeleton]') || []) {
    skeleton.remove();
  }
}

export function createModeSurfacePresenter({
  documentRef = globalThis.document,
  aboutController = null,
} = {}) {
  let currentMode = null;
  let currentStatus = null;
  const scopes = new Map();

  const renderStatus = () => {
    const status = documentRef?.querySelector?.('[data-app-data-status]');
    if (!status || !currentStatus || currentStatus.mode !== currentMode) return;
    const scope = scopes.get(currentMode);
    const showScope = currentStatus.phase === 'ready' && scope;
    status.dataset.phase = currentStatus.phase;
    status.textContent = showScope ? scope.shortLabel : currentStatus.label;
    if (showScope) {
      status.dataset.scopeKind = scope.kind;
      status.setAttribute('aria-label', scope.accessibleLabel);
      status.setAttribute('title', scope.accessibleLabel);
    } else {
      delete status.dataset.scopeKind;
      status.removeAttribute?.('aria-label');
      status.removeAttribute?.('title');
    }

    const details = documentRef?.querySelector?.('[data-app-source-details]');
    if (!details) return;
    if (showScope && scope.details?.length) {
      details.dataset.scopeKind = scope.kind;
      details.textContent = scope.details.join(' · ');
    } else {
      delete details.dataset.scopeKind;
      details.textContent = currentStatus.phase === 'failed' ? currentStatus.label : '';
    }
  };

  const showIntent = (mode) => {
    currentMode = mode === 'diary' ? 'diary' : 'crime';
    removeSkeletons(documentRef);
    const surface = documentRef?.querySelector?.(`[data-panel-view="${currentMode}"]`);
    if (surface) {
      surface.dataset.modeState = 'loading';
      surface.setAttribute('aria-busy', 'true');
      const skeleton = documentRef.createElement('div');
      skeleton.dataset.modeSkeleton = currentMode;
      skeleton.setAttribute('role', 'status');
      skeleton.setAttribute('aria-live', 'polite');
      skeleton.className = 'mode-skeleton';
      const title = currentMode === 'diary' ? 'Preparing Route Safety Diary' : 'Preparing Crime Explorer';
      skeleton.innerHTML = `
        <strong>${title}</strong>
        <span>Loading controls and data…</span>
      `;
      surface.insertBefore(skeleton, surface.firstChild || null);
    }
    replaceHelp(documentRef?.getElementById?.('help-card'), currentMode);
    aboutController?.setMode?.(currentMode);
  };

  const settle = (mode, phase) => {
    if (mode !== currentMode) return false;
    const surface = documentRef?.querySelector?.(`[data-panel-view="${mode}"]`);
    if (surface) {
      surface.dataset.modeState = phase;
      surface.setAttribute('aria-busy', 'false');
    }
    removeSkeletons(documentRef);
    return true;
  };

  const showStatus = (snapshot) => {
    currentStatus = snapshot;
    renderStatus();
  };

  const showDataScope = (scope) => {
    if (!scope?.mode) return;
    scopes.set(scope.mode, scope);
    renderStatus();
  };

  return Object.freeze({ showIntent, settle, showStatus, showDataScope });
}
