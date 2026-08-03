import { updateLegend, hideLegend } from './legend.js';
import { upsertTractsFill, showTractsFill, hideTractsFill } from './tracts_layers.js';
import { store } from '../state/store.js';
import { computeBreaks, makePalette, toMapLibreStep } from '../utils/classify.js';
import { setTranslatedText, t } from '../i18n/index.js';

/**
 * Render tracts choropleth, masking low-population tracts via __mask flag.
 * @param {import('maplibre-gl').Map} map
 * @param {{geojson: object, values: number[]}} merged
 * @returns {{breaks:number[], colors:string[]}}
 */
export function renderTractsChoropleth(map, merged) {
  const geojson = merged?.geojson || merged; // Handle both formats
  const values = merged?.values || (geojson?.features || []).map((f) => Number(f?.properties?.value) || 0);
  const subtitle = merged?.legendSubtitle || '';
  const unavailable = merged?.dataStatus === 'unavailable';

  const allZero = !unavailable && (values.length === 0 || values.every((v) => v === 0));
  const breaks = allZero ? [] : computeBreaks(values, { method: store.classMethod, bins: store.classBins, custom: store.classCustomBreaks });
  const colors = makePalette(store.classPalette, (breaks.length || Math.max(1, store.classBins - 1)) + 1);

  // Update legend
  if (unavailable || allZero || breaks.length === 0) {
    hideLegend();
    hideTractsFill(map);
    showOutlinesOnlyBanner(unavailable
      ? merged.statusMessage
      : t('crime.noTractIncidents'));
  } else {
    updateLegend({ title: t('crime.censusTracts'), unit: '', breaks, colors, subtitle });

    // Build step expression for fill color
    const { paintProps } = toMapLibreStep(breaks, colors, { opacity: store.classOpacity });

    // Update tract fill layer (use new tracts_layers module)
    upsertTractsFill(map, geojson, { fillColor: paintProps['fill-color'], fillOpacity: paintProps['fill-opacity'] });
    showTractsFill(map);
    hideTractsOutlineBanner();
  }

  return { breaks, colors };
}

/**
 * Show banner: tract outlines only (no choropleth data)
 */
function showOutlinesOnlyBanner(message) {
  let banner = document.getElementById('tracts-outline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'tracts-outline-banner';
    Object.assign(banner.style, {
      position: 'fixed',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(255, 243, 205, 0.95)',
      color: '#92400e',
      padding: '8px 12px',
      border: '1px solid #fbbf24',
      borderRadius: '6px',
      zIndex: '30',
      font: '13px/1.4 system-ui, sans-serif',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    });
    document.body.appendChild(banner);
  }
  if (message) {
    banner.removeAttribute('data-i18n');
    banner.textContent = message;
  } else {
    setTranslatedText(banner, 'crime.tractsUnavailable');
  }
  banner.style.display = 'block';
}

/**
 * Hide outlines-only banner
 */
export function hideTractsOutlineBanner() {
  const banner = document.getElementById('tracts-outline-banner');
  if (banner) {
    banner.style.display = 'none';
  }
}
