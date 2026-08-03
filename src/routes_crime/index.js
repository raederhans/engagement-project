import { getDistrictsMerged } from '../map/choropleth_districts.js';
import { renderDistrictChoropleth } from '../map/render_choropleth.js';
import { attachHover } from '../map/ui_tooltip.js';
import { wirePoints } from '../map/wire_points.js';
import { store, initCoverageAndDefaults } from '../state/store.js';
import { updateCompare } from '../compare/card.js';
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
} = {}) {
  const mapReady = waitForMapReady(map);
  let markerA = null;
  let markerB = null;
  let tractClickWired = false;
  let districtClickWired = false;
  let active = true;
  let hoverCleanup = null;
  let popupCleanup = null;
  let tractOutlineData = null;
  let currentTractSnapshotProvenance = null;

  try {
    await initCoverageAndDefaults();
    onCoverageChange();
  } catch (error) {
    onCoverageChange();
    throw error;
  }

  const center = map.getCenter();
  if (!store.centerLonLat) store.setCenterFromLngLat(center.lng, center.lat);
  const pointsController = wirePoints(map, { getFilters: captureCrimeSnapshot });
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

    syncComparisonOverlays({ centerLonLat, centerBLonLat, radiusM, queryMode });

    try {
      let nextTractSnapshotProvenance = null;
      if (adminLevel === 'tracts') {
        const merged = await getTractsMerged({
          per10k,
          windowStart: start,
          windowEnd: end,
          types,
          signal,
        });
        if (!isCurrent()) return { applied: false };
        renderTractsChoropleth(map, merged);
        nextTractSnapshotProvenance = merged.provenance || null;
        clearCrimeResultsUnavailable();
        reconcileCrimeLayerVisibility(map, snapshot);
        reconcileCrimeLegend(snapshot);
        if (queryMode === 'tract' && selectedTractGEOID) {
          upsertSelectedTract(map, selectedTractGEOID);
        } else {
          clearSelectedTract(map);
        }
        wireTractSelection();
      } else {
        const [merged] = await Promise.all([
          getDistrictsMerged({ start, end, types, signal }),
          ensureTractOutline({ signal, isCurrent }),
        ]);
        if (!isCurrent()) return { applied: false };
        renderDistrictChoropleth(map, merged);
        clearCrimeResultsUnavailable();
        reconcileCrimeLayerVisibility(map, snapshot);
        reconcileCrimeLegend(snapshot);
        ensureDistrictInteractions();
        if (queryMode === 'district' && selectedDistrictCode) {
          upsertSelectedDistrict(map, selectedDistrictCode);
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
    const jobs = [];
    if (queryMode === 'buffer' && center3857) {
      jobs.push(pointsController.refresh(snapshot, { signal, shouldApply: isCurrent }));
    } else if (queryMode === 'district') {
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
    return classifyCrimeRefreshJobs(results);
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
      const geoid = tractFeatureGEOID(event.features?.[0]);
      if (!active || store.queryMode !== 'tract' || !geoid) return;
      store.selectedTractGEOID = geoid;
      upsertSelectedTract(map, geoid);
      removeBufferOverlay(map);
      void requestRefresh();
    });
  }

  function ensureDistrictInteractions() {
    if (!hoverCleanup) hoverCleanup = attachHover(map, 'districts-fill');
    if (!popupCleanup) popupCleanup = attachDistrictPopup(map, 'districts-fill');
  }

  function syncComparisonOverlays({ centerLonLat, centerBLonLat, radiusM, queryMode }) {
    if (queryMode !== 'buffer') {
      removeBufferOverlay(map);
      markerA?.remove();
      markerB?.remove();
      markerA = null;
      markerB = null;
      return;
    }
    if (centerLonLat) {
      markerA ||= createMapMarker({ color: '#c86b00', className: 'analysis-marker analysis-marker--a' });
      markerA.setLngLat(centerLonLat).addTo(map);
      localizeMapMarker(markerA);
      upsertBufferA(map, { centerLonLat, radiusM });
    }
    if (centerBLonLat) {
      markerB ||= createMapMarker({ color: '#0a6c74', className: 'analysis-marker analysis-marker--b' });
      markerB.setLngLat(centerBLonLat).addTo(map);
      localizeMapMarker(markerB);
      upsertBufferB(map, { centerLonLat: centerBLonLat, radiusM });
    }
  }

  async function ensureTractOutline({ signal, isCurrent }) {
    if (!tractOutlineData) {
      try {
        const tracts = await fetchTractsCachedFirst({ signal });
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
      const code = String(event.features?.[0]?.properties?.DIST_NUMC || '').padStart(2, '0');
      if (!active || store.queryMode !== 'district' || !code) return;
      store.selectedDistrictCode = code;
      upsertSelectedDistrict(map, code);
      removeBufferOverlay(map);
      void requestRefresh();
    });
  }

  map.on('click', (event) => {
    if (!active || store.queryMode !== 'buffer' || store.selectMode !== 'point') return;
    const target = store.selectTarget === 'B' ? 'B' : 'A';
    store.setComparisonPoint(target, event.lngLat.lng, event.lngLat.lat, t('crime.mapPoint', { target }));
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
    void requestRefresh();
  });

  return {
    requestRefresh,
    runProgrammaticMapMove: pointsController.runProgrammaticMapMove,
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
        reconcileCrimeLayerVisibility(map, store);
        reconcileCrimeLegend(store);
      }
      else for (const layerId of CRIME_LAYER_IDS) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
      }
      if (active && store.centerLonLat) {
        upsertBufferA(map, { centerLonLat: store.centerLonLat, radiusM: store.radius });
      } else if (!active) {
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
    return primaryLayer === 'incidents' ? 'visible' : 'none';
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
