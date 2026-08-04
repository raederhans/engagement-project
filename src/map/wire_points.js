import {
  attachClusterExpansion,
  clearCrimePoints,
  incidentResultKey,
  refreshPoints,
} from './points.js';
import { onLanguageChange, t } from '../i18n/index.js';
import { formatLocalizedDate } from '../i18n/date.js';
import { escapeHtml } from '../utils/html.js';

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
    incidentResultsController = null,
    _loadIncidentModule = () => import('../routes_crime/incident_results_controller.js'),
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
  let incidentResults = incidentResultsController;
  let incidentResultsPromise = null;
  let destroyed = false;

  const loadIncidentResults = () => {
    if (incidentResults) return Promise.resolve(incidentResults);
    if (destroyed || !globalThis.document?.getElementById?.('incident-results')) {
      return Promise.resolve(null);
    }
    incidentResultsPromise ||= _loadIncidentModule()
      .then((module) => {
        const controller = module.createIncidentResultsController(map, {
          translate: t,
          languageChange: onLanguageChange,
          getResultKey: incidentResultKey,
          formatDate: formatLocalizedDate,
          escape: escapeHtml,
        });
        if (destroyed) {
          controller.destroy();
          return null;
        }
        incidentResults = controller;
        return controller;
      })
      .catch((error) => {
        incidentResultsPromise = null;
        console.warn('Incident results failed to initialize:', error);
        throw error;
      });
    return incidentResultsPromise;
  };

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
    const filters = filtersOverride === undefined ? getFilters() : filtersOverride;
    if (!shouldRefresh(filters)) {
      invalidate();
      clearCrimePointsImpl(map);
      incidentResults?.clear?.();
      return { applied: false, status: 'idle' };
    }
    invalidate();
    const requestGeneration = generation;
    const controller = new AbortController();
    const isCurrent = () => active
      && generation === requestGeneration
      && !controller.signal.aborted
      && !ownerSignal?.aborted
      && ownerShouldApply();
    const incidentResultsTask = loadIncidentResults();
    void incidentResultsTask.then((controller) => {
      if (isCurrent()) controller?.setLoading?.();
    }, () => {});
    const abortFromOwner = () => controller.abort(ownerSignal.reason);
    ownerSignal?.addEventListener('abort', abortFromOwner, { once: true });
    if (ownerSignal?.aborted) abortFromOwner();
    requestController = controller;

    try {
      const result = await refreshPointsImpl(map, {
        ...filters,
        signal: controller.signal,
        resultGeneration: requestGeneration,
        shouldApply: isCurrent,
      });
      if (!isCurrent()) return { applied: false };
      backoffIdx = 0;
      if (result?.applied && result.geo) {
        const incidentController = await incidentResultsTask;
        if (!isCurrent()) return { applied: false };
        incidentController?.replaceResults?.({
          ...result,
          generation: requestGeneration,
        });
      }
      if (!clusterCleanup) {
        clusterCleanup = attachClusterExpansion(map, {
          isActive: () => active,
          getGeneration: () => generation,
          runMapMove: runProgrammaticMapMove,
          refresh: () => run(),
        });
      }
      return result ?? { applied: true };
    } catch (error) {
      const stale = !isCurrent() || isAbortError(error);
      if (stale) return { applied: false };

      incidentResults?.setFailed?.();
      showToast(t(incidentResults ? 'map.pointsRetrying' : 'incidents.failed'));
      toastTimer = scheduler.setTimeout(() => {
        toastTimer = null;
        hideToast();
      }, 2500);
      const delay = backoffs[Math.min(backoffIdx, backoffs.length - 1)];
      backoffIdx += 1;
      retryTimer = scheduler.setTimeout(() => {
        retryTimer = null;
        if (isCurrent()) {
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
      incidentResults?.clear?.();
    },
    setActive(next) {
      active = Boolean(next);
      if (!active) {
        settleProgrammaticMove(false);
        invalidate();
        incidentResults?.clear?.();
      }
    },
    destroy() {
      destroyed = true;
      active = false;
      settleProgrammaticMove(false);
      invalidate();
      map.off('load', onLoad);
      map.off('moveend', onMoveEnd);
      clusterCleanup?.();
      clusterCleanup = null;
      incidentResults?.destroy?.();
      incidentResults = null;
    },
  };
}
