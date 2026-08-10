import { ACS_TRACT_GEOGRAPHY_VINTAGE } from '../data/acs_aggregation.js';

function unavailable(reason) {
  return { status: 'unavailable', reason, selections: null };
}

/** Convert an explicit text list into full-tract candidates without inference. */
export function parseAcsTractSelectionText(value) {
  if (typeof value !== 'string') return unavailable('tract-selection-required');
  const tokens = value.trim().split(/[\s,;]+/).filter(Boolean);
  if (tokens.length < 2) return unavailable('two-or-more-complete-tracts-required');
  if (tokens.some((geoid) => !/^42101\d{6}$/.test(geoid))) {
    return unavailable('invalid-philadelphia-tract-geoid');
  }
  if (new Set(tokens).size !== tokens.length) {
    return unavailable('duplicate-tract-selection');
  }
  return {
    status: 'available',
    reason: null,
    selections: Object.freeze(tokens.map((geoid) => Object.freeze({
      geoid,
      coverage: 'full-tract',
      geographyVintage: ACS_TRACT_GEOGRAPHY_VINTAGE,
    }))),
  };
}
