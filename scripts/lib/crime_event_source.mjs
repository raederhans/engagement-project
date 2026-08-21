import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const SNAPSHOT_SCHEMA = 'engagement-phl-crime-source-snapshot/v1';
const CHECKPOINT_SCHEMA = 'engagement-phl-crime-acquisition-checkpoint/v1';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function acquireCrimeSourceSnapshot({
  outputDir,
  start,
  end,
  sourceContract,
  pageSize = sourceContract?.acquisition?.default_page_size,
  partitionCount = sourceContract?.acquisition?.default_partition_count,
  request = fetch,
  now = () => new Date(),
  onProgress = () => {},
} = {}) {
  validateSourceContract(sourceContract);
  exactDate(start, 'acquisition start');
  exactDate(end, 'acquisition end');
  if (start >= end) throw new Error('Crime acquisition requires a non-empty half-open date range.');
  if (!outputDir || typeof outputDir !== 'string') throw new Error('Crime acquisition output directory is required.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50_000) {
    throw new Error('Crime acquisition page size must be between 1 and 50000.');
  }
  if (!Number.isInteger(partitionCount) || partitionCount < 1 || partitionCount > 256) {
    throw new Error('Crime acquisition partition count must be between 1 and 256.');
  }

  const manifestPath = path.join(outputDir, 'manifest.json');
  const existingManifest = await readJsonIfExists(manifestPath);
  if (existingManifest) {
    await validateCrimeSourceSnapshot(existingManifest, outputDir, { sourceContract });
    if (existingManifest.scope.start !== start || existingManifest.scope.end_exclusive !== end) {
      throw new Error('Existing completed acquisition scope differs from the requested scope.');
    }
    onProgress({ phase: 'idempotent', rowCount: existingManifest.row_count });
    return { manifest: existingManifest, manifestPath, idempotent: true };
  }

  const rowsDir = path.join(outputDir, 'rows');
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  await fs.mkdir(rowsDir, { recursive: true });
  const checkpoint = await loadOrCreateCheckpoint(checkpointPath, rowsDir, {
    start, end, pageSize, partitionCount, sourceContract,
  });

  const summaryBefore = checkpoint.summary_before || await requestSummary({
    request, sourceContract, start, end,
  });
  checkpoint.summary_before = summaryBefore;
  await writeJsonAtomic(checkpointPath, checkpoint);

  let lastSourceId = checkpoint.last_source_id;
  while (true) {
    const sql = buildPageSql(sourceContract, { start, end, lastSourceId, pageSize });
    const response = await requestCartoJson(sourceContract.api_url, sql, { request });
    validateQuerySchema(response.fields, sourceContract.expected_query_schema);
    const rows = response.rows;
    if (!Array.isArray(rows)) throw new Error('Crime source page rows are invalid.');
    if (rows.length === 0) break;

    const appendByPartition = Array.from({ length: partitionCount }, () => []);
    let previousId = lastSourceId;
    for (const sourceRow of rows) {
      const sourceId = sourceIdentifier(sourceRow);
      if (sourceId <= previousId) throw new Error('Crime source keyset order is not strictly increasing.');
      previousId = sourceId;
      const partition = partitionForSourceId(sourceId, partitionCount);
      appendByPartition[partition].push(`${JSON.stringify(sourceRow)}\n`);
      updateAcquisitionQuality(checkpoint.quality, sourceRow, sourceContract);
      checkpoint.partition_counts[partition] += 1;
      checkpoint.row_count += 1;
    }

    for (let partition = 0; partition < partitionCount; partition += 1) {
      if (appendByPartition[partition].length === 0) continue;
      const shardPath = path.join(rowsDir, shardName(partition));
      await fs.appendFile(shardPath, appendByPartition[partition].join(''), 'utf8');
    }
    checkpoint.last_source_id = previousId;
    checkpoint.pages_completed += 1;
    checkpoint.partition_bytes = await partitionFileSizes(rowsDir, partitionCount);
    checkpoint.updated_at = exactNow(now);
    await writeJsonAtomic(checkpointPath, checkpoint);
    lastSourceId = previousId;
    onProgress({
      phase: 'page',
      page: checkpoint.pages_completed,
      rowCount: checkpoint.row_count,
      lastSourceId,
    });
    if (rows.length < pageSize) break;
  }

  const summaryAfter = await requestSummary({ request, sourceContract, start, end });
  const countStable = summaryBefore.row_count === summaryAfter.row_count;
  const countComplete = checkpoint.row_count === summaryAfter.row_count;
  const sourceIdsUnique = summaryAfter.row_count === summaryAfter.distinct_source_ids;
  const retrievedAt = exactNow(now);
  const shardManifests = [];
  for (let partition = 0; partition < partitionCount; partition += 1) {
    const relativePath = path.posix.join('rows', shardName(partition));
    const shardPath = path.join(outputDir, ...relativePath.split('/'));
    await ensureFile(shardPath);
    const stat = await fs.stat(shardPath);
    shardManifests.push({
      partition,
      path: relativePath,
      row_count: checkpoint.partition_counts[partition],
      bytes: stat.size,
      identity: await hashFile(shardPath),
    });
  }
  const availability = countStable && countComplete && sourceIdsUnique ? 'available' : 'partial';
  const snapshotIdentity = identityOf({
    dataset_id: sourceContract.dataset_id,
    source_table: sourceContract.source_table,
    scope: { start, end_exclusive: end },
    row_count: checkpoint.row_count,
    source_as_of: summaryAfter.max_event_at,
    source_schema: sourceContract.expected_query_schema,
    shards: shardManifests.map(({ path: shardPath, row_count: rowCount, bytes, identity }) => ({
      path: shardPath, row_count: rowCount, bytes, identity,
    })),
  });
  const manifest = {
    schema: SNAPSHOT_SCHEMA,
    source_kind: 'official',
    snapshot_id: snapshotIdentity,
    dataset_id: sourceContract.dataset_id,
    provider: sourceContract.provider,
    source_table: sourceContract.source_table,
    source_url: sourceContract.api_url,
    source_catalog_url: sourceContract.official_catalog_url,
    source_vintage: {
      id: snapshotIdentity,
      source_as_of: summaryAfter.max_event_at,
      retrieved_at: retrievedAt,
      meaning: 'Identity of the exact acquired query result; not a completeness or authority claim.',
    },
    scope: {
      start,
      end_exclusive: end,
      completeness: 'complete-query-required',
      ordering: 'cartodb_id ASC',
    },
    availability,
    row_count: checkpoint.row_count,
    source_summary_before: summaryBefore,
    source_summary_after: summaryAfter,
    source_schema: sourceContract.expected_query_schema,
    partition_count: partitionCount,
    shards: shardManifests,
    acquisition: {
      page_size: pageSize,
      pages_completed: checkpoint.pages_completed,
      checkpoint_path: 'checkpoint.json',
      resumable: true,
      count_stable: countStable,
      count_complete: countComplete,
      source_ids_unique: sourceIdsUnique,
    },
    quality: finalizeAcquisitionQuality(checkpoint.quality, summaryAfter, sourceContract),
    artifact_identity_contract: 'SHA-256 identities name exact bytes or canonical manifest inputs only.',
  };
  await writeJsonAtomic(manifestPath, manifest);
  checkpoint.complete = true;
  checkpoint.snapshot_id = snapshotIdentity;
  checkpoint.updated_at = retrievedAt;
  await writeJsonAtomic(checkpointPath, checkpoint);
  await validateCrimeSourceSnapshot(manifest, outputDir, { sourceContract });
  if (availability !== 'available') {
    throw new Error(
      `Crime acquisition is partial: before=${summaryBefore.row_count}, after=${summaryAfter.row_count}, fetched=${checkpoint.row_count}.`,
    );
  }
  onProgress({ phase: 'complete', rowCount: manifest.row_count, snapshotId: snapshotIdentity });
  return { manifest, manifestPath, idempotent: false };
}

export async function validateCrimeSourceSnapshot(manifest, snapshotDir, { sourceContract } = {}) {
  validateSourceContract(sourceContract);
  if (manifest?.schema !== SNAPSHOT_SCHEMA || manifest.source_kind !== 'official'
    || manifest.dataset_id !== sourceContract.dataset_id
    || manifest.source_table !== sourceContract.source_table
    || manifest.source_url !== sourceContract.api_url
    || !exactDate(manifest.scope?.start)
    || !exactDate(manifest.scope?.end_exclusive)
    || manifest.scope.start >= manifest.scope.end_exclusive
    || !['available', 'partial'].includes(manifest.availability)
    || !Number.isInteger(manifest.row_count) || manifest.row_count < 0
    || !Number.isInteger(manifest.partition_count) || manifest.partition_count < 1
    || !Array.isArray(manifest.shards) || manifest.shards.length !== manifest.partition_count) {
    throw new Error('Crime source snapshot manifest is invalid.');
  }
  let rowCount = 0;
  for (let index = 0; index < manifest.shards.length; index += 1) {
    const shard = manifest.shards[index];
    if (shard.partition !== index || shard.path !== path.posix.join('rows', shardName(index))
      || !Number.isInteger(shard.row_count) || shard.row_count < 0
      || !Number.isInteger(shard.bytes) || shard.bytes < 0) {
      throw new Error(`Crime source snapshot shard ${index} metadata is invalid.`);
    }
    const shardPath = safeSnapshotPath(snapshotDir, shard.path);
    const stat = await fs.stat(shardPath);
    if (stat.size !== shard.bytes || await hashFile(shardPath) !== shard.identity) {
      throw new Error(`Crime source snapshot shard ${index} identity does not match its manifest.`);
    }
    rowCount += shard.row_count;
  }
  if (rowCount !== manifest.row_count) throw new Error('Crime source snapshot shard row counts drifted.');
  if (manifest.availability === 'available'
    && (manifest.acquisition?.count_stable !== true
      || manifest.acquisition?.count_complete !== true
      || manifest.acquisition?.source_ids_unique !== true)) {
    throw new Error('Available crime source snapshot lacks complete stable-count evidence.');
  }
  if (manifest.source_vintage?.id !== manifest.snapshot_id) {
    throw new Error('Crime source vintage must identify the exact snapshot manifest input.');
  }
  return manifest;
}

export function validateSourceContract(value) {
  if (value?.registry_schema !== 'engagement-phl-crime-event-source/v1'
    || value.schema_version !== 1
    || value.dataset_id !== 'philadelphia-reported-crime'
    || value.source_table !== 'incidents_part1_part2'
    || value.source_identifier?.field !== 'cartodb_id'
    || value.source_semantics?.preliminary !== true
    || value.source_semantics?.location_precision !== 'Generalized to the hundred block by the source'
    || value.fail_closed?.unavailable_is_zero !== false
    || value.fail_closed?.partial_is_current !== false
    || !Array.isArray(value.selected_fields)
    || !value.expected_query_schema) {
    throw new Error('Philadelphia crime event source contract is invalid.');
  }
  const schemaFields = Object.keys(value.expected_query_schema);
  if (JSON.stringify(schemaFields) !== JSON.stringify(value.selected_fields)) {
    throw new Error('Crime event selected fields and expected query schema drifted.');
  }
  return value;
}

export function buildPageSql(sourceContract, { start, end, lastSourceId = 0, pageSize } = {}) {
  validateSourceContract(sourceContract);
  exactDate(start, 'query start');
  exactDate(end, 'query end');
  if (!Number.isSafeInteger(lastSourceId) || lastSourceId < 0) throw new Error('Query cursor is invalid.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50_000) throw new Error('Query page size is invalid.');
  return `SELECT ${sourceContract.selected_fields.join(', ')}\n`
    + `FROM ${sourceContract.source_table}\n`
    + `WHERE dispatch_date_time >= '${start}' AND dispatch_date_time < '${end}'\n`
    + `  AND cartodb_id > ${lastSourceId}\n`
    + `ORDER BY cartodb_id ASC\nLIMIT ${pageSize}`;
}

export function resolveIncrementalCrimeScope(warehouseManifest, {
  end,
  overlapDays = 45,
  initialStart = '2006-01-01',
} = {}) {
  exactDate(end, 'incremental scope end');
  exactDate(initialStart, 'incremental initial start');
  if (!Number.isInteger(overlapDays) || overlapDays < 1 || overlapDays > 366) {
    throw new Error('Incremental overlap days must be between 1 and 366.');
  }
  const latestEventAt = timestampOrNull(warehouseManifest?.coverage?.latest_event_at);
  if (!latestEventAt) return { start: initialStart, end, mode: 'initial-backfill' };
  const startDate = new Date(latestEventAt);
  startDate.setUTCDate(startDate.getUTCDate() - overlapDays);
  const start = startDate.toISOString().slice(0, 10);
  if (start >= end) throw new Error('Incremental overlap scope is empty or ends before the warehouse watermark.');
  return { start, end, mode: 'overlap-incremental', overlapDays };
}

export async function inspectCrimeSourceHealth(sourceContract, { request = fetch, scope = null } = {}) {
  validateSourceContract(sourceContract);
  if (scope) {
    exactDate(scope.start, 'source health scope start');
    exactDate(scope.end_exclusive, 'source health scope end');
    if (scope.start >= scope.end_exclusive) throw new Error('Source health scope must be non-empty.');
  }
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = sourceContract.source_semantics.city_bbox;
  const sql = `SELECT COUNT(*)::int AS row_count, `
    + (scope ? `COUNT(*) FILTER (WHERE dispatch_date_time >= '${scope.start}' AND dispatch_date_time < '${scope.end_exclusive}')::int AS date_scoped_row_count, ` : '')
    + `COUNT(DISTINCT cartodb_id)::int AS distinct_source_ids, `
    + `COUNT(DISTINCT dc_key)::int AS distinct_dc_keys, `
    + `COUNT(*) FILTER (WHERE dispatch_date_time IS NULL)::int AS event_time_missing, `
    + `COUNT(*) FILTER (WHERE cartodb_id IS NULL)::int AS source_id_missing, `
    + `COUNT(*) FILTER (WHERE point_x IS NULL OR point_y IS NULL)::int AS coordinate_missing, `
    + `COUNT(*) FILTER (WHERE point_x IS NOT NULL AND point_y IS NOT NULL AND (`
    + `point_x < ${minLongitude} OR point_x > ${maxLongitude} OR point_y < ${minLatitude} OR point_y > ${maxLatitude}`
    + `))::int AS coordinate_outside_city_bounds, `
    + `MIN(dispatch_date_time) AS min_event_at, MAX(dispatch_date_time) AS max_event_at `
    + `FROM ${sourceContract.source_table}`;
  const payload = await requestCartoJson(sourceContract.api_url, sql, { request });
  const row = payload.rows?.[0];
  for (const field of [
    'row_count', 'distinct_source_ids', 'distinct_dc_keys', 'event_time_missing',
    'source_id_missing', 'coordinate_missing', 'coordinate_outside_city_bounds',
  ]) {
    if (!Number.isInteger(row?.[field]) || row[field] < 0) {
      throw new Error(`Crime source health field ${field} is invalid.`);
    }
  }
  if (scope && (!Number.isInteger(row.date_scoped_row_count) || row.date_scoped_row_count < 0)) {
    throw new Error('Crime source health date_scoped_row_count is invalid.');
  }
  return {
    schema: 'engagement-phl-crime-source-health-observation/v1',
    observed_at: new Date().toISOString(),
    row_count: row.row_count,
    date_scoped_row_count: scope ? row.date_scoped_row_count : null,
    scope,
    distinct_source_ids: row.distinct_source_ids,
    distinct_dc_keys: row.distinct_dc_keys,
    duplicate_source_id_count: row.row_count - row.distinct_source_ids,
    suspected_duplicate_dc_key_excess: row.row_count - row.distinct_dc_keys,
    event_time_missing: row.event_time_missing,
    source_id_missing: row.source_id_missing,
    coordinate_missing: row.coordinate_missing,
    coordinate_outside_city_bounds: row.coordinate_outside_city_bounds,
    min_event_at: timestampOrNull(row.min_event_at),
    max_event_at: timestampOrNull(row.max_event_at),
    meaning: 'Live aggregate observation only; not continuing completeness, freshness, or authority.',
  };
}

export function partitionForSourceId(sourceId, partitionCount) {
  const digest = createHash('sha256').update(String(sourceId)).digest();
  return digest.readUInt32BE(0) % partitionCount;
}

async function loadOrCreateCheckpoint(checkpointPath, rowsDir, options) {
  const existing = await readJsonIfExists(checkpointPath);
  if (existing) {
    if (existing.schema !== CHECKPOINT_SCHEMA
      || existing.start !== options.start || existing.end_exclusive !== options.end
      || existing.page_size !== options.pageSize
      || existing.partition_count !== options.partitionCount
      || existing.dataset_id !== options.sourceContract.dataset_id
      || existing.complete === true) {
      throw new Error('Existing acquisition checkpoint is incompatible or already complete without a manifest.');
    }
    for (let index = 0; index < options.partitionCount; index += 1) {
      const shardPath = path.join(rowsDir, shardName(index));
      await ensureFile(shardPath);
      const expectedBytes = existing.partition_bytes[index];
      const stat = await fs.stat(shardPath);
      if (stat.size < expectedBytes) throw new Error(`Checkpoint shard ${index} is shorter than recorded bytes.`);
      if (stat.size > expectedBytes) await fs.truncate(shardPath, expectedBytes);
    }
    return existing;
  }
  const checkpoint = {
    schema: CHECKPOINT_SCHEMA,
    dataset_id: options.sourceContract.dataset_id,
    start: options.start,
    end_exclusive: options.end,
    page_size: options.pageSize,
    partition_count: options.partitionCount,
    last_source_id: 0,
    row_count: 0,
    pages_completed: 0,
    partition_counts: Array(options.partitionCount).fill(0),
    partition_bytes: Array(options.partitionCount).fill(0),
    summary_before: null,
    quality: emptyAcquisitionQuality(),
    complete: false,
    snapshot_id: null,
    updated_at: null,
  };
  for (let index = 0; index < options.partitionCount; index += 1) {
    await ensureFile(path.join(rowsDir, shardName(index)));
  }
  await writeJsonAtomic(checkpointPath, checkpoint);
  return checkpoint;
}

async function requestSummary({ request, sourceContract, start, end }) {
  const sql = `SELECT COUNT(*)::int AS row_count, COUNT(DISTINCT cartodb_id)::int AS distinct_source_ids, `
    + `COUNT(DISTINCT dc_key)::int AS distinct_dc_keys, MIN(dispatch_date_time) AS min_event_at, `
    + `MAX(dispatch_date_time) AS max_event_at FROM ${sourceContract.source_table} `
    + `WHERE dispatch_date_time >= '${start}' AND dispatch_date_time < '${end}'`;
  const payload = await requestCartoJson(sourceContract.api_url, sql, { request });
  const row = payload.rows?.[0];
  if (!row || !Number.isInteger(row.row_count) || !Number.isInteger(row.distinct_source_ids)
    || !Number.isInteger(row.distinct_dc_keys)) {
    throw new Error('Crime source summary response is invalid.');
  }
  return {
    row_count: row.row_count,
    distinct_source_ids: row.distinct_source_ids,
    distinct_dc_keys: row.distinct_dc_keys,
    suspected_duplicate_dc_key_excess: row.row_count - row.distinct_dc_keys,
    min_event_at: timestampOrNull(row.min_event_at),
    max_event_at: timestampOrNull(row.max_event_at),
  };
}

async function requestCartoJson(apiUrl, sql, { request, attempts = 3 } = {}) {
  const url = new URL(apiUrl);
  url.searchParams.set('q', sql);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'engagement-project-dfev1-crime-acquisition/1',
        },
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.rows) || !payload.fields) {
        throw new Error('response body lacks rows or fields');
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  throw new Error(`Crime source request failed after ${attempts} attempts: ${lastError?.message || lastError}`);
}

function validateQuerySchema(actualFields, expectedSchema) {
  const actual = Object.fromEntries(Object.entries(actualFields || {}).map(([name, details]) => [name, details?.type]));
  if (JSON.stringify(actual) !== JSON.stringify(expectedSchema)) {
    throw new Error(`Crime source schema drifted: expected ${JSON.stringify(expectedSchema)}, received ${JSON.stringify(actual)}.`);
  }
}

function sourceIdentifier(row) {
  const value = Number(row?.cartodb_id);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Crime source row cartodb_id is invalid.');
  return value;
}

function emptyAcquisitionQuality() {
  return {
    by_date: {},
    by_category: {},
    coordinate_missing: 0,
    coordinate_invalid: 0,
    coordinate_outside_city_bounds: 0,
  };
}

function updateAcquisitionQuality(quality, row, sourceContract) {
  const date = timestampOrNull(row.dispatch_date_time)?.slice(0, 10) || 'unavailable';
  const category = typeof row.text_general_code === 'string' && row.text_general_code.trim()
    ? row.text_general_code.trim() : 'unavailable';
  quality.by_date[date] = (quality.by_date[date] || 0) + 1;
  quality.by_category[category] = (quality.by_category[category] || 0) + 1;
  if (row.point_x == null || row.point_y == null) {
    quality.coordinate_missing += 1;
    return;
  }
  const longitude = Number(row.point_x);
  const latitude = Number(row.point_y);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    quality.coordinate_invalid += 1;
    return;
  }
  const bbox = sourceContract.source_semantics?.city_bbox || [-75.35, 39.8, -74.9, 40.2];
  if (longitude < bbox[0] || longitude > bbox[2] || latitude < bbox[1] || latitude > bbox[3]) {
    quality.coordinate_outside_city_bounds += 1;
  }
}

function finalizeAcquisitionQuality(quality, summary, sourceContract) {
  const labels = Object.entries(quality.by_category).sort(([left], [right]) => left.localeCompare(right));
  return {
    schema_drift: false,
    duplicate_source_id_count: summary.row_count - summary.distinct_source_ids,
    suspected_duplicate_count: summary.suspected_duplicate_dc_key_excess,
    suspected_duplicate_basis: 'row_count-minus-distinct-dc_key; dc_key uniqueness semantics are not authoritative',
    counts_by_date: Object.fromEntries(Object.entries(quality.by_date).sort(([left], [right]) => left.localeCompare(right))),
    counts_by_category: Object.fromEntries(labels),
    coordinate_missing: quality.coordinate_missing,
    coordinate_invalid: quality.coordinate_invalid,
    coordinate_outside_city_bounds: quality.coordinate_outside_city_bounds,
    source_location_precision: sourceContract.source_semantics.location_precision,
  };
}

async function partitionFileSizes(rowsDir, partitionCount) {
  const sizes = [];
  for (let index = 0; index < partitionCount; index += 1) {
    sizes.push((await fs.stat(path.join(rowsDir, shardName(index)))).size);
  }
  return sizes;
}

function safeSnapshotPath(snapshotDir, relativePath) {
  if (path.isAbsolute(relativePath) || relativePath.includes('..')) {
    throw new Error('Snapshot shard path must remain inside the snapshot directory.');
  }
  const root = path.resolve(snapshotDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Snapshot shard path escapes the snapshot directory.');
  }
  return resolved;
}

function shardName(partition) {
  return `part-${String(partition).padStart(3, '0')}.jsonl`;
}

async function ensureFile(filePath) {
  const handle = await fs.open(filePath, 'a');
  await handle.close();
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(destination, value) {
  const temporary = `${destination}.${process.pid}-${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

function identityOf(value) {
  return `sha256:${createHash('sha256').update(stableSerialization(value)).digest('hex')}`;
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactDate(value, label = null) {
  const valid = typeof value === 'string' && DATE_PATTERN.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!valid && label) throw new Error(`${label} must be YYYY-MM-DD.`);
  return valid ? value : null;
}

function timestampOrNull(value) {
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function exactNow(now) {
  const value = now();
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Acquisition clock is invalid.');
  return parsed.toISOString();
}
