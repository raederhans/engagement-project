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
  onModeIntent = () => {},
  onModeSettled = () => {},
  onShortStatusChange = () => {},
  onDataScopeChange = () => {},
  reportError = (label, error) => console.error(`[${label}]`, error),
}) {
  let crimeControllerPromise = null;
  let crimeController = null;
  let diaryModulePromise = null;
  let diaryModule = null;
  let diaryInsights = null;
  let diaryActive = false;
  let activeMode = null;
  let shortStatus = Object.freeze({
    mode: getCurrentMode() === 'diary' ? 'diary' : 'crime',
    phase: 'idle',
    label: 'Data idle',
  });
  const statusListeners = new Set();

  const statusLabel = (mode, phase) => {
    const name = mode === 'diary' ? 'Diary' : 'Crime';
    if (phase === 'loading') return `${name} loading`;
    if (phase === 'ready') return `${name} data ready`;
    return `${name} data unavailable`;
  };

  const publishStatus = (mode, phase) => {
    shortStatus = Object.freeze({ mode, phase, label: statusLabel(mode, phase) });
    onShortStatusChange(shortStatus);
    for (const listener of statusListeners) listener(shortStatus);
  };

  const settleMode = (mode, phase, ownsMode) => {
    if (!ownsMode()) return;
    publishStatus(mode, phase);
    onModeSettled(mode, phase);
  };

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
    if (!ownsMode()) return { status: 'superseded' };

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
          onScopeChange: (scope) => {
            if (ownsMode()) onDataScopeChange(scope);
          },
        }), signal);
        if (!initResult.completed || !ownsMode()) {
          module.teardownDiaryMode(map);
          return;
        }
        if (initResult.value?.status !== 'ready') {
          diaryMount?.replaceChildren?.();
          if (diaryMount) diaryMount.textContent = 'Diary data is unavailable. Reload to try again.';
          activeMode = null;
          settleMode(mode, 'failed', ownsMode);
          return;
        }
        diaryActive = true;
        activeMode = 'diary';
        settleMode(mode, 'ready', ownsMode);
      } catch (error) {
        if (!signal.aborted) {
          reportError('Diary init failed', error);
          settleMode(mode, 'failed', ownsMode);
        }
      }
      return { status: activeMode === 'diary' ? 'ready' : 'superseded' };
    }

    await stopDiary();
    if (chartsPane) chartsPane.style.display = '';

    try {
      const controllerResult = await waitForTransition(getCrimeController(), signal);
      if (!controllerResult.completed) return { status: 'superseded' };
      const controller = controllerResult.value;
      if (!ownsMode()) {
        controller.setActive(false);
        return { status: 'superseded' };
      }
      controller.setActive(true);
      activeMode = 'crime';
      if (!ownsMode()) return { status: 'superseded' };
      try {
        const refresh = await controller.requestRefresh({ signal });
        if (refresh?.status === 'live') settleMode(mode, 'ready', ownsMode);
        else if (refresh?.status === 'failed') settleMode(mode, 'failed', ownsMode);
        return ownsMode() ? refresh : { status: 'superseded' };
      } catch (error) {
        if (!signal.aborted) reportError('Crime refresh failed', error);
        settleMode(mode, 'failed', ownsMode);
        return { status: signal.aborted ? 'superseded' : 'failed', error: String(error?.message || error) };
      }
    } catch (error) {
      if (!signal.aborted) reportError('Crime init failed', error);
      settleMode(mode, 'failed', ownsMode);
      return { status: signal.aborted ? 'superseded' : 'failed', error: String(error?.message || error) };
    }
  };

  const enqueue = createLatestSerialQueue(applyMode);
  const schedule = (mode) => {
    const normalized = mode === 'diary' && diaryFeatureEnabled ? 'diary' : 'crime';
    writeMode(normalized);
    onModeIntent(normalized);
    publishStatus(normalized, 'loading');
    return enqueue(normalized);
  };
  schedule.cancel = (reason) => enqueue.cancel(reason);

  const withCurrentCrime = (action) => {
    if (activeMode !== 'crime' || getCurrentMode() !== 'crime' || !crimeController) return false;
    action(crimeController);
    return true;
  };

  return Object.freeze({
    schedule,
    cancelCurrentTransition: (reason) => schedule.cancel(reason),
    getActiveMode: () => activeMode,
    getShortStatus: () => shortStatus,
    subscribeShortStatus(listener) {
      if (typeof listener !== 'function') return () => {};
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    getCurrentCrimeProvenance() {
      if (activeMode !== 'crime' || getCurrentMode() !== 'crime' || !crimeController) return {};
      return crimeController.getCurrentProvenance?.() || {};
    },
    async requestCrimeRefresh({ signal } = {}) {
      if (activeMode !== 'crime' || getCurrentMode() !== 'crime' || !crimeController) {
        return { status: 'superseded' };
      }
      publishStatus('crime', 'loading');
      try {
        const refresh = await crimeController.requestRefresh({ signal });
        const ownsCrime = () => activeMode === 'crime' && getCurrentMode() === 'crime';
        if (refresh?.status === 'live') settleMode('crime', 'ready', ownsCrime);
        else if (refresh?.status === 'failed') settleMode('crime', 'failed', ownsCrime);
        return refresh;
      } catch (error) {
        reportError('Crime refresh failed', error);
        settleMode('crime', 'failed', () => activeMode === 'crime' && getCurrentMode() === 'crime');
        return { status: 'failed', error: String(error?.message || error) };
      }
    },
    runCrimeMapMove(action) {
      let completion = null;
      if (withCurrentCrime((controller) => {
        completion = controller.runProgrammaticMapMove(action);
      })) return completion;
      action();
      return Promise.resolve(true);
    },
    fitCurrentCrimeSelection(options) {
      let completion = Promise.resolve(false);
      if (withCurrentCrime((controller) => {
        completion = controller.fitCurrentSelection(options);
      })) return completion;
      return completion;
    },
    fitCurrentDiarySelection() {
      if (activeMode !== 'diary' || getCurrentMode() !== 'diary' || !diaryModule) return false;
      return diaryModule.fitCurrentDiarySelection?.() || false;
    },
    updateCrimeBuffer() {
      return withCurrentCrime((controller) => controller.updateBuffer());
    },
    setTractsOverlayVisible(visible) {
      return withCurrentCrime((controller) => controller.setTractsOverlayVisible(visible));
    },
  });
}
