import maplibregl from 'maplibre-gl';
import dayjs from 'dayjs';
import { store } from '../state/store.js';
import { fetchByDistrict, fetchTopTypesByDistrict } from '../api/crime.js';

export function attachDistrictPopup(map, layer = 'districts-fill') {
  let popup;
  map.on('click', layer, async (e) => {
    try {
      const f = e.features && e.features[0];
      if (!f) return;
      const code = String(f.properties?.DIST_NUMC || '').padStart(2, '0');
      const name = f.properties?.name || `District ${code}`;
      const { start, end, types } = store.getFilters();
      const [byDist, topn] = await Promise.all([
        fetchByDistrict({ start, end, types }),
        fetchTopTypesByDistrict({ start, end, types, dc_dist: code, limit: 3 }),
      ]);
      const n = (Array.isArray(byDist?.rows) ? byDist.rows : byDist).find?.((r) => String(r.dc_dist).padStart(2,'0') === code)?.n || 0;
      const topRows = Array.isArray(topn?.rows) ? topn.rows : topn;
      const html = `
        <div style="min-width:220px">
          <div style="font-weight:600">${name} (${code})</div>
          <div>Total: ${n}</div>
          <div>Top 3: ${(topRows||[]).map(r=>`${r.text_general_code} (${r.n})`).join(', ') || '—'}</div>
        </div>`;

      if (popup) popup.remove();
      popup = new maplibregl.Popup({ closeButton: true })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    } catch (err) {
      console.warn('District popup failed:', err);
    }
  });

  map.on('click', (e) => {
    // clicking elsewhere closes via default closeButton; no-op here
  });
}

