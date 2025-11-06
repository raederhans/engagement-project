/**
 * Compute k-quantile breaks for an array of numeric values.
 * Returns an array of (k-1) thresholds for use with a step expression.
 * @param {number[]} values
 * @param {number} [k=5]
 * @returns {number[]}
 */
export function quantileBreaks(values, k = 5) {
  const nums = (values || [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (nums.length === 0 || k < 2) return [];

  const breaks = [];
  for (let i = 1; i < k; i++) {
    const pos = i * (nums.length - 1) / k;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const val = idx + 1 < nums.length ? nums[idx] * (1 - frac) + nums[idx + 1] * frac : nums[idx];
    breaks.push(Number(val.toFixed(2)));
  }
  return breaks;
}

/**
 * Map a numeric value to a color given breaks.
 * @param {number} value
 * @param {number[]} breaks - thresholds (ascending)
 * @returns {string} hex color
 */
export function colorFor(value, breaks) {
  const palette = ['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d'];
  if (!Number.isFinite(value) || !Array.isArray(breaks) || breaks.length === 0) return palette[0];
  let idx = 0;
  for (let i = 0; i < breaks.length; i++) {
    if (value < breaks[i]) { idx = i; break; }
    idx = i + 1;
  }
  return palette[Math.min(idx, palette.length - 1)];
}

