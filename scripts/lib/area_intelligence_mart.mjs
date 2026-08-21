import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const MART_SCHEMA = 'engagement-area-intelligence-feature-mart/v1';
const CHECKPOINT_SCHEMA = 'engagement-area-intelligence-mart-checkpoint/v1';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function buildAreaIntelligenceMarts({
  sourceRoot,
  outputRoot,
  protocolPath,
  tractGeoJsonPath,
  outputPartitionCount = 32,
  allowSyntheticFixture = false,
  now = () => new Date(),
  onProgress = () => {},
} = {}) {
  const resolvedOutput = assertOwnedOutputRoot(outputRoot);
  const protocolBytes = await fs.readFile(protocolPath);
  const protocol = JSON.parse(protocolBytes.toString('utf8'));
  validateEvaluationProtocol(protocol);
  const protocolIdentity = sha256(protocolBytes);
  const gate = await validateExactWarehouse(sourceRoot, protocol, { allowSyntheticFixture });

  if (!Number.isInteger(outputPartitionCount) || outputPartitionCount < 1 || outputPartitionCount > 128) {
    throw new Error('Area Intelligence output partition count must be between 1 and 128.');
  }

  const existing = await readJsonIfExists(path.join(resolvedOutput, 'manifest.json'));
  if (existing) {
    const reusable = await validatePublishedMart(existing, resolvedOutput, gate, protocolIdentity);
    if (!reusable) {
      throw new Error('Area Intelligence output root contains a completed mart for a different exact input; use a new task-owned root.');
    }
    onProgress({ phase: 'idempotent', manifest: existing });
    return { manifest: existing, idempotent: true };
  }

  await fs.mkdir(resolvedOutput, { recursive: true });
  const checkpointPath = path.join(resolvedOutput, 'checkpoint.json');
  const checkpoint = await loadOrCreateCheckpoint(checkpointPath, {
    sourceGate: gate.identity,
    protocolIdentity,
    inputPartitionCount: gate.manifest.partition_count,
    outputPartitionCount,
    now,
  });
  const tractBlocks = await loadTractBlocks(tractGeoJsonPath);
  const snapshotIndex = new Map(gate.lineage.source_snapshots.map((entry, index) => [entry.snapshot_id, index]));

  for (let inputPartition = 0; inputPartition < gate.manifest.partition_count; inputPartition += 1) {
    const key = String(inputPartition).padStart(3, '0');
    const completed = checkpoint.input_partitions[key];
    if (completed) {
      await validateCheckpointFiles(resolvedOutput, completed.staging_files);
      continue;
    }
    const inputDir = path.join(resolvedOutput, 'staging', `input-${key}`);
    await removeOwnedSubdirectory(resolvedOutput, inputDir);
    await fs.mkdir(inputDir, { recursive: true });
    const result = await stageCanonicalPartition({
      inputPath: gate.canonicalParts[inputPartition].absolute_path,
      inputDir,
      inputPartition,
      outputPartitionCount,
      snapshotIndex,
      tractBlocks,
    });
    checkpoint.input_partitions[key] = {
      ...result.counts,
      staging_files: await inventoryRelativeFiles(resolvedOutput, result.files),
    };
    checkpoint.updated_at = exactNow(now);
    await writeJsonAtomic(checkpointPath, checkpoint);
    onProgress({ phase: 'stage-partition', partition: inputPartition, ...result.counts });
  }

  const admission = summarizeAdmission(checkpoint.input_partitions);
  if (admission.canonical_rows_seen !== protocol.exact_input_gate.canonical_row_count) {
    throw new Error(`Area Intelligence canonical row gate mismatch: expected ${protocol.exact_input_gate.canonical_row_count}, received ${admission.canonical_rows_seen}.`);
  }
  if (admission.unknown_category !== 0 || admission.invalid_event_time !== 0 || admission.non_active !== 0) {
    throw new Error('Area Intelligence canonical admission found unknown categories, invalid event times, or non-active rows; training is blocked.');
  }

  const candidateRoot = path.join(resolvedOutput, 'candidate', 'marts');
  await fs.mkdir(candidateRoot, { recursive: true });
  for (const unitType of ['tract', 'fixed-grid']) {
    await fs.mkdir(path.join(candidateRoot, unitType), { recursive: true });
    for (let outputPartition = 0; outputPartition < outputPartitionCount; outputPartition += 1) {
      const reduceKey = `${unitType}-${String(outputPartition).padStart(3, '0')}`;
      const completed = checkpoint.reduced_partitions[reduceKey];
      if (completed) {
        await validateCheckpointFiles(resolvedOutput, [completed]);
        continue;
      }
      const result = await reduceMartPartition({
        outputRoot: resolvedOutput,
        candidateRoot,
        inputPartitionCount: gate.manifest.partition_count,
        outputPartition,
        unitType,
        sourceSnapshots: gate.lineage.source_snapshots,
      });
      checkpoint.reduced_partitions[reduceKey] = result;
      checkpoint.updated_at = exactNow(now);
      await writeJsonAtomic(checkpointPath, checkpoint);
      onProgress({ phase: 'reduce-partition', unitType, partition: outputPartition, rowCount: result.row_count });
    }
  }

  await assertUpstreamInventoryUnchanged(gate);
  const parts = Object.values(checkpoint.reduced_partitions)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((part) => ({ ...part, path: part.path.replace(/^candidate\//, '') }));
  const completeWeekEnd = utcMonday(gate.manifest.coverage.latest_event_at);
  const generatedAt = exactNow(now);
  const manifestCore = {
    schema: MART_SCHEMA,
    protocol: {
      schema: protocol.schema,
      sha256: protocolIdentity,
      frozen_at: protocol.frozen_at,
      frozen_before_model_performance: protocol.frozen_before_model_performance,
    },
    exact_input: gate.identity,
    source_coverage: structuredClone(gate.manifest.coverage),
    evaluation_complete_week_end_exclusive: completeWeekEnd,
    source_snapshot_index: gate.lineage.source_snapshots.map((entry, index) => ({
      index,
      snapshot_id: entry.snapshot_id,
      source_as_of: entry.source_as_of,
      scope: entry.scope,
    })),
    transforms: {
      week: protocol.target.week_definition,
      categories: protocol.marts.categories,
      tract_boundary_id: gate.manifest.transforms.tract_boundary_id,
      tract_geography_definition: gate.manifest.transforms.tract_geography_definition,
      grid_scheme: gate.manifest.transforms.grid_scheme,
      acs_snapshot_id: gate.manifest.transforms.acs_snapshot_id,
      acs_vintage: gate.manifest.transforms.acs_vintage,
    },
    admission,
    output_partition_count: outputPartitionCount,
    parts,
    row_count: parts.reduce((sum, part) => sum + part.row_count, 0),
    unit_count: {
      tract: new Set(parts.filter((part) => part.unit_type === 'tract').flatMap((part) => part.unit_ids)).size,
      'fixed-grid': new Set(parts.filter((part) => part.unit_type === 'fixed-grid').flatMap((part) => part.unit_ids)).size,
    },
    artifact_policy: {
      event_level_data_included: false,
      coordinates_included: false,
      generalized_locations_included: false,
      git_policy: 'ignored-task-owned-large-artifact',
      identity_meaning: 'Input and artifact byte identity only; not model correctness, truth, freshness, completeness, or authority.',
    },
  };
  const artifactIdentity = identityOf(manifestCore);
  const manifest = {
    ...manifestCore,
    artifact_identity: artifactIdentity,
    generated_at: generatedAt,
  };

  const publishedMarts = path.join(resolvedOutput, 'marts');
  if (await pathExists(publishedMarts)) {
    throw new Error('Area Intelligence published mart directory exists without a manifest; fail closed and use a new task-owned root.');
  }
  await fs.rename(candidateRoot, publishedMarts);
  await writeJsonAtomic(path.join(resolvedOutput, 'manifest.json'), manifest);
  checkpoint.status = 'complete';
  checkpoint.artifact_identity = artifactIdentity;
  checkpoint.updated_at = generatedAt;
  await writeJsonAtomic(checkpointPath, checkpoint);
  onProgress({ phase: 'complete', manifest });
  return { manifest, idempotent: false };
}

export async function validateExactWarehouse(sourceRoot, protocol, { allowSyntheticFixture = false } = {}) {
  const root = path.resolve(sourceRoot || '');
  const warehouseRoot = path.join(root, 'warehouse');
  const files = {
    warehouse_manifest: path.join(warehouseRoot, 'manifest.json'),
    backfill_checkpoint: path.join(root, 'backfill-checkpoint.json'),
    lineage_registry: path.join(warehouseRoot, 'lineage', 'registry.json'),
  };
  const [manifestBytes, checkpointBytes, lineageBytes] = await Promise.all([
    fs.readFile(files.warehouse_manifest),
    fs.readFile(files.backfill_checkpoint),
    fs.readFile(files.lineage_registry),
  ]);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const checkpoint = JSON.parse(checkpointBytes.toString('utf8'));
  const lineage = JSON.parse(lineageBytes.toString('utf8'));
  const expected = protocol.exact_input_gate;
  const observedDigests = {
    warehouse_manifest_sha256: sha256(manifestBytes),
    backfill_checkpoint_sha256: sha256(checkpointBytes),
    lineage_registry_sha256: sha256(lineageBytes),
  };

  if (!allowSyntheticFixture) {
    for (const [field, digest] of Object.entries(observedDigests)) {
      if (digest !== expected[field]) throw new Error(`Area Intelligence exact input gate failed for ${field}.`);
    }
    if (manifest.mode !== 'official-local-candidate') {
      throw new Error('Area Intelligence production mart build requires an official-local-candidate M1 warehouse.');
    }
  }
  if (manifest.schema !== expected.warehouse_schema
    || manifest.serving_eligible !== expected.serving_eligible
    || manifest.partition_count !== expected.partition_count
    || manifest.canonical_row_count !== expected.canonical_row_count
    || manifest.active_row_count !== expected.active_row_count
    || manifest.coverage?.earliest_scope_start !== expected.scope_start
    || manifest.coverage?.latest_scope_end_exclusive !== expected.scope_end_exclusive
    || manifest.applied_snapshot_ids?.length !== expected.source_snapshot_count
    || Object.keys(checkpoint.completed || {}).length !== expected.completed_scope_count
    || checkpoint.final_quality?.acquired_rows !== expected.canonical_row_count
    || checkpoint.final_quality?.date_scoped_count_complete !== true
    || lineage.source_snapshots?.length !== expected.source_snapshot_count
    || lineage.model_input_contract?.serving_status !== 'not-published') {
    throw new Error('Area Intelligence M1 manifest/checkpoint/lineage gate did not match the frozen protocol.');
  }

  const canonicalDir = path.join(warehouseRoot, 'canonical');
  const canonicalParts = [];
  for (let index = 0; index < expected.partition_count; index += 1) {
    const name = `part-${String(index).padStart(3, '0')}.jsonl`;
    const absolutePath = path.join(canonicalDir, name);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile() || stat.size <= 0) throw new Error(`Area Intelligence canonical partition is missing or empty: ${name}`);
    canonicalParts.push({
      name,
      absolute_path: absolutePath,
      bytes: stat.size,
      mtime_ms: stat.mtimeMs,
    });
  }
  const namedParts = (await fs.readdir(canonicalDir)).filter((name) => /^part-\d{3}\.jsonl$/.test(name)).sort();
  if (namedParts.length !== expected.partition_count
    || namedParts.some((name, index) => name !== canonicalParts[index].name)) {
    throw new Error('Area Intelligence canonical partition name set does not match the frozen 64-part contract.');
  }

  const snapshotIds = new Set(manifest.applied_snapshot_ids);
  let lineageRowCount = 0;
  for (const entry of lineage.source_snapshots) {
    if (!snapshotIds.has(entry.snapshot_id) || entry.availability !== 'available') {
      throw new Error('Area Intelligence lineage contains an unavailable or unapplied source snapshot.');
    }
    const sourceManifestPath = path.resolve(entry.manifest_path);
    if (!isInside(root, sourceManifestPath)) throw new Error('Area Intelligence source manifest escaped the authorized M1 root.');
    const sourceManifest = JSON.parse(await fs.readFile(sourceManifestPath, 'utf8'));
    if (sourceManifest.snapshot_id !== entry.snapshot_id || sourceManifest.row_count !== entry.row_count) {
      throw new Error(`Area Intelligence source manifest lineage mismatch for ${entry.snapshot_id}.`);
    }
    lineageRowCount += entry.row_count;
  }
  if (lineageRowCount !== expected.canonical_row_count) {
    throw new Error(`Area Intelligence lineage row total mismatch: ${lineageRowCount}.`);
  }

  return {
    root,
    warehouseRoot,
    manifest,
    checkpoint,
    lineage,
    canonicalParts,
    files,
    identity: {
      ...observedDigests,
      warehouse_current_snapshot_id: manifest.current_snapshot_id,
      canonical_row_count: manifest.canonical_row_count,
      active_row_count: manifest.active_row_count,
      partition_count: manifest.partition_count,
      source_snapshot_count: lineage.source_snapshots.length,
    },
  };
}

async function stageCanonicalPartition({
  inputPath,
  inputDir,
  inputPartition,
  outputPartitionCount,
  snapshotIndex,
  tractBlocks,
}) {
  const streams = new Map();
  const files = new Set();
  const counts = {
    canonical_rows_seen: 0,
    tract_admitted: 0,
    tract_ambiguous: 0,
    tract_unmapped: 0,
    grid_admitted: 0,
    grid_unavailable: 0,
    unknown_category: 0,
    invalid_event_time: 0,
    non_active: 0,
  };
  const input = readline.createInterface({ input: createReadStream(inputPath, 'utf8'), crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of input) {
      lineNumber += 1;
      if (!line) continue;
      const event = JSON.parse(line);
      counts.canonical_rows_seen += 1;
      if (event.lifecycle?.state !== 'active') {
        counts.non_active += 1;
        continue;
      }
      if (!exactTimestamp(event.event_at)) {
        counts.invalid_event_time += 1;
        continue;
      }
      const category = event.normalized_category;
      if (category?.status !== 'mapped' || typeof category.theme_id !== 'string') {
        counts.unknown_category += 1;
        continue;
      }
      const sourceSnapshot = snapshotIndex.get(event.lineage?.source_snapshot_id);
      if (!Number.isInteger(sourceSnapshot)
        || event.source_vintage?.snapshot_id !== event.lineage?.source_snapshot_id) {
        throw new Error(`Canonical event lineage mismatch in input partition ${inputPartition}, line ${lineNumber}.`);
      }
      const week = utcMonday(event.event_at);
      const tract = event.spatial?.tract;
      if (tract?.status === 'mapped' && /^\d{11}$/.test(tract.geoid || '')) {
        const block = tractBlocks.get(tract.geoid);
        if (!block) throw new Error(`Mapped tract ${tract.geoid} has no spatial block assignment.`);
        await writeStagingRecord({
          streams,
          files,
          inputDir,
          unitType: 'tract',
          outputPartitionCount,
          unitId: tract.geoid,
          record: {
            u: tract.geoid,
            b: block,
            w: week,
            c: category.theme_id,
            s: sourceSnapshot,
            p: finiteNonNegative(event.acs?.estimate?.value),
            m: finiteNonNegative(event.acs?.moe90?.value),
            av: event.acs?.valueStatus || 'unavailable',
          },
        });
        counts.tract_admitted += 1;
      } else if (tract?.status === 'ambiguous') counts.tract_ambiguous += 1;
      else counts.tract_unmapped += 1;

      const grid = event.spatial?.grid;
      if (grid?.status === 'mapped' && typeof grid.gridId === 'string') {
        await writeStagingRecord({
          streams,
          files,
          inputDir,
          unitType: 'fixed-grid',
          outputPartitionCount,
          unitId: grid.gridId,
          record: {
            u: grid.gridId,
            b: gridBlock(grid.gridId),
            w: week,
            c: category.theme_id,
            s: sourceSnapshot,
          },
        });
        counts.grid_admitted += 1;
      } else counts.grid_unavailable += 1;
    }
  } finally {
    await Promise.all([...streams.values()].map(endStream));
  }
  return { counts, files: [...files] };
}

async function writeStagingRecord({ streams, files, inputDir, unitType, outputPartitionCount, unitId, record }) {
  const outputPartition = partitionForUnit(unitId, outputPartitionCount);
  const name = `${unitType}-${String(outputPartition).padStart(3, '0')}.jsonl`;
  const filePath = path.join(inputDir, name);
  let stream = streams.get(name);
  if (!stream) {
    stream = createWriteStream(filePath, { encoding: 'utf8', flags: 'a' });
    streams.set(name, stream);
    files.add(filePath);
  }
  if (!stream.write(`${JSON.stringify(record)}\n`)) await once(stream, 'drain');
}

async function reduceMartPartition({
  outputRoot,
  candidateRoot,
  inputPartitionCount,
  outputPartition,
  unitType,
  sourceSnapshots,
}) {
  const units = new Map();
  for (let inputPartition = 0; inputPartition < inputPartitionCount; inputPartition += 1) {
    const inputKey = String(inputPartition).padStart(3, '0');
    const inputPath = path.join(
      outputRoot,
      'staging',
      `input-${inputKey}`,
      `${unitType}-${String(outputPartition).padStart(3, '0')}.jsonl`,
    );
    if (!await pathExists(inputPath)) continue;
    const lines = readline.createInterface({ input: createReadStream(inputPath, 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      const record = JSON.parse(line);
      let unit = units.get(record.u);
      if (!unit) {
        unit = { block: record.b, population: record.p, moe90: record.m, acsValueStatus: record.av, weeks: new Map() };
        units.set(record.u, unit);
      }
      if (unit.block !== record.b) throw new Error(`Area Intelligence block assignment drift for ${record.u}.`);
      if (record.p != null && unit.population == null) unit.population = record.p;
      if (record.m != null && unit.moe90 == null) unit.moe90 = record.m;
      let week = unit.weeks.get(record.w);
      if (!week) {
        week = { count: 0, categories: new Map(), snapshots: new Set() };
        unit.weeks.set(record.w, week);
      }
      week.count += 1;
      week.categories.set(record.c, (week.categories.get(record.c) || 0) + 1);
      week.snapshots.add(record.s);
    }
  }

  const relativePath = path.posix.join('candidate', 'marts', unitType, `part-${String(outputPartition).padStart(3, '0')}.jsonl`);
  const outputPath = path.join(outputRoot, ...relativePath.split('/'));
  const stream = createWriteStream(outputPath, { encoding: 'utf8', flags: 'w' });
  let rowCount = 0;
  let firstWeek = null;
  let lastWeek = null;
  try {
    for (const unitId of [...units.keys()].sort()) {
      const unit = units.get(unitId);
      for (const weekStart of [...unit.weeks.keys()].sort()) {
        const week = unit.weeks.get(weekStart);
        const weekEndExclusive = addWeeks(weekStart, 1);
        const row = {
          schema: 'engagement-area-intelligence-unit-week/v1',
          unit_type: unitType,
          unit_id: unitId,
          spatial_block_id: unit.block,
          week_start: weekStart,
          week_end_exclusive: weekEndExclusive,
          reported_incident_count: week.count,
          category_counts: Object.fromEntries([...week.categories].sort(([left], [right]) => left.localeCompare(right))),
          acs: weeklyAcs(unitType, weekStart, unit, sourceSnapshots),
          source_snapshot_indexes: [...week.snapshots].sort((left, right) => left - right),
          lineage_ref: 'manifest.source_snapshot_index',
        };
        if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, 'drain');
        rowCount += 1;
        firstWeek = firstWeek == null || weekStart < firstWeek ? weekStart : firstWeek;
        lastWeek = lastWeek == null || weekStart > lastWeek ? weekStart : lastWeek;
      }
    }
  } finally {
    await endStream(stream);
  }
  const stat = await fs.stat(outputPath);
  return {
    path: relativePath,
    unit_type: unitType,
    partition: outputPartition,
    row_count: rowCount,
    unit_ids: [...units.keys()].sort(),
    first_week: firstWeek,
    last_week: lastWeek,
    bytes: stat.size,
    mtime_ms: stat.mtimeMs,
    sha256: await hashFile(outputPath),
  };
}

function weeklyAcs(unitType, weekStart, unit) {
  if (unitType !== 'tract') {
    return {
      status: 'unavailable',
      estimate: null,
      moe90: null,
      model_input_eligible: false,
      reason: 'geography-incompatible-with-tract-estimate',
    };
  }
  const year = Number(weekStart.slice(0, 4));
  const valuesAvailable = unit.acsValueStatus === 'available'
    && Number.isFinite(unit.population)
    && Number.isFinite(unit.moe90);
  if (year < 2020 || year > 2024) {
    return {
      status: 'incompatible-vintage',
      estimate: valuesAvailable ? unit.population : null,
      moe90: valuesAvailable ? unit.moe90 : null,
      model_input_eligible: false,
      reason: 'week-start-year-outside-2020-2024-acs-period',
    };
  }
  if (!valuesAvailable) {
    return {
      status: 'unavailable',
      estimate: null,
      moe90: null,
      model_input_eligible: false,
      reason: 'acs-estimate-or-moe-unavailable',
    };
  }
  return {
    status: 'available',
    estimate: unit.population,
    moe90: unit.moe90,
    model_input_eligible: true,
    reason: null,
  };
}

async function loadTractBlocks(tractGeoJsonPath) {
  const collection = JSON.parse(await fs.readFile(tractGeoJsonPath, 'utf8'));
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Area Intelligence tract block source must be a GeoJSON FeatureCollection.');
  }
  const blocks = new Map();
  for (const feature of collection.features) {
    const geoid = feature?.properties?.GEOID;
    const bounds = geometryBounds(feature?.geometry);
    if (!/^\d{11}$/.test(geoid || '') || !bounds) throw new Error('Area Intelligence tract block source contains an invalid feature.');
    const longitude = (bounds[0] + bounds[2]) / 2;
    const latitude = (bounds[1] + bounds[3]) / 2;
    const [x, y] = webMercator(longitude, latitude);
    blocks.set(geoid, `epsg3857-2km:${Math.floor(x / 2000)}:${Math.floor(y / 2000)}`);
  }
  if (blocks.size !== 408) throw new Error(`Area Intelligence expected 408 tract block assignments; received ${blocks.size}.`);
  return blocks;
}

function geometryBounds(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (value) => {
    if (Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      bounds[0] = Math.min(bounds[0], value[0]);
      bounds[1] = Math.min(bounds[1], value[1]);
      bounds[2] = Math.max(bounds[2], value[0]);
      bounds[3] = Math.max(bounds[3], value[1]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry.coordinates);
  return bounds.every(Number.isFinite) ? bounds : null;
}

function webMercator(longitude, latitude) {
  const radius = 6378137;
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return [
    radius * longitude * Math.PI / 180,
    radius * Math.log(Math.tan(Math.PI / 4 + boundedLatitude * Math.PI / 360)),
  ];
}

function gridBlock(gridId) {
  const match = /^epsg3857-500m:(-?\d+):(-?\d+)$/.exec(gridId);
  if (!match) throw new Error(`Area Intelligence fixed-grid id is invalid: ${gridId}`);
  return `epsg3857-2km:${floorDiv(Number(match[1]), 4)}:${floorDiv(Number(match[2]), 4)}`;
}

function floorDiv(value, divisor) {
  return Math.floor(value / divisor);
}

function summarizeAdmission(inputPartitions) {
  const summary = {
    canonical_rows_seen: 0,
    tract: { admitted: 0, ambiguous_excluded: 0, unmapped_excluded: 0 },
    'fixed-grid': { admitted: 0, unavailable_excluded: 0 },
    unknown_category: 0,
    invalid_event_time: 0,
    non_active: 0,
  };
  for (const value of Object.values(inputPartitions)) {
    summary.canonical_rows_seen += value.canonical_rows_seen;
    summary.tract.admitted += value.tract_admitted;
    summary.tract.ambiguous_excluded += value.tract_ambiguous;
    summary.tract.unmapped_excluded += value.tract_unmapped;
    summary['fixed-grid'].admitted += value.grid_admitted;
    summary['fixed-grid'].unavailable_excluded += value.grid_unavailable;
    summary.unknown_category += value.unknown_category;
    summary.invalid_event_time += value.invalid_event_time;
    summary.non_active += value.non_active;
  }
  return summary;
}

async function validatePublishedMart(manifest, outputRoot, gate, protocolIdentity) {
  if (manifest.schema !== MART_SCHEMA
    || manifest.protocol?.sha256 !== protocolIdentity
    || stableSerialization(manifest.exact_input) !== stableSerialization(gate.identity)
    || !Array.isArray(manifest.parts)) return false;
  for (const part of manifest.parts) {
    const partPath = path.resolve(outputRoot, ...part.path.split('/'));
    if (!isInside(outputRoot, partPath)) return false;
    const stat = await fs.stat(partPath).catch(() => null);
    if (!stat?.isFile() || stat.size !== part.bytes || await hashFile(partPath) !== part.sha256) return false;
  }
  return true;
}

async function assertUpstreamInventoryUnchanged(gate) {
  for (const part of gate.canonicalParts) {
    const stat = await fs.stat(part.absolute_path);
    if (stat.size !== part.bytes || stat.mtimeMs !== part.mtime_ms) {
      throw new Error(`Authorized upstream partition changed during M2 build: ${part.name}`);
    }
  }
  for (const [field, filePath] of Object.entries(gate.files)) {
    const expected = gate.identity[`${field}_sha256`];
    if (expected && await hashFile(filePath) !== expected) {
      throw new Error(`Authorized upstream ${field} changed during M2 build.`);
    }
  }
}

async function loadOrCreateCheckpoint(checkpointPath, options) {
  const existing = await readJsonIfExists(checkpointPath);
  if (existing) {
    if (existing.schema !== CHECKPOINT_SCHEMA
      || stableSerialization(existing.source_gate) !== stableSerialization(options.sourceGate)
      || existing.protocol_sha256 !== options.protocolIdentity
      || existing.input_partition_count !== options.inputPartitionCount
      || existing.output_partition_count !== options.outputPartitionCount) {
      throw new Error('Area Intelligence checkpoint belongs to a different exact input or protocol.');
    }
    return existing;
  }
  const checkpoint = {
    schema: CHECKPOINT_SCHEMA,
    status: 'building',
    source_gate: options.sourceGate,
    protocol_sha256: options.protocolIdentity,
    input_partition_count: options.inputPartitionCount,
    output_partition_count: options.outputPartitionCount,
    input_partitions: {},
    reduced_partitions: {},
    created_at: exactNow(options.now),
    updated_at: exactNow(options.now),
    resume: 'Re-run the identical command with the same exact input, output root, and frozen protocol.',
  };
  await writeJsonAtomic(checkpointPath, checkpoint);
  return checkpoint;
}

async function validateCheckpointFiles(outputRoot, records = []) {
  for (const record of records) {
    const filePath = path.resolve(outputRoot, ...record.path.split('/'));
    if (!isInside(outputRoot, filePath)) throw new Error('Area Intelligence checkpoint path escaped its task-owned root.');
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size !== record.bytes) {
      throw new Error(`Area Intelligence checkpoint file is missing or changed: ${record.path}`);
    }
    if (record.sha256 && await hashFile(filePath) !== record.sha256) {
      throw new Error(`Area Intelligence checkpoint file identity changed: ${record.path}`);
    }
  }
}

async function inventoryRelativeFiles(outputRoot, files) {
  const records = [];
  for (const filePath of [...files].sort()) {
    const stat = await fs.stat(filePath);
    records.push({
      path: path.relative(outputRoot, filePath).replaceAll('\\', '/'),
      bytes: stat.size,
    });
  }
  return records;
}

function validateEvaluationProtocol(protocol) {
  if (protocol?.schema !== 'engagement-area-intelligence-evaluation-protocol/v1'
    || protocol.schema_version !== 1
    || protocol.frozen_before_model_performance !== true
    || !Array.isArray(protocol.rolling_folds) || protocol.rolling_folds.length < 3
    || protocol.promotion_gate?.failure_result !== 'honest-no-promotion-historical-trends-only') {
    throw new Error('Area Intelligence evaluation protocol is invalid or not frozen.');
  }
}

function assertOwnedOutputRoot(outputRoot) {
  const root = path.resolve(outputRoot || '');
  const workspace = process.cwd();
  if (!isInside(workspace, root) || !root.split(path.sep).includes('.dfev1')) {
    throw new Error('Area Intelligence output root must be a task-owned .dfev1 directory inside the current worktree.');
  }
  return root;
}

async function removeOwnedSubdirectory(outputRoot, target) {
  if (!isInside(outputRoot, target) || path.resolve(target) === path.resolve(outputRoot)) {
    throw new Error('Refusing to remove a path outside the Area Intelligence task-owned root.');
  }
  await fs.rm(target, { recursive: true, force: true });
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function partitionForUnit(unitId, partitionCount) {
  return createHash('sha256').update(unitId).digest().readUInt32BE(0) % partitionCount;
}

export function utcMonday(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid event timestamp: ${timestamp}`);
  date.setUTCHours(0, 0, 0, 0);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export function addWeeks(dateText, weeks) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (!Number.isInteger(weeks) || !Number.isFinite(date.getTime())) throw new Error('Invalid week arithmetic input.');
  return new Date(date.getTime() + weeks * WEEK_MS).toISOString().slice(0, 10);
}

function nextUtcMonday(timestamp) {
  return addWeeks(utcMonday(timestamp), 1);
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function exactTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function exactNow(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Area Intelligence clock returned an invalid Date.');
  return value.toISOString();
}

async function endStream(stream) {
  if (stream.writableEnded) return;
  stream.end();
  await once(stream, 'finish');
}

async function writeJsonAtomic(destination, value) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, destination);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function identityOf(value) {
  return `sha256:${sha256(Buffer.from(stableSerialization(value)))}`;
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
