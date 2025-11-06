import './style.css';
import dayjs from 'dayjs';
import { initMap } from './map/initMap.js';
import { getDistrictsMerged } from './map/choropleth_districts.js';
import { renderDistrictChoropleth } from './map/render_choropleth.js';
import { drawLegend } from './map/ui_legend.js';
import { attachHover } from './map/ui_tooltip.js';
import { wirePoints } from './map/wire_points.js';
import { updateAllCharts } from './charts/index.js';
import { store, initCoverageAndDefaults } from './state/store.js';
import { initPanel } from './ui/panel.js';
import { initAboutPanel } from './ui/about.js';
import { refreshPoints } from './map/points.js';
import { updateCompare } from './compare/card.js';
import { attachDistrictPopup } from './map/ui_popup_district.js';
import * as turf from '@turf/turf';
import { getTractsMerged } from './map/tracts_view.js';
import { renderTractsChoropleth } from './map/render_choropleth_tracts.js';
import { upsertSelectedDistrict, clearSelectedDistrict, upsertSelectedTract, clearSelectedTract } from './map/selection_layers.js';
import { initLegend } from './map/legend.js';
import { upsertTractsOutline } from './map/tracts_layers.js';
import { fetchTractsCachedFirst } from './api/boundaries.js';

window.__dashboard = {
  setChoropleth: (/* future hook */) => {},
};

window.addEventListener('DOMContentLoaded', async () => {
  const map = initMap();

  // Align defaults with dataset coverage
  try {
    await initCoverageAndDefaults();
  } catch {}

  try {
    // Fixed 6-month window demo
    const end = dayjs().format('YYYY-MM-DD');
    const start = dayjs().subtract(6, 'month').format('YYYY-MM-DD');

    // Persist center for buffer-based charts
    const c = map.getCenter();
    store.setCenterFromLngLat(c.lng, c.lat);
    const merged = await getDistrictsMerged({ start, end });

    map.on('load', async () => {
      // Initialize legend control
      initLegend();

      // Initialize about panel (top slide-down)
      initAboutPanel();

      // Render districts (legend updated inside)
      renderDistrictChoropleth(map, merged);
      attachHover(map, 'districts-fill');
      attachDistrictPopup(map, 'districts-fill');

      // Load and render tract outlines (always-on, above districts fill)
      try {
        const tractsGeo = await fetchTractsCachedFirst();
        if (tractsGeo && tractsGeo.features && tractsGeo.features.length > 0) {
          upsertTractsOutline(map, tractsGeo);
        }
      } catch (err) {
        console.warn('Failed to load tract outlines:', err);
      }
    });
  } catch (err) {
    console.warn('Choropleth demo failed:', err);
  }

  // Wire points layer refresh with fixed 6-month filters for now
  wirePoints(map, { getFilters: () => store.getFilters() });

  // Charts: guard until center is set or scope by district
  try {
    const { start, end, types, drilldownCodes, center3857, radiusM, queryMode, selectedDistrictCode, selectedTractGEOID } = store.getFilters();
    const pane = document.getElementById('charts') || document.body;
    const status = document.getElementById('charts-status') || (() => {
      const d = document.createElement('div');
      d.id = 'charts-status';
      d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
      pane.appendChild(d);
      return d;
    })();
    if ((queryMode === 'buffer' && center3857) || queryMode === 'district') {
      status.textContent = '';
      await updateAllCharts({ start, end, types, drilldownCodes, center3857, radiusM, queryMode, selectedDistrictCode, selectedTractGEOID });
    } else {
      status.textContent = 'Tip: click the map to set a center and show buffer-based charts.';
    }
  } catch (err) {
    const pane = document.getElementById('charts') || document.body;
    const status = document.getElementById('charts-status') || (() => {
      const d = document.createElement('div');
      d.id = 'charts-status';
      d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
      pane.appendChild(d);
      return d;
    })();
    status.innerText = 'Charts unavailable: ' + (err.message || err);
  }

  // Controls panel
  let _tractClickWired = false;
  let _districtClickWired = false;
  async function refreshAll() {
    const { start, end, types, drilldownCodes, queryMode, selectedDistrictCode, selectedTractGEOID } = store.getFilters();
    try {
      if (store.adminLevel === 'tracts') {
        const merged = await getTractsMerged({ per10k: store.per10k, windowStart: start, windowEnd: end });
        renderTractsChoropleth(map, merged); // Legend updated inside
        // maintain tract highlight based on selection
        if (store.queryMode === 'tract' && selectedTractGEOID) {
          upsertSelectedTract(map, selectedTractGEOID);
        } else {
          clearSelectedTract(map);
        }
        // wire click for tract selection once
        if (!_tractClickWired && map.getLayer('tracts-fill')) {
          _tractClickWired = true;
          map.on('click', 'tracts-fill', (e) => {
            try {
              const f = e.features && e.features[0];
              const geoid = getTractGEOID(f?.properties || {});
              if (geoid && store.queryMode === 'tract') {
                store.selectedTractGEOID = geoid;
                upsertSelectedTract(map, geoid);
                // clear buffer overlay
                removeBufferOverlay();
                if ((typeof import.meta !== 'undefined' && import.meta.env?.DEV) || (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production')) {
                  console.debug('Tract selected GEOID:', geoid);
                }
                // charts follow tract MVP path
                refreshAll();
              }
            } catch {}
          });
        }
      } else {
        const merged = await getDistrictsMerged({ start, end, types });
        renderDistrictChoropleth(map, merged); // Legend updated inside
        // maintain district highlight based on selection
        if (store.queryMode === 'district' && selectedDistrictCode) {
          upsertSelectedDistrict(map, selectedDistrictCode);
        } else {
          clearSelectedDistrict(map);
        }
        // click to select district in selection mode (once)
        if (!_districtClickWired && map.getLayer('districts-fill')) {
          _districtClickWired = true;
          map.on('click', 'districts-fill', (e) => {
            const f = e.features && e.features[0];
            const code = (f?.properties?.DIST_NUMC || '').toString().padStart(2,'0');
            if (store.queryMode === 'district' && code) {
              store.selectedDistrictCode = code;
              upsertSelectedDistrict(map, code);
              removeBufferOverlay();
              refreshAll();
            }
          });
        }
      }
    } catch (e) {
      console.warn('Boundary refresh failed:', e);
    }

    if (queryMode === 'buffer') {
      if (store.center3857) {
        refreshPoints(map, { start, end, types, queryMode }).catch((e) => console.warn('Points refresh failed:', e));
      } else {
        try { const { clearCrimePoints } = await import('./map/points.js'); clearCrimePoints(map); } catch {}
      }
    } else if (queryMode === 'district') {
      refreshPoints(map, { start, end, types, queryMode, selectedDistrictCode }).catch((e) => console.warn('Points refresh failed:', e));
    } else {
      try { const { clearCrimePoints } = await import('./map/points.js'); clearCrimePoints(map); } catch {}
    }

    const f = store.getFilters();
    updateAllCharts(f).catch((e) => {
      console.error(e);
      const pane = document.getElementById('charts') || document.body;
      const status = document.getElementById('charts-status') || (() => {
        const d = document.createElement('div');
        d.id = 'charts-status';
        d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
        pane.appendChild(d);
        return d;
      })();
      status.innerText = 'Charts unavailable: ' + (e.message || e);
    });

    // Compare card (A) live
    if (store.center3857) {
      await updateCompare({
        types,
        center3857: store.center3857,
        radiusM: store.radius,
        timeWindowMonths: store.timeWindowMonths,
        adminLevel: store.adminLevel,
      }).catch((e) => console.warn('Compare update failed:', e));
    }
  }

  initPanel(store, {
    onChange: refreshAll,
    getMapCenter: () => map.getCenter(),
    onTractsOverlayToggle: (visible) => {
      const layer = map.getLayer('tracts-outline-line');
      if (layer) {
        map.setLayoutProperty('tracts-outline-line', 'visibility', visible ? 'visible' : 'none');
      }
    },
  });

  // Selection mode: click to set A and update buffer circle
  function updateBuffer() {
    if (!store.centerLonLat) return;
    const circle = turf.circle(store.centerLonLat, store.radius, { units: 'meters', steps: 64 });
    const srcId = 'buffer-a';
    if (map.getSource(srcId)) {
      map.getSource(srcId).setData(circle);
    } else {
      map.addSource(srcId, { type: 'geojson', data: circle });
      map.addLayer({ id: 'buffer-a-fill', type: 'fill', source: srcId, paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'buffer-a-line', type: 'line', source: srcId, paint: { 'line-color': '#0284c7', 'line-width': 1.5 } });
    }
  }

  map.on('click', (e) => {
    if (store.queryMode === 'buffer' && store.selectMode === 'point') {
      const lngLat = [e.lngLat.lng, e.lngLat.lat];
      store.centerLonLat = lngLat;
      store.setCenterFromLngLat(e.lngLat.lng, e.lngLat.lat);
      // marker A
      if (!window.__markerA && window.maplibregl && window.maplibregl.Marker) {
        window.__markerA = new window.maplibregl.Marker({ color: '#ef4444' });
      }
      if (window.__markerA && window.__markerA.setLngLat) {
        window.__markerA.setLngLat(e.lngLat).addTo(map);
      }
      upsertBufferA(map, { centerLonLat: store.centerLonLat, radiusM: store.radius });
      store.selectMode = 'idle';
      const btn = document.getElementById('useCenterBtn'); if (btn) btn.textContent = 'Select on map';
      const hint = document.getElementById('useMapHint'); if (hint) hint.style.display = 'none';
      document.body.style.cursor = '';
      window.__dashboard = window.__dashboard || {}; window.__dashboard.lastPick = { when: new Date().toISOString(), lngLat };
      refreshAll();
    }
  });

  // react to radius changes
  const radiusObserver = new MutationObserver(() => updateBuffer());
  radiusObserver.observe(document.documentElement, { attributes: false, childList: false, subtree: false });

  function removeBufferOverlay() {
    for (const id of ['buffer-a-fill','buffer-a-line']) { if (map.getLayer(id)) try { map.removeLayer(id); } catch {} }
    if (map.getSource('buffer-a')) try { map.removeSource('buffer-a'); } catch {}
  }

  function getTractGEOID(props) {
    return props?.GEOID || props?.GEOID20 || props?.TRACT_GEOID ||
           (props?.STATE && props?.COUNTY && props?.TRACT
             ? String(props.STATE).padStart(2,'0') + String(props.COUNTY).padStart(3,'0') + String(props.TRACT).padStart(6,'0')
             : (props?.TRACT_FIPS && props?.STATE_FIPS && props?.COUNTY_FIPS
                 ? String(props.STATE_FIPS).padStart(2,'0') + String(props.COUNTY_FIPS).padStart(3,'0') + String(props.TRACT_FIPS).padStart(6,'0')
                 : null));
  }
});
