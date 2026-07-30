function isAbortError(error) {
  return error?.name === 'AbortError';
}

export function readCrimeSnapshot(source) {
  const filters = source.getFilters();
  return {
    ...filters,
    types: [...(filters.types || [])],
    drilldownCodes: [...(filters.drilldownCodes || [])],
    center3857: filters.center3857 ? [...filters.center3857] : null,
    centerLonLat: source.centerLonLat ? [...source.centerLonLat] : null,
    adminLevel: source.adminLevel,
    per10k: source.per10k,
    timeWindowMonths: source.timeWindowMonths,
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
    async refresh() {
      if (!active) return { applied: false };

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

      try {
        const result = await runRefresh(snapshot, context);
        return context.isCurrent() ? (result ?? { applied: true }) : { applied: false };
      } catch (error) {
        if (!context.isCurrent() || isAbortError(error)) return { applied: false };
        throw error;
      } finally {
        if (generation === requestGeneration) controller = null;
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
