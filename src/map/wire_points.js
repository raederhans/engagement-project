import { attachClusterExpansion, attachIncidentDetails, clearCrimePoints, refreshPoints } from './points.js';
import { t } from '../i18n/index.js';

function createDebounced(fn, wait, scheduler) {
  let timer = null;
  const debounced = (...args) => {
    if (timer != null) scheduler.clearTimeout(timer);
    timer = scheduler.setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  debounced.cancel = () => {
    if (timer == null) return;
    scheduler.clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

function showToastInDom(message) {
  let element = document.getElementById('toast');
  if (!element) {
    element = document.createElement('div');
    element.id = 'toast';
    element.className = 'toast';
    element.hidden = true;
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    document.body.appendChild(element);
  }
  element.textContent = message;
  element.hidden = false;
}

function hideToastInDom() {
  const toast = document.getElementById('toast');
  if (toast) toast.hidden = true;
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

/**
 * Wire map move events to refresh clustered points with simple error backoff and toast.
 * deps: { getFilters: () => ({start,end,types}) }
 * @param {import('maplibre-gl').Map} map
 * @param {{getFilters:Function}} deps
 */
export function wirePoints(map, deps) {
  const {
    getFilters,
    refreshPointsImpl = refreshPoints,
    clearCrimePointsImpl = clearCrimePoints,
    showToast = showToastInDom,
    hideToast = hideToastInDom,
    scheduler = globalThis,
    shouldRefresh = () => true,
    autoRefresh = true,
  } = deps;
  const backoffs = [2000, 4000, 8000];
  let backoffIdx = 0;
  let active = true;
  let generation = 0;
  let requestController = null;
  let retryTimer = null;
  let toastTimer = null;
  let programmaticMoveOwner = null;
  let clusterCleanup = null;
  let incidentCleanup = null;

  const settleProgrammaticMove = (completed) => {
    if (!programmaticMoveOwner) return;
    const owner = programmaticMoveOwner;
    programmaticMoveOwner = null;
    owner.resolve(Boolean(completed));
  };

  const cancelRetry = () => {
    if (retryTimer == null) return;
    scheduler.clearTimeout(retryTimer);
    retryTimer = null;
  };

  const cancelToast = () => {
    if (toastTimer != null) {
      scheduler.clearTimeout(toastTimer);
      toastTimer = null;
    }
    hideToast();
  };

  const invalidate = () => {
    generation += 1;
    requestController?.abort();
    requestController = null;
    cancelRetry();
    debouncedMoveEnd.cancel();
    cancelToast();
    incidentCleanup?.closePopup?.();
  };

  const run = async (
    filtersOverride,
    { signal: ownerSignal, shouldApply: ownerShouldApply = () => true } = {},
  ) => {
    if (!active || ownerSignal?.aborted || !ownerShouldApply()) return { applied: false };
    const filters = filtersOverride === undefined ? getFilters() : filtersOverride;
    if (!shouldRefresh(filters)) {
      invalidate();
      clearCrimePointsImpl(map);
      return { applied: false, status: 'idle' };
    }
    invalidate();
    const requestGeneration = generation;
    const controller = new AbortController();
    const abortFromOwner = () => controller.abort(ownerSignal.reason);
    ownerSignal?.addEventListener('abort', abortFromOwner, { once: true });
    if (ownerSignal?.aborted) abortFromOwner();
    requestController = controller;

    try {
      const result = await refreshPointsImpl(map, {
        ...filters,
        signal: controller.signal,
        shouldApply: () => active
          && generation === requestGeneration
          && !controller.signal.aborted
          && !ownerSignal?.aborted
          && ownerShouldApply(),
      });
      if (!active
        || generation !== requestGeneration
        || controller.signal.aborted
        || ownerSignal?.aborted
        || !ownerShouldApply()) {
        return { applied: false };
      }
      backoffIdx = 0;
      if (!clusterCleanup) {
        clusterCleanup = attachClusterExpansion(map, {
          isActive: () => active,
          getGeneration: () => generation,
          runMapMove: runProgrammaticMapMove,
          refresh: () => run(),
        });
      }
      if (!incidentCleanup && map.getLayer?.('unclustered')) {
        incidentCleanup = attachIncidentDetails(map);
      }
      return result ?? { applied: true };
    } catch (error) {
      const stale = !active
        || generation !== requestGeneration
        || controller.signal.aborted
        || ownerSignal?.aborted
        || !ownerShouldApply()
        || isAbortError(error);
      if (stale) return { applied: false };

      showToast(t('map.pointsRetrying'));
      toastTimer = scheduler.setTimeout(() => {
        toastTimer = null;
        hideToast();
      }, 2500);
      const delay = backoffs[Math.min(backoffIdx, backoffs.length - 1)];
      backoffIdx += 1;
      retryTimer = scheduler.setTimeout(() => {
        retryTimer = null;
        if (active && generation === requestGeneration) {
          void run(filtersOverride, { signal: ownerSignal, shouldApply: ownerShouldApply });
        }
      }, delay);
      return { status: 'failed' };
    } finally {
      ownerSignal?.removeEventListener('abort', abortFromOwner);
      if (requestController === controller) requestController = null;
    }
  };

  const debouncedMoveEnd = createDebounced((filters) => void run(filters), 300, scheduler);
  const onMoveEnd = () => {
    if (!active) return;
    if (programmaticMoveOwner) {
      if (!programmaticMoveOwner.armed) return;
      settleProgrammaticMove(true);
      return;
    }
    const filters = getFilters();
    if (!shouldRefresh(filters)) return;
    debouncedMoveEnd(filters);
  };
  const onLoad = () => {
    const filters = getFilters();
    if (shouldRefresh(filters)) void run(filters);
  };

  const runProgrammaticMapMove = (action) => {
    if (typeof action !== 'function') return Promise.resolve(false);
    if (!active) {
      action();
      return Promise.resolve(false);
    }
    settleProgrammaticMove(false);
    let resolveMove;
    const completion = new Promise((resolve) => { resolveMove = resolve; });
    const owner = { resolve: resolveMove, armed: false };
    programmaticMoveOwner = owner;
    try {
      action();
    } catch (error) {
      settleProgrammaticMove(false);
      return Promise.reject(error);
    }
    if (programmaticMoveOwner === owner) owner.armed = true;
    if (map.isMoving?.() !== true) settleProgrammaticMove(true);
    return completion;
  };

  if (autoRefresh) {
    if (map.loaded?.() || map.isStyleLoaded?.()) onLoad();
    else map.once('load', onLoad);
  }
  map.on('moveend', onMoveEnd);

  return {
    refresh: run,
    runProgrammaticMapMove,
    clear() {
      settleProgrammaticMove(false);
      invalidate();
      clearCrimePointsImpl(map);
      incidentCleanup?.closePopup?.();
    },
    setActive(next) {
      active = Boolean(next);
      if (!active) {
        settleProgrammaticMove(false);
        invalidate();
      }
    },
    destroy() {
      active = false;
      settleProgrammaticMove(false);
      invalidate();
      map.off('load', onLoad);
      map.off('moveend', onMoveEnd);
      clusterCleanup?.();
      clusterCleanup = null;
      incidentCleanup?.();
      incidentCleanup = null;
    },
  };
}
