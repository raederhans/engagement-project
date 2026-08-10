import { getDistrictsMerged } from '../map/choropleth_districts.js';
import { renderDistrictChoropleth } from '../map/render_choropleth.js';
import { attachHover } from '../map/ui_tooltip.js';
import { wirePoints } from '../map/wire_points.js';
import { store, initCoverageAndDefaults } from '../state/store.js';
import { createCrimeStatePort } from '../state/crime_state_port.js';
import {
  crimeSelectionKey,
  hasActiveIncidentSelection,
  normalizeCrimeRefreshScope,
  planCrimeRefresh,
  resolveCrimeLayerVisibility,
  resolveCrimePrimaryLayer,
} from '../state/crime_view_state.js';
import {
  clearCurrentComparison,
  setCurrentAnalysisSelection,
  updateCompare,
} from '../compare/card.js';
import { attachDistrictPopup } from '../map/ui_popup_district.js';
import { getTractsMerged } from '../map/tracts_view.js';
import { hideTractsOutlineBanner, renderTractsChoropleth } from '../map/render_choropleth_tracts.js';
import {
  upsertSelectedDistrict,
  clearSelectedDistrict,
  upsertSelectedTract,
  clearSelectedTract,
} from '../map/selection_layers.js';
import { clearBufferA, clearBufferB, upsertBufferA, upsertBufferB } from '../map/buffer_overlay.js';
import {
  hideLegend,
  initLegend,
  showLegend,
  updateLegend,
} from '../map/legend.js';
import { buildOffenseHighlights } from '../utils/types.js';
import { makePalette } from '../utils/classify.js';
import { upsertTractsOutline } from '../map/tracts_layers.js';
import { fetchTractsCachedFirst } from '../api/boundaries.js';
import { createMapMarker, localizeMapMarker } from '../map/initMap.js';
import { tractFeatureGEOID } from '../utils/geoids.js';
import {
  createCrimeRefreshOwner,
  observeCrimeRefreshJob,
  readCrimeSnapshot,
} from './crime_refresh_owner.js';
import { createCrimeMapSelectionCoordinator } from './crime_map_selection_coordinator.js';
import { setTranslatedText, t } from '../i18n/index.js';
import {
  bufferBounds,
  fitBoundsWithPanel,
  geometryBounds,
} from '../map/camera_fit.js';
import { describeCrimeDataScope } from '../ui/data_scope.js';
import {
  classifyCrimeRefreshJobs,
  createCrimeRefreshProvenance,
  normalizeCrimeRefreshResult,
} from '../ui/crime_result_meta.js';

export {
  crimeSelectionKey,
  hasActiveIncidentSelection,
  normalizeCrimeRefreshScope,
  planCrimeRefresh,
  resolveCrimeLayerVisibility,
  resolveCrimePrimaryLayer,
} from '../state/crime_view_state.js';

const CRIME_LAYER_IDS = [
  'districts-fill',
  'districts-line',
  'districts-label',
  'districts-selected-fill',
  'districts-selected-line',
  'tracts-fill',
  'tracts-outline-line',
  'tracts-selected-fill',
  'tracts-selected-line',
  'clusters',
  'cluster-count',
  'unclustered',
  'buffer-a-fill',
  'buffer-a-line',
  'buffer-b-fill',
  'buffer-b-line',
];

function canonicalCrimeSource(metadata) {
  if (!metadata?.dataset) return null;
  const dataset = ({
    'police-districts': 'districts',
    'census-tract-boundaries': 'tracts',
    'census-tract-statistics': 'demographics',
  })[metadata.dataset] || metadata.dataset;
  const source = metadata.provider || metadata.source;
  if (!source || !['live', 'fallback'].includes(metadata.kind)) return null;
  return {
    dataset,
    kind: metadata.kind,
    source,
    asOf: metadata.asOf || null,
  };
}

function mergeCrimeSources(...collections) {
  const merged = new Map();
  for (const metadata of collections.flat()) {
    const source = canonicalCrimeSource(metadata);
    if (!source) continue;
    merged.set(JSON.stringify(source), source);
  }
  return [...merged.values()];
}

let chartsModulePromise;

function loadChartsModule() {
  return chartsModulePromise ||= import('../charts/index.js');
}

async function updateCharts(filters, options) {
  const { updateAllCharts } = await loadChartsModule();
  return updateAllCharts(filters, options);
}

async function clearLoadedCharts() {
  if (!chartsModulePromise) return false;
  const { clearCrimeCharts } = await chartsModulePromise;
  return clearCrimeCharts();
}

function waitForMapReady(map) {
  if (map.loaded?.() || map.isStyleLoaded?.()) return Promise.resolve();
  return new Promise((resolve) => map.once('load', resolve));
}

function captureCrimeSnapshot() {
  return readCrimeSnapshot(store);
}

export function reconcileBufferOverlays({
  map,
  queryMode,
  centerLonLat,
  centerBLonLat,
  markerA = null,
  markerB = null,
  clearA = clearBufferA,
  clearB = clearBufferB,
} = {}) {
  if (queryMode !== 'buffer' || !centerLonLat) {
    markerA?.remove();
    markerA = null;
    clearA(map);
  }
  if (queryMode !== 'buffer' || !centerBLonLat) {
    markerB?.remove();
    markerB = null;
    clearB(map);
  }
  return { markerA, markerB };
}

export function classifyDistrictBoundaryRefresh({
  featureCount = 0,
  overlayRequested = false,
  outlineResult = { applied: true, status: 'success' },
} = {}) {
  if (outlineResult?.applied === false || outlineResult?.status === 'superseded') {
    return { applied: false, status: 'superseded' };
  }
  if (overlayRequested && outlineResult?.status === 'failed') {
    return {
      applied: true,
      status: 'partial',
      featureCount,
      succeeded: ['districts'],
      failed: ['tracts-outline'],
    };
  }
  return { applied: true, status: 'success', featureCount };
}

export async function loadTractOutlineResult({
  signal,
  isCurrent = () => true,
  onSourceResolved,
  fetchTracts = fetchTractsCachedFirst,
} = {}) {
  try {
    const data = await fetchTracts({ signal, onSourceResolved });
    if (!isCurrent()) return { applied: false, status: 'superseded' };
    return {
      applied: true,
      status: 'success',
      featureCount: data?.features?.length || 0,
      data,
    };
  } catch (error) {
    if (!isCurrent() || signal?.aborted || error?.name === 'AbortError') {
      return { applied: false, status: 'superseded' };
    }
    console.warn('Failed to load tract outlines:', error);
    return {
      applied: true,
      status: 'failed',
      error: String(error?.message || error),
    };
  }
}

function unionBounds(...values) {
  const valid = values.filter(Boolean);
  if (valid.length === 0) return null;
  return [
    [Math.min(...valid.map((bounds) => bounds[0][0])), Math.min(...valid.map((bounds) => bounds[0][1]))],
    [Math.max(...valid.map((bounds) => bounds[1][0])), Math.max(...valid.map((bounds) => bounds[1][1]))],
  ];
}

export function createCrimeSynchronousActions({
  map,
  isControllerActive,
  isModeActive,
  readBuffer,
  upsertBuffer = upsertBufferA,
}) {
  const ownsMap = () => Boolean(isControllerActive() && isModeActive());
  return Object.freeze({
    updateBuffer() {
      if (!ownsMap()) return false;
      const { centerLonLat, radiusM } = readBuffer();
      if (!centerLonLat) return false;
      upsertBuffer(map, { centerLonLat, radiusM });
      return true;
    },
    setTractsOverlayVisible(visible) {
      if (!ownsMap() || !map.getLayer('tracts-outline-line')) return false;
      map.setLayoutProperty(
        'tracts-outline-line',
        'visibility',
        visible ? 'visible' : 'none',
      );
      return true;
    },
  });
}

export async function initCrimeMode(map, {
  isActive = () => true,
  onCoverageChange = () => {},
  onPointChange = () => {},
  onSelectionChange = () => {},
  onDataScopeChange = () => {},
  resultMeta = {},
  taskFocus = null,
  presetPorts = null,
  statePort = null,
  now = () => new Date().toISOString(),
} = {}) {
  await import('../i18n/crime_offense_catalog.js');
  if (taskFocus?.mount) {
    void import('./task_focus_controller.js')
      .then(({ default: initTaskFocus }) => initTaskFocus(taskFocus, presetPorts))
      .catch((error) => console.warn('Task focus failed:', error));
  }
  const mapReady = waitForMapReady(map);
  let markerA = null;
  let markerB = null;
  let active = true;
  let hoverCleanup = null;
  let popupCleanup = null;
  let currentTractSnapshotProvenance = null;
  let districtData = null;
  let tractData = null;
  let lastCameraSelectionKey = null;
  const crimeState = statePort || createCrimeStatePort({ state: store });

  try {
    await initCoverageAndDefaults();
    onCoverageChange();
  } catch (error) {
    onCoverageChange();
    throw error;
  }

  const pointsController = wirePoints(map, {
    getFilters: captureCrimeSnapshot,
    shouldRefresh: hasActiveIncidentSelection,
    autoRefresh: false,
  });
  const refreshOwner = createCrimeRefreshOwner({
    readSnapshot: captureCrimeSnapshot,
    runRefresh: refreshAll,
  });
  const synchronousActions = createCrimeSynchronousActions({
    map,
    isControllerActive: () => active,
    isModeActive: isActive,
    readBuffer: () => ({ centerLonLat: store.centerLonLat, radiusM: store.radius }),
  });

  function publishCurrentSelection(snapshot = captureCrimeSnapshot(), { origin = 'sync' } = {}) {
    const key = crimeSelectionKey(snapshot);
    setCurrentAnalysisSelection(document.getElementById('compare-card'), key);
    onSelectionChange(key, { origin });
    return key;
  }

  await mapReady;
  if (!isActive()) {
    active = false;
    refreshOwner.setActive(false);
    pointsController.setActive(false);
  } else {
    initLegend();
  }

  async function refreshAll(snapshot, { signal, isCurrent, scope = 'all' }) {
    if (!active || !isActive() || !isCurrent()) return { applied: false };
    const plan = planCrimeRefresh(snapshot, scope);
    if (!plan.valid) return { status: 'failed', error: `Unknown Crime result scope: ${scope}` };
    const requested = new Set(plan.requested);
    const incidentView = requested.has('incidents')
      && resolveCrimePrimaryLayer(snapshot) === 'incidents';
    if (incidentView) reconcileCrimeLegend(snapshot);
    else hideLegend();
    if (plan.inactive.includes('incidents')) {
      pointsController.clear();
      resultMeta.incidents?.clear();
    }
    if (plan.inactive.includes('charts')) {
      resultMeta.charts?.clear();
      await clearLoadedCharts();
    }
    if (plan.inactive.includes('summary')) {
      resultMeta.summary?.clear();
      clearCurrentComparison();
    }
    if (scope !== 'all' && requested.size === 0) {
      return { status: 'failed', error: 'Select an analysis target before retrying this result.' };
    }
    if (requested.has('boundary')) currentTractSnapshotProvenance = null;
    const {
      start,
      end,
      types,
      queryMode,
      selectedDistrictCode,
      selectedTractGEOID,
      adminLevel,
      per10k,
      center3857,
      centerLonLat,
      centerB3857,
      centerBLonLat,
      addressA,
      addressB,
      radiusM,
    } = snapshot;
    const resolvedSources = new Map();
    const collectResolvedSource = (metadata) => {
      if (!isCurrent()) return;
      const source = canonicalCrimeSource(metadata);
      if (source) resolvedSources.set(source.dataset, source);
    };
    resolvedSources.set('incidents', {
      dataset: 'incidents',
      kind: 'live',
      source: 'CARTO',
      asOf: store.coverageMax || null,
    });

    const provenanceFor = (name, value) => createCrimeRefreshProvenance({
      name,
      value,
      snapshot,
      sources: mergeCrimeSources(
        [...resolvedSources.values()],
        value?.sourceLineage || [],
      ),
      coverageMax: store.coverageMax,
      generatedAt: now(),
    });
    const publishResult = ({ name, result, token }) => {
      const presenter = resultMeta[name];
      if (!presenter) return;
      if (result.status === 'rejected') {
        presenter.failed(result.reason, { token });
        console.warn(`${name} refresh failed:`, result.reason);
        return;
      }
      const value = result.value;
      if (value?.applied === false || value?.status === 'superseded') {
        presenter.cancel(token);
        return;
      }
      if (!value || value.status === 'failed') {
        presenter.failed(new Error(value?.error || `${name} query failed`), { token });
        return;
      }
      try {
        presenter.ready(provenanceFor(name, value), {
          token,
          availability: value.status === 'partial' ? 'partial' : 'current',
        });
      } catch (error) {
        presenter.failed(error, { token });
      }
    };
    const entries = [];
    const jobs = [];
    const startResultJob = (name, promise) => {
      const presenter = resultMeta[name];
      const token = presenter?.loading();
      const cancelPresenter = () => presenter?.cancel(token);
      signal.addEventListener('abort', cancelPresenter, { once: true });
      const trackedPromise = observeCrimeRefreshJob({ name, promise, token }, {
        isCurrent,
        onSettled(entry) {
          signal.removeEventListener('abort', cancelPresenter);
          entries.push(entry);
          publishResult(entry);
        },
        onSuperseded() {
          signal.removeEventListener('abort', cancelPresenter);
          cancelPresenter();
        },
      });
      jobs.push({ name, promise: trackedPromise });
      return trackedPromise;
    };

    syncComparisonOverlays({ centerLonLat, centerBLonLat, radiusM, queryMode });
    publishCurrentSelection(snapshot);
    const bufferCamera = requested.has('boundary') && queryMode === 'buffer'
      ? fitCurrentSelection({ snapshot })
      : Promise.resolve(false);

    if (requested.has('boundary')) {
      startResultJob('boundary', (async () => {
        let nextTractSnapshotProvenance = null;
        let featureCount = 0;
        let boundaryOutcome = null;
        if (adminLevel === 'tracts') {
          const merged = await getTractsMerged({
            per10k,
            windowStart: start,
            windowEnd: end,
            types,
            signal,
            onSourceResolved: collectResolvedSource,
          });
          if (!isCurrent()) return { applied: false };
          tractData = merged.geojson || merged;
          featureCount = tractData?.features?.length || 0;
          renderTractsChoropleth(map, merged);
          nextTractSnapshotProvenance = merged.provenance || null;
          reconcileCrimeLayerVisibility(map, snapshot);
          if (queryMode === 'tract' && selectedTractGEOID) {
            upsertSelectedTract(map, selectedTractGEOID);
            await fitCurrentSelection({ snapshot });
          } else {
            clearSelectedTract(map);
          }
          selectionCoordinator.wireTractSelection();
          boundaryOutcome = { applied: true, status: 'success', featureCount };
        } else {
          const [merged, outlineResult] = await Promise.all([
            getDistrictsMerged({
              start,
              end,
              types,
              signal,
              onSourceResolved: collectResolvedSource,
            }),
            ensureTractOutline({ signal, isCurrent, onSourceResolved: collectResolvedSource }),
          ]);
          if (!isCurrent()) return { applied: false };
          districtData = merged;
          featureCount = merged?.features?.length || 0;
          renderDistrictChoropleth(map, merged);
          reconcileCrimeLayerVisibility(map, snapshot);
          ensureDistrictInteractions();
          if (queryMode === 'district' && selectedDistrictCode) {
            upsertSelectedDistrict(map, selectedDistrictCode);
            await fitCurrentSelection({ snapshot });
          } else {
            clearSelectedDistrict(map);
          }
          selectionCoordinator.wireDistrictSelection();
          boundaryOutcome = classifyDistrictBoundaryRefresh({
            featureCount,
            overlayRequested: Boolean(snapshot.overlayTractsLines),
            outlineResult,
          });
        }
        if (nextTractSnapshotProvenance) {
          resolvedSources.set('tract-crime', {
            dataset: 'tract-crime',
            kind: 'fallback',
            source: 'Validated tract snapshot',
            asOf: nextTractSnapshotProvenance.coverageDate,
          });
        }
        if (isCurrent()) currentTractSnapshotProvenance = nextTractSnapshotProvenance;
        return boundaryOutcome;
      })());
    }

    if (!isCurrent()) return { applied: false };
    await bufferCamera;
    if (!isCurrent()) return { applied: false };
    if (requested.has('incidents') && hasActiveIncidentSelection(snapshot)) {
      startResultJob(
        'incidents',
        pointsController.refresh(snapshot, { signal, shouldApply: isCurrent }),
      );
    } else if (requested.has('incidents')) {
      pointsController.clear();
    }
    if (requested.has('charts')) {
      startResultJob('charts', updateCharts(snapshot, { signal, shouldApply: isCurrent }));
    }
    if (requested.has('summary')) {
      const summaryOptions = {
        signal,
        shouldApply: isCurrent,
        onSourceResolved: collectResolvedSource,
      };
      startResultJob(
        'summary',
        queryMode === 'tract'
          ? loadChartsModule().then(({ runTractSummary }) => runTractSummary({
              start,
              end,
              types,
              selectedTractGEOID,
              per10k,
              coverageDate: store.coverageMax,
            }, summaryOptions, updateCompare))
          : updateCompare({
              start,
              end,
              types,
              center3857,
              centerB3857,
              addressA,
              addressB,
              radiusM,
              queryMode,
              selectedTractGEOID,
              adminLevel,
              per10k,
              coverageDate: store.coverageMax,
            }, summaryOptions),
      );
    }
    await Promise.allSettled(jobs.map(({ promise }) => promise));
    if (!isCurrent()) return { applied: false };
    if (incidentView) reconcileCrimeLegend(snapshot);
    const outcome = classifyCrimeRefreshJobs(entries);
    if ((outcome.status === 'live' || outcome.status === 'partial') && scope === 'all') {
      const relevantDatasets = new Set(['incidents']);
      if (adminLevel === 'tracts') {
        relevantDatasets.add('tracts');
        relevantDatasets.add('demographics');
      } else {
        relevantDatasets.add('districts');
        if (store.overlayTractsLines) relevantDatasets.add('tracts');
      }
      onDataScopeChange(describeCrimeDataScope({
        coverageMax: store.coverageMax,
        sources: [...resolvedSources.values()]
          .filter((source) => relevantDatasets.has(source.dataset)),
      }));
    }
    return outcome;
  }

  async function requestRefresh({ signal, scope = 'all' } = {}) {
    if (!normalizeCrimeRefreshScope(scope)) {
      return { status: 'failed', error: `Unknown Crime result scope: ${scope}` };
    }
    try {
      const result = await refreshOwner.refresh({ signal, scope });
      if (result?.status === 'busy') return result;
      return normalizeCrimeRefreshResult(result);
    } catch (error) {
      console.warn('Crime refresh failed:', error);
      return { status: 'failed', error: String(error?.message || error) };
    }
  }

  const selectionCoordinator = createCrimeMapSelectionCoordinator({
    map,
    state: store,
    statePort: crimeState,
    isActive: () => active,
    readTractId: tractFeatureGEOID,
    translate: t,
    onTractSelected({ feature, geoid }) {
      publishCurrentSelection(undefined, { origin: 'map' });
      upsertSelectedTract(map, geoid);
      removeBufferOverlay(map);
      void fitCurrentSelection({ feature, force: true }).then(() => requestRefresh());
    },
    onDistrictSelected({ feature, code }) {
      publishCurrentSelection(undefined, { origin: 'map' });
      upsertSelectedDistrict(map, code);
      removeBufferOverlay(map);
      void fitCurrentSelection({ feature, force: true }).then(() => requestRefresh());
    },
    onPointSelected({ target }) {
      publishCurrentSelection(undefined, { origin: 'map' });
      onPointChange(target);
      syncComparisonOverlays({
        centerLonLat: store.centerLonLat,
        centerBLonLat: store.centerBLonLat,
        radiusM: store.radius,
        queryMode: store.queryMode,
      });
    },
    onPointSelectionEnded() {
      for (const id of ['useCenterBtn', 'usePointBBtn']) {
        const button = document.getElementById(id);
        if (button) setTranslatedText(button, 'crime.pickOnMap');
      }
      const hint = document.getElementById('useMapHint');
      if (hint) hint.style.display = 'none';
      document.body.style.cursor = '';
      void fitCurrentSelection({ force: true }).then(() => requestRefresh());
    },
  });

  function ensureDistrictInteractions() {
    if (!hoverCleanup) hoverCleanup = attachHover(map, 'districts-fill');
    if (!popupCleanup) popupCleanup = attachDistrictPopup(map, 'districts-fill');
  }

  function syncComparisonOverlays({ centerLonLat, centerBLonLat, radiusM, queryMode }) {
    ({ markerA, markerB } = reconcileBufferOverlays({
      map,
      queryMode,
      centerLonLat,
      centerBLonLat,
      markerA,
      markerB,
    }));
    if (queryMode !== 'buffer') return;
    if (centerLonLat) {
      markerA ||= createMapMarker({ color: '#c86b00', className: 'analysis-marker analysis-marker--a' });
      markerA.setLngLat(centerLonLat).addTo(map);
      localizeMapMarker(markerA, { labelKey: 'map.markerA' });
      upsertBufferA(map, { centerLonLat, radiusM });
    }
    if (centerBLonLat) {
      markerB ||= createMapMarker({ color: '#0a6c74', className: 'analysis-marker analysis-marker--b' });
      markerB.setLngLat(centerBLonLat).addTo(map);
      localizeMapMarker(markerB, { labelKey: 'map.markerB' });
      upsertBufferB(map, { centerLonLat: centerBLonLat, radiusM });
    }
  }

  async function ensureTractOutline({ signal, isCurrent, onSourceResolved }) {
    const result = await loadTractOutlineResult({ signal, isCurrent, onSourceResolved });
    if (result.status === 'success' && active && isActive() && result.data?.features?.length) {
      upsertTractsOutline(map, result.data);
    }
    const { data: _data, ...outcome } = result;
    return outcome;
  }

  async function fitCurrentSelection({
    snapshot = captureCrimeSnapshot(),
    feature = null,
    force = false,
  } = {}) {
    if (!active || !isActive()) return false;
    const key = crimeSelectionKey(snapshot);
    publishCurrentSelection(snapshot);
    if (!key || (!force && key === lastCameraSelectionKey)) return false;
    let bounds = null;
    if (snapshot.queryMode === 'buffer') {
      bounds = unionBounds(
        bufferBounds(snapshot.centerLonLat, snapshot.radiusM),
        bufferBounds(snapshot.centerBLonLat, snapshot.radiusM),
      );
    } else if (snapshot.queryMode === 'district') {
      const selected = feature || districtData?.features?.find((candidate) => (
        String(candidate?.properties?.DIST_NUMC || '').padStart(2, '0')
          === String(snapshot.selectedDistrictCode || '').padStart(2, '0')
      ));
      bounds = geometryBounds(selected);
    } else if (snapshot.queryMode === 'tract') {
      const selected = feature || tractData?.features?.find((candidate) => (
        tractFeatureGEOID(candidate) === snapshot.selectedTractGEOID
      ));
      bounds = geometryBounds(selected);
    }
    if (!bounds) return false;
    lastCameraSelectionKey = key;
    const completed = await pointsController.runProgrammaticMapMove(() => {
      fitBoundsWithPanel(map, bounds);
    });
    if (!completed && lastCameraSelectionKey === key) lastCameraSelectionKey = null;
    return completed;
  }

  return {
    requestRefresh,
    requestRouteCorridor,
    clearRouteCorridor,
    runProgrammaticMapMove: pointsController.runProgrammaticMapMove,
    fitCurrentSelection,
    updateBuffer: synchronousActions.updateBuffer,
    setTractsOverlayVisible: synchronousActions.setTractsOverlayVisible,
    getCurrentProvenance() {
      return currentTractSnapshotProvenance
        ? { tractSnapshot: structuredClone(currentTractSnapshotProvenance) }
        : {};
    },
    setActive(next) {
      active = Boolean(next);
      refreshOwner.setActive(active);
      pointsController.setActive(active);
      if (active) {
        publishCurrentSelection();
        reconcileCrimeLayerVisibility(map, store);
        const snapshot = captureCrimeSnapshot();
        if (resolveCrimePrimaryLayer(snapshot) === 'incidents') reconcileCrimeLegend(snapshot);
        else showLegend();
      }
      else for (const layerId of CRIME_LAYER_IDS) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
      }
      if (active && store.centerLonLat) {
        upsertBufferA(map, { centerLonLat: store.centerLonLat, radiusM: store.radius });
      } else if (!active) {
        lastCameraSelectionKey = null;
        pointsController.clear();
        markerA?.remove();
        markerB?.remove();
        markerA = null;
        markerB = null;
        hideLegend();
        hideTractsOutlineBanner();
        hoverCleanup?.();
        popupCleanup?.();
        hoverCleanup = null;
        popupCleanup = null;
        removeBufferOverlay(map);
      }
    },
  };
}

export function reconcileCrimeLayerVisibility(map, state = store) {
  for (const layerId of CRIME_LAYER_IDS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', resolveCrimeLayerVisibility(layerId, state));
    }
  }
}

function reconcileCrimeLegend(state) {
  const highlights = buildOffenseHighlights(
    state.drilldownCodes,
    makePalette(state.classPalette, 5),
  );
  if (highlights.length === 0) return hideLegend();
  updateLegend({
    title: 'map.offenseLegendTitle',
    subtitle: 'map.offenseLegendSubtitle',
    items: highlights,
  });
}

function removeBufferOverlay(map) {
  clearBufferA(map);
  clearBufferB(map);
}
