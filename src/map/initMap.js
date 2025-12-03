import maplibregl from 'maplibre-gl';
import { MAP_STYLES, resolveMapStyle } from '../config.js';

const DEFAULT_CENTER = [-75.1652, 39.9526];
const DEFAULT_ZOOM = 11;
let diaryStyleNoticeLogged = false;

/**
 * Initialize a MapLibre map instance with a simple OSM raster basemap.
 * @returns {import('maplibre-gl').Map}
 */
export function initMap(options = {}) {
  const {
    container = 'map',
    center = DEFAULT_CENTER,
    zoom = DEFAULT_ZOOM,
    mode = 'crime',
  } = options;

  if (mode !== 'diary' && MAP_STYLES.diaryLight && !diaryStyleNoticeLogged) {
    console.info('[Diary] diaryLight style configured; call initMap({ mode: "diary" }) once Diary basemap swap is approved.');
    diaryStyleNoticeLogged = true;
  }
  if (mode === 'diary' && !MAP_STYLES.diaryLight) {
    console.info('[Diary] Diary mode requested but no diaryLight style configured; falling back to default basemap.');
  }

  const map = new maplibregl.Map({
    container,
    style: resolveMapStyle(mode),
    center,
    zoom,
  });

  return map;
}
