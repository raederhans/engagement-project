import './style.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { initMap } from './map/initMap.js';
import { setAnalysisMode, store, setViewMode, onViewModeChange } from './state/store.js';
import { initPanel, readModeFromURL, writeModeToURL } from './ui/panel.js';
import { initAboutPanel } from './ui/about.js';
import { createDiaryInsightsLoader } from './routes_diary/diary_insights_port.js';
import { createModeCoordinator } from './mode_coordinator.js';
import { applyCrimeViewState, decodeCrimeViewState, hasCrimeViewState } from './state/crime_view_state.js';

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
    if (diaryShell) diaryShell?.after(root);
    else document.body.appendChild(root);
    return root;
  },
  createHost: (module, root) => module.createDiaryInsightsHost(root),
});

window.addEventListener('DOMContentLoaded', async () => {
  const sharedParams = new URLSearchParams(window.location.search || '');
  if (hasCrimeViewState(sharedParams)) {
    applyCrimeViewState(store, decodeCrimeViewState(sharedParams), { setMode: setAnalysisMode });
  }
  const initialMode = setViewMode(readModeFromURL(), { silent: true });
  const map = initMap({ mode: initialMode, center: store.centerLonLat || undefined });
  const chartsPane = document.getElementById('charts');
  initAboutPanel();
  writeModeToURL(initialMode);

  let coordinator = null;
  const panel = initPanel(store, {
    onChange: () => coordinator?.requestCrimeRefresh(),
    onRadiusInput: () => coordinator?.updateCrimeBuffer(),
    getMapCenter: () => map.getCenter(),
    onAddressResolved: (_target, result) => {
      map.flyTo({ center: result.lngLat, zoom: Math.max(map.getZoom(), 13) });
      void coordinator?.requestCrimeRefresh();
    },
    onTractsOverlayToggle: (visible) => coordinator?.setTractsOverlayVisible(visible),
  });
  const { diaryMount } = panel;

  coordinator = createModeCoordinator({
    map,
    diaryFeatureEnabled,
    getCurrentMode: () => store.viewMode,
    writeMode: writeModeToURL,
    chartsPane,
    diaryMount,
    loadCrimeController: () => import('./routes_crime/index.js')
      .then((module) => module.initCrimeMode(map, {
        isActive: () => store.viewMode === 'crime',
        onCoverageChange: () => panel.syncFromStore?.(),
        onPointChange: () => panel.syncFromStore?.(),
      })),
    loadDiaryModule: () => import('./routes_diary/index.js'),
    getDiaryInsights: (owner) => diaryInsightsLoader.getHost(owner),
  });

  onViewModeChange((mode) => void coordinator.schedule(mode));
  await coordinator.schedule(store.viewMode);
});
