import maplibregl from 'maplibre-gl';
import dayjs from 'dayjs';
import { store } from '../state/store.js';
import { fetchByDistrict, fetchTopTypesByDistrict } from '../api/crime.js';
import { escapeHtml } from '../utils/html.js';
import { t } from '../i18n/index.js';

export function attachDistrictPopup(map, layer = 'districts-fill', {
  fetchByDistrictImpl = fetchByDistrict,
  fetchTopTypesByDistrictImpl = fetchTopTypesByDistrict,
  createPopup = () => new maplibregl.Popup({ closeButton: true }),
} = {}) {
  let popup;
  let active = true;
  const clickHandler = async (e) => {
    if (!active || store.queryMode !== 'district') return;
    try {
      const f = e.features && e.features[0];
      if (!f) return;
      const code = String(f.properties?.DIST_NUMC || '').padStart(2, '0');
      const name = f.properties?.name || t('crime.districtName', { code });
      const { start, end, types } = store.getFilters();
      const [byDist, topn] = await Promise.all([
        fetchByDistrictImpl({ start, end, types }),
        fetchTopTypesByDistrictImpl({ start, end, types, dc_dist: code, limit: 3 }),
      ]);
      if (!active) return;
      const n = (Array.isArray(byDist?.rows) ? byDist.rows : byDist).find?.((r) => String(r.dc_dist).padStart(2,'0') === code)?.n || 0;
      const topRows = Array.isArray(topn?.rows) ? topn.rows : topn;
      const safeName = escapeHtml(name);
      const safeCode = escapeHtml(code);
      const topRowsLabel = (topRows || [])
        .map((row) => `${row.text_general_code} (${Number(row.n) || 0})`)
        .join(', ');
      const html = `
        <div style="min-width:220px">
          <div style="font-weight:600">${safeName} (${safeCode})</div>
          <div>${escapeHtml(t('crime.popupTotal', { count: Number(n) || 0 }))}</div>
          <div>${escapeHtml(t('crime.popupTop3', { items: topRowsLabel || '—' }))}</div>
        </div>`;

      if (popup) popup.remove();
      popup = createPopup()
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    } catch (err) {
      console.warn('District popup failed:', err);
    }
  };
  map.on('click', layer, clickHandler);

  return () => {
    active = false;
    map.off('click', layer, clickHandler);
    popup?.remove();
    popup = null;
  };
}

