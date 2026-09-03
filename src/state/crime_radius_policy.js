export const CRIME_RADIUS_POLICY = Object.freeze({
  min: 100,
  max: 10_000,
  defaultValue: 400,
  presets: Object.freeze([200, 400, 800, 1200, 1600, 2400]),
});

const PRESET_VALUES = new Set(CRIME_RADIUS_POLICY.presets);

export function isValidCrimeRadius(value) {
  const radius = Number(value);
  return Number.isInteger(radius)
    && radius >= CRIME_RADIUS_POLICY.min
    && radius <= CRIME_RADIUS_POLICY.max;
}

export function normalizeCrimeRadius(value, fallback = CRIME_RADIUS_POLICY.defaultValue) {
  return isValidCrimeRadius(value) ? Number(value) : fallback;
}

export function isCrimeRadiusPreset(value) {
  return PRESET_VALUES.has(Number(value));
}
