import './style.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { initializeTranslations } from './i18n/index.js';
import { initMap } from './map/initMap.js';
import { setAnalysisMode, store, setViewMode, onViewModeChange } from './state/store.js';
import {
  initPanel,
  readModeFromURL,
  writeCrimeStateToURL,
} from './ui/panel.js';
import { initAboutPanel } from './ui/about.js';
import { initLanguageSwitch } from './ui/language_switch.js';
import { createModeSurfacePresenter, createModeUrlWriter } from './ui/mode_surfaces.js';
import { createDiaryInsightsLoader } from './routes_diary/diary_insights_port.js';
import { createModeCoordinator } from './mode_coordinator.js';
import {
  applyCrimeViewState,
  decodeCrimeViewState,
  encodeCrimeViewState,
  hasCrimeViewState,
} from './state/crime_view_state.js';

const query = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search || '')
  : new URLSearchParams('');
const diaryFeatureEnabled = import.meta?.env?.VITE_FEATURE_DIARY === '1'
  || query.get('mode') === 'diary';

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
  createHost: (module, root) => module.createDiaryInsightsHost(root),
});

window.addEventListener('DOMContentLoaded', async () => {
  initializeTranslations({ documentRef: document, storage: window.localStorage, navigatorRef: window.navigator });
  initLanguageSwitch({ documentRef: document });
  const sharedParams = new URLSearchParams(window.location.search || '');
  if (hasCrimeViewState(sharedParams)) {
    applyCrimeViewState(store, decodeCrimeViewState(sharedParams), { setMode: setAnalysisMode });
  }
  const initialMode = setViewMode(readModeFromURL(), { silent: true });
  const map = initMap({ mode: initialMode, center: store.centerLonLat || undefined });
  const chartsPane = document.getElementById('charts');
  const aboutController = initAboutPanel({ initialMode });
  const modeSurfaces = createModeSurfacePresenter({ documentRef: document, aboutController });
  const writeMode = createModeUrlWriter({
    getHref: () => window.location.href,
    replaceHref: (href) => window.history.replaceState({}, '', href),
    getCrimeQuery: () => encodeCrimeViewState(store),
  });
  writeMode(initialMode);

  let coordinator = null;
  let analysisHistoryController = null;
  let analysisHistoryPromise = null;
  const refreshCrime = async () => {
    const result = await coordinator?.requestCrimeRefresh();
    if (result?.status === 'live') await analysisHistoryController?.refreshFreshness({ live: true });
    return result;
  };
  const panel = initPanel(store, {
    onChange: refreshCrime,
    onRadiusInput: () => coordinator?.updateCrimeBuffer(),
    getMapCenter: () => map.getCenter(),
    onAddressResolved: async (_target, result) => {
      return coordinator.runCrimeMapMove(() => {
        map.flyTo({ center: result.lngLat, zoom: Math.max(map.getZoom(), 13) });
      });
    },
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
