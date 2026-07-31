import { extractLineCoordinates } from './data_normalization.js';

export function buildSimulationCoordinates(geometry, { stepDegrees = 0.0002 } = {}) {
  const base = extractLineCoordinates(geometry);
  const result = [];
  for (const current of base) {
    if (!current) continue;
    if (!result.length) {
      result.push(current);
      continue;
    }
    const previous = result.at(-1);
    const steps = Math.max(1, Math.ceil(distanceBetween(previous, current) / stepDegrees));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      result.push([
        previous[0] + (current[0] - previous[0]) * ratio,
        previous[1] + (current[1] - previous[1]) * ratio,
      ]);
    }
  }
  return result;
}

function distanceBetween(a, b) {
  if (!a || !b) return 0;
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy);
}
