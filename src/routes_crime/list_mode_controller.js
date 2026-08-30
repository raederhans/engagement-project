import { initCoverageAndDefaults, store } from '../state/store.js';
import { crimeSelectionKey } from '../state/crime_view_state.js';
import {
  createCrimeRefreshOwner,
  isPrivateCrimeAnalysisSnapshot,
  privateCrimeUnavailableResult,
  readCrimeSnapshot,
} from './crime_refresh_owner.js';
import {
  classifyCrimeRefreshJobs,
  createCrimeRefreshProvenance,
} from '../ui/crime_result_meta.js';
import { describeCrimeDataScope } from '../ui/data_scope.js';
import { createCrimeListResultsView } from '../ui/crime_list_results.js';

const CARTO_INCIDENT_SOURCE = Object.freeze({
  dataset: 'incidents',
  kind: 'live',
  source: 'CARTO',
  asOf: null,
});

async function fetchListIncidents(snapshot, { signal } = {}) {
  const { fetchPoints } = await import('../api/crime.js');
  let tractGeometry;
  if (snapshot.queryMode === 'tract' && snapshot.selectedTractGEOID) {
    const { resolveSelectedTractGeometry } = await import('../charts/index.js');
    tractGeometry = await resolveSelectedTractGeometry({
      selectedTractGEOID: snapshot.selectedTractGEOID,
      signal,
    });
  }
  const geo = await fetchPoints({
    start: snapshot.start,
    end: snapshot.end,
    types: snapshot.types,
    center3857: snapshot.queryMode === 'buffer' ? snapshot.center3857 : undefined,
    radiusM: snapshot.queryMode === 'buffer' ? snapshot.radiusM : undefined,
    dc_dist: snapshot.queryMode === 'district' ? snapshot.selectedDistrictCode : undefined,
    tractGeometry,
    signal,
  });
  const count = Array.isArray(geo?.features) ? geo.features.length : 0;
  return { applied: true, status: 'success', geo, count };
}

export function createCrimeListController({
  readSnapshot = () => readCrimeSnapshot(store),
  initializeCoverage = initCoverageAndDefaults,
  fetchIncidents = fetchListIncidents,
  updateSummary = async (snapshot, options) => {
    const { runPublicAreaSummary } = await import('./public_area_summary.js');
    return runPublicAreaSummary(snapshot, options);
  },
  updateCharts = async (snapshot, options) => {
    const { updateAllCharts } = await import('../charts/index.js');
    return updateAllCharts(snapshot, options);
  },
  createProvenance = createCrimeRefreshProvenance,
  view = null,
  resultMeta = {},
  onCoverageChange = () => {},
  onDataScopeChange = () => {},
  now = () => new Date().toISOString(),
} = {}) {
  const listView = view || createCrimeListResultsView({ resultMeta });
  let active = true;
  let initialized = false;
  const provenanceByScope = new Map();

  const runRefresh = async (snapshot, { signal, isCurrent, scope = 'all' }) => {
    if (!active || !isCurrent()) return { status: 'superseded' };
    const requested = scope === 'all' ? ['incidents', 'summary', 'charts'] : [scope];
    if (isPrivateCrimeAnalysisSnapshot(snapshot)) {
      for (const name of requested) listView?.unavailable?.(name);
      return privateCrimeUnavailableResult();
    }
    if (!crimeSelectionKey(snapshot)) {
      for (const name of requested) listView?.clear?.(name);
      return { status: 'idle', succeeded: [], failed: [] };
    }

    const sources = [{ ...CARTO_INCIDENT_SOURCE, asOf: snapshot.coverageDate || null }];
    const entries = await Promise.all(requested.map(async (name) => {
      const token = listView?.loading?.(name);
      try {
        const options = { signal, shouldApply: isCurrent };
        const rawValue = name === 'incidents'
          ? await fetchIncidents(snapshot, options)
          : name === 'summary'
            ? await updateSummary(snapshot, options)
            : await updateCharts(snapshot, options);
        const value = name === 'incidents' && rawValue?.type === 'FeatureCollection'
          ? {
              applied: true,
              status: 'success',
              geo: rawValue,
              count: Array.isArray(rawValue.features) ? rawValue.features.length : 0,
            }
          : rawValue;
        if (!isCurrent()) return { name, result: { status: 'fulfilled', value: { applied: false } }, token };
        if (!value || value.applied === false || value.status === 'failed') {
          const error = new Error(`${name} result is unavailable.`);
          listView?.failed?.(name, error);
          return { name, result: { status: 'rejected', reason: error }, token };
        }
        if (name === 'incidents') listView?.incidents?.(value);
        const provenance = createProvenance({
          name,
          value,
          snapshot,
          sources: [...sources, ...(value.sourceLineage || [])],
          coverageMax: snapshot.coverageDate,
          generatedAt: now(),
        });
        provenanceByScope.set(name, provenance);
        listView?.ready?.(name, provenance, value.status === 'partial' ? 'partial' : 'current');
        return { name, result: { status: 'fulfilled', value }, token };
      } catch (error) {
        if (!isCurrent() || signal.aborted || error?.name === 'AbortError') {
          return { name, result: { status: 'fulfilled', value: { applied: false } }, token };
        }
        listView?.failed?.(name, error);
        return { name, result: { status: 'rejected', reason: error }, token };
      }
    }));
    if (!isCurrent()) return { status: 'superseded', succeeded: [], failed: [] };
    const outcome = classifyCrimeRefreshJobs(entries);
    if (outcome.status === 'live' || outcome.status === 'partial') {
      onDataScopeChange(describeCrimeDataScope({
        coverageMax: snapshot.coverageDate,
        sources,
      }));
      listView?.focusResults?.();
    }
    return outcome;
  };

  const refreshOwner = createCrimeRefreshOwner({ readSnapshot, runRefresh });

  return Object.freeze({
    async initialize() {
      if (initialized) return true;
      try {
        await initializeCoverage();
        initialized = true;
        onCoverageChange();
        return true;
      } catch (error) {
        onCoverageChange(error);
        throw error;
      }
    },
    async requestRefresh(options = {}) {
      let snapshot;
      if (initialized) {
        snapshot = readSnapshot();
      } else {
        try {
          snapshot = readSnapshot();
        } catch {
          // Coverage initialization owns the public fallback below.
        }
        if (!isPrivateCrimeAnalysisSnapshot(snapshot)) {
          await this.initialize();
          snapshot = readSnapshot();
        }
      }
      return refreshOwner.refresh({ ...options, snapshot });
    },
    setActive(next) {
      active = Boolean(next);
      refreshOwner.setActive(active);
    },
    getCurrentProvenance() {
      return Object.fromEntries(provenanceByScope);
    },
    destroy() {
      active = false;
      refreshOwner.destroy();
      listView?.destroy?.();
    },
  });
}
