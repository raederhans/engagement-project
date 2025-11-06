const DATE_FLOOR = "2015-01-01";

/**
 * Ensure the provided ISO date is not earlier than the historical floor.
 * @param {string} value - ISO date string.
 * @returns {string} ISO date string clamped to the floor.
 */
export function dateFloorGuard(value) {
  const iso = ensureIso(value, "start");
  return iso < DATE_FLOOR ? DATE_FLOOR : iso;
}

/**
 * Clean and deduplicate offense type strings.
 * @param {string[]} [types] - Array of offense labels.
 * @returns {string[]} Sanitized values safe for SQL literal usage.
 */
export function sanitizeTypes(types) {
  if (!Array.isArray(types)) {
    return [];
  }

  const cleaned = types
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0)
    .map((value) => value.replace(/'/g, "''"));

  return Array.from(new Set(cleaned));
}

/**
 * Build the spatial envelope clause for a bounding box.
 * @param {number[] | {xmin:number, ymin:number, xmax:number, ymax:number}} bbox - Map bounding box in EPSG:3857.
 * @returns {string} SQL clause prefixed with AND or an empty string.
 */
export function envelopeClause(bbox) {
  if (!bbox) {
    return "";
  }

  const values = Array.isArray(bbox)
    ? bbox
    : [
        bbox.xmin ?? bbox.minX,
        bbox.ymin ?? bbox.minY,
        bbox.xmax ?? bbox.maxX,
        bbox.ymax ?? bbox.maxY,
      ];

  if (!Array.isArray(values) || values.length !== 4) {
    return "";
  }

  const numbers = values.map((value) => Number(value));
  if (numbers.some((value) => !Number.isFinite(value))) {
    return "";
  }

  const [xmin, ymin, xmax, ymax] = numbers;
  return `AND the_geom && ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}, 3857)`;
}

/**
 * Build SQL for point requests with optional type and bbox filters (§2.1).
 * @param {object} params
 * @param {string} params.start - Inclusive start ISO date.
 * @param {string} params.end - Exclusive end ISO date.
 * @param {string[]} [params.types] - Optional offense filters.
 * @param {number[] | {xmin:number, ymin:number, xmax:number, ymax:number}} [params.bbox] - Bounding box in EPSG:3857.
 * @returns {string} SQL statement.
 */
export function buildCrimePointsSQL({ start, end, types, bbox, dc_dist, drilldownCodes }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, "end");
  const clauses = baseTemporalClauses(startIso, endIso, types, { drilldownCodes });

  const bboxClause = envelopeClause(bbox);
  if (bboxClause) {
    clauses.push(`  ${bboxClause}`);
  }
  if (dc_dist) {
    clauses.push(`  ${buildDistrictFilter(dc_dist)}`);
  }

  return [
    "SELECT the_geom, dispatch_date_time, text_general_code, ucr_general, dc_dist, location_block",
    "FROM incidents_part1_part2",
    ...clauses,
  ].join("\n");
}

/**
 * Build SQL for the citywide monthly series (§2.2).
 * @param {object} params
 * @param {string} params.start - Inclusive start ISO date.
 * @param {string} params.end - Exclusive end ISO date.
 * @param {string[]} [params.types] - Optional offense filters.
 * @returns {string} SQL statement.
 */
export function buildMonthlyCitySQL({ start, end, types, dc_dist, drilldownCodes }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, "end");
  const clauses = baseTemporalClauses(startIso, endIso, types, { drilldownCodes });
  if (dc_dist) clauses.push(`  ${buildDistrictFilter(dc_dist)}`);

  return [
    "SELECT date_trunc('month', dispatch_date_time) AS m, COUNT(*) AS n",
    "FROM incidents_part1_part2",
    ...clauses,
    "GROUP BY 1 ORDER BY 1",
  ].join("\n");
}

/**
 * Build SQL for the buffer-based monthly series (§2.3).
 * @param {object} params
 * @param {string} params.start - Inclusive start ISO date.
 * @param {string} params.end - Exclusive end ISO date.
 * @param {string[]} [params.types] - Optional offense filters.
 * @param {number[] | {x:number, y:number}} params.center3857 - Center point (EPSG:3857).
 * @param {number} params.radiusM - Buffer radius in meters.
 * @returns {string} SQL statement.
 */
export function buildMonthlyBufferSQL({
  start,
  end,
  types,
  center3857,
  radiusM,
  drilldownCodes,
}) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, "end");
  const clauses = baseTemporalClauses(startIso, endIso, types, { drilldownCodes });
  clauses.push(`  ${dWithinClause(center3857, radiusM)}`);

  return [
    "SELECT date_trunc('month', dispatch_date_time) AS m, COUNT(*) AS n",
    "FROM incidents_part1_part2",
    ...clauses,
    "GROUP BY 1 ORDER BY 1",
  ].join("\n");
}

/**
 * Build SQL for top-N offense types within buffer (§2.4).
 * @param {object} params
 * @param {string} params.start - Inclusive start ISO date.
 * @param {string} params.end - Exclusive end ISO date.
 * @param {number[] | {x:number, y:number}} params.center3857 - Center in EPSG:3857.
 * @param {number} params.radiusM - Buffer radius in meters.
 * @param {number} [params.limit=12] - LIMIT clause.
 * @returns {string} SQL statement.
 */
export function buildTopTypesSQL({
  start,
  end,
  center3857,
  radiusM,
  limit = 12,
}) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, "end");
  const clauses = [
    ...baseTemporalClauses(startIso, endIso, undefined, { includeTypes: false }),
    `  ${dWithinClause(center3857, radiusM)}`,
  ];

  const limitValue = ensurePositiveInt(limit, "limit");

  return [
    "SELECT text_general_code, COUNT(*) AS n",
    "FROM incidents_part1_part2",
    ...clauses,
    `GROUP BY 1 ORDER BY n DESC LIMIT ${limitValue}`,
  ].join("\n");
}

/**
 * Build SQL for 7x24 heatmap aggregations (§2.5).
 * @param {object} params
 * @param {string} params.start - Inclusive start ISO date.
 * @param {string} params.end - Exclusive end ISO date.
 * @param {string[]} [params.types] - Optional offense filters.
 * @param {number[] | {x:number, y:number}} params.center3857 - Center in EPSG:3857.
 * @param {number} params.radiusM - Buffer radius in meters.
 * @returns {string} SQL statement.
 */
export function buildHeatmap7x24SQL({
  start,
  end,
  types,
  center3857,
  radiusM,
  drilldownCodes,
}) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, "end");
  const clauses = baseTemporalClauses(startIso, endIso, types, { drilldownCodes });
  clauses.push(`  ${dWithinClause(center3857, radiusM)}`);

  return [
    "SELECT EXTRACT(DOW  FROM dispatch_date_time AT TIME ZONE 'America/New_York') AS dow,",
    "       EXTRACT(HOUR FROM dispatch_date_time AT TIME ZONE 'America/New_York') AS hr,",
    "       COUNT(*) AS n",
    "FROM incidents_part1_part2",
    ...clauses,
    "GROUP BY 1,2 ORDER BY 1,2",
  ].join("\n");
}

/**
 * Build SQL for district aggregations (§2.6).
 * @param {object} params
 * @param {string} params.start - Inclusive start ISO date.
 * @param {string} params.end - Exclusive end ISO date.
 * @param {string[]} [params.types] - Optional offense filters.
 * @returns {string} SQL statement.
 */
export function buildByDistrictSQL({ start, end, types, drilldownCodes }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, "end");
  const clauses = baseTemporalClauses(startIso, endIso, types, { drilldownCodes });

  return [
    "SELECT dc_dist, COUNT(*) AS n",
    "FROM incidents_part1_part2",
    ...clauses,
    "GROUP BY 1 ORDER BY 1",
  ].join("\n");
}

/**
 * Top types for a given district code.
 * @param {{start:string,end:string,types?:string[],dc_dist:string,limit?:number}} p
 */
export function buildTopTypesDistrictSQL({ start, end, types, dc_dist, limit = 5, drilldownCodes }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, 'end');
  const clauses = baseTemporalClauses(startIso, endIso, types, { drilldownCodes });
  const dist = String(dc_dist).padStart(2, '0').replace(/'/g, "''");
  clauses.push(`  AND dc_dist = '${dist}'`);
  return [
    'SELECT text_general_code, COUNT(*) AS n',
    'FROM incidents_part1_part2',
    ...clauses,
    `GROUP BY 1 ORDER BY n DESC LIMIT ${ensurePositiveInt(limit,'limit')}`,
  ].join('\n');
}

/**
 * 7x24 heatmap aggregates filtered by district code.
 * @param {{start:string,end:string,types?:string[],dc_dist:string}} p
 */
export function buildHeatmap7x24DistrictSQL({ start, end, types, dc_dist, drilldownCodes }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, 'end');
  const clauses = baseTemporalClauses(startIso, endIso, types, { drilldownCodes });
  const dist = String(dc_dist).padStart(2, '0').replace(/'/g, "''");
  clauses.push(`  AND dc_dist = '${dist}'`);
  return [
    "SELECT EXTRACT(DOW  FROM dispatch_date_time AT TIME ZONE 'America/New_York') AS dow,",
    "       EXTRACT(HOUR FROM dispatch_date_time AT TIME ZONE 'America/New_York') AS hr,",
    "       COUNT(*) AS n",
    "FROM incidents_part1_part2",
    ...clauses,
    "GROUP BY 1,2 ORDER BY 1,2",
  ].join('\n');
}

/**
 * District filter helper.
 */
export function buildDistrictFilter(districtCode) {
  const dist = String(districtCode).padStart(2, '0').replace(/'/g, "''");
  return `AND dc_dist = '${dist}'`;
}

/**
 * Build SQL to count incidents within a buffer (no GROUP BY).
 * @param {object} params
 * @param {string} params.start
 * @param {string} params.end
 * @param {string[]} [params.types]
 * @param {number[]|{x:number,y:number}} params.center3857
 * @param {number} params.radiusM
 * @returns {string}
 */
export function buildCountBufferSQL({ start, end, types, center3857, radiusM, drilldownCodes }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, 'end');
  const clauses = baseTemporalClauses(startIso, endIso, types, { drilldownCodes });
  clauses.push(`  ${dWithinClause(center3857, radiusM)}`);
  return [
    "SELECT COUNT(*) AS n",
    "FROM incidents_part1_part2",
    ...clauses,
  ].join("\n");
}

function ensureIso(value, label) {
  if (!value) {
    throw new Error(`Missing required ISO date for ${label}.`);
  }
  const iso = String(value);
  if (!iso.match(/^\d{4}-\d{2}-\d{2}/)) {
    throw new Error(`Invalid ISO date for ${label}: ${value}`);
  }
  return iso;
}

function ensurePositiveInt(value, label) {
  const num = Number.parseInt(String(value), 10);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return num;
}

function ensureCenter(center) {
  if (!center) {
    throw new Error("center3857 is required.");
  }

  if (Array.isArray(center) && center.length >= 2) {
    const [x, y] = center.map((value) => Number(value));
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  } else if (typeof center === "object") {
    const x = Number(center.x ?? center.lon ?? center.lng);
    const y = Number(center.y ?? center.lat);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }

  throw new Error("center3857 must supply numeric x and y coordinates.");
}

function ensureRadius(radius) {
  const value = Number(radius);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("radiusM must be a positive number.");
  }
  return value;
}

function dWithinClause(center, radius) {
  const [x, y] = ensureCenter(center);
  const distance = ensureRadius(radius);
  return `AND ST_DWithin(the_geom, ST_SetSRID(ST_Point(${x}, ${y}), 3857), ${distance})`;
}

function baseTemporalClauses(startIso, endIso, types, { includeTypes = true, drilldownCodes } = {}) {
  const clauses = [
    "WHERE dispatch_date_time >= '2015-01-01'",
    `  AND dispatch_date_time >= '${startIso}'`,
    `  AND dispatch_date_time < '${endIso}'`,
  ];

  if (includeTypes) {
    // Drilldown codes override parent group types
    const codes = (drilldownCodes && drilldownCodes.length > 0) ? drilldownCodes : types;
    const sanitizedTypes = sanitizeTypes(codes);
    if (sanitizedTypes.length > 0) {
      clauses.push(
        `  AND text_general_code IN (${sanitizedTypes
          .map((value) => `'${value}'`)
          .join(", ")})`
      );
    }
  }

  return clauses;
}

/**
 * Build monthly time series SQL for a single census tract.
 */
export function buildMonthlyTractSQL({ start, end, types, tractGEOID, tractGeometry }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, 'end');
  const clauses = baseTemporalClauses(startIso, endIso, types);
  const gj = geojsonString6(tractGeometry);
  const bbox = bbox4326(tractGeometry);
  if (bbox) {
    const [minx, miny, maxx, maxy] = bbox;
    clauses.push(`  AND the_geom && ST_Transform(ST_MakeEnvelope(${minx}, ${miny}, ${maxy}, ${maxy}, 4326), 3857)`);
  }
  clauses.push(`  AND ST_Intersects(the_geom, ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${gj}'), 4326), 3857))`);

  return [
    "SELECT date_trunc('month', dispatch_date_time) AS m, COUNT(*) AS n",
    'FROM incidents_part1_part2',
    ...clauses,
    'GROUP BY 1 ORDER BY 1',
  ].join('\n');
}

/**
 * Build top N offense types SQL for a census tract (STUB).
 * @param {object} params
 * @param {string} params.start - ISO date
 * @param {string} params.end - ISO date
 * @param {string} params.tractGEOID - 11-digit census tract GEOID
 * @param {object} params.tractGeometry - GeoJSON geometry object
 * @param {number} [params.limit=12] - Max results
 * @returns {string} SQL query
 * @throws {Error} Not yet implemented
 */
export function buildTopTypesTractSQL({ start, end, types, tractGEOID, tractGeometry, limit = 12 }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, 'end');
  const clauses = baseTemporalClauses(startIso, endIso, types);
  const gj = geojsonString6(tractGeometry);
  const bbox = bbox4326(tractGeometry);
  if (bbox) {
    const [minx, miny, maxx, maxy] = bbox;
    clauses.push(`  AND the_geom && ST_Transform(ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 4326), 3857)`);
  }
  clauses.push(`  AND ST_Intersects(the_geom, ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${gj}'), 4326), 3857))`);
  return [
    'SELECT text_general_code, COUNT(*) AS n',
    'FROM incidents_part1_part2',
    ...clauses,
    `GROUP BY 1 ORDER BY n DESC LIMIT ${ensurePositiveInt(limit,'limit')}`,
  ].join('\n');
}

/**
 * Build 7x24 heatmap SQL for a census tract (STUB).
 * @param {object} params
 * @param {string} params.start - ISO date
 * @param {string} params.end - ISO date
 * @param {string[]} params.types - Offense codes
 * @param {string} params.tractGEOID - 11-digit census tract GEOID
 * @param {object} params.tractGeometry - GeoJSON geometry object
 * @returns {string} SQL query
 * @throws {Error} Not yet implemented
 */
export function buildHeatmap7x24TractSQL({ start, end, types, tractGEOID, tractGeometry }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, 'end');
  const clauses = baseTemporalClauses(startIso, endIso, types);
  const gj = geojsonString6(tractGeometry);
  const bbox = bbox4326(tractGeometry);
  if (bbox) {
    const [minx, miny, maxx, maxy] = bbox;
    clauses.push(`  AND the_geom && ST_Transform(ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 4326), 3857)`);
  }
  clauses.push(`  AND ST_Intersects(the_geom, ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${gj}'), 4326), 3857))`);
  return [
    "SELECT EXTRACT(DOW  FROM dispatch_date_time AT TIME ZONE 'America/New_York') AS dow,",
    "       EXTRACT(HOUR FROM dispatch_date_time AT TIME ZONE 'America/New_York') AS hr,",
    '       COUNT(*) AS n',
    'FROM incidents_part1_part2',
    ...clauses,
    'GROUP BY 1,2 ORDER BY 1,2',
  ].join('\n');
}

// Helpers: round geometry to 6 decimals and compute bbox in 4326
function geojsonString6(geom) {
  if (!geom) throw new Error('tractGeometry required');
  const g = roundGeometry6(geom);
  return JSON.stringify(g).replace(/'/g, "''");
}

function roundGeometry6(geom) {
  const r6 = (n) => Math.round(n * 1e6) / 1e6;
  const rc = (c) => Array.isArray(c[0]) ? c.map(rc) : [r6(c[0]), r6(c[1])];
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: rc(geom.coordinates) };
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map(rc) };
  return geom;
}

function bbox4326(geom) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const visit = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const x = coords[0], y = coords[1];
      if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y;
    } else {
      for (const c of coords) visit(c);
    }
  };
  if (!geom) return null;
  if (geom.type === 'Polygon') visit(geom.coordinates);
  else if (geom.type === 'MultiPolygon') visit(geom.coordinates);
  if (!Number.isFinite(minx)) return null;
  return [minx, miny, maxx, maxy];
}
