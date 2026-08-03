import { waitForOwnedPromise } from '../utils/latest_serial_queue.js';

function isAbortError(error) {
  return error?.name === 'AbortError';
}

export function readCrimeSnapshot(source) {
  const filters = source.getFilters();
  return {
    ...filters,
    types: [...(filters.types || [])],
    resolvedOffenseCodes: [...(filters.resolvedOffenseCodes || filters.types || [])],
    drilldownCodes: [...(filters.drilldownCodes || [])],
    center3857: filters.center3857 ? [...filters.center3857] : null,
    centerLonLat: source.centerLonLat ? [...source.centerLonLat] : null,
    centerB3857: source.centerB3857 ? [...source.centerB3857] : null,
    centerBLonLat: source.centerBLonLat ? [...source.centerBLonLat] : null,
    addressA: source.addressA ?? null,
    addressB: source.addressB ?? null,
    adminLevel: source.adminLevel,
    per10k: source.per10k,
  };
}

export function createCrimeRefreshOwner({ readSnapshot, runRefresh }) {
  let active = true;
  let generation = 0;
  let controller = null;

  const invalidate = () => {
    generation += 1;
    controller?.abort();
    controller = null;
  };

  return {
    async refresh({ signal: ownerSignal } = {}) {
      if (!active) return { applied: false };
      if (ownerSignal?.aborted) return { applied: false };

      invalidate();
      const requestGeneration = generation;
      const requestController = new AbortController();
      controller = requestController;
      const snapshot = readSnapshot();
      const context = {
        signal: requestController.signal,
        isCurrent: () => active
          && generation === requestGeneration
          && !requestController.signal.aborted,
      };
      const abortFromOwner = () => requestController.abort(ownerSignal.reason);
      ownerSignal?.addEventListener('abort', abortFromOwner, { once: true });

      try {
        const result = await waitForOwnedPromise(runRefresh(snapshot, context), requestController.signal);
        return context.isCurrent() ? (result ?? { applied: true }) : { applied: false };
      } catch (error) {
        if (!context.isCurrent() || isAbortError(error)) return { applied: false };
        throw error;
      } finally {
        ownerSignal?.removeEventListener('abort', abortFromOwner);
        if (generation === requestGeneration) controller = null;
      }
    },
    cancel() {
      invalidate();
    },
    setActive(next) {
      const shouldActivate = Boolean(next);
      if (active === shouldActivate) return;
      active = shouldActivate;
      if (!active) invalidate();
    },
    destroy() {
      active = false;
      invalidate();
    },
  };
}
