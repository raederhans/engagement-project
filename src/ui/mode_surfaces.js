import { CRIME_VIEW_QUERY_KEYS } from '../state/crime_view_state.js';
import { applyTranslations, onLanguageChange, t } from '../i18n/index.js';

const MODE_HELP = Object.freeze({
  crime: [
    'help.crimeItem1',
    'help.crimeItem2',
    'help.crimeItem3',
  ],
  diary: [
    'help.diaryItem1',
    'help.diaryItem2',
    'help.diaryItem3',
  ],
});

export function getModeHelpItems(mode) {
  return MODE_HELP[mode === 'diary' ? 'diary' : 'crime'].map((key) => t(key));
}

export function createModeUrlWriter({ getHref, replaceHref, getCrimeQuery }) {
  let crimeQuery = new URLSearchParams(getCrimeQuery?.() || '');

  return (mode) => {
    const normalized = mode === 'diary' ? 'diary' : 'crime';
    const url = new URL(getHref());
    crimeQuery = new URLSearchParams(getCrimeQuery?.() || crimeQuery);
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
  const prefix = mode === 'diary' ? 'diary' : 'crime';
  const titleKey = `help.${prefix}TitleShort`;
  const items = MODE_HELP[prefix].map((key) => `<li data-i18n="${key}">${t(key)}</li>`).join('');
  helpCard.innerHTML = `<summary data-i18n="${titleKey}">${t(titleKey)}</summary><ul>${items}</ul>`;
  applyTranslations(helpCard);
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
    const storedScope = scopes.get(currentMode);
    const scope = storedScope?.resolve?.() || storedScope;
    const showScope = currentStatus.phase === 'ready' && scope;
    status.dataset.phase = currentStatus.phase;
    const prefix = currentStatus.mode === 'diary' ? 'diary' : 'crime';
    const suffix = currentStatus.phase === 'loading' ? 'Loading' : currentStatus.phase === 'ready' ? 'Ready' : 'Unavailable';
    const statusLabel = t(`mode.status.${prefix}${suffix}`);
    status.textContent = showScope ? scope.shortLabel : statusLabel;
    if (showScope) {
      status.dataset.scopeKind = scope.kind;
      status.setAttribute('aria-label', scope.accessibleLabel);
      status.setAttribute('title', scope.accessibleLabel);
    } else {
      delete status.dataset.scopeKind;
      status.removeAttribute?.('aria-label');
      status.removeAttribute?.('title');
    }

    const detailSurfaces = [...(documentRef?.querySelectorAll?.('[data-app-source-details]') || [])];
    if (!detailSurfaces.length) {
      const detailSurface = documentRef?.querySelector?.('[data-app-source-details]');
      if (detailSurface) detailSurfaces.push(detailSurface);
    }
    for (const details of detailSurfaces) {
      if (showScope && scope.details?.length) {
        details.dataset.scopeKind = scope.kind;
        details.textContent = scope.details.join(' · ');
      } else {
        delete details.dataset.scopeKind;
        details.textContent = currentStatus.phase === 'failed' ? statusLabel : '';
      }
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
      const titleKey = currentMode === 'diary' ? 'mode.preparingDiary' : 'mode.preparingCrime';
      skeleton.innerHTML = `
        <strong data-i18n="${titleKey}">${t(titleKey)}</strong>
        <span data-i18n="mode.loadingControls">${t('mode.loadingControls')}</span>
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

  onLanguageChange(renderStatus);

  return Object.freeze({ showIntent, settle, showStatus, showDataScope });
}
