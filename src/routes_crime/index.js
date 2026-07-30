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

async function updateCharts(filters) {
  const { updateAllCharts } = await loadChartsModule();
  return updateAllCharts(filters);
}

function waitForMapReady(map) {
  if (map.loaded?.() || map.isStyleLoaded?.()) return Promise.resolve();
  return new Promise((resolve) => map.once('load', resolve));
}

function chartsStatus() {
  const pane = document.getElementById('charts') || document.body;
  let status = document.getElementById('charts-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'charts-status';
    status.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
    pane.appendChild(status);
  }
  return status;
}

export async function initCrimeMode(map, { isActive = () => true } = {}) {
  const mapReady = waitForMapReady(map);
  let markerA = null;
  let tractClickWired = false;
  let districtClickWired = false;
  let active = true;
  let refreshRunning = false;
  let refreshQueued = false;
  let hoverCleanup = null;
  let popupCleanup = null;
  let tractOutlineData = null;
  let tractOutlinePromise = null;

  try {
    await initCoverageAndDefaults();
  } catch {}

  const center = map.getCenter();
  store.setCenterFromLngLat(center.lng, center.lat);
  const pointsController = wirePoints(map, { getFilters: () => store.getFilters() });

  const initialFilters = store.getFilters();
  const districtsPromise = getDistrictsMerged({
    start: initialFilters.start,
    end: initialFilters.end,
    types: initialFilters.types,
  });

  await mapReady;
  if (!isActive()) {
    active = false;
    pointsController.setActive(false);
  } else {
    try {
      const merged = await districtsPromise;
      if (isActive()) {
        initLegend();
        renderDistrictChoropleth(map, merged);
        ensureDistrictInteractions();
      }
    } catch (error) {
      console.warn('Choropleth initialization failed:', error);
    }

    if (isActive()) {
      void ensureTractOutline();
      await refreshCharts(initialFilters);
    }
  }

  async function refreshCharts(filters) {
    const status = chartsStatus();
    if ((filters.queryMode === 'buffer' && filters.center3857) || filters.queryMode === 'district' || filters.queryMode === 'tract') {
      status.textContent = '';
      try {
        await updateCharts(filters);
      } catch (error) {
        status.textContent = `Charts unavailable: ${error?.message || error}`;
      }
    } else {
      status.textContent = 'Tip: click the map to set a center and show buffer-based charts.';
    }
  }

  async function refreshAll() {
    if (!active || !isActive()) return;
    const filters = store.getFilters();
    const { start, end, types, queryMode, selectedDistrictCode, selectedTractGEOID } = filters;

    try {
      if (store.adminLevel === 'tracts') {
        const merged = await getTractsMerged({
          per10k: store.per10k,
          windowStart: start,
          windowEnd: end,
        });
        if (!active || !isActive()) return;
        renderTractsChoropleth(map, merged);
        if (queryMode === 'tract' && selectedTractGEOID) {
          upsertSelectedTract(map, selectedTractGEOID);
        } else {
          clearSelectedTract(map);
        }
        wireTractSelection();
      } else {
        const merged = await getDistrictsMerged({ start, end, types });
        if (!active || !isActive()) return;
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
      console.warn('Boundary refresh failed:', error);
    }

    if (!active || !isActive()) return;
    const jobs = [];
    if (queryMode === 'buffer' && store.center3857) {
      jobs.push(pointsController.refresh());
    } else if (queryMode === 'district') {
      jobs.push(pointsController.refresh());
    } else {
      pointsController.clear();
    }
    jobs.push(refreshCharts(store.getFilters()));
    if (store.center3857) {
      jobs.push(updateCompare({
        types,
        center3857: store.center3857,
        radiusM: store.radius,
        timeWindowMonths: store.timeWindowMonths,
        adminLevel: store.adminLevel,
      }));
    }
    const results = await Promise.allSettled(jobs);
    for (const result of results) {
      if (result.status === 'rejected') console.warn('Crime dashboard refresh failed:', result.reason);
    }
  }

  async function requestRefresh() {
    refreshQueued = true;
    if (refreshRunning) return;
    refreshRunning = true;
    try {
      while (refreshQueued && active && isActive()) {
        refreshQueued = false;
        await refreshAll();
      }
    } finally {
      refreshRunning = false;
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

  async function ensureTractOutline() {
    if (!tractOutlineData) {
      tractOutlinePromise ||= fetchTractsCachedFirst()
        .then((tracts) => {
          tractOutlineData = tracts;
          return tracts;
        });
      try {
        await tractOutlinePromise;
      } catch (error) {
        tractOutlinePromise = null;
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
    const lngLat = [event.lngLat.lng, event.lngLat.lat];
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
    window.__dashboard.lastPick = { when: new Date().toISOString(), lngLat };
    void requestRefresh();
  });

  return {
    requestRefresh,
    updateBuffer() {
      if (store.centerLonLat) {
        upsertBufferA(map, { centerLonLat: store.centerLonLat, radiusM: store.radius });
      }
    },
    setActive(next) {
      active = Boolean(next);
      pointsController.setActive(active);
      for (const layerId of CRIME_LAYER_IDS) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', active ? activeLayerVisibility(layerId) : 'none');
        }
      }
      if (active) {
        void ensureTractOutline();
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
