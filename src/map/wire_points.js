import { clearCrimePoints, refreshPoints } from './points.js';
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
    Object.assign(element.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: 40,
      background: 'rgba(17,24,39,0.9)', color: '#fff', padding: '8px 10px', borderRadius: '6px', fontSize: '12px'
    });
    document.body.appendChild(element);
  }
  element.textContent = message;
  element.style.display = 'block';
}

function hideToastInDom() {
  const toast = document.getElementById('toast');
  if (toast) toast.style.display = 'none';
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
  } = deps;
  const backoffs = [2000, 4000, 8000];
  let backoffIdx = 0;
  let active = true;
  let generation = 0;
  let requestController = null;
  let retryTimer = null;
  let toastTimer = null;
  let programmaticMoveOwner = null;

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
  };

  const run = async (
    filtersOverride,
    { signal: ownerSignal, shouldApply: ownerShouldApply = () => true } = {},
  ) => {
    if (!active || ownerSignal?.aborted || !ownerShouldApply()) return { applied: false };
    invalidate();
    const requestGeneration = generation;
    const controller = new AbortController();
    const abortFromOwner = () => controller.abort(ownerSignal.reason);
    ownerSignal?.addEventListener('abort', abortFromOwner, { once: true });
    if (ownerSignal?.aborted) abortFromOwner();
    requestController = controller;
    const filters = filtersOverride === undefined ? getFilters() : filtersOverride;

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

  const debouncedMoveEnd = createDebounced(() => void run(), 300, scheduler);
  const onMoveEnd = () => {
    if (!active) return;
    if (programmaticMoveOwner) {
      if (!programmaticMoveOwner.armed) return;
      settleProgrammaticMove(true);
      return;
    }
    debouncedMoveEnd();
  };
  const onLoad = () => void run();

  if (map.loaded?.() || map.isStyleLoaded?.()) {
    void run();
  } else {
    map.once('load', onLoad);
  }
  map.on('moveend', onMoveEnd);

  return {
    refresh: run,
    runProgrammaticMapMove(action) {
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
    },
    clear() {
      settleProgrammaticMove(false);
      invalidate();
      clearCrimePointsImpl(map);
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
    },
  };
}
