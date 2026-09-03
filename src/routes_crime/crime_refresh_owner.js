import { waitForOwnedPromise } from '../utils/latest_serial_queue.js';
import {
  classifyCrimeRuntime,
  containsPrivateCrimeLocation,
  CRIME_RUNTIME_KINDS,
} from '../crime_runtime_policy.js';

export { containsPrivateCrimeLocation } from '../crime_runtime_policy.js';

function isAbortError(error) {
  return error?.name === 'AbortError';
}

export const PRIVATE_CRIME_UNAVAILABLE_REASON = 'private-location-analysis';

export function isPrivateCrimeAnalysisSnapshot(source) {
  return classifyCrimeRuntime(source).kind !== CRIME_RUNTIME_KINDS.PUBLIC_AREA;
}

export function containsActivePrivateCrimeLocation(source) {
  return source?.queryMode === 'buffer' && containsPrivateCrimeLocation(source);
}

export function privateCrimeUnavailableResult() {
  return {
    status: 'unavailable',
    reason: PRIVATE_CRIME_UNAVAILABLE_REASON,
    succeeded: [],
    failed: [],
  };
}

export function readCrimeSnapshot(source) {
  if (source?.queryMode === 'district' || source?.queryMode === 'tract') {
    const filters = source.getFilters();
    return {
      ...filters,
      types: [...(filters.types || [])],
      resolvedOffenseCodes: [...(filters.resolvedOffenseCodes || filters.types || [])],
      drilldownCodes: [...(filters.drilldownCodes || [])],
      queryMode: source.queryMode,
      center3857: null,
      centerLonLat: null,
      centerB3857: null,
      centerBLonLat: null,
      addressA: null,
      addressB: null,
      adminLevel: source.adminLevel,
      per10k: source.per10k,
      coverageDate: source.coverageMax || null,
      overlayTractsLines: source.overlayTractsLines,
    };
  }
  if (isPrivateCrimeAnalysisSnapshot(source)) {
    let filters = {};
    try {
      filters = source.getFilters?.() || {};
    } catch {
      // Private analysis is rejected before coverage initialization, so filters may be unavailable.
    }
    return {
      ...filters,
      types: [...(filters.types || [])],
      resolvedOffenseCodes: [...(filters.resolvedOffenseCodes || filters.types || [])],
      drilldownCodes: [...(filters.drilldownCodes || [])],
      queryMode: source.queryMode ?? filters.queryMode,
      center3857: (filters.center3857 || source.center3857)
        ? [...(filters.center3857 || source.center3857)]
        : null,
      centerLonLat: source.centerLonLat ? [...source.centerLonLat] : null,
      centerB3857: (filters.centerB3857 || source.centerB3857)
        ? [...(filters.centerB3857 || source.centerB3857)]
        : null,
      centerBLonLat: source.centerBLonLat ? [...source.centerBLonLat] : null,
      addressA: source.addressA ?? filters.addressA ?? null,
      addressB: source.addressB ?? filters.addressB ?? null,
      adminLevel: source.adminLevel ?? filters.adminLevel,
      per10k: source.per10k ?? filters.per10k,
      coverageDate: source.coverageMax || null,
      overlayTractsLines: source.overlayTractsLines,
    };
  }
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
    coverageDate: source.coverageMax || null,
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
    async refresh({ signal: ownerSignal, scope = 'all', snapshot: suppliedSnapshot } = {}) {
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
      const snapshot = suppliedSnapshot ?? readSnapshot();
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
