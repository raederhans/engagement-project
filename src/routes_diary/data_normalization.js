export const SEGMENT_ID_PROP = 'segment_id';
export const SCORE_PROP = 'decayed_mean';
export const NEFF_PROP = 'n_eff';
export const STREET_NAME_PROP = 'street_name';
export const TAGS_PROP = 'top_tags';
export const LENGTH_PROP = 'length_m';
export const CLASS_PROP = 'class';
export const ROUTE_ID_PROP = 'route_id';
export const ROUTE_SEG_IDS_PROP = 'segment_ids';
export const ROUTE_ALT_SEG_IDS_PROP = 'alt_segment_ids';
export const ROUTE_NAME_PROP = 'name';
export const ROUTE_FROM_PROP = 'from';
export const ROUTE_TO_PROP = 'to';

export function normalizeFeatureCollection(collection, normalizerFn) {
  const base = collection && collection.type === 'FeatureCollection'
    ? collection
    : { type: 'FeatureCollection', features: [] };
  const features = Array.isArray(base.features) ? base.features : [];
  return {
    type: 'FeatureCollection',
    features: features.map((f, idx) => normalizerFn(f, idx)),
  };
}

export function normalizeSegmentFeature(feature, idx = 0) {
  const base = feature?.type === 'Feature' ? feature : { type: 'Feature', properties: {}, geometry: feature?.geometry || null };
  const props = { ...(base.properties || {}) };
  const id = typeof props[SEGMENT_ID_PROP] === 'string' && props[SEGMENT_ID_PROP].trim()
    ? props[SEGMENT_ID_PROP].trim()
    : `seg_demo_${idx + 1}`;
  const scoreRaw = Number(props[SCORE_PROP]);
  const score = Number.isFinite(scoreRaw) ? Math.max(1, Math.min(5, scoreRaw)) : 3;
  const nEffRaw = Number(props[NEFF_PROP]);
  const nEff = Number.isFinite(nEffRaw) ? Math.max(0, nEffRaw) : 0;
  const lenRaw = Number(props[LENGTH_PROP]);
  const classRaw = Number(props[CLASS_PROP]);
  const street = props[STREET_NAME_PROP] || props.street || props.name || '';

  return {
    type: 'Feature',
    geometry: base.geometry || null,
    properties: {
      ...props,
      [SEGMENT_ID_PROP]: id,
      [SCORE_PROP]: score,
      [NEFF_PROP]: nEff,
      [LENGTH_PROP]: Number.isFinite(lenRaw) ? lenRaw : props.length_m || 0,
      [CLASS_PROP]: Number.isFinite(classRaw) ? classRaw : 3,
      [STREET_NAME_PROP]: typeof street === 'string' ? street : '',
    },
  };
}

export function normalizeRouteFeature(feature, idx = 0) {
  const base = feature?.type === 'Feature' ? feature : { type: 'Feature', properties: {}, geometry: feature?.geometry || null };
  const props = { ...(base.properties || {}) };
  const rid = typeof props[ROUTE_ID_PROP] === 'string' && props[ROUTE_ID_PROP].trim()
    ? props[ROUTE_ID_PROP].trim()
    : `route_demo_${idx + 1}`;
  const segIds = normalizeIdArray(props[ROUTE_SEG_IDS_PROP], idx);
  const altSegIds = normalizeIdArray(props[ROUTE_ALT_SEG_IDS_PROP], idx);
  const lengthRaw = Number(props.length_m);
  const durationRaw = Number(props.duration_min);
  const altLenRaw = Number(props.alt_length_m);
  const altDurRaw = Number(props.alt_duration_min);
  const altGeometry = props.alt_geometry && typeof props.alt_geometry === 'object'
    ? (typeof structuredClone === 'function' ? structuredClone(props.alt_geometry) : JSON.parse(JSON.stringify(props.alt_geometry)))
    : undefined;
  return {
    type: 'Feature',
    geometry: base.geometry || null,
    properties: {
      ...props,
      [ROUTE_ID_PROP]: rid,
      [ROUTE_NAME_PROP]: props[ROUTE_NAME_PROP] || props.name || rid,
      [ROUTE_FROM_PROP]: props[ROUTE_FROM_PROP] || props.from || 'Start',
      [ROUTE_TO_PROP]: props[ROUTE_TO_PROP] || props.to || 'Destination',
      [ROUTE_SEG_IDS_PROP]: segIds,
      [ROUTE_ALT_SEG_IDS_PROP]: altSegIds,
      length_m: Number.isFinite(lengthRaw) ? lengthRaw : 0,
      duration_min: Number.isFinite(durationRaw) ? durationRaw : 0,
      alt_length_m: Number.isFinite(altLenRaw) ? altLenRaw : undefined,
      alt_duration_min: Number.isFinite(altDurRaw) ? altDurRaw : undefined,
      alt_geometry: altGeometry,
    },
  };
}

function normalizeIdArray(arr, idx = 0) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((id) => (id === null || id === undefined ? '' : String(id)))
    .map((id, i) => (id.trim() ? id.trim() : `seg_demo_${idx + 1}_${i + 1}`))
    .filter(Boolean);
}
