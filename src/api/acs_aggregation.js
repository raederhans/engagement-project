import { normalizeAcsVreSnapshot, aggregateAcsTractPopulation } from '../data/acs_aggregation.js';
import { fetchJson } from '../utils/http.js';

const ACS_VRE_LOCAL_URL = new URL('../data/acs_vre_b01003_2024_pa101.json', import.meta.url).href;

function reportSource(callback, metadata) {
  if (typeof callback !== 'function') return;
  try { callback(metadata); } catch {}
}

export async function fetchAcsPopulationVreSnapshot({
  localUrl = ACS_VRE_LOCAL_URL,
  fetchJsonImpl = fetchJson,
  signal,
  onSourceResolved,
} = {}) {
  try {
    const payload = await fetchJsonImpl(localUrl, {
      timeoutMs: 8000,
      retries: 1,
      cacheTTL: 0,
      signal,
    });
    const snapshot = normalizeAcsVreSnapshot(payload);
    reportSource(onSourceResolved, {
      dataset: 'acs-tract-aggregation-vre',
      kind: 'fallback',
      provider: 'Bundled U.S. Census Bureau VRE snapshot',
      url: localUrl,
      vintage: snapshot.manifest.release,
      asOf: snapshot.manifest.period,
      retrievedAt: snapshot.manifest.retrievedAt,
      cacheHit: false,
    });
    return { status: 'available', snapshot, error: null };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw signal?.reason ?? error;
    return {
      status: 'unavailable',
      snapshot: null,
      error: error instanceof Error ? error.message : 'ACS VRE source is unavailable.',
    };
  }
}

export async function fetchAcsTractPopulationAggregate({
  selections,
  loadSnapshot = fetchAcsPopulationVreSnapshot,
  signal,
  onSourceResolved,
} = {}) {
  const source = await loadSnapshot({ signal, onSourceResolved });
  if (source?.status !== 'available' || !source.snapshot) {
    return { status: 'unavailable', reason: 'vre-source-unavailable', result: null };
  }
  return aggregateAcsTractPopulation({ selections, snapshot: source.snapshot });
}
