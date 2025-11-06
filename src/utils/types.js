import groups from '../data/offense_groups.json' assert { type: 'json' };

/**
 * Map offense text_general_code into coarse groups with colors.
 * @param {string} name
 * @returns {string} hex color
 */
export function groupColor(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('HOMICIDE')) return '#8b0000';
  if (n.includes('ROBBERY')) return '#d97706';
  if (n.includes('ASSAULT')) return '#ef4444';
  if (n.includes('BURGLARY')) return '#a855f7';
  if (n.includes('THEFT FROM VEHICLE')) return '#0ea5e9';
  if (n.includes('MOTOR VEHICLE THEFT')) return '#0891b2';
  if (n.includes('THEFT')) return '#22c55e';
  if (n.includes('NARCOTIC')) return '#10b981';
  if (n.includes('VANDALISM') || n.includes('CRIMINAL MISCHIEF')) return '#6366f1';
  return '#999999';
}

/**
 * Return an array of [matchKey, color] pairs for common categories.
 * Used to build a MapLibre match expression for unclustered points.
 */
export function categoryColorPairs() {
  return [
    ['HOMICIDE', '#8b0000'],
    ['ROBBERY FIREARM', '#d97706'],
    ['ROBBERY', '#d97706'],
    ['AGGRAVATED ASSAULT', '#ef4444'],
    ['SIMPLE ASSAULT', '#ef4444'],
    ['BURGLARY', '#a855f7'],
    ['THEFT FROM VEHICLE', '#0ea5e9'],
    ['MOTOR VEHICLE THEFT', '#0891b2'],
    ['THEFT', '#22c55e'],
    ['NARCOTICS', '#10b981'],
    ['DRUG', '#10b981'],
    ['VANDALISM', '#6366f1'],
    ['CRIMINAL MISCHIEF', '#6366f1'],
  ];
}

// Offense groups for controls (original JSON)
export const offenseGroups = groups;

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

// Build a lookup index that recognizes several naming variants
const OFFENSE_GROUPS_INDEX = (() => {
  const idx = new Map();
  for (const [Key, arr] of Object.entries(groups)) {
    const variants = new Set([
      Key,
      Key.toLowerCase(),
      toSnake(Key).toLowerCase(),
      toPascalFromSnake(Key),
    ]);
    for (const v of variants) idx.set(v, arr);
  }
  return idx;
})();

/**
 * Expand selected group keys into a flat list of text_general_code values.
 * @param {string[]} selectedGroups
 * @returns {string[]}
 */
export function expandGroupsToCodes(selectedGroups = []) {
  const out = new Set();
  for (const g of selectedGroups) {
    const candidates = [
      g,
      g?.toLowerCase?.(),
      toSnake(g)?.toLowerCase?.(),
      toPascalFromSnake(g),
    ];
    let codes = null;
    for (const c of candidates) {
      if (c && OFFENSE_GROUPS_INDEX.has(c)) { codes = OFFENSE_GROUPS_INDEX.get(c); break; }
    }
    if (Array.isArray(codes)) codes.forEach((c) => out.add(c));
  }
  return Array.from(out);
}

export function getCodesForGroups(groups) { return expandGroupsToCodes(groups); }
