import { STREET_NAME_PROP, SEGMENT_ID_PROP } from './data_normalization.js';

export function getSegmentDisplayLabel(segmentFeature, fallbackIndex = 1) {
  const props = segmentFeature?.properties || {};
  const street = props[STREET_NAME_PROP] || props.street || props.name;
  const normalizedStreet = typeof street === 'string' ? street.trim() : '';
  if (normalizedStreet && !isPlaceholderStreetName(normalizedStreet)) {
    return normalizedStreet;
  }
  return `Segment ${fallbackIndex}`;
}

function isPlaceholderStreetName(value) {
  return /^(unknown|unnamed|n\/a|none)$/i.test(value);
}

export function getSegmentId(feature) {
  return feature?.properties?.[SEGMENT_ID_PROP] || feature?.properties?.id || null;
}
