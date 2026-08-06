import {
  ROUTE_CORRIDOR_INPUT_LIMITS,
  validateKnownRouteInput,
} from './route_corridor_capability.js';

export const ROUTE_GEOJSON_MAX_TEXT_CHARS = 256_000;
export const ROUTE_GEOJSON_MAX_FILE_BYTES = 256_000;

/**
 * Parse an explicitly selected GeoJSON route locally. This function performs
 * no network, storage, URL, location-permission, or map-matching work.
 */
export function parseRouteGeoJsonText(text) {
  if (typeof text !== 'string') {
    throw new Error('Imported route must contain GeoJSON text.');
  }
  if (text.length > ROUTE_GEOJSON_MAX_TEXT_CHARS) {
    throw new Error('Imported route GeoJSON is too large.');
  }
  if (text.trim() === '') {
    throw new Error('Imported route must contain GeoJSON text.');
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Imported route must be valid GeoJSON JSON.');
  }

  const lineStrings = extractLineStrings(value);
  if (lineStrings.length !== 1) {
    throw new Error('Imported GeoJSON must contain exactly one LineString route.');
  }
  return admittedRoute('imported-route', lineStrings[0].coordinates);
}

/** Read a user-selected File/Blob in the browser without uploading it. */
export async function readRouteGeoJsonFile(file) {
  if (!file || typeof file.text !== 'function') {
    throw new Error('A user-selected GeoJSON file is required.');
  }
  if (Number.isFinite(file.size) && file.size > ROUTE_GEOJSON_MAX_FILE_BYTES) {
    throw new Error('Imported route GeoJSON file is too large.');
  }
  return parseRouteGeoJsonText(await file.text());
}

/** Create an explicit known route from caller-owned manual/drawing input. */
export function createManualRouteInput(coordinates) {
  return admittedRoute('manual-draw', coordinates);
}

function extractLineStrings(value) {
  if (value?.type === 'LineString') return [value];
  if (value?.type === 'Feature' && value.geometry?.type === 'LineString') {
    return [value.geometry];
  }
  if (value?.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return value.features
      .map((feature) => feature?.geometry)
      .filter((geometry) => geometry?.type === 'LineString');
  }
  return [];
}

function admittedRoute(source, coordinates) {
  if (Array.isArray(coordinates) && coordinates.length > ROUTE_CORRIDOR_INPUT_LIMITS.maxRouteVertices) {
    throw new Error('Route input exceeds the supported vertex limit.');
  }
  const routeInput = {
    inputKind: 'known-polyline',
    source,
    geometry: {
      type: 'LineString',
      coordinates: cloneCoordinates(coordinates),
    },
  };
  const admission = validateKnownRouteInput(routeInput);
  if (!admission.ok) throw new Error(`Route input is not a valid known route: ${admission.reason}.`);
  return routeInput;
}

function cloneCoordinates(value) {
  return Array.isArray(value)
    ? value.map((coordinate) => Array.isArray(coordinate) ? coordinate.slice(0, 2) : coordinate)
    : value;
}
