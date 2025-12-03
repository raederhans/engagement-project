import { STREET_NAME_PROP, SEGMENT_ID_PROP } from './data_normalization.js';

export function getSegmentDisplayLabel(segmentFeature, fallbackIndex = 1) {
  const props = segmentFeature?.properties || {};
  const street = props[STREET_NAME_PROP] || props.street || props.name;
  if (street && typeof street === 'string' && street.trim()) {
    return street.trim();
  }
  return `Segment ${fallbackIndex}`;
}

export function getSegmentId(feature) {
  return feature?.properties?.[SEGMENT_ID_PROP] || feature?.properties?.id || null;
}
