import {
  extractLineCoordinates,
  ROUTE_ALT_SEG_IDS_PROP,
  ROUTE_SEG_IDS_PROP,
} from './data_normalization.js';
import '../i18n/p1.js';
import { t } from '../i18n/index.js';

export function resolveAlternativeForRoute(routeFeature, { getSegment } = {}) {
  if (!routeFeature) return null;
  const props = routeFeature.properties || {};
  const altIds = Array.isArray(props[ROUTE_ALT_SEG_IDS_PROP]) && props[ROUTE_ALT_SEG_IDS_PROP].length > 0
    ? props[ROUTE_ALT_SEG_IDS_PROP]
    : props[ROUTE_SEG_IDS_PROP] || [];
  const altLength = Number.isFinite(props.alt_length_m) ? props.alt_length_m : props.length_m;
  const altDuration = Number.isFinite(props.alt_duration_min) ? props.alt_duration_min : props.duration_min;
  const geometry = props.alt_geometry || buildGeometryFromSegments(altIds, { getSegment });
  if (!geometry) return null;
  return {
    feature: {
      type: 'Feature',
      geometry,
      properties: { route_id: `${props.route_id || 'route'}_alt` },
    },
    meta: {
      [ROUTE_SEG_IDS_PROP]: altIds,
      alt_length_m: Number(altLength),
      alt_duration_min: Number(altDuration),
    },
  };
}

export function buildGeometryFromSegments(segmentIds, { getSegment } = {}) {
  if (!segmentIds?.length || typeof getSegment !== 'function') return null;
  const coordinates = [];
  for (const id of segmentIds) {
    const feature = getSegment(id);
    const line = extractLineCoordinates(feature?.geometry);
    if (!line.length) return null;
    if (!coordinates.length) {
      coordinates.push(...line);
      continue;
    }
    const last = coordinates.at(-1);
    const first = line[0];
    coordinates.push(...(last?.[0] === first?.[0] && last?.[1] === first?.[1] ? line.slice(1) : line));
  }
  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
}

export function summarizeAlternativeBenefit(primaryRoute, altMeta, { countLowRated } = {}) {
  if (!primaryRoute || !altMeta || typeof countLowRated !== 'function') return null;
  const primaryIds = primaryRoute.properties?.[ROUTE_SEG_IDS_PROP] || [];
  const altIds = altMeta[ROUTE_SEG_IDS_PROP] || [];
  const primaryLength = Number(primaryRoute.properties?.length_m) || 0;
  const altLength = Number(altMeta.alt_length_m ?? primaryLength) || primaryLength;
  const primaryDuration = Number(primaryRoute.properties?.duration_min) || 0;
  const altDuration = Number(altMeta.alt_duration_min ?? primaryDuration) || primaryDuration;
  return {
    pLow: countLowRated(primaryIds),
    aLow: countLowRated(altIds),
    overheadPct: primaryLength > 0 ? ((altLength - primaryLength) / primaryLength) * 100 : 0,
    deltaMin: Number((altDuration - primaryDuration).toFixed(1)),
  };
}

export function describeAlternativeTradeoff(summary) {
  if (!summary) return null;
  const avoided = Math.max(0, Number(summary.pLow || 0) - Number(summary.aLow || 0));
  const deltaMinutes = Number(summary.deltaMin) || 0;
  const distanceDelta = Number(summary.overheadPct) || 0;
  const formattedMinutes = Number.isInteger(Math.abs(deltaMinutes))
    ? Math.abs(deltaMinutes)
    : Math.abs(deltaMinutes).toFixed(1);
  const duration = deltaMinutes > 0
    ? t('diary.alternative.minutesLonger', { count: formattedMinutes })
    : deltaMinutes < 0
      ? t('diary.alternative.minutesShorter', { count: formattedMinutes })
      : t('diary.alternative.sameDuration');
  const distance = distanceDelta > 0
    ? t('diary.alternative.farther', { count: Math.round(distanceDelta) })
    : distanceDelta < 0
      ? t('diary.alternative.shorter', { count: Math.round(Math.abs(distanceDelta)) })
      : t('diary.alternative.sameDistance');
  return Object.freeze({
    benefit: avoided > 0
      ? t(avoided === 1 ? 'diary.alternative.avoidsOne' : 'diary.alternative.avoidsMany', { count: avoided })
      : t('diary.alternative.noAvoided'),
    cost: `${duration} · ${distance}`,
    caveat: t('diary.alternative.caveat'),
    hasBenefit: avoided > 0,
  });
}
