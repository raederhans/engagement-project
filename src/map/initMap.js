import maplibregl from 'maplibre-gl';
import { MAP_STYLES, resolveMapStyle } from '../config.js';
import { setTranslatedAttribute, setTranslatedText } from '../i18n/index.js';
import { prefersReducedMotion } from './camera_fit.js';

const DEFAULT_CENTER = [-75.1652, 39.9526];
const DEFAULT_ZOOM = 11;

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

  const map = new maplibregl.Map({
    container,
    style: resolveMapStyle(mode),
    center,
    zoom,
  });
  installDefaultMapControls(map, {
    initialView: { center, zoom },
  });
  const contextRecovery = installMapContextRecovery(map);
  map.once?.('remove', contextRecovery.remove);

  return map;
}

export function installMapContextRecovery(map, {
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  scheduler = globalThis,
} = {}) {
  const root = documentRef?.querySelector?.('[data-map-recovery]');
  const message = documentRef?.querySelector?.('[data-map-recovery-message]');
  const reload = documentRef?.querySelector?.('[data-map-recovery-reload]');
  if (!root || !message || !reload || !map?.on || !map?.off) return { remove() {} };

  let hideTimer = null;
  let removed = false;
  const clearHideTimer = () => {
    if (hideTimer == null) return;
    scheduler.clearTimeout?.(hideTimer);
    hideTimer = null;
  };
  const hide = () => {
    hideTimer = null;
    root.hidden = true;
    root.dataset.phase = 'idle';
  };
  const onLost = () => {
    if (removed) return;
    clearHideTimer();
    root.hidden = false;
    root.dataset.phase = 'lost';
    setTranslatedText(message, 'map.contextLost');
    setTranslatedText(reload, 'map.reload');
    reload.hidden = false;
  };
  const onRestored = () => {
    if (removed) return;
    clearHideTimer();
    root.hidden = false;
    root.dataset.phase = 'restored';
    setTranslatedText(message, 'map.contextRestored');
    reload.hidden = true;
    hideTimer = scheduler.setTimeout?.(hide, 4_000) ?? null;
  };
  const reloadPage = () => windowRef?.location?.reload?.();

  map.on('webglcontextlost', onLost);
  map.on('webglcontextrestored', onRestored);
  reload.addEventListener?.('click', reloadPage);

  return {
    remove() {
      if (removed) return;
      removed = true;
      clearHideTimer();
      map.off('webglcontextlost', onLost);
      map.off('webglcontextrestored', onRestored);
      reload.removeEventListener?.('click', reloadPage);
      hide();
    },
  };
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

export function createResetExtentControl({
  documentRef,
  initialView,
  windowRef = globalThis.window,
} = {}) {
  let map;
  let button;
  const resetMap = () => {
    const view = {
      center: initialView.center,
      zoom: initialView.zoom,
      bearing: 0,
      pitch: 0,
    };
    if (prefersReducedMotion(windowRef)) map?.jumpTo?.(view);
    else map?.easeTo?.({ ...view, duration: 350 });
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

export function localizeMapMarker(marker, {
  labelKey = 'map.marker',
  interactive = false,
} = {}) {
  const element = marker.getElement?.();
  setTranslatedAttribute(element, labelKey, 'title');
  setTranslatedAttribute(element, labelKey, 'aria-label');
  element?.setAttribute?.('role', 'img');
  if (!interactive) element?.setAttribute?.('tabindex', '-1');
  return marker;
}
