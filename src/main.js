import './style.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { initMap } from './map/initMap.js';
import { store, setViewMode, onViewModeChange } from './state/store.js';
import { initPanel, readModeFromURL, writeModeToURL } from './ui/panel.js';
import { initAboutPanel } from './ui/about.js';
import { createLatestSerialQueue } from './utils/latest_serial_queue.js';

const query = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search || '')
  : new URLSearchParams('');
const diaryFeatureEnabled = import.meta?.env?.VITE_FEATURE_DIARY === '1'
  || query.get('mode') === 'diary';

let crimeControllerPromise = null;
let diaryModulePromise = null;
let diaryInsightsPromise = null;
let diaryInsights = null;

function loadCrimeController(map) {
  if (!crimeControllerPromise) {
    crimeControllerPromise = import('./routes_crime/index.js')
      .then((module) => module.initCrimeMode(map, {
        isActive: () => store.viewMode === 'crime',
      }));
  }
  return crimeControllerPromise;
}

function loadDiaryModule() {
  if (!diaryFeatureEnabled) return null;
  if (!diaryModulePromise) diaryModulePromise = import('./routes_diary/index.js');
  return diaryModulePromise;
}

async function loadDiaryInsights() {
  if (!diaryInsightsPromise) {
    diaryInsightsPromise = import('./routes_diary/ui_insights_panel.js').then((module) => {
      const root = document.createElement('div');
      root.id = 'diary-insights-root';
      document.body.appendChild(root);
      diaryInsights = module.createDiaryInsightsHost(root);
      window.__diaryInsightsHost = diaryInsights;
      return diaryInsights;
    });
  }
  return diaryInsightsPromise;
}

function waitForStyleReady(map) {
  if (map.isStyleLoaded?.()) return Promise.resolve();
  return new Promise((resolve) => map.once('idle', resolve));
}

window.__dashboard = {
  setChoropleth: (/* future hook */) => {},
};

window.addEventListener('DOMContentLoaded', async () => {
  const initialMode = setViewMode(readModeFromURL(), { silent: true });
  const map = initMap({ mode: initialMode });
  const chartsPane = document.getElementById('charts');
  initAboutPanel();
  writeModeToURL(initialMode);

  let diaryActive = false;

  const { diaryMount } = initPanel(store, {
    onChange: () => {
      if (store.viewMode === 'crime' && crimeControllerPromise) {
        void crimeControllerPromise.then((controller) => controller.requestRefresh());
      }
    },
    onRadiusInput: () => {
      if (crimeControllerPromise) {
        void crimeControllerPromise.then((controller) => controller.updateBuffer());
      }
    },
    getMapCenter: () => map.getCenter(),
    onTractsOverlayToggle: (visible) => {
      if (map.getLayer('tracts-outline-line')) {
        map.setLayoutProperty('tracts-outline-line', 'visibility', visible ? 'visible' : 'none');
      }
    },
  });

  const applyViewModeChange = async (mode, { isLatest }) => {
    if (!isLatest()) return;
    writeModeToURL(mode);

    if (mode === 'diary' && diaryFeatureEnabled) {
      if (chartsPane) chartsPane.style.display = 'none';
      if (crimeControllerPromise) {
        const controller = await crimeControllerPromise;
        controller.setActive(false);
      }
      await waitForStyleReady(map);
      if (!isLatest() || store.viewMode !== 'diary') return;

      try {
        const modulePromise = loadDiaryModule();
        if (!modulePromise) return;
        const [module, insights] = await Promise.all([modulePromise, loadDiaryInsights()]);
        if (!isLatest() || store.viewMode !== 'diary') return;
        insights.show();
        insights.setCollapsed(true);
        await module.initDiaryMode(map, { mountInto: diaryMount || null });
        if (!isLatest() || store.viewMode !== 'diary') {
          module.teardownDiaryMode(map);
          return;
        }
        diaryActive = true;
      } catch (error) {
        console.error('[Diary] init failed:', error);
      }
      return;
    }

    diaryInsights?.hide();
    if (diaryActive && diaryModulePromise) {
      try {
        const module = await diaryModulePromise;
        module.teardownDiaryMode(map);
      } catch (error) {
        console.error('[Diary] teardown failed:', error);
      }
    }
    diaryActive = false;
    if (diaryMount) diaryMount.replaceChildren();
    if (chartsPane) chartsPane.style.display = '';

    try {
      const controller = await loadCrimeController(map);
      if (!isLatest() || store.viewMode !== 'crime') {
        controller.setActive(false);
        return;
      }
      controller.setActive(true);
    } catch (error) {
      console.error('[Crime] init failed:', error);
    }
  };

  const scheduleViewModeChange = createLatestSerialQueue(applyViewModeChange);
  onViewModeChange((mode) => void scheduleViewModeChange(mode));
  await scheduleViewModeChange(store.viewMode);
});
