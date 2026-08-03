import maplibregl from 'maplibre-gl';
import { MAP_STYLES, resolveMapStyle } from '../config.js';
import { setTranslatedAttribute } from '../i18n/index.js';

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
  installDefaultMapControls(map, {
    initialView: { center, zoom },
  });

  return map;
}

export function installDefaultMapControls(map, {
  maplibre = maplibregl,
  documentRef = globalThis.document,
  initialView = { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
} = {}) {
  const navigation = new maplibre.NavigationControl({
    showCompass: true,
    showZoom: true,
    visualizePitch: true,
  });
  const reset = createResetExtentControl({ documentRef, initialView });
  map.addControl(navigation, 'top-right');
  map.addControl(reset, 'top-right');
  localizeMapControls(map);

  return {
    remove() {
      map.removeControl?.(reset);
      map.removeControl?.(navigation);
    },
  };
}

function localizeMapControls(map) {
  const container = map.getContainer?.();
  const bindings = [
    ['.maplibregl-ctrl-zoom-in', 'map.zoomIn'],
    ['.maplibregl-ctrl-zoom-out', 'map.zoomOut'],
    ['.maplibregl-ctrl-compass', 'map.resetBearing'],
    ['.maplibregl-ctrl-attrib-button', 'map.toggleAttribution'],
  ];
  for (const [selector, key] of bindings) {
    const element = container?.querySelector?.(selector);
    setTranslatedAttribute(element, key, 'title');
    setTranslatedAttribute(element, key, 'aria-label');
  }
  setTranslatedAttribute(map.getCanvas?.(), 'map.canvas', 'aria-label');
}

function createResetExtentControl({ documentRef, initialView }) {
  let map;
  let button;
  const resetMap = () => {
    map?.easeTo({
      center: initialView.center,
      zoom: initialView.zoom,
      bearing: 0,
      pitch: 0,
      duration: 350,
    });
  };

  return {
    onAdd(nextMap) {
      map = nextMap;
      const container = documentRef.createElement('div');
      container.className = 'maplibregl-ctrl maplibregl-ctrl-group map-reset-control';
      button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'map-reset-control__button';
      setTranslatedAttribute(button, 'map.resetExtent', 'title');
      setTranslatedAttribute(button, 'map.resetExtent', 'aria-label');
      button.textContent = '⌂';
      button.addEventListener('click', resetMap);
      container.appendChild?.(button);
      return container;
    },
    onRemove() {
      button?.removeEventListener('click', resetMap);
      button?.parentNode?.remove?.();
      button = null;
      map = null;
    },
  };
}

export function createMapMarker(options = {}) {
  return new maplibregl.Marker(options);
}

export function localizeMapMarker(marker) {
  const element = marker.getElement?.();
  setTranslatedAttribute(element, 'map.marker', 'title');
  setTranslatedAttribute(element, 'map.marker', 'aria-label');
  return marker;
}
