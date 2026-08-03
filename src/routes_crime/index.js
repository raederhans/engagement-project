import { getDistrictsMerged } from '../map/choropleth_districts.js';
import { renderDistrictChoropleth } from '../map/render_choropleth.js';
import { attachHover } from '../map/ui_tooltip.js';
import { wirePoints } from '../map/wire_points.js';
import { store, initCoverageAndDefaults } from '../state/store.js';
import { setCurrentAnalysisSelection, updateCompare } from '../compare/card.js';
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
import { hideLegend, initLegend, showLegend } from '../map/legend.js';
import { upsertTractsOutline } from '../map/tracts_layers.js';
import { fetchTractsCachedFirst } from '../api/boundaries.js';
import { createMapMarker, localizeMapMarker } from '../map/initMap.js';
import { tractFeatureGEOID } from '../utils/geoids.js';
import { createCrimeRefreshOwner, readCrimeSnapshot } from './crime_refresh_owner.js';
import { setTranslatedText, t } from '../i18n/index.js';
import {
  bufferBounds,
  fitBoundsWithPanel,
  geometryBounds,
} from '../map/camera_fit.js';
import { describeCrimeDataScope } from '../ui/data_scope.js';
import { wireSettledMarkerDrag } from './draggable_marker.js';

export { wireSettledMarkerDrag };

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

let chartsModulePromise;

function loadChartsModule() {
  if (!chartsModulePromise) chartsModulePromise = import('../charts/index.js');
  return chartsModulePromise;
}

async function updateCharts(filters, options) {
  const { updateAllCharts } = await loadChartsModule();
  return updateAllCharts(filters, options);
}

function waitForMapReady(map) {
  if (map.loaded?.() || map.isStyleLoaded?.()) return Promise.resolve();
  return new Promise((resolve) => map.once('load', resolve));
}

function captureCrimeSnapshot() {
  return readCrimeSnapshot(store);
}

export function normalizeCrimeRefreshResult(result) {
  if (result?.status === 'failed') return { status: 'failed' };
  if (result?.status === 'live' || result?.applied === true) return { status: 'live' };
  return { status: 'superseded' };
}

export function classifyCrimeRefreshJobs(results) {
  let superseded = false;
  for (const result of results) {
    if (result?.status === 'rejected') return { status: 'failed' };
    const value = result?.value;
    if (!value || value.status === 'failed') return { status: 'failed' };
    if (value.status === 'superseded' || value.applied === false) superseded = true;
    else if (value.status !== 'live' && value.applied !== true) return { status: 'failed' };
  }
  return superseded ? { applied: false } : { applied: true };
}

export function hasActiveIncidentSelection(state) {
  return state?.queryMode === 'buffer'
    && Array.isArray(state.centerLonLat)
    && state.centerLonLat.length >= 2;
}

export function crimeSelectionKey(state) {
  if (state?.queryMode === 'district' && state.selectedDistrictCode) {
    return `district:${String(state.selectedDistrictCode).padStart(2, '0')}`;
  }
  if (state?.queryMode === 'tract' && state.selectedTractGEOID) {
    return `tract:${state.selectedTractGEOID}`;
  }
  if (hasActiveIncidentSelection(state)) {
    const centerA = state.centerLonLat.join(',');
    const centerB = Array.isArray(state.centerBLonLat) ? `|${state.centerBLonLat.join(',')}` : '';
    return `buffer:${centerA}${centerB}|${Number(state.radiusM ?? state.radius) || 400}`;
  }
  return null;
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
} = {}) {
  const mapReady = waitForMapReady(map);
  let markerA = null;
  let markerB = null;
  let disposeMarkerADrag = null;
  let disposeMarkerBDrag = null;
  let tractClickWired = false;
  let districtClickWired = false;
  let active = true;
  let hoverCleanup = null;
  let popupCleanup = null;
  let tractOutlineData = null;
  let currentTractSnapshotProvenance = null;
  let districtData = null;
  let tractData = null;
  let lastCameraSelectionKey = null;
  const resolvedSources = new Map();

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

  async function refreshAll(snapshot, { signal, isCurrent }) {
    if (!active || !isActive() || !isCurrent()) return { applied: false };
    currentTractSnapshotProvenance = null;
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
    const collectResolvedSource = (metadata) => {
      if (!isCurrent() || !metadata?.dataset) return;
      const dataset = metadata.dataset === 'police-districts'
        ? 'districts'
        : metadata.dataset === 'census-tract-boundaries'
          ? 'tracts'
          : metadata.dataset === 'census-tract-statistics'
            ? 'demographics'
            : metadata.dataset;
      resolvedSources.set(dataset, {
        dataset,
        kind: metadata.kind,
        source: metadata.provider,
        asOf: metadata.asOf || null,
      });
    };
    resolvedSources.set('incidents', {
      dataset: 'incidents',
      kind: 'live',
      source: 'CARTO',
      asOf: store.coverageMax || null,
    });

    syncComparisonOverlays({ centerLonLat, centerBLonLat, radiusM, queryMode });
    publishCurrentSelection(snapshot);
    const bufferCamera = queryMode === 'buffer'
      ? fitCurrentSelection({ snapshot })
      : Promise.resolve(false);

    try {
      let nextTractSnapshotProvenance = null;
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
        renderTractsChoropleth(map, merged);
        nextTractSnapshotProvenance = merged.provenance || null;
        clearCrimeResultsUnavailable();
        reconcileCrimeLayerVisibility(map, snapshot);
        reconcileCrimeLegend(snapshot);
        if (queryMode === 'tract' && selectedTractGEOID) {
          upsertSelectedTract(map, selectedTractGEOID);
          await fitCurrentSelection({ snapshot });
        } else {
          clearSelectedTract(map);
        }
        wireTractSelection();
      } else {
        const [merged] = await Promise.all([
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
        renderDistrictChoropleth(map, merged);
        clearCrimeResultsUnavailable();
        reconcileCrimeLayerVisibility(map, snapshot);
        reconcileCrimeLegend(snapshot);
        ensureDistrictInteractions();
        if (queryMode === 'district' && selectedDistrictCode) {
          upsertSelectedDistrict(map, selectedDistrictCode);
          await fitCurrentSelection({ snapshot });
        } else {
          clearSelectedDistrict(map);
        }
        wireDistrictSelection();
      }
      if (isCurrent()) currentTractSnapshotProvenance = nextTractSnapshotProvenance;
    } catch (error) {
      if (!isCurrent()) return { applied: false };
      currentTractSnapshotProvenance = null;
      console.warn('Boundary refresh failed:', error);
      markCrimeResultsUnavailable(map, 'Map and charts are unavailable for the current filters. Try again.');
      return { status: 'failed' };
    }

    if (!isCurrent()) return { applied: false };
    await bufferCamera;
    if (!isCurrent()) return { applied: false };
    const jobs = [];
    if (hasActiveIncidentSelection(snapshot)) {
      jobs.push(pointsController.refresh(snapshot, { signal, shouldApply: isCurrent }));
    } else {
      pointsController.clear();
    }
    jobs.push(updateCharts(snapshot, { signal, shouldApply: isCurrent }));
    if (center3857) {
      jobs.push(updateCompare({
        start,
        end,
        types,
        center3857,
        centerB3857,
        addressA,
        addressB,
        radiusM,
        adminLevel,
        per10k,
        coverageDate: store.coverageMax,
      }, { signal, shouldApply: isCurrent }));
    }
    const results = await Promise.allSettled(jobs);
    if (!isCurrent()) return { applied: false };
    for (const result of results) {
      if (result.status === 'rejected') console.warn('Crime dashboard refresh failed:', result.reason);
    }
    const outcome = classifyCrimeRefreshJobs(results);
    if (outcome.applied && isCurrent()) {
      const relevantDatasets = new Set(['incidents']);
      if (adminLevel === 'tracts') {
        relevantDatasets.add('tracts');
        relevantDatasets.add('demographics');
      } else {
        relevantDatasets.add('districts');
        if (store.overlayTractsLines) relevantDatasets.add('tracts');
      }
      const sources = [...resolvedSources.values()]
        .filter((source) => relevantDatasets.has(source.dataset));
      if (currentTractSnapshotProvenance) {
        sources.push({
          dataset: 'tract-crime',
          kind: 'fallback',
          sourceKey: 'scope.source.validatedTractSnapshot',
          asOf: currentTractSnapshotProvenance.coverageDate,
        });
      }
      onDataScopeChange(describeCrimeDataScope({
        coverageMax: store.coverageMax,
        sources,
      }));
    }
    return outcome;
  }

  async function requestRefresh({ signal } = {}) {
    try {
      return normalizeCrimeRefreshResult(await refreshOwner.refresh({ signal }));
    } catch (error) {
      console.warn('Crime refresh failed:', error);
      return { status: 'failed', error: String(error?.message || error) };
    }
  }

  function wireTractSelection() {
    if (tractClickWired || !map.getLayer('tracts-fill')) return;
    tractClickWired = true;
    map.on('click', 'tracts-fill', (event) => {
      const feature = event.features?.[0];
      const geoid = tractFeatureGEOID(feature);
      if (!active || store.queryMode !== 'tract' || !geoid) return;
      store.selectedTractGEOID = geoid;
      publishCurrentSelection(undefined, { origin: 'map' });
      upsertSelectedTract(map, geoid);
      removeBufferOverlay(map);
      void fitCurrentSelection({ feature, force: true }).then(() => requestRefresh());
    });
  }

  function ensureDistrictInteractions() {
    if (!hoverCleanup) hoverCleanup = attachHover(map, 'districts-fill');
    if (!popupCleanup) popupCleanup = attachDistrictPopup(map, 'districts-fill');
  }

  function syncComparisonOverlays({ centerLonLat, centerBLonLat, radiusM, queryMode }) {
    const removeMarkerA = () => {
      disposeMarkerADrag?.();
      disposeMarkerADrag = null;
      markerA?.remove();
      markerA = null;
    };
    const removeMarkerB = () => {
      disposeMarkerBDrag?.();
      disposeMarkerBDrag = null;
      markerB?.remove();
      markerB = null;
    };
    const updateDraggedPoint = (target, { lng, lat }) => {
      store.setComparisonPoint(target, lng, lat, t('crime.mapPoint', { target }));
      const center = target === 'B' ? store.centerBLonLat : store.centerLonLat;
      if (target === 'B') upsertBufferB(map, { centerLonLat: center, radiusM: store.radius });
      else upsertBufferA(map, { centerLonLat: center, radiusM: store.radius });
    };
    const wireMarkerDrag = (marker, target) => wireSettledMarkerDrag(marker, {
      isActive: () => active && isActive() && store.queryMode === 'buffer',
      onDragStart: () => {
        refreshOwner.cancel();
        publishCurrentSelection(undefined, { origin: 'map' });
      },
      onMove: (position) => {
        updateDraggedPoint(target, position);
        publishCurrentSelection(undefined, { origin: 'drag' });
      },
      onSettled: (position) => {
        updateDraggedPoint(target, position);
        publishCurrentSelection(undefined, { origin: 'map' });
        onPointChange(target);
        void requestRefresh();
      },
    });

    if (queryMode !== 'buffer') {
      removeBufferOverlay(map);
      removeMarkerA();
      removeMarkerB();
      return;
    }
    if (centerLonLat) {
      if (!markerA) {
        markerA = createMapMarker({
          color: '#c86b00',
          className: 'analysis-marker analysis-marker--a',
          draggable: true,
        });
        disposeMarkerADrag = wireMarkerDrag(markerA, 'A');
      }
      markerA.setLngLat(centerLonLat).addTo(map);
      localizeMapMarker(markerA);
      upsertBufferA(map, { centerLonLat, radiusM });
    } else removeMarkerA();
    if (centerBLonLat) {
      if (!markerB) {
        markerB = createMapMarker({
          color: '#0a6c74',
          className: 'analysis-marker analysis-marker--b',
          draggable: true,
        });
        disposeMarkerBDrag = wireMarkerDrag(markerB, 'B');
      }
      markerB.setLngLat(centerBLonLat).addTo(map);
      localizeMapMarker(markerB);
      upsertBufferB(map, { centerLonLat: centerBLonLat, radiusM });
    } else removeMarkerB();
  }

  async function ensureTractOutline({ signal, isCurrent, onSourceResolved }) {
    if (!tractOutlineData) {
      try {
        const tracts = await fetchTractsCachedFirst({ signal, onSourceResolved });
        if (!isCurrent()) return;
        tractOutlineData = tracts;
      } catch (error) {
        if (!isCurrent() || signal.aborted || error?.name === 'AbortError') return;
        console.warn('Failed to load tract outlines:', error);
        return;
      }
    }
    if (active && isActive() && tractOutlineData?.features?.length) {
      upsertTractsOutline(map, tractOutlineData);
    }
  }

  function wireDistrictSelection() {
    if (districtClickWired || !map.getLayer('districts-fill')) return;
    districtClickWired = true;
    map.on('click', 'districts-fill', (event) => {
      const feature = event.features?.[0];
      const code = String(feature?.properties?.DIST_NUMC || '').padStart(2, '0');
      if (!active || store.queryMode !== 'district' || !code) return;
      store.selectedDistrictCode = code;
      publishCurrentSelection(undefined, { origin: 'map' });
      upsertSelectedDistrict(map, code);
      removeBufferOverlay(map);
      void fitCurrentSelection({ feature, force: true }).then(() => requestRefresh());
    });
  }

  map.on('click', (event) => {
    if (!active || store.queryMode !== 'buffer' || store.selectMode !== 'point') return;
    const target = store.selectTarget === 'B' ? 'B' : 'A';
    store.setComparisonPoint(target, event.lngLat.lng, event.lngLat.lat, t('crime.mapPoint', { target }));
    publishCurrentSelection(undefined, { origin: 'map' });
    onPointChange(target);
    syncComparisonOverlays({
      centerLonLat: store.centerLonLat,
      centerBLonLat: store.centerBLonLat,
      radiusM: store.radius,
      queryMode: store.queryMode,
    });
    store.selectMode = 'idle';
    for (const id of ['useCenterBtn', 'usePointBBtn']) {
      const button = document.getElementById(id);
      if (button) setTranslatedText(button, 'crime.pickOnMap');
    }
    const hint = document.getElementById('useMapHint');
    if (hint) hint.style.display = 'none';
    document.body.style.cursor = '';
    void fitCurrentSelection({ force: true }).then(() => requestRefresh());
  });

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
        reconcileCrimeLegend(store);
      }
      else for (const layerId of CRIME_LAYER_IDS) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
      }
      if (active && store.centerLonLat) {
        upsertBufferA(map, { centerLonLat: store.centerLonLat, radiusM: store.radius });
      } else if (!active) {
        lastCameraSelectionKey = null;
        pointsController.clear();
        disposeMarkerADrag?.();
        disposeMarkerBDrag?.();
        disposeMarkerADrag = null;
        disposeMarkerBDrag = null;
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

export function resolveCrimePrimaryLayer(state) {
  if (state?.queryMode === 'district') return 'districts';
  if (state?.queryMode === 'tract') return 'tracts';
  return 'incidents';
}

export function shouldShowCrimeLegend(state) {
  return resolveCrimePrimaryLayer(state) !== 'incidents';
}

function reconcileCrimeLegend(state) {
  if (shouldShowCrimeLegend(state)) showLegend();
  else hideLegend();
}

export function resolveCrimeLayerVisibility(layerId, state) {
  const primaryLayer = resolveCrimePrimaryLayer(state);
  if (layerId === 'tracts-outline-line') {
    return state?.overlayTractsLines ? 'visible' : 'none';
  }
  if (layerId === 'tracts-fill' || layerId.startsWith('tracts-selected-')) {
    return primaryLayer === 'tracts' ? 'visible' : 'none';
  }
  if (layerId.startsWith('districts-')) {
    return primaryLayer === 'districts' ? 'visible' : 'none';
  }
  if (layerId === 'clusters' || layerId === 'cluster-count' || layerId === 'unclustered') {
    return primaryLayer === 'incidents' && hasActiveIncidentSelection(state) ? 'visible' : 'none';
  }
  if (layerId.startsWith('buffer-a-')) {
    return state?.queryMode === 'buffer' && state?.centerLonLat ? 'visible' : 'none';
  }
  if (layerId.startsWith('buffer-b-')) {
    return state?.queryMode === 'buffer' && state?.centerBLonLat ? 'visible' : 'none';
  }
  return 'visible';
}

export function markCrimeResultsUnavailable(map, message, documentRef = globalThis.document) {
  for (const layerId of CRIME_LAYER_IDS) {
    if (layerId.startsWith('buffer-')) continue;
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
  }
  hideLegend();
  for (const id of ['charts', 'compare-card']) {
    const element = documentRef?.getElementById?.(id);
    if (element) {
      element.style.opacity = '0.35';
      element.style.pointerEvents = 'none';
    }
  }
  let status = documentRef?.getElementById?.('crime-results-status');
  if (!status && documentRef?.createElement) {
    status = documentRef.createElement('div');
    status.id = 'crime-results-status';
    status.setAttribute('role', 'status');
    documentRef.getElementById?.('sidepanel')?.prepend(status);
  }
  if (status) {
    status.textContent = message;
    status.style.display = 'block';
  }
}

function clearCrimeResultsUnavailable(documentRef = globalThis.document) {
  for (const id of ['charts', 'compare-card']) {
    const element = documentRef?.getElementById?.(id);
    if (element) {
      element.style.opacity = '';
      element.style.pointerEvents = '';
    }
  }
  const status = documentRef?.getElementById?.('crime-results-status');
  if (status) status.style.display = 'none';
}

function removeBufferOverlay(map) {
  clearBufferA(map);
  clearBufferB(map);
}
