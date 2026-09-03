export function planCrimeBoundaryWarmup({
  adminLevel = 'districts',
  overlayTractsLines = false,
} = {}, scope = 'all') {
  if (scope !== 'all' && scope !== 'boundary') return [];
  if (adminLevel === 'tracts') return ['tracts'];
  return overlayTractsLines ? ['districts', 'tracts'] : ['districts'];
}

export async function warmCrimeBoundaryResources({
  snapshot,
  scope = 'all',
  signal,
  loadDistricts,
  loadTracts,
} = {}) {
  const kinds = planCrimeBoundaryWarmup(snapshot, scope);
  return Promise.all(kinds.map((kind) => (
    kind === 'tracts'
      ? loadTracts?.({ signal })
      : loadDistricts?.({ signal })
  )));
}

export async function prepareCrimeRefresh({ loadCoverage, warmBoundary } = {}) {
  const coverageTask = Promise.resolve().then(loadCoverage);
  const boundaryTask = Promise.resolve()
    .then(warmBoundary)
    .then(
      (value) => ({ status: 'ready', value }),
      (error) => ({ status: 'failed', error }),
    );
  const [coverage, boundary] = await Promise.all([coverageTask, boundaryTask]);
  return { coverage, boundary };
}

export async function ensureVisibleTractOverlay({
  visible,
  trySetVisible,
  loadBoundary,
} = {}) {
  if (trySetVisible?.(visible)) return true;
  if (!visible) return false;
  const result = await loadBoundary?.();
  if (!['live', 'partial'].includes(result?.status)) return false;
  return Boolean(trySetVisible?.(true));
}
