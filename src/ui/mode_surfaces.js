import { CRIME_VIEW_QUERY_KEYS } from '../state/crime_view_state.js';
import { applyTranslations, setTranslatedText, t } from '../i18n/index.js';

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
    const status = documentRef?.querySelector?.('[data-app-data-status]');
    if (!status || snapshot.mode !== currentMode) return;
    status.dataset.phase = snapshot.phase;
    const prefix = snapshot.mode === 'diary' ? 'diary' : 'crime';
    const suffix = snapshot.phase === 'loading' ? 'Loading' : snapshot.phase === 'ready' ? 'Ready' : 'Unavailable';
    setTranslatedText(status, `mode.status.${prefix}${suffix}`);
  };

  return Object.freeze({ showIntent, settle, showStatus });
}
