import groups from '../data/offense_groups.json' with { type: 'json' };

export const MAX_HIGHLIGHTED_OFFENSES = 3;

const THEME_INDEX = new Map(Object.entries(groups).map(([key, codes]) => [
  key,
  Object.freeze([...codes]),
]));

const LEGACY_GROUPS = Object.freeze({
  assault_gun: Object.freeze(THEME_INDEX.get('person').slice(6, 8)),
  burglary: Object.freeze(THEME_INDEX.get('property').slice(0, 2)),
  robbery_gun: Object.freeze(THEME_INDEX.get('person').slice(4, 6)),
  vandalism_other: Object.freeze([
    THEME_INDEX.get('public_order')[1],
    THEME_INDEX.get('property')[6],
  ]),
});

export const offenseGroups = groups;

export function normalizeHighlightedOffenses(codes = []) {
  const normalized = [];
  const seen = new Set();
  for (const value of Array.isArray(codes) ? codes : []) {
    const code = String(value || '').trim().slice(0, 120);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    normalized.push(code);
    if (normalized.length === MAX_HIGHLIGHTED_OFFENSES) break;
  }
  return normalized;
}

export function buildOffenseHighlights(codes, palette) {
  const colorIndexes = [4, 1, 3];
  return normalizeHighlightedOffenses(codes).map((code, index) => ({
    code,
    color: palette[colorIndexes[index]],
  }));
}

export function buildOffenseColorExpression(highlights) {
  if (highlights.length === 0) return '#999999';
  const expression = ['match', ['get', 'text_general_code']];
  for (const { code, color } of highlights) expression.push(code, color);
  expression.push('#6b7280');
  return expression;
}

export function syncOffenseHighlightOptions(select, codes) {
  const normalized = normalizeHighlightedOffenses(codes);
  const selected = new Set(normalized);
  for (const option of select?.options || []) {
    if (option.dataset?.i18n) continue;
    option.selected = selected.has(option.value);
    option.disabled = normalized.length === MAX_HIGHLIGHTED_OFFENSES && !option.selected;
  }
  return normalized;
}

// Canonicalization helpers for robust key matching
export function toSnake(s) {
  return String(s || '')
    .trim()
    .replace(/[\s\-\/()]+/g, '_')
    .replace(/__+/g, '_');
}

export function toPascalFromSnake(s) {
  return toSnake(s)
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('_');
}

function normalizedGroupKey(value) {
  return toSnake(value).toLowerCase();
}

/**
 * Expand selected group keys into a flat list of text_general_code values.
 * @param {string[]} selectedGroups
 * @returns {string[]}
 */
export function expandGroupsToCodes(selectedGroups = []) {
  const out = new Set();
  for (const g of selectedGroups) {
    const key = normalizedGroupKey(g);
    const codes = THEME_INDEX.get(key) || LEGACY_GROUPS[key];
    if (Array.isArray(codes)) codes.forEach((c) => out.add(c));
  }
  return Array.from(out);
}
