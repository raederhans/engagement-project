import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateHomeCompareSourceRegistry } from '../../src/home_compare/source_registry.js';

const MANIFEST_SCHEMA = 'engagement-home-compare-source-smoke/v1';

export { validateHomeCompareSourceRegistry };

export async function observeHomeCompareSources(registry, {
  requestJson = defaultRequestJson,
  retrievedAt = new Date().toISOString(),
} = {}) {
  const admitted = validateHomeCompareSourceRegistry(registry);
  const observations = [];
  for (const source of admitted.sources) {
    try {
      const observed = await observeSource(source, { requestJson, retrievedAt });
      observations.push(validateHomeCompareSourceObservation(observed, source));
    } catch (error) {
      observations.push({
        sourceId: source.id,
        status: 'unavailable',
        dataset: source.dataset,
        transport: source.transport,
        retrievedAt: null,
        sourceAsOf: null,
        revision: null,
        rowCount: null,
        schemaFields: [],
        missingFields: [...source.expected_fields],
        dq: ['source-observation-failed-closed', boundedReason(error)],
      });
    }
  }
  const status = observations.every(({ status: sourceStatus }) => sourceStatus === 'partial')
    ? 'partial'
    : observations.some(({ status: sourceStatus }) => sourceStatus !== 'unavailable') ? 'partial' : 'unavailable';
  const semantic = {
    schema: MANIFEST_SCHEMA,
    status,
    observations: observations.map(({ retrievedAt: _clock, ...observation }) => observation),
    routing: admitted.routing,
    privacy: admitted.privacy,
  };
  return {
    schema: MANIFEST_SCHEMA,
    generatedAt: retrievedAt,
    status,
    semanticIdentity: `sha256:${sha256(stableStringify(semantic))}`,
    observations,
    routing: admitted.routing,
    privacy: admitted.privacy,
    limitations: [
      'This is bounded live source/schema evidence, not a complete download, source-owned immutable revision, accuracy guarantee, or product authority.',
      'No address, coordinate, parcel, owner, transaction party, case/document identifier, or source record row is retained.',
    ],
  };
}

export async function writeHomeCompareSourceManifest(manifest, outputPath) {
  const target = path.resolve(outputPath);
  const previous = await readJsonIfExists(target);
  if (previous?.schema === MANIFEST_SCHEMA
    && previous.semanticIdentity === manifest.semanticIdentity) {
    return { status: 'idempotent', outputPath: target, manifest: previous, stat: await stat(target) };
  }
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.candidate-${process.pid}`;
  await writeFile(temporary, `${stableStringify(manifest)}\n`, 'utf8');
  await rename(temporary, target);
  return { status: 'published', outputPath: target, manifest, stat: await stat(target) };
}

async function observeSource(source, { requestJson, retrievedAt }) {
  if (source.transport === 'arcgis-geocode-server') {
    const metadata = await requestJson(`${source.canonical_url}?f=pjson`);
    const schemaFields = Array.isArray(metadata.candidateFields)
      ? metadata.candidateFields.map(({ name }) => name).filter(Boolean).sort()
      : [];
    return observation(source, {
      retrievedAt,
      sourceAsOf: null,
      revision: null,
      rowCount: null,
      schemaFields,
      dq: ['candidate-response-does-not-contain-parcel-identity'],
    });
  }
  if (source.transport === 'carto-sql') {
    if (source.id === 'li-property-history') {
      const tables = ['violations', 'business_licenses', 'case_investigations'];
      const observed = await Promise.all(tables.map((table) => observeCartoTable(source.api_url, table, requestJson)));
      return observation(source, {
        retrievedAt,
        sourceAsOf: latestDate(...observed.map(({ sourceAsOf }) => sourceAsOf)),
        revision: null,
        rowCount: observed.reduce((sum, item) => sum + item.rowCount, 0),
        schemaFields: [...new Set(observed.flatMap(({ schemaFields }) => schemaFields))].sort(),
        dq: [
          'composite-three-table-observation',
          'future-sentinel-dates-excluded-from-source-as-of',
          'source-owned-revision-unavailable',
        ],
      });
    }
    const table = source.dataset;
    const observed = await observeCartoTable(source.api_url, table, requestJson);
    const dq = ['source-owned-revision-unavailable'];
    let sourceAsOf = observed.sourceAsOf;
    if (source.id === 'opa-assessment-history') {
      const taxYear = observed.sourceAsOf?.slice(0, 4) || 'unavailable';
      dq.unshift(`max-published-assessment-tax-year-${taxYear}`);
      if (observed.sourceAsOf && Date.parse(observed.sourceAsOf) > Date.parse(retrievedAt)) {
        dq.unshift('published-tax-year-ahead-of-retrieval-requires-vintage-review');
      }
      sourceAsOf = null;
    }
    return observation(source, {
      retrievedAt,
      sourceAsOf,
      revision: null,
      rowCount: observed.rowCount,
      schemaFields: observed.schemaFields,
      dq,
    });
  }
  const metadata = await requestJson(`${source.api_url}?f=pjson`);
  const count = await requestJson(`${source.api_url}/query?${new URLSearchParams({
    f: 'json',
    where: '1=1',
    returnCountOnly: 'true',
  })}`);
  const lastEdit = Number(metadata?.editingInfo?.lastEditDate);
  const schemaFields = Array.isArray(metadata?.fields)
    ? metadata.fields.map(({ name }) => name).filter(Boolean).sort()
    : [];
  return observation(source, {
    retrievedAt,
    sourceAsOf: Number.isFinite(lastEdit) ? new Date(lastEdit).toISOString() : null,
    revision: Number.isFinite(lastEdit) ? `arcgis-last-edit:${lastEdit}` : null,
    rowCount: admittedCount(count?.count, `${source.id} feature count`),
    schemaFields,
    dq: Number.isFinite(lastEdit) ? [] : ['arcgis-last-edit-unavailable'],
  });
}

async function observeCartoTable(apiUrl, table, requestJson) {
  const schema = await cartoQuery(apiUrl, `SELECT * FROM ${table} LIMIT 0`, requestJson);
  const dateExpression = {
    opa_properties_public: 'MAX(assessment_date)',
    assessments: "MAX(year)::text || '-01-01'",
    rtt_summary: 'MAX(recording_date)',
    public_cases_fc: 'MAX(updated_datetime)',
    violations: 'MAX(violationdate)',
    business_licenses: "MAX(mostrecentissuedate) FILTER (WHERE mostrecentissuedate <= CURRENT_TIMESTAMP + INTERVAL '1 day')",
    case_investigations: "MAX(investigationcompleted) FILTER (WHERE investigationcompleted <= CURRENT_TIMESTAMP + INTERVAL '1 day')",
    incidents_part1_part2: 'MAX(dispatch_date_time)',
  }[table] || 'NULL';
  const aggregate = await cartoQuery(apiUrl, `SELECT COUNT(*)::bigint AS row_count, ${dateExpression} AS source_as_of FROM ${table}`, requestJson);
  if (!Array.isArray(aggregate.rows) || aggregate.rows.length !== 1) throw new TypeError(`Invalid ${table} aggregate.`);
  return {
    schemaFields: Object.keys(schema.fields || {}).sort(),
    rowCount: admittedCount(aggregate.rows[0].row_count, `${table} row count`),
    sourceAsOf: nullableDate(aggregate.rows[0].source_as_of),
  };
}

async function cartoQuery(apiUrl, query, requestJson) {
  return requestJson(`${apiUrl}?${new URLSearchParams({ q: query })}`);
}

function observation(source, fields) {
  const missingFields = source.expected_fields.filter((field) => !fields.schemaFields.includes(field));
  const unavailable = missingFields.length > 0;
  return {
    sourceId: source.id,
    status: unavailable ? 'unavailable' : 'partial',
    dataset: source.dataset,
    transport: source.transport,
    ...fields,
    rowCount: unavailable ? null : fields.rowCount,
    missingFields,
    dq: [...fields.dq, ...(missingFields.length ? ['schema-drift'] : [])],
  };
}

export function validateHomeCompareSourceObservation(value, source) {
  exactObject(value, [
    'sourceId', 'status', 'dataset', 'transport', 'retrievedAt', 'sourceAsOf',
    'revision', 'rowCount', 'schemaFields', 'missingFields', 'dq',
  ], `observation ${source.id}`);
  if (value.sourceId !== source.id || !['partial', 'unavailable'].includes(value.status)) {
    throw new TypeError(`Invalid observation identity/status for ${source.id}.`);
  }
  if (value.status === 'partial') {
    nullableDate(value.retrievedAt, false);
  } else if (value.rowCount !== null) {
    throw new TypeError(`Unavailable observation ${source.id} must not expose a row count.`);
  } else if (value.retrievedAt !== null) {
    nullableDate(value.retrievedAt, false);
  }
  nullableDate(value.sourceAsOf);
  if (value.revision !== null) boundedText(value.revision, 240, `${source.id}.revision`);
  if (value.rowCount !== null && (!Number.isSafeInteger(value.rowCount) || value.rowCount < 0)) {
    throw new TypeError(`Invalid row count for ${source.id}.`);
  }
  stringArray(value.schemaFields, `${source.id}.schemaFields`, 150);
  stringArray(value.missingFields, `${source.id}.missingFields`, 150);
  stringArray(value.dq, `${source.id}.dq`, 30);
  return value;
}

async function defaultRequestJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} fields are invalid.`);
  }
}

function stringArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== 'string' || !item || item.length > 800)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function boundedText(value, maximum, label) {
  if (typeof value !== 'string' || !value || value.length > maximum) throw new TypeError(`${label} is invalid.`);
}

function admittedCount(value, label) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${label} is invalid.`);
  return number;
}

function nullableDate(value, allowNull = true) {
  if (value == null || value === '') {
    if (allowNull) return null;
    throw new TypeError('Required source date is missing.');
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new TypeError('Source date is invalid.');
  return new Date(timestamp).toISOString();
}

function latestDate(...values) {
  const timestamps = values.filter(Boolean).map(Date.parse).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function boundedReason(error) {
  return String(error?.code || error?.name || 'unavailable').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'unavailable';
}
