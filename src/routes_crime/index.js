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
import { upsertBufferA } from '../map/buffer_overlay.js';
import { hideLegend, initLegend } from '../map/legend.js';
import { upsertTractsOutline } from '../map/tracts_layers.js';
import { fetchTractsCachedFirst } from '../api/boundaries.js';
import { createMapMarker } from '../map/initMap.js';
import { tractFeatureGEOID } from '../utils/geoids.js';
import { createCrimeRefreshOwner, readCrimeSnapshot } from './crime_refresh_owner.js';

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

export async function initCrimeMode(map, { isActive = () => true } = {}) {
  const mapReady = waitForMapReady(map);
  let markerA = null;
  let tractClickWired = false;
  let districtClickWired = false;
  let active = true;
  let hoverCleanup = null;
  let popupCleanup = null;
  let tractOutlineData = null;

  try {
    await initCoverageAndDefaults();
  } catch {}

  const center = map.getCenter();
  store.setCenterFromLngLat(center.lng, center.lat);
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
    await refreshOwner.refresh();
  }

  async function refreshAll(snapshot, { signal, isCurrent }) {
    if (!active || !isActive() || !isCurrent()) return { applied: false };
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
      radiusM,
      timeWindowMonths,
    } = snapshot;

    try {
      if (adminLevel === 'tracts') {
        const merged = await getTractsMerged({
          per10k,
          windowStart: start,
          windowEnd: end,
          signal,
        });
        if (!isCurrent()) return { applied: false };
        renderTractsChoropleth(map, merged);
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
        ensureDistrictInteractions();
        if (queryMode === 'district' && selectedDistrictCode) {
          upsertSelectedDistrict(map, selectedDistrictCode);
        } else {
          clearSelectedDistrict(map);
        }
        wireDistrictSelection();
      }
    } catch (error) {
      if (!isCurrent()) return { applied: false };
      console.warn('Boundary refresh failed:', error);
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
        types,
        center3857,
        radiusM,
        timeWindowMonths,
        adminLevel,
      }, { signal, shouldApply: isCurrent }));
    }
    const results = await Promise.allSettled(jobs);
    if (!isCurrent()) return { applied: false };
    for (const result of results) {
      if (result.status === 'rejected') console.warn('Crime dashboard refresh failed:', result.reason);
    }
    if (queryMode === 'buffer' && centerLonLat) {
      upsertBufferA(map, { centerLonLat, radiusM });
    }
    return { applied: true };
  }

  function requestRefresh() {
    return refreshOwner.refresh();
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
    store.setCenterFromLngLat(event.lngLat.lng, event.lngLat.lat);
    markerA ||= createMapMarker({ color: '#ef4444' });
    markerA.setLngLat(event.lngLat).addTo(map);
    upsertBufferA(map, { centerLonLat: store.centerLonLat, radiusM: store.radius });
    store.selectMode = 'idle';
    const button = document.getElementById('useCenterBtn');
    if (button) button.textContent = 'Select on map';
    const hint = document.getElementById('useMapHint');
    if (hint) hint.style.display = 'none';
    document.body.style.cursor = '';
    void requestRefresh();
  });

  return {
    requestRefresh,
    updateBuffer: synchronousActions.updateBuffer,
    setTractsOverlayVisible: synchronousActions.setTractsOverlayVisible,
    setActive(next) {
      active = Boolean(next);
      refreshOwner.setActive(active);
      pointsController.setActive(active);
      for (const layerId of CRIME_LAYER_IDS) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', active ? activeLayerVisibility(layerId) : 'none');
        }
      }
      if (active) {
        if (store.centerLonLat) {
          upsertBufferA(map, { centerLonLat: store.centerLonLat, radiusM: store.radius });
        }
        void requestRefresh();
      } else {
        pointsController.clear();
        markerA?.remove();
        markerA = null;
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

function activeLayerVisibility(layerId) {
  if (layerId === 'tracts-outline-line') {
    return store.overlayTractsLines ? 'visible' : 'none';
  }
  if (layerId === 'tracts-fill' || layerId.startsWith('tracts-selected-')) {
    return store.adminLevel === 'tracts' ? 'visible' : 'none';
  }
  if (layerId.startsWith('districts-')) {
    return store.adminLevel === 'tracts' ? 'none' : 'visible';
  }
  if (layerId.startsWith('buffer-a-')) {
    return store.queryMode === 'buffer' && store.centerLonLat ? 'visible' : 'none';
  }
  return 'visible';
}

function removeBufferOverlay(map) {
  for (const id of ['buffer-a-fill', 'buffer-a-line']) {
    if (map.getLayer(id)) {
      try { map.removeLayer(id); } catch {}
    }
  }
  if (map.getSource('buffer-a')) {
    try { map.removeSource('buffer-a'); } catch {}
  }
}
