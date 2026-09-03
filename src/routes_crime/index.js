import { getDistrictsMerged } from '../map/choropleth_districts.js';
import { attachHover } from '../map/ui_tooltip.js';
import { wirePoints } from '../map/wire_points.js';
import { store, initCoverageAndDefaults } from '../state/store.js';
import { createCrimeStatePort } from '../state/crime_state_port.js';
import {
  crimeSelectionKey,
  hasActiveIncidentSelection,
  isDefaultCrimeContext,
  normalizeCrimeRefreshScope,
  planCrimeRefresh,
  resolveCrimeDistrictFillOpacity,
  resolveCrimeDistrictLineStyle,
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
import {
  fetchPoliceDistrictsCachedFirst,
  fetchTractsCachedFirst,
} from '../api/boundaries.js';
import { createMapMarker, localizeMapMarker } from '../map/initMap.js';
import { tractFeatureGEOID } from '../utils/geoids.js';
import {
  createCrimeRefreshOwner,
  observeCrimeRefreshJob,
  readCrimeSnapshot,
} from './crime_refresh_owner.js';
import { createCrimeMapSelectionCoordinator } from './crime_map_selection_coordinator.js';
import { setTranslatedText, t } from '../i18n/index.js';
import { fitBoundsWithPanel, geometryBounds } from '../map/camera_fit.js';
import { clearCrimeDistrictData } from '../charts/accessible_data.js';
import { describeCrimeDataScope } from '../ui/data_scope.js';
import {
  classifyCrimeRefreshJobs,
  createCrimeRefreshProvenance,
  normalizeCrimeRefreshResult,
} from '../ui/crime_result_meta.js';

export {
  crimeSelectionKey,
  hasActiveIncidentSelection,
  isDefaultCrimeContext,
  normalizeCrimeRefreshScope,
  planCrimeRefresh,
  resolveCrimeDistrictFillOpacity,
  resolveCrimeDistrictLineStyle,
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
  let defaultContextFitCompleted = false;
  let defaultContextFitPromise = null;
  let userMovedMap = false;
  let coverageInitialized = false;
  const crimeState = statePort || createCrimeStatePort({ state: store });
  const { renderCrimeDistrictContext } = await import('./crime_district_context.js');

  async function ensureCoverage() {
    if (coverageInitialized) return true;
    try {
      await initCoverageAndDefaults();
      coverageInitialized = true;
      onCoverageChange();
      return true;
    } catch (error) {
      onCoverageChange();
      throw error;
    }
  }

  const pointsController = wirePoints(map, {
    getFilters: captureCrimeSnapshot,
    canReadFilters: () => store.coverageStatus === 'ready',
    shouldRefresh: hasActiveIncidentSelection,
    autoRefresh: false,
  });
  map.on('movestart', (event) => {
    if (event?.originalEvent) userMovedMap = true;
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

  async function fitDefaultDistrictContext(snapshot, geojson) {
    if (defaultContextFitCompleted || userMovedMap || !isDefaultCrimeContext(snapshot)) return false;
    if (defaultContextFitPromise) return defaultContextFitPromise;
    const bounds = geometryBounds(geojson);
    if (!bounds) return false;
    defaultContextFitPromise = Promise.resolve(
      pointsController.runProgrammaticMapMove(() => fitBoundsWithPanel(map, bounds, {
        maxZoom: 11,
      })),
    ).then((applied) => {
      defaultContextFitCompleted = Boolean(applied);
      return Boolean(applied);
    }).finally(() => {
      defaultContextFitPromise = null;
    });
    return defaultContextFitPromise;
  }

  function renderDistrictContextState(snapshot, geojson, status) {
    districtData = geojson;
    if (!isDefaultCrimeContext(snapshot) && snapshot.queryMode !== 'district') {
      clearCrimeDistrictData();
      reconcileCrimeLayerVisibility(map, snapshot);
      return;
    }
    renderCrimeDistrictContext({
      map,
      snapshot,
      geojson,
      status,
      reconcileLayerVisibility: reconcileCrimeLayerVisibility,
      ensureInteractions: ensureDistrictInteractions,
      wireSelection: () => selectionCoordinator?.wireDistrictSelection?.(),
      fitContext: fitDefaultDistrictContext,
    });
  }

  function publishCurrentSelection(snapshot = store, { origin = 'sync' } = {}) {
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
    if (!isDefaultCrimeContext(snapshot) && snapshot.queryMode !== 'district') {
      clearCrimeDistrictData();
    }
    if (isDefaultCrimeContext(snapshot)) showLegend();
    else if (incidentView) reconcileCrimeLegend(snapshot);
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

    if (requested.has('boundary')) {
      startResultJob('boundary', (async () => {
        let nextTractSnapshotProvenance = null;
        let featureCount = 0;
        let boundaryOutcome = null;
        if (adminLevel === 'tracts') {
          clearCrimeDistrictData();
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
          const outlinePromise = snapshot.overlayTractsLines
            ? ensureTractOutline({ signal, isCurrent, onSourceResolved: collectResolvedSource })
            : Promise.resolve({ applied: true, status: 'skipped' });
          let merged;
          let outlineResult;
          try {
            [merged, outlineResult] = await Promise.all([
              getDistrictsMerged({
                start,
                end,
                types,
                signal,
                onSourceResolved: collectResolvedSource,
                onBoundariesReady: (geojson) => {
                  if (isCurrent() && isDefaultCrimeContext(snapshot)) {
                    renderDistrictContextState(snapshot, geojson, 'loading');
                  }
                },
              }),
              outlinePromise,
            ]);
          } catch (error) {
            if (!isCurrent() || signal?.aborted || error?.name === 'AbortError') throw error;
            const geojson = await fetchPoliceDistrictsCachedFirst({
              signal,
              onSourceResolved: collectResolvedSource,
            });
            if (!isCurrent()) return { applied: false };
            renderDistrictContextState(snapshot, geojson, 'unavailable');
            return {
              applied: true,
              status: 'partial',
              featureCount: geojson?.features?.length || 0,
              succeeded: ['district-boundaries'],
              failed: ['district-counts'],
              error,
            };
          }
          if (!isCurrent()) return { applied: false };
          districtData = merged;
          featureCount = merged?.features?.length || 0;
          renderDistrictContextState(snapshot, merged, 'ready');
          if (queryMode === 'district' && selectedDistrictCode) {
            upsertSelectedDistrict(map, selectedDistrictCode);
            await fitCurrentSelection({ snapshot });
          } else {
            clearSelectedDistrict(map);
          }
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
        queryMode === 'district' || queryMode === 'tract'
          ? import('./public_area_summary.js').then(({ runPublicAreaSummary }) => runPublicAreaSummary({
              start,
              end,
              types,
              queryMode,
              selectedDistrictCode,
              selectedTractGEOID,
              per10k,
              coverageDate: store.coverageMax,
            }, summaryOptions))
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
      const {
        prepareCrimeRefresh,
        warmCrimeBoundaryResources,
      } = await import('./crime_load_coordinator.js');
      await prepareCrimeRefresh({
        loadCoverage: ensureCoverage,
        warmBoundary: () => warmCrimeBoundaryResources({
          snapshot: store,
          scope,
          signal,
          loadDistricts: fetchPoliceDistrictsCachedFirst,
          loadTracts: fetchTractsCachedFirst,
        }),
      });
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
      clearCrimeDistrictData();
      reconcileCrimeLayerVisibility(map, store);
      reconcileCrimeLegend(store);
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

  async function setTractsOverlayVisible(visible) {
    if (!active || !isActive()) return false;
    const { ensureVisibleTractOverlay } = await import('./crime_load_coordinator.js');
    return ensureVisibleTractOverlay({
      visible,
      trySetVisible: synchronousActions.setTractsOverlayVisible,
      loadBoundary: () => requestRefresh({ scope: 'boundary' }),
    });
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
    const { fitCrimeSelectionCamera } = await import('./crime_selection_camera.js');
    const result = await fitCrimeSelectionCamera({
      map,
      snapshot,
      feature,
      districtData,
      tractData,
      selectionKey: key,
      previousSelectionKey: lastCameraSelectionKey,
      runProgrammaticMapMove: pointsController.runProgrammaticMapMove,
    });
    lastCameraSelectionKey = result.selectionKey;
    return result.applied;
  }

  return {
    requestRefresh,
    runProgrammaticMapMove: pointsController.runProgrammaticMapMove,
    fitCurrentSelection,
    updateBuffer: synchronousActions.updateBuffer,
    setTractsOverlayVisible,
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
        if (resolveCrimePrimaryLayer(store) === 'incidents') {
          if (isDefaultCrimeContext(store)) showLegend();
          else reconcileCrimeLegend(store);
        } else showLegend();
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
  if (map.getLayer('districts-fill')) {
    map.setPaintProperty?.(
      'districts-fill',
      'fill-opacity',
      resolveCrimeDistrictFillOpacity(state),
    );
  }
  if (map.getLayer('districts-line')) {
    const line = resolveCrimeDistrictLineStyle(state);
    map.setPaintProperty?.('districts-line', 'line-color', line.color);
    map.setPaintProperty?.('districts-line', 'line-opacity', line.opacity);
    map.setPaintProperty?.('districts-line', 'line-width', line.width);
  }
}

export function resolveCrimeLegendState(state = {}) {
  return {
    drilldownCodes: Array.isArray(state.drilldownCodes)
      ? state.drilldownCodes
      : (Array.isArray(state.selectedDrilldownCodes) ? state.selectedDrilldownCodes : []),
    classPalette: state.classPalette,
  };
}

function reconcileCrimeLegend(state) {
  const legendState = resolveCrimeLegendState(state);
  const highlights = buildOffenseHighlights(
    legendState.drilldownCodes,
    makePalette(legendState.classPalette, 5),
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
