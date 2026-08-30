export const M5_PRIVATE_SENTINELS = Object.freeze([
  'M5 PRIVATE ADDRESS 7919',
  'M5 PRIVATE DIARY NOTE 8841',
  '-75.123456789',
  '39.987654321',
]);

export function assertNoPrivateSentinels(value, category) {
  let text = JSON.stringify(value);
  try { text = decodeURIComponent(text.replaceAll('+', ' ')); } catch {}
  const sentinelIndex = M5_PRIVATE_SENTINELS.findIndex((sentinel) => text.includes(sentinel));
  if (sentinelIndex < 0) return;
  const safeCategory = String(category).replace(/[^a-z0-9-]/gi, '-').slice(0, 48) || 'unknown';
  const error = new Error(
    `M5 privacy gate rejected category=${safeCategory} sentinel-index=${sentinelIndex}`,
  );
  error.code = 'M5_PRIVATE_SENTINEL_DETECTED';
  error.category = safeCategory;
  error.sentinelIndex = sentinelIndex;
  throw error;
}
