import './style.css';
import { initializeTranslations, setTranslatedText } from './i18n/index.js';
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
import { createSourceHealthLoader } from './source_health/source_health_loader.js';
import { createDiaryInsightsLoader } from './routes_diary/diary_insights_port.js';
import { createModeCoordinator } from './mode_coordinator.js';
import { createCrimeResultMetaPresenter } from './ui/crime_result_meta.js';
import {
  createCrimeViewModeController,
  readCrimeViewMode,
} from './ui/crime_view_mode.js';
import {
  createOptionalMapRuntime,
  loadOptionalMapRuntime,
} from './map/optional_map_runtime.js';
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
  initializeTranslations({
    documentRef: document,
    storage: window.localStorage,
    navigatorRef: window.navigator,
  });
  initLanguageSwitch({ documentRef: document });
  const sharedParams = new URLSearchParams(window.location.search || '');
  if (hasCrimeViewState(sharedParams)) {
    applyCrimeViewState(store, decodeCrimeViewState(sharedParams), { setMode: setAnalysisMode });
  }
  const initialMode = setViewMode(readModeFromURL(), { silent: true });
  const chartsPane = document.getElementById('charts');
  const mapElement = document.getElementById('map');
  const mapStatus = document.querySelector('[data-map-runtime-status]');
  const viewModeRoot = document.querySelector('[data-crime-view-mode]');
  const aboutController = initAboutPanel({ initialMode });
  const modeSurfaces = createModeSurfacePresenter({ documentRef: document, aboutController });
  const sourceHealthLoader = createSourceHealthLoader({
    mount: document.querySelector('[data-source-health-entry]'),
    loadUi: () => import('./source_health/source_health_controller.js'),
    getRuntimeEvidence: () => ({
      crimeCoverage: {
        status: store.coverageStatus,
        min: store.coverageMin,
        max: store.coverageMax,
      },
    }),
  });
  let listController = null;
  let listControllerPromise = null;
  let mapCrimeController = null;
  let presentationController = null;
  let presentationGeneration = 0;
  let panel = null;
  let analysisHistoryController = null;
  let analysisHistoryPromise = null;
  let routeCorridorLoader = null;
  let routeCorridorLoaderPromise = null;

  const crimeResultMeta = Object.fromEntries(
    [...document.querySelectorAll('[data-result-meta]')].map((root) => {
      const scope = root.dataset.resultMeta;
      return [scope, createCrimeResultMetaPresenter({
        root,
        onRetry: () => (
          presentationController?.getMode() === 'list'
            ? ensureListController().then((owner) => owner.requestRefresh({ scope }))
            : coordinator?.retryCrimeResult(scope)
        ),
      })];
    }),
  );
  const writeMode = createModeUrlWriter({
    getHref: () => window.location.href,
    replaceHref: (href) => window.history.replaceState({}, '', href),
    getCrimeQuery: () => encodeCrimeViewState(store),
  });
  writeMode(initialMode);

  const mapRuntime = createOptionalMapRuntime({
    loadMap: () => loadOptionalMapRuntime({
      mode: store.viewMode,
      center: store.centerLonLat || undefined,
    }),
    onStatusChange(snapshot) {
      if (!mapStatus) return;
      mapStatus.dataset.phase = snapshot.phase;
      const key = snapshot.phase === 'loading'
        ? 'crime.viewMode.mapLoading'
        : snapshot.phase === 'ready'
          ? 'crime.viewMode.mapReady'
          : snapshot.phase === 'failed' ? 'crime.viewMode.mapFailed' : null;
      if (key) setTranslatedText(mapStatus, key);
    },
  });

  const refreshCrime = async (clearArtifact = true) => {
    if (store.viewMode !== 'crime') return { status: 'superseded' };
    routeCorridorLoader?.syncCanonical();
    if (clearArtifact) analysisHistoryController?.setCurrentArtifact(null);
    const result = presentationController?.getMode() === 'list'
      ? await requestListRefresh()
      : await ensureMapCoordinator().then((owner) => owner.requestCrimeRefresh());
    if (result?.status === 'live') await analysisHistoryController?.refreshFreshness({ live: true });
    return result;
  };

  panel = initPanel(store, {
    onChange: refreshCrime,
    onRadiusInput: () => {
      if (presentationController?.getMode() === 'map') coordinator?.updateCrimeBuffer();
    },
    getMapCenter: () => mapRuntime.getMap()?.getCenter?.() || null,
    onAddressResolved: async () => {
      if (presentationController?.getMode() === 'list') return true;
      await ensureMapCoordinator();
      return coordinator.fitCurrentCrimeSelection({ force: true });
    },
    onTractsOverlayToggle: (visible) => {
      if (presentationController?.getMode() === 'map') coordinator?.setTractsOverlayVisible(visible);
    },
  });
  const { diaryMount, analysisHistoryMount } = panel;
  const routeCorridorMount = panel.taskFocus?.routeCorridorMount;
  const routeOpen = routeCorridorMount?.querySelector?.('[data-route-corridor-open]');
  const routeRetry = routeCorridorMount?.querySelector?.('[data-route-corridor-retry]');
  const routeLoaderStatus = routeCorridorMount?.querySelector?.('[data-route-corridor-loader-status]');

  const readRouteCorridorSnapshot = () => {
    try {
      const filters = store.getFilters();
      return {
        start: filters.start,
        end: filters.end,
        types: [...(filters.types || [])],
        drilldownCodes: [...(filters.drilldownCodes || [])],
      };
    } catch {
      return { start: null, end: null, types: [], drilldownCodes: [] };
    }
  };

  const ensureRouteCorridorLoader = async () => {
    if (routeCorridorLoader) return routeCorridorLoader;
    if (!routeCorridorLoaderPromise) {
      if (routeLoaderStatus) {
        routeLoaderStatus.hidden = false;
        routeLoaderStatus.textContent = 'Loading route review…';
      }
      if (routeRetry) routeRetry.hidden = true;
      routeCorridorLoaderPromise = import('./routes_crime/route_corridor_app_loader.js')
        .then((module) => module.createRouteCorridorAppLoader({
          mount: routeCorridorMount,
          readCanonicalSnapshot: readRouteCorridorSnapshot,
          getMap: () => mapRuntime.getMap(),
        }))
        .then((owner) => {
          routeCorridorLoader = owner;
          routeCorridorLoader.setActive(store.viewMode === 'crime');
          routeOpen?.removeEventListener('click', onRouteIntent);
          routeRetry?.removeEventListener('click', onRouteIntent);
          return owner;
        })
        .catch((error) => {
          routeCorridorLoaderPromise = null;
          if (routeLoaderStatus) {
            routeLoaderStatus.hidden = false;
            routeLoaderStatus.textContent = 'Route review could not load. Retry when ready.';
          }
          if (routeRetry) routeRetry.hidden = false;
          console.warn('Route corridor loader is unavailable:', error);
          return null;
        });
    }
    return routeCorridorLoaderPromise;
  };
  const onRouteIntent = () => {
    void ensureRouteCorridorLoader().then((owner) => owner?.open());
  };
  routeOpen?.addEventListener('click', onRouteIntent);
  routeRetry?.addEventListener('click', onRouteIntent);

  async function ensureListController() {
    if (listController) return listController;
    if (!listControllerPromise) {
      listControllerPromise = import('./routes_crime/list_mode_controller.js')
        .then((module) => module.createCrimeListController({
          resultMeta: crimeResultMeta,
          onCoverageChange: () => {
            panel.syncFromStore?.();
            sourceHealthLoader.refresh();
          },
          onDataScopeChange: modeSurfaces.showDataScope,
        }))
        .then((owner) => {
          listController = owner;
          return owner;
        })
        .catch((error) => {
          listControllerPromise = null;
          throw error;
        });
    }
    return listControllerPromise;
  }

  async function requestListRefresh(options = {}) {
    const ownsList = () => store.viewMode === 'crime'
      && presentationController?.getMode() === 'list';
    if (!ownsList()) return { status: 'superseded' };
    modeSurfaces.showIntent('crime');
    modeSurfaces.showStatus({ mode: 'crime', phase: 'loading', label: 'Crime list' });
    const result = await ensureListController().then((owner) => owner.requestRefresh(options));
    if (!ownsList()) return { status: 'superseded' };
    const phase = ['live', 'partial', 'idle'].includes(result?.status) ? 'ready' : 'failed';
    modeSurfaces.showStatus({ mode: 'crime', phase, label: 'Crime list' });
    modeSurfaces.settle('crime', phase);
    return result;
  }

  async function ensureMapCoordinator() {
    if (coordinator) return coordinator;
    const map = await mapRuntime.ensureMap();
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
          isActive: () => store.viewMode === 'crime'
            && presentationController?.getMode() === 'map',
          onCoverageChange: () => {
            if (store.viewMode === 'crime') panel.syncFromStore?.();
            sourceHealthLoader.refresh();
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
        })).then((controller) => {
          mapCrimeController = controller;
          return controller;
        }),
      loadDiaryModule: () => import('./routes_diary/index.js'),
      getDiaryInsights: (owner) => diaryInsightsLoader.getHost(owner),
    });
    return coordinator;
  }

  const ensureAnalysisHistory = () => {
    if (!analysisHistoryMount || store.viewMode !== 'crime') return null;
    if (!analysisHistoryPromise) {
      analysisHistoryPromise = import('./i18n/history.js')
        .then(() => import('./analysis/analysis_history_controller.js'))
        .then((module) => module.initAnalysisHistory({
          mount: analysisHistoryMount,
          store,
          syncControls: () => panel.syncFromStore?.(),
          syncCanonicalUrl: () => writeCrimeStateToURL(store),
          focusAnalysis: () => (
            presentationController.getMode() === 'list'
              ? document.getElementById('crime-list-results-title')?.focus?.()
              : coordinator?.fitCurrentCrimeSelection({ force: true })
          ),
          scheduleCrime: () => scheduleProductMode('crime'),
          cancelCrimeTransition: () => coordinator?.cancelCurrentTransition(),
          getCurrentCrimeProvenance: () => (
            presentationController.getMode() === 'list'
              ? listController?.getCurrentProvenance() || {}
              : coordinator?.getCurrentCrimeProvenance() || {}
          ),
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

  async function scheduleProductMode(mode, { explicit = false } = {}) {
    if (explicit) analysisHistoryController?.cancelPendingRestore();
    if (mode === 'crime' && presentationController.getMode() === 'list') {
      const result = await requestListRefresh();
      void ensureAnalysisHistory();
      return result;
    }
    const owner = await ensureMapCoordinator();
    const result = await owner.schedule(mode);
    if (store.viewMode === 'crime' && owner.getActiveMode() === 'crime') {
      void ensureAnalysisHistory();
      if (result?.status === 'live') await analysisHistoryController?.refreshFreshness({ live: true });
    }
    return result;
  }

  async function applyPresentation(mode, { origin = 'initial' } = {}) {
    const generation = ++presentationGeneration;
    const ownsPresentation = () => generation === presentationGeneration;
    const normalized = mode === 'list' && store.viewMode === 'crime' ? 'list' : 'map';
    routeCorridorLoader?.setActive(store.viewMode === 'crime');
    document.documentElement.dataset.crimeView = normalized;
    document.body.dataset.crimeView = normalized;
    mapElement?.setAttribute('aria-hidden', String(normalized === 'list'));
    if (mapElement) mapElement.inert = normalized === 'list';
    panel.setCrimePresentationMode?.(normalized);
    const listResults = document.querySelector('[data-crime-list-results]');
    if (listResults) listResults.hidden = normalized !== 'list';
    for (const input of viewModeRoot?.querySelectorAll?.('input[name="crime-view-mode"]') || []) {
      input.checked = input.value === normalized;
    }
    if (viewModeRoot) viewModeRoot.hidden = store.viewMode !== 'crime';

    if (normalized === 'list') {
      coordinator?.cancelCurrentTransition?.('Crime list view selected');
      mapCrimeController?.setActive?.(false);
      const listOwner = await ensureListController();
      if (!ownsPresentation() || presentationController.getMode() !== 'list') {
        listOwner.setActive(false);
        return;
      }
      listOwner.setActive(true);
      if (mapStatus) {
        mapStatus.dataset.phase = origin === 'fallback' ? 'failed' : 'ready';
        setTranslatedText(
          mapStatus,
          origin === 'fallback' ? 'crime.viewMode.mapFailed' : 'crime.viewMode.listReady',
        );
      }
      await listOwner.initialize();
      if (!ownsPresentation() || presentationController.getMode() !== 'list') return;
      panel.syncFromStore?.();
      if (store.viewMode === 'crime') await scheduleProductMode('crime');
      return;
    }

    listController?.setActive(false);
    try {
      const owner = await ensureMapCoordinator();
      if (!ownsPresentation() || presentationController.getMode() !== 'map') return;
      mapRuntime.getMap()?.resize?.();
      const result = await owner.schedule(store.viewMode);
      if (!ownsPresentation() || store.viewMode !== 'crime' || owner.getActiveMode() !== 'crime') return;
      void ensureAnalysisHistory();
      if (result?.status === 'live') await analysisHistoryController?.refreshFreshness({ live: true });
    } catch (error) {
      if (!ownsPresentation()) return;
      console.warn('Map runtime is unavailable:', error);
      presentationController.setMode('list', { origin: 'fallback' });
    }
  }

  presentationController = createCrimeViewModeController({
    getHref: () => window.location.href,
    replaceHref: (href) => window.history.replaceState({}, '', href),
    addEventListener: (...args) => window.addEventListener(...args),
    removeEventListener: (...args) => window.removeEventListener(...args),
    onChange: (mode, meta) => void applyPresentation(mode, meta),
  });
  viewModeRoot?.addEventListener('change', (event) => {
    if (event.target?.name === 'crime-view-mode') {
      presentationController.setMode(event.target.value);
    }
  });
  onViewModeChange((mode) => {
    analysisHistoryController?.cancelPendingRestore();
    if (mode === 'diary' && presentationController.getMode() === 'list') {
      presentationController.setMode('map', { origin: 'product-mode' });
      return;
    }
    void applyPresentation(presentationController.getMode(), { origin: 'product-mode' });
  });

  const initialPresentation = readCrimeViewMode(window.location.href);
  presentationController.setMode(initialPresentation, { origin: 'initial' });
  await applyPresentation(initialPresentation, { origin: 'initial' });
});
