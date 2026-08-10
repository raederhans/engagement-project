import fs from 'node:fs/promises';
import path from 'node:path';

export const HIN_2025_SCHEMA = 'phl-hin-2025-v1';
export const HIN_2025_FEATURE_COUNT = 162;
export const HIN_2025_ARTIFACT_MAX_BYTES = 280_000;
export const HIN_2025_COORDINATE_PRECISION = 6;
export const HIN_2025_ITEM_ID = '7e416319784a463fa0d8b528d7ccf511';
export const HIN_2025_LAYER_ID = 0;
export const HIN_2025_CRASH_DATA_PERIOD = Object.freeze([2019, 2023]);
export const HIN_2025_NETWORK_VINTAGE = 2025;

export const HIN_2025_ITEM_URL = `https://www.arcgis.com/sharing/rest/content/items/${HIN_2025_ITEM_ID}`;
export const HIN_2025_LAYER_URL = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/ArcGIS/rest/services/high_injury_network_2025/FeatureServer/0';
export const HIN_2025_OFFICIAL_CONTEXT_URL = 'https://visionzerophl.com/plans-and-reports/action-plan-25-30';
export const HIN_2025_TIME_SEMANTICS_URL = 'https://www.phila.gov/2025-11-25-city-of-philadelphia-releases-vision-zero-action-plan-2030/';

const HIN_2025_COUNT_URL = `${HIN_2025_LAYER_URL}/query?where=1%3D1&returnCountOnly=true&f=json`;
const HIN_2025_QUERY_URL = `${HIN_2025_LAYER_URL}/query?where=1%3D1&outFields=objectid%2Cstname%2Clength_ft%2CShape__Length&returnGeometry=true&outSR=4326&orderByFields=objectid%20ASC&f=geojson`;
export const HIN_2025_EXPECTED_FIELDS = Object.freeze([
  ['objectid', 'esriFieldTypeOID'],
  ['stname', 'esriFieldTypeString'],
  ['length_ft', 'esriFieldTypeDouble'],
  ['Shape__Length', 'esriFieldTypeDouble'],
]);
export const HIN_2025_EXPECTED_GEOMETRY_COUNTS = Object.freeze({ LineString: 6, MultiLineString: 156 });

export async function acquireOfficialHin2025({ request = fetch } = {}) {
  // ArcGIS intermittently rejects the four-request burst. Sequential reads
  // avoid manufacturing a source failure while preserving fail-closed checks.
  const item = await requestJson(`${HIN_2025_ITEM_URL}?f=pjson`, request);
  const layer = await requestJson(`${HIN_2025_LAYER_URL}?f=pjson`, request);
  const countResult = await requestJson(HIN_2025_COUNT_URL, request);
  const geojson = await requestJson(HIN_2025_QUERY_URL, request);
  const officialContextText = await requestText(HIN_2025_TIME_SEMANTICS_URL, request);
  validateOfficialHin2025Contract({ item, layer, countResult, geojson });
  validateOfficialHin2025TimeSemantics(officialContextText);
  return { item, layer, countResult, geojson, officialContextText };
}

export function validateOfficialHin2025Contract({ item, layer, countResult, geojson } = {}) {
  if (item?.id !== HIN_2025_ITEM_ID
    || item.type !== 'Feature Service'
    || item.access !== 'public') {
    throw new Error('HIN 2025 item identity, type, or public access changed.');
  }
  if (layer?.name !== 'high_injury_network_2025'
    || layer.geometryType !== 'esriGeometryPolyline'
    || layer.objectIdField !== 'objectid'
    || !['', null, undefined].includes(layer.globalIdField)) {
    throw new Error('HIN 2025 layer identity or geometry contract changed.');
  }
  const fields = Array.isArray(layer.fields)
    ? layer.fields.map(({ name, type }) => [name, type]) : null;
  if (JSON.stringify(fields) !== JSON.stringify(HIN_2025_EXPECTED_FIELDS)) {
    throw new Error('HIN 2025 official field schema changed.');
  }
  if (countResult?.count !== HIN_2025_FEATURE_COUNT) {
    throw new Error(`HIN 2025 official count must be ${HIN_2025_FEATURE_COUNT}.`);
  }
  if (!Number.isFinite(item.modified)
    || !Number.isFinite(layer?.editingInfo?.dataLastEditDate)
    || !Number.isFinite(layer?.editingInfo?.schemaLastEditDate)) {
    throw new Error('HIN 2025 source edit timestamps are unavailable.');
  }
  if (geojson?.type !== 'FeatureCollection'
    || !Array.isArray(geojson.features)
    || geojson.features.length !== HIN_2025_FEATURE_COUNT) {
    throw new Error('HIN 2025 GeoJSON count does not match the admitted source count.');
  }

  const identities = new Set();
  const geometryCounts = { LineString: 0, MultiLineString: 0 };
  for (const feature of geojson.features) {
    const propertyNames = Object.keys(feature?.properties || {}).sort();
    if (JSON.stringify(propertyNames) !== JSON.stringify(['Shape__Length', 'length_ft', 'objectid', 'stname'])) {
      throw new Error('HIN 2025 GeoJSON properties do not match the admitted field set.');
    }
    const objectid = feature.properties.objectid;
    if (!Number.isSafeInteger(objectid) || objectid <= 0 || identities.has(objectid)
      || (feature.id !== undefined && Number(feature.id) !== objectid)) {
      throw new Error('HIN 2025 contains an invalid or duplicate snapshot objectid.');
    }
    identities.add(objectid);
    if (!Object.hasOwn(geometryCounts, feature?.geometry?.type)) {
      throw new Error(`HIN 2025 has unsupported geometry ${feature?.geometry?.type || '(missing)'}.`);
    }
    geometryCounts[feature.geometry.type] += 1;
  }
  if (JSON.stringify(geometryCounts) !== JSON.stringify(HIN_2025_EXPECTED_GEOMETRY_COUNTS)) {
    throw new Error('HIN 2025 mixed geometry counts changed.');
  }
  return { featureCount: HIN_2025_FEATURE_COUNT, geometryCounts };
}

export function validateOfficialHin2025TimeSemantics(value) {
  const text = plainText(value);
  if (!/updated high injury network/i.test(text)
    || !/updated HIN is based on crash data from 2019 to 2023/i.test(text)) {
    throw new Error('HIN 2025 official crash-data period semantics changed or are unavailable.');
  }
  return Object.freeze({
    crashDataPeriod: [...HIN_2025_CRASH_DATA_PERIOD],
    networkVintage: HIN_2025_NETWORK_VINTAGE,
    officialContext: HIN_2025_TIME_SEMANTICS_URL,
  });
}

export function normalizeHin2025Snapshot({ item, layer, geojson, retrievedAt } = {}) {
  const retrieved = strictIsoTimestamp(retrievedAt, 'retrievedAt');
  validateOfficialHin2025Contract({
    item,
    layer,
    countResult: { count: geojson?.features?.length },
    geojson,
  });
  const rows = [...geojson.features]
    .sort((left, right) => left.properties.objectid - right.properties.objectid)
    .map((feature) => [
      feature.properties.objectid,
      feature.properties.stname,
      feature.properties.length_ft,
      feature.properties.Shape__Length,
      feature.geometry.type === 'LineString' ? 'L' : 'M',
      roundCoordinateTree(feature.geometry.coordinates, HIN_2025_COORDINATE_PRECISION),
    ]);
  const snapshot = {
    schema: HIN_2025_SCHEMA,
    meta: {
      dataset: 'Philadelphia High Injury Network 2025',
      definition: 'Historical planning network developed by Philadelphia OTIS from 2019-2023 crash data to guide traffic safety investments; not a live condition or route certification.',
      crashDataPeriod: [...HIN_2025_CRASH_DATA_PERIOD],
      networkVintage: HIN_2025_NETWORK_VINTAGE,
      retrievedAt: retrieved,
      itemMetadataModifiedAt: epochToIso(item.modified, 'item modified'),
      layerDataEditedAt: epochToIso(layer.editingInfo.dataLastEditDate, 'layer data edit'),
      layerSchemaEditedAt: epochToIso(layer.editingInfo.schemaLastEditDate, 'layer schema edit'),
      sourceItem: HIN_2025_ITEM_URL,
      sourceLayer: HIN_2025_LAYER_URL,
      officialContext: HIN_2025_OFFICIAL_CONTEXT_URL,
      method: 'ArcGIS GeoJSON ordered by objectid; rows encode [snapshotObjectId, streetName, lengthFt, shapeLength, geometryType, coordinates]; coordinates rounded to 6 decimals.',
      licenseAndWarranty: plainText(item.licenseInfo),
      featureCount: HIN_2025_FEATURE_COUNT,
      geometryCounts: { ...HIN_2025_EXPECTED_GEOMETRY_COUNTS },
      coordinatePrecision: HIN_2025_COORDINATE_PRECISION,
      objectIdScope: 'snapshot-local-only',
    },
    rows,
  };
  validateHin2025Snapshot(snapshot);
  return snapshot;
}

export function validateHin2025Snapshot(snapshot) {
  if (snapshot?.schema !== HIN_2025_SCHEMA) throw new Error('HIN 2025 snapshot schema is unsupported.');
  const meta = snapshot.meta;
  if (meta?.dataset !== 'Philadelphia High Injury Network 2025'
    || meta?.networkVintage !== HIN_2025_NETWORK_VINTAGE
    || JSON.stringify(meta.crashDataPeriod) !== JSON.stringify(HIN_2025_CRASH_DATA_PERIOD)
    || meta.featureCount !== HIN_2025_FEATURE_COUNT
    || meta.coordinatePrecision !== HIN_2025_COORDINATE_PRECISION
    || meta.objectIdScope !== 'snapshot-local-only') {
    throw new Error('HIN 2025 snapshot metadata contract is invalid.');
  }
  for (const [key, label] of [
    ['retrievedAt', 'retrievedAt'],
    ['itemMetadataModifiedAt', 'item metadata modified'],
    ['layerDataEditedAt', 'layer data edit'],
    ['layerSchemaEditedAt', 'layer schema edit'],
  ]) strictIsoTimestamp(meta[key], label);
  if (meta.sourceItem !== HIN_2025_ITEM_URL
    || meta.sourceLayer !== HIN_2025_LAYER_URL
    || meta.officialContext !== HIN_2025_OFFICIAL_CONTEXT_URL
    || typeof meta.definition !== 'string' || !meta.definition.includes('2019-2023')
    || typeof meta.licenseAndWarranty !== 'string' || !/without warranty/i.test(meta.licenseAndWarranty)) {
    throw new Error('HIN 2025 provenance, period definition, or City warranty is invalid.');
  }
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length !== HIN_2025_FEATURE_COUNT) {
    throw new Error('HIN 2025 snapshot row count is invalid.');
  }
  const identities = new Set();
  const geometryCounts = { LineString: 0, MultiLineString: 0 };
  let previousIdentity = 0;
  for (const row of snapshot.rows) {
    if (!Array.isArray(row) || row.length !== 6) throw new Error('HIN 2025 row tuple is invalid.');
    const [identity, streetName, lengthFt, shapeLength, geometryCode, coordinates] = row;
    if (!Number.isSafeInteger(identity) || identity <= previousIdentity || identities.has(identity)) {
      throw new Error('HIN 2025 snapshot-local object identities must be unique and sorted.');
    }
    previousIdentity = identity;
    identities.add(identity);
    if (typeof streetName !== 'string' || !streetName.trim()
      || !Number.isFinite(lengthFt) || lengthFt < 0
      || !Number.isFinite(shapeLength) || shapeLength < 0) {
      throw new Error('HIN 2025 responsibility fields are invalid.');
    }
    const type = geometryCode === 'L' ? 'LineString' : geometryCode === 'M' ? 'MultiLineString' : null;
    if (!type || !isValidLineCoordinates(type, coordinates)) {
      throw new Error('HIN 2025 compact geometry is invalid.');
    }
    geometryCounts[type] += 1;
  }
  if (JSON.stringify(geometryCounts) !== JSON.stringify(meta.geometryCounts)
    || JSON.stringify(geometryCounts) !== JSON.stringify(HIN_2025_EXPECTED_GEOMETRY_COUNTS)) {
    throw new Error('HIN 2025 snapshot geometry counts are invalid.');
  }
  return { featureCount: snapshot.rows.length, geometryCounts };
}

export function renderHin2025Snapshot(snapshot) {
  validateHin2025Snapshot(snapshot);
  const text = `${JSON.stringify(snapshot)}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes > HIN_2025_ARTIFACT_MAX_BYTES) {
    throw new Error(`HIN 2025 snapshot exceeds ${HIN_2025_ARTIFACT_MAX_BYTES} bytes: ${bytes}.`);
  }
  return { text, bytes };
}

export async function writeHin2025SnapshotAtomic(destination, snapshot) {
  const { text, bytes } = renderHin2025Snapshot(snapshot);
  const resolved = path.resolve(destination);
  const directory = path.dirname(resolved);
  const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}-${Date.now()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporary, text, 'utf8');
    await fs.rename(temporary, resolved);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return { destination: resolved, bytes };
}

async function requestJson(url, request) {
  const response = await request(url, { headers: { accept: 'application/json' } });
  if (!response?.ok) throw new Error(`HIN 2025 source request failed (${response?.status || 'unknown'}).`);
  const value = await response.json();
  if (value?.error) throw new Error(`HIN 2025 ArcGIS error: ${value.error.message || 'unknown'}.`);
  return value;
}

async function requestText(url, request) {
  const response = await request(url, { headers: { accept: 'text/html' } });
  if (!response?.ok) throw new Error(`HIN 2025 official context request failed (${response?.status || 'unknown'}).`);
  return response.text();
}

function epochToIso(value, label) {
  if (!Number.isFinite(value)) throw new Error(`HIN 2025 ${label} timestamp is invalid.`);
  return new Date(value).toISOString();
}

function strictIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || new Date(value).toISOString() !== value) {
    throw new Error(`HIN 2025 ${label} must be a canonical UTC timestamp.`);
  }
  return value;
}

function roundCoordinateTree(value, precision) {
  if (Array.isArray(value)) return value.map((item) => roundCoordinateTree(item, precision));
  if (!Number.isFinite(value)) throw new Error('HIN 2025 contains a non-finite coordinate.');
  return Number(value.toFixed(precision));
}

function isValidLineCoordinates(type, coordinates) {
  const lines = type === 'LineString' ? [coordinates] : coordinates;
  return Array.isArray(lines) && lines.length > 0 && lines.every((line) => (
    Array.isArray(line)
    && line.length >= 2
    && line.every(isLonLat)
  )) && lines.some((line) => (
    line.some(([lon, lat]) => lon !== line[0][0] || lat !== line[0][1])
  ));
}

function isLonLat(value) {
  return Array.isArray(value) && value.length === 2
    && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180
    && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
}

function plainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
