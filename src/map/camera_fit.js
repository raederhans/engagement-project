const DEFAULT_GUTTER = 24;
const MIN_VISIBLE_MAP = 80;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRect(rect) {
  if (!rect) return null;
  const left = finite(rect.left);
  const top = finite(rect.top);
  const right = finite(rect.right);
  const bottom = finite(rect.bottom);
  if ([left, top, right, bottom].some((value) => value == null)) return null;
  const width = finite(rect.width) ?? right - left;
  const height = finite(rect.height) ?? bottom - top;
  if (width <= 0 || height <= 0) return null;
  return { left, top, right, bottom, width, height };
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function clampPadding(padding, mapRect) {
  const horizontalLimit = Math.max(DEFAULT_GUTTER * 2, mapRect.width - MIN_VISIBLE_MAP);
  const verticalLimit = Math.max(DEFAULT_GUTTER * 2, mapRect.height - MIN_VISIBLE_MAP);
  const horizontalTotal = padding.left + padding.right;
  const verticalTotal = padding.top + padding.bottom;
  if (horizontalTotal > horizontalLimit) {
    const scale = horizontalLimit / horizontalTotal;
    padding.left *= scale;
    padding.right *= scale;
  }
  if (verticalTotal > verticalLimit) {
    const scale = verticalLimit / verticalTotal;
    padding.top *= scale;
    padding.bottom *= scale;
  }
  return Object.fromEntries(
    Object.entries(padding).map(([key, value]) => [key, Math.round(value)]),
  );
}

export function resolvePanelAwarePadding({
  mapRect: rawMapRect,
  obstructionRects = [],
  gutter = DEFAULT_GUTTER,
} = {}) {
  const mapRect = normalizeRect(rawMapRect);
  if (!mapRect) {
    return { top: gutter, right: gutter, bottom: gutter, left: gutter };
  }
  const padding = { top: gutter, right: gutter, bottom: gutter, left: gutter };

  for (const rawRect of obstructionRects) {
    const rect = normalizeRect(rawRect);
    if (!rect || !intersects(mapRect, rect)) continue;
    const spansWidth = rect.width >= mapRect.width * 0.6;
    const spansHeight = rect.height >= mapRect.height * 0.6;

    if (spansWidth) {
      if (rect.top <= mapRect.top + gutter) {
        padding.top = Math.max(padding.top, rect.bottom - mapRect.top + gutter);
      } else {
        padding.bottom = Math.max(padding.bottom, mapRect.bottom - rect.top + gutter);
      }
      continue;
    }
    if (spansHeight) {
      if (rect.left <= mapRect.left + gutter) {
        padding.left = Math.max(padding.left, rect.right - mapRect.left + gutter);
      } else {
        padding.right = Math.max(padding.right, mapRect.right - rect.left + gutter);
      }
      continue;
    }

    const distances = [
      ['top', Math.abs(rect.top - mapRect.top), rect.bottom - mapRect.top + gutter],
      ['right', Math.abs(mapRect.right - rect.right), mapRect.right - rect.left + gutter],
      ['bottom', Math.abs(mapRect.bottom - rect.bottom), mapRect.bottom - rect.top + gutter],
      ['left', Math.abs(rect.left - mapRect.left), rect.right - mapRect.left + gutter],
    ].sort((a, b) => a[1] - b[1]);
    const [edge, , value] = distances[0];
    padding[edge] = Math.max(padding[edge], value);
  }

  return clampPadding(padding, mapRect);
}

export function geometryBounds(value) {
  const coordinates = [];
  const visit = (node) => {
    if (!node) return;
    if (node.type === 'FeatureCollection') {
      for (const feature of node.features || []) visit(feature);
      return;
    }
    if (node.type === 'Feature') {
      visit(node.geometry);
      return;
    }
    if (node.type === 'GeometryCollection') {
      for (const geometry of node.geometries || []) visit(geometry);
      return;
    }
    const walk = (entry) => {
      if (!Array.isArray(entry)) return;
      if (entry.length >= 2 && finite(entry[0]) != null && finite(entry[1]) != null) {
        coordinates.push([Number(entry[0]), Number(entry[1])]);
        return;
      }
      for (const child of entry) walk(child);
    };
    walk(node.coordinates);
  };
  visit(value);
  if (coordinates.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coordinates) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [[minX, minY], [maxX, maxY]];
}

export function bufferBounds(centerLonLat, radiusM) {
  if (!Array.isArray(centerLonLat) || centerLonLat.length < 2) return null;
  const longitude = finite(centerLonLat[0]);
  const latitude = finite(centerLonLat[1]);
  const radius = finite(radiusM);
  if (longitude == null || latitude == null || radius == null || radius <= 0) return null;
  const latitudeDelta = radius / 111_320;
  const cosine = Math.max(0.01, Math.cos(latitude * Math.PI / 180));
  const longitudeDelta = radius / (111_320 * cosine);
  return [
    [longitude - longitudeDelta, latitude - latitudeDelta],
    [longitude + longitudeDelta, latitude + latitudeDelta],
  ];
}

function isVisible(element, windowRef) {
  if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
  const style = windowRef?.getComputedStyle?.(element);
  return !style || (style.display !== 'none' && style.visibility !== 'hidden');
}

export function readPanelAwarePadding(map, {
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  const mapRect = map?.getContainer?.()?.getBoundingClientRect?.();
  const obstructionRects = [];
  for (const selector of ['.app-bar', '#sidepanel', '#results-drawer', '.diary-insights-root']) {
    const element = documentRef?.querySelector?.(selector);
    if (!isVisible(element, windowRef)) continue;
    const rect = element.getBoundingClientRect?.();
    if (rect) obstructionRects.push(rect);
  }
  return resolvePanelAwarePadding({ mapRect, obstructionRects });
}

export function prefersReducedMotion(windowRef = globalThis.window) {
  return Boolean(windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

export function fitBoundsWithPanel(map, bounds, {
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  duration = 450,
  maxZoom = 15,
} = {}) {
  if (!map?.fitBounds || !bounds) return false;
  map.fitBounds(bounds, {
    padding: readPanelAwarePadding(map, { documentRef, windowRef }),
    duration: prefersReducedMotion(windowRef) ? 0 : duration,
    maxZoom,
  });
  return true;
}
