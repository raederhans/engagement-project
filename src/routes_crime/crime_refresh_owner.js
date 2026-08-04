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
    overlayTractsLines: source.overlayTractsLines,
  };
}

export function createCrimeRefreshOwner({ readSnapshot, runRefresh }) {
  let active = true;
  let generation = 0;
  let controller = null;
  let currentScope = null;

  const invalidate = () => {
    generation += 1;
    controller?.abort();
    controller = null;
    currentScope = null;
  };

  return {
    async refresh({ signal: ownerSignal, scope = 'all' } = {}) {
      if (!active) return { applied: false };
      if (ownerSignal?.aborted) return { applied: false };
      if (controller && !controller.signal.aborted && currentScope === 'all' && scope !== 'all') {
        return {
          applied: false,
          status: 'busy',
          reason: 'full-refresh-active',
        };
      }

      invalidate();
      const requestGeneration = generation;
      const requestController = new AbortController();
      controller = requestController;
      currentScope = scope;
      const snapshot = readSnapshot();
      const context = {
        signal: requestController.signal,
        scope,
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
        if (generation === requestGeneration) {
          controller = null;
          currentScope = null;
        }
      }
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

export function observeCrimeRefreshJob({ name, promise, token }, {
  isCurrent = () => true,
  onSettled = () => {},
  onSuperseded = () => {},
} = {}) {
  const publish = (result) => {
    const entry = { name, result, token };
    if (isCurrent()) onSettled(entry);
    else onSuperseded(entry);
    return entry;
  };

  return Promise.resolve(promise).then(
    (value) => {
      publish({ status: 'fulfilled', value });
      return value;
    },
    (reason) => {
      publish({ status: 'rejected', reason });
      throw reason;
    },
  );
}
