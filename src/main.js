import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { initializeTranslations } from './i18n/index.js';
import { setAnalysisMode, store, setViewMode, onViewModeChange } from './state/store.js';
import {
  initPanel,
  readModeFromURL,
  writeCrimeStateToURL,
} from './ui/panel.js';
import { initAboutPanel } from './ui/about.js';
import { initLanguageSwitch } from './ui/language_switch.js';
import { createModeSurfacePresenter, createModeUrlWriter } from './ui/mode_surfaces.js';
import { setSheetState } from './ui/sheet_controller.js';
import { createDiaryInsightsLoader } from './routes_diary/diary_insights_port.js';
import { createModeCoordinator } from './mode_coordinator.js';
import { createCrimeResultMetaPresenter } from './ui/crime_result_meta.js';
import {
  applyCrimeViewState,
  decodeCrimeViewState,
  encodeCrimeViewState,
  hasCrimeViewState,
  replaceCrimeViewState,
} from './state/crime_view_state.js';

const query = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search || '')
  : new URLSearchParams('');
const diaryFeatureEnabled = import.meta?.env?.VITE_FEATURE_DIARY === '1'
  || query.get('mode') === 'diary';
let coordinator = null;

const diaryInsightsLoader = createDiaryInsightsLoader({
  loadModule: () => import('./routes_diary/ui_insights_panel.js'),
  createRoot: () => {
    const root = document.createElement('div');
    root.id = 'diary-insights-root';
    const diaryShell = document.querySelector('[data-panel-view="diary"]');
    if (diaryShell) diaryShell.after(root);
    else document.body.appendChild(root);
    return root;
  },
  createHost: (module, root) => module.createDiaryInsightsHost(
    root,
    (expanded) => {
      if (!expanded) return;
      coordinator?.fitCurrentDiarySelection();
      const compactLayout = window.matchMedia(
        '(max-width: 720px), (max-width: 900px) and (orientation: landscape)',
      ).matches;
      if (!compactLayout) return;
      const sheet = document.getElementById('sidepanel');
      if (sheet) setSheetState(sheet, 'full');
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.requestAnimationFrame(() => root.scrollIntoView({
        block: 'start',
        inline: 'nearest',
        behavior: reducedMotion ? 'auto' : 'smooth',
      }));
    },
  ),
});

window.addEventListener('DOMContentLoaded', async () => {
  initializeTranslations({ documentRef: document, storage: window.localStorage, navigatorRef: window.navigator });
  initLanguageSwitch({ documentRef: document });
  const sharedParams = new URLSearchParams(window.location.search || '');
  if (hasCrimeViewState(sharedParams)) {
    applyCrimeViewState(store, decodeCrimeViewState(sharedParams), { setMode: setAnalysisMode });
  }
  const initialMode = setViewMode(readModeFromURL(), { silent: true });
  const { initMap } = await import('./map/initMap.js');
  const map = initMap({ mode: initialMode, center: store.centerLonLat || undefined });
  const chartsPane = document.getElementById('charts');
  const aboutController = initAboutPanel({ initialMode });
  const modeSurfaces = createModeSurfacePresenter({ documentRef: document, aboutController });
  const crimeResultMeta = Object.fromEntries(
    [...document.querySelectorAll('[data-result-meta]')].map((root) => {
      const scope = root.dataset.resultMeta;
      return [scope, createCrimeResultMetaPresenter({
        root,
        onRetry: () => coordinator?.retryCrimeResult(scope),
      })];
    }),
  );
  const writeMode = createModeUrlWriter({
    getHref: () => window.location.href,
    replaceHref: (href) => window.history.replaceState({}, '', href),
    getCrimeQuery: () => encodeCrimeViewState(store),
  });
  writeMode(initialMode);

  let analysisHistoryController = null;
  let analysisHistoryPromise = null;
  const refreshCrime = async (clearArtifact = true) => {
    if (clearArtifact) analysisHistoryController?.setCurrentArtifact(null);
    const result = await coordinator?.requestCrimeRefresh();
    if (result?.status === 'live') await analysisHistoryController?.refreshFreshness({ live: true });
    return result;
  };
  const panel = initPanel(store, {
    onChange: refreshCrime,
    onRadiusInput: () => coordinator?.updateCrimeBuffer(),
    getMapCenter: () => map.getCenter(),
    onAddressResolved: async () => coordinator.fitCurrentCrimeSelection({ force: true }),
    onTractsOverlayToggle: (visible) => coordinator?.setTractsOverlayVisible(visible),
  });
  const { diaryMount, analysisHistoryMount } = panel;

  coordinator = createModeCoordinator({
    map,
    diaryFeatureEnabled,
    getCurrentMode: () => store.viewMode,
    writeMode,
    onModeIntent: modeSurfaces.showIntent,
    onModeSettled: modeSurfaces.settle,
    onShortStatusChange: modeSurfaces.showStatus,
    onDataScopeChange: modeSurfaces.showDataScope,
    chartsPane,
    diaryMount,
    loadCrimeController: () => import('./routes_crime/index.js')
      .then((module) => module.initCrimeMode(map, {
        isActive: () => store.viewMode === 'crime',
        onCoverageChange: () => {
          if (store.viewMode === 'crime') panel.syncFromStore?.();
        },
        onPointChange: () => {
          if (store.viewMode === 'crime') panel.syncFromStore?.();
        },
        onSelectionChange: (_key, { origin } = {}) => {
          if (origin !== 'map') return;
          panel.syncFromStore?.();
          analysisHistoryController?.setCurrentArtifact(null);
        },
        onDataScopeChange: modeSurfaces.showDataScope,
        resultMeta: crimeResultMeta,
        taskFocus: panel.taskFocus,
        presetPorts: {
          state: store,
          normalize: (state) => decodeCrimeViewState(encodeCrimeViewState(state)),
          replace: (next) => replaceCrimeViewState(store, next, { setMode: setAnalysisMode }),
          sync: () => panel.syncPreset?.(),
          url: () => writeCrimeStateToURL(store),
          clear: () => analysisHistoryController?.setCurrentArtifact(null),
          refresh: () => refreshCrime(false),
        },
      })),
    loadDiaryModule: () => import('./routes_diary/index.js'),
    getDiaryInsights: (owner) => diaryInsightsLoader.getHost(owner),
  });

  const ensureAnalysisHistory = () => {
    if (!analysisHistoryMount || store.viewMode !== 'crime' || coordinator.getActiveMode() !== 'crime') return null;
    if (!analysisHistoryPromise) {
      analysisHistoryPromise = import('./i18n/history.js')
        .then(() => import('./analysis/analysis_history_controller.js'))
        .then((module) => module.initAnalysisHistory({
          mount: analysisHistoryMount,
          store,
          syncControls: () => panel.syncFromStore?.(),
          syncCanonicalUrl: () => writeCrimeStateToURL(store),
          focusAnalysis: () => coordinator.fitCurrentCrimeSelection({ force: true }),
          scheduleCrime: () => coordinator.schedule('crime'),
          cancelCrimeTransition: () => coordinator.cancelCurrentTransition(),
          getCurrentCrimeProvenance: () => coordinator.getCurrentCrimeProvenance(),
        }))
        .then((controller) => {
          analysisHistoryController = controller;
          panel.setAnalysisHistorySync?.(() => controller?.sync());
          return controller;
        })
        .catch((error) => {
          analysisHistoryPromise = null;
          console.warn('Analysis history is unavailable:', error);
          return null;
        });
    }
    return analysisHistoryPromise;
  };

  const scheduleMode = async (mode, { explicit = false } = {}) => {
    if (explicit) analysisHistoryController?.cancelPendingRestore();
    const result = await coordinator.schedule(mode);
    if (store.viewMode === 'crime' && coordinator.getActiveMode() === 'crime') {
      void ensureAnalysisHistory();
      if (result?.status === 'live') await analysisHistoryController?.refreshFreshness({ live: true });
    }
    return result;
  };

  onViewModeChange((mode) => void scheduleMode(mode, { explicit: true }));
  await scheduleMode(store.viewMode);
});
