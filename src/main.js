import './style.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { initMap } from './map/initMap.js';
import { store, setViewMode, onViewModeChange } from './state/store.js';
import { initPanel, readModeFromURL, writeModeToURL } from './ui/panel.js';
import { initAboutPanel } from './ui/about.js';
import { createDiaryInsightsLoader } from './routes_diary/diary_insights_port.js';
import { createModeCoordinator } from './mode_coordinator.js';

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
    document.body.appendChild(root);
    return root;
  },
  createHost: (module, root) => module.createDiaryInsightsHost(root),
});

window.addEventListener('DOMContentLoaded', async () => {
  const initialMode = setViewMode(readModeFromURL(), { silent: true });
  const map = initMap({ mode: initialMode });
  const chartsPane = document.getElementById('charts');
  initAboutPanel();
  writeModeToURL(initialMode);

  let coordinator = null;
  const { diaryMount } = initPanel(store, {
    onChange: () => coordinator?.requestCrimeRefresh(),
    onRadiusInput: () => coordinator?.updateCrimeBuffer(),
    getMapCenter: () => map.getCenter(),
    onTractsOverlayToggle: (visible) => coordinator?.setTractsOverlayVisible(visible),
  });

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
      })),
    loadDiaryModule: () => import('./routes_diary/index.js'),
    getDiaryInsights: (owner) => diaryInsightsLoader.getHost(owner),
  });

  onViewModeChange((mode) => void coordinator.schedule(mode));
  await coordinator.schedule(store.viewMode);
});
