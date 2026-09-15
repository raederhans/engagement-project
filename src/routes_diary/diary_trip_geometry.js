import { distanceMeters } from '../utils/geo_circle.js';

export function diaryRouteDistance(geometry) {
  if (!geometry) return null;
  const lines = geometry.type === 'LineString' ? [geometry.coordinates]
    : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
  if (!lines.length) return null;
  let distance = 0;
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2) return null;
    for (let i = 1; i < line.length; i += 1) {
      if (![...line[i - 1], ...line[i]].every(Number.isFinite)) return null;
      distance += distanceMeters(line[i - 1], line[i]);
    }
  }
  return distance;
}
