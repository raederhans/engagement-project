import { initCoverageAndDefaults, store } from '../state/store.js';
import { crimeSelectionKey } from '../state/crime_view_state.js';
import {
  createCrimeRefreshOwner,
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

async function fetchListOverview(snapshot, { signal } = {}) {
  const crime = await import('../api/crime.js');
  const common = {
    start: snapshot.start,
    end: snapshot.end,
    types: snapshot.types,
    signal,
  };
  if (snapshot.queryMode === 'buffer' && snapshot.center3857) {
    return crime.fetchTopTypesBuffer({
      ...common,
      center3857: snapshot.center3857,
      radiusM: snapshot.radiusM,
      limit: 1000,
    });
  }
  if (snapshot.queryMode === 'district' && snapshot.selectedDistrictCode) {
    return crime.fetchTopTypesByDistrict({
      ...common,
      dc_dist: snapshot.selectedDistrictCode,
      limit: 1000,
    });
  }
  if (snapshot.queryMode === 'tract' && snapshot.selectedTractGEOID) {
    return crime.fetchTopTypesTract({
      ...common,
      tractGEOID: snapshot.selectedTractGEOID,
      limit: 1000,
    });
  }
  return crime.fetchOffenseCountsCity({
    ...common,
    drilldownCodes: snapshot.drilldownCodes,
  });
}

export function createCrimeListController({
  readSnapshot = () => readCrimeSnapshot(store),
  readFilterState = () => store,
  initializeCoverage = initCoverageAndDefaults,
  fetchOverview = fetchListOverview,
  fetchIncidents = fetchListIncidents,
  updateSummary = async (snapshot, options) => {
    if (snapshot.queryMode === 'district' || snapshot.queryMode === 'tract') {
      const { runPublicAreaSummary } = await import('./public_area_summary.js');
      return runPublicAreaSummary(snapshot, options);
    }
    const { updateCompare } = await import('../compare/card.js');
    return updateCompare(snapshot, options);
  },
  updateCharts = async (snapshot, options) => {
    const { updateAllCharts } = await import('../charts/index.js');
    return updateAllCharts(snapshot, options);
  },
  createProvenance = createCrimeRefreshProvenance,
  view = null,
  resultMeta = {},
  onQuickFilter = () => {},
  onCoverageChange = () => {},
  onDataScopeChange = () => {},
  now = () => new Date().toISOString(),
} = {}) {
  const listView = view || createCrimeListResultsView({
    resultMeta,
    readFilterState,
    onQuickFilter,
  });
  let active = true;
  let initialized = false;
  const provenanceByScope = new Map();

  const runRefresh = async (snapshot, { signal, isCurrent, scope = 'all' }) => {
    if (!active || !isCurrent()) return { status: 'superseded' };
    const hasSelection = Boolean(crimeSelectionKey(snapshot));
    listView?.setSelectionAvailable?.(hasSelection);
    const requested = scope === 'all'
      ? (hasSelection ? ['overview', 'incidents', 'summary', 'charts'] : ['overview'])
      : [scope];
    if (!hasSelection && scope !== 'all') {
      for (const name of requested) listView?.clear?.(name);
      return { status: 'idle', succeeded: [], failed: [] };
    }

    const sources = [{ ...CARTO_INCIDENT_SOURCE, asOf: snapshot.coverageDate || null }];
    const entries = await Promise.all(requested.map(async (name) => {
      const token = listView?.loading?.(name);
      try {
        const options = { signal, shouldApply: isCurrent };
        const rawValue = name === 'overview'
          ? await fetchOverview(snapshot, options)
          : name === 'incidents'
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
          : name === 'overview'
            ? { applied: true, status: 'success', rows: rawValue?.rows || [] }
            : rawValue;
        if (!isCurrent()) return { name, result: { status: 'fulfilled', value: { applied: false } }, token };
        if (!value || value.applied === false || value.status === 'failed') {
          const error = new Error(`${name} result is unavailable.`);
          listView?.failed?.(name, error);
          return { name, result: { status: 'rejected', reason: error }, token };
        }
        if (name === 'overview') listView?.overview?.(value);
        if (name === 'incidents') listView?.incidents?.(value);
        const provenance = name === 'overview' ? null : createProvenance({
          name,
          value,
          snapshot,
          sources: [...sources, ...(value.sourceLineage || [])],
          coverageMax: snapshot.coverageDate,
          generatedAt: now(),
        });
        if (provenance) provenanceByScope.set(name, provenance);
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
      if (!initialized) await this.initialize();
      const snapshot = readSnapshot();
      listView?.syncFilters?.(readFilterState());
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
