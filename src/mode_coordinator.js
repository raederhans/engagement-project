import {
  createLatestSerialQueue,
  waitForOwnedPromise,
} from './utils/latest_serial_queue.js';

async function waitForTransition(promise, signal) {
  try {
    return { completed: true, value: await waitForOwnedPromise(promise, signal) };
  } catch (error) {
    if (signal.aborted) return { completed: false, value: null };
    throw error;
  }
}

function waitForStyleReady(map, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  if (map.isStyleLoaded?.()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (ready) => {
      map.off?.('idle', handleIdle);
      signal?.removeEventListener('abort', handleAbort);
      resolve(ready);
    };
    const handleIdle = () => finish(true);
    const handleAbort = () => finish(false);
    map.once('idle', handleIdle);
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

export function createModeCoordinator({
  map,
  diaryFeatureEnabled,
  getCurrentMode,
  writeMode,
  chartsPane,
  diaryMount,
  loadCrimeController,
  loadDiaryModule,
  getDiaryInsights,
  reportError = (label, error) => console.error(`[${label}]`, error),
}) {
  let crimeControllerPromise = null;
  let crimeController = null;
  let diaryModulePromise = null;
  let diaryModule = null;
  let diaryInsights = null;
  let diaryActive = false;
  let activeMode = null;

  const getCrimeController = () => {
    if (!crimeControllerPromise) {
      let ownedPromise;
      ownedPromise = Promise.resolve()
        .then(loadCrimeController)
        .then((controller) => {
          crimeController = controller;
          return controller;
        })
        .catch((error) => {
          if (crimeControllerPromise === ownedPromise) crimeControllerPromise = null;
          crimeController = null;
          throw error;
        });
      crimeControllerPromise = ownedPromise;
    }
    return crimeControllerPromise;
  };

  const getDiaryModule = () => {
    if (!diaryFeatureEnabled) return null;
    if (!diaryModulePromise) {
      diaryModulePromise = Promise.resolve()
        .then(loadDiaryModule)
        .then((module) => {
          diaryModule = module;
          return module;
        });
    }
    return diaryModulePromise;
  };

  const deactivateCrimeForDiary = (signal) => {
    activeMode = activeMode === 'crime' ? null : activeMode;
    if (crimeController) {
      crimeController.setActive(false);
      return;
    }
    if (!crimeControllerPromise) return;
    void waitForOwnedPromise(crimeControllerPromise, signal)
      .then((controller) => {
        if (!signal.aborted && getCurrentMode() !== 'crime') controller.setActive(false);
      })
      .catch((error) => {
        if (!signal.aborted) reportError('Crime pending controller failed', error);
      });
  };

  const stopDiary = async () => {
    diaryInsights?.hide();
    if (diaryActive && diaryModule) diaryModule.teardownDiaryMode(map);
    diaryActive = false;
    if (activeMode === 'diary') activeMode = null;
    diaryMount?.replaceChildren?.();
  };

  const applyMode = async (mode, { isLatest, signal }) => {
    const ownsMode = () => !signal.aborted && isLatest() && getCurrentMode() === mode;
    if (!ownsMode()) return;
    writeMode(mode);

    if (mode === 'diary' && diaryFeatureEnabled) {
      if (chartsPane) chartsPane.style.display = 'none';
      deactivateCrimeForDiary(signal);
      const styleReady = await waitForStyleReady(map, signal);
      if (!styleReady || !ownsMode()) return;

      try {
        const pendingModule = getDiaryModule();
        if (!pendingModule) return;
        const moduleResult = await waitForTransition(pendingModule, signal);
        if (!moduleResult.completed || !ownsMode()) return;
        const module = moduleResult.value;
        const insightsResult = await waitForTransition(getDiaryInsights({
          signal,
          isCurrent: ownsMode,
        }), signal);
        if (!insightsResult.completed || !insightsResult.value || !ownsMode()) return;
        diaryInsights = insightsResult.value;
        diaryInsights.show();
        diaryInsights.setCollapsed(true);

        const initResult = await waitForTransition(module.initDiaryMode(map, {
          mountInto: diaryMount || null,
          insights: diaryInsights,
          signal,
          isCurrent: ownsMode,
        }), signal);
        if (!initResult.completed || !ownsMode()) {
          module.teardownDiaryMode(map);
          return;
        }
        if (initResult.value?.status !== 'ready') {
          diaryMount?.replaceChildren?.();
          if (diaryMount) diaryMount.textContent = 'Diary data is unavailable. Reload to try again.';
          activeMode = null;
          return;
        }
        diaryActive = true;
        activeMode = 'diary';
      } catch (error) {
        if (!signal.aborted) reportError('Diary init failed', error);
      }
      return;
    }

    await stopDiary();
    if (chartsPane) chartsPane.style.display = '';

    try {
      const controllerResult = await waitForTransition(getCrimeController(), signal);
      if (!controllerResult.completed) return;
      const controller = controllerResult.value;
      if (!ownsMode()) {
        controller.setActive(false);
        return;
      }
      controller.setActive(true);
      activeMode = 'crime';
    } catch (error) {
      if (!signal.aborted) reportError('Crime init failed', error);
    }
  };

  const schedule = createLatestSerialQueue(applyMode);

  const withCurrentCrime = (action) => {
    if (activeMode !== 'crime' || getCurrentMode() !== 'crime' || !crimeController) return false;
    action(crimeController);
    return true;
  };

  return Object.freeze({
    schedule,
    getActiveMode: () => activeMode,
    requestCrimeRefresh() {
      return withCurrentCrime((controller) => { void controller.requestRefresh(); });
    },
    updateCrimeBuffer() {
      return withCurrentCrime((controller) => controller.updateBuffer());
    },
    setTractsOverlayVisible(visible) {
      return withCurrentCrime((controller) => controller.setTractsOverlayVisible(visible));
    },
  });
}
