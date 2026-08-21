import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { createAcsPopulationIndex } from './crime_event_acs.mjs';
import {
  createTractSpatialIndex,
  fixedWebMercatorGridCell,
  mapEventToCorridors,
  spatialArtifactIdentity,
  validateCorridorRegistry,
  validateSourceCoordinate,
} from './crime_event_spatial.mjs';
import {
  partitionForSourceId,
  validateCrimeSourceSnapshot,
  validateSourceContract,
} from './crime_event_source.mjs';

const EVENT_SCHEMA = 'engagement-phl-crime-event/v1';
const WAREHOUSE_SCHEMA = 'engagement-phl-crime-event-warehouse/v1';
const QUALITY_SCHEMA = 'engagement-phl-crime-data-quality/v1';
const LINEAGE_SCHEMA = 'engagement-phl-crime-lineage/v1';
const SYNTHETIC_SNAPSHOT_SCHEMA = 'engagement-phl-crime-synthetic-snapshot/v1';
const TRANSACTION_SCHEMA = 'engagement-phl-crime-warehouse-transaction/v1';

export async function createWarehouseDependencies({
  eventContract,
  sourceContract,
  taxonomy,
  tractGeoJson,
  tractSourceRegistry,
  acsSnapshot,
  corridorRegistry = null,
} = {}) {
  validateEventContract(eventContract);
  validateSourceContract(sourceContract);
  const crosswalk = createOffenseCrosswalk(taxonomy);
  const geographyDefinition = eventContract.spatial.tract.geography_definition;
  const tractBoundaryId = spatialArtifactIdentity(tractGeoJson);
  const tractIndex = createTractSpatialIndex(tractGeoJson, {
    sourceId: tractBoundaryId,
    geographyDefinition,
  });
  validateTractGeographyContract(tractSourceRegistry, tractIndex, geographyDefinition);
  const acsIndex = createAcsPopulationIndex(acsSnapshot, {
    contract: eventContract.acs,
    tractGeoids: tractIndex.geoids,
    tractGeographyDefinition: geographyDefinition,
  });
  const admittedCorridors = validateCorridorRegistry(corridorRegistry);
  return Object.freeze({
    eventContract,
    sourceContract,
    crosswalk,
    tractIndex,
    tractBoundaryId,
    tractSourceRegistry: structuredClone(tractSourceRegistry),
    acsIndex,
    corridorRegistry: admittedCorridors,
  });
}

export async function ingestCrimeSourceSnapshot({
  snapshotDir,
  warehouseDir,
  dependencies,
  allowSynthetic = false,
  now = () => new Date(),
  onProgress = () => {},
  failAtPublishPartition = null,
} = {}) {
  if (!snapshotDir || !warehouseDir) throw new Error('Crime warehouse ingest requires snapshot and warehouse directories.');
  validateDependencies(dependencies);
  await fs.mkdir(warehouseDir, { recursive: true });
  await recoverWarehouseTransaction(warehouseDir);

  const snapshotManifest = JSON.parse(await fs.readFile(path.join(snapshotDir, 'manifest.json'), 'utf8'));
  if (snapshotManifest.source_kind === 'synthetic') {
    if (!allowSynthetic) throw new Error('Synthetic crime snapshots are test-only and cannot enter the official warehouse CLI.');
    await validateSyntheticSnapshot(snapshotManifest, snapshotDir);
  } else {
    await validateCrimeSourceSnapshot(snapshotManifest, snapshotDir, {
      sourceContract: dependencies.sourceContract,
    });
  }
  if (snapshotManifest.availability !== 'available') {
    throw new Error(`Crime warehouse rejects ${snapshotManifest.availability || 'unavailable'} source snapshots.`);
  }

  const currentManifestPath = path.join(warehouseDir, 'manifest.json');
  const currentManifest = await readJsonIfExists(currentManifestPath);
  if (currentManifest?.schema && currentManifest.schema !== WAREHOUSE_SCHEMA) {
    throw new Error('Existing crime warehouse schema is unsupported.');
  }
  if (currentManifest?.applied_snapshot_ids?.includes(snapshotManifest.snapshot_id)) {
    onProgress({ phase: 'idempotent', snapshotId: snapshotManifest.snapshot_id });
    return {
      idempotent: true,
      manifest: currentManifest,
      quality: await readJsonIfExists(path.join(
        warehouseDir, 'quality', `${safeArtifactName(snapshotManifest.snapshot_id)}.json`,
      )),
    };
  }
  const partitionCount = currentManifest?.partition_count || snapshotManifest.partition_count;
  if (partitionCount !== snapshotManifest.partition_count
    || partitionCount !== dependencies.eventContract.default_partition_count) {
    throw new Error('Crime warehouse and source snapshot partition counts do not match the event contract.');
  }

  const observedAt = exactNow(now);
  const transactionId = safeArtifactName(snapshotManifest.snapshot_id);
  const transactionDir = safeOwnedPath(warehouseDir, path.join(warehouseDir, '.transactions', transactionId));
  await fs.mkdir(path.join(transactionDir, 'candidate'), { recursive: true });
  const journalPath = path.join(transactionDir, 'journal.json');
  const journal = {
    schema: TRANSACTION_SCHEMA,
    snapshot_id: snapshotManifest.snapshot_id,
    state: 'building',
    published_partitions: 0,
    partition_count: partitionCount,
    previous_manifest_present: Boolean(currentManifest),
    started_at: observedAt,
  };
  await writeJsonAtomic(journalPath, journal);

  const qualityAccumulator = createQualityAccumulator(snapshotManifest, dependencies, observedAt);
  const revisionDetails = [];
  const priorLatestEventAt = currentManifest?.coverage?.latest_event_at || null;
  let latestEventAt = priorLatestEventAt;
  let canonicalRowCount = 0;

  try {
    for (let partition = 0; partition < partitionCount; partition += 1) {
      const rawShard = snapshotManifest.shards[partition];
      const rawPath = safeSnapshotPath(snapshotDir, rawShard.path);
      const canonicalPath = path.join(warehouseDir, 'canonical', shardName(partition));
      const existing = await readCanonicalPartition(canonicalPath, partition, partitionCount);
      const seen = new Set();
      let previousRawId = 0;

      for await (const sourceRow of readJsonLines(rawPath)) {
        const sourceId = sourceIdentifier(sourceRow);
        if (sourceId <= previousRawId || seen.has(sourceId)
          || partitionForSourceId(sourceId, partitionCount) !== partition) {
          throw new Error(`Raw crime shard ${partition} is not uniquely keyset-sorted or correctly partitioned.`);
        }
        previousRawId = sourceId;
        seen.add(sourceId);
        const next = canonicalizeSourceRow(sourceRow, snapshotManifest, dependencies, observedAt);
        const prior = existing.get(sourceId);
        let revisionType;
        if (!prior) {
          revisionType = priorLatestEventAt && next.event_at < priorLatestEventAt ? 'late-arriving' : 'added';
          existing.set(sourceId, next);
        } else {
          const transformationChanged = transformIdentity(prior) !== transformIdentity(next);
          if (prior.lifecycle?.state === 'removal-candidate') revisionType = 'reappeared';
          else if (prior.row_hash === next.row_hash) {
            revisionType = transformationChanged ? 'transformation-updated' : 'unchanged';
          } else if (prior.raw_category?.offense_label !== next.raw_category.offense_label
            || prior.raw_category?.ucr_general !== next.raw_category.ucr_general) {
            revisionType = 'reclassified';
          } else {
            revisionType = 'modified';
          }
          next.first_seen_at = prior.first_seen_at;
          existing.set(sourceId, next);
        }
        qualityAccumulator.revisions[revisionType] += 1;
        if (revisionType !== 'unchanged') {
          appendRevisionDetail(revisionDetails, revisionRecord(sourceId, revisionType, prior, next));
        }
        if (!latestEventAt || next.event_at > latestEventAt) latestEventAt = next.event_at;
      }

      for (const [sourceId, event] of existing) {
        if (seen.has(sourceId) || !eventInScope(event, snapshotManifest.scope)) continue;
        const prior = structuredClone(event);
        const firstMissingAt = event.lifecycle?.state === 'removal-candidate'
          ? event.lifecycle.first_missing_at : observedAt;
        const missingVintages = event.lifecycle?.state === 'removal-candidate'
          ? event.lifecycle.missing_vintages + 1 : 1;
        event.lifecycle = {
          state: 'removal-candidate',
          first_missing_at: firstMissingAt,
          missing_vintages: missingVintages,
          reason: 'absent-from-complete-query-scope',
          last_missing_snapshot_id: snapshotManifest.snapshot_id,
        };
        qualityAccumulator.revisions['removal-candidate'] += 1;
        appendRevisionDetail(revisionDetails, revisionRecord(sourceId, 'removal-candidate', prior, event));
      }

      const rows = [...existing.values()].sort((left, right) => sourceNumericId(left) - sourceNumericId(right));
      rows.forEach((event) => accumulateCanonicalQuality(qualityAccumulator, event));
      canonicalRowCount += rows.length;
      const candidatePath = path.join(transactionDir, 'candidate', shardName(partition));
      await writeJsonLines(candidatePath, rows);
      onProgress({ phase: 'build-partition', partition, rowCount: rows.length });
    }

    const previousApplied = currentManifest?.applied_snapshot_ids || [];
    const quality = finalizeQualityReport(qualityAccumulator, snapshotManifest, observedAt);
    const lineage = await buildLineageRegistry({
      warehouseDir,
      currentManifest,
      snapshotDir,
      snapshotManifest,
      dependencies,
      observedAt,
    });
    const manifest = {
      schema: WAREHOUSE_SCHEMA,
      mode: snapshotManifest.source_kind === 'synthetic' ? 'synthetic-test' : 'official-local-candidate',
      serving_eligible: false,
      partition_count: partitionCount,
      canonical_row_count: canonicalRowCount,
      active_row_count: quality.lifecycle.active,
      removal_candidate_count: quality.lifecycle.removal_candidate,
      current_snapshot_id: snapshotManifest.snapshot_id,
      applied_snapshot_ids: [...previousApplied, snapshotManifest.snapshot_id],
      coverage: {
        earliest_scope_start: minText(currentManifest?.coverage?.earliest_scope_start, snapshotManifest.scope.start),
        latest_scope_end_exclusive: maxText(
          currentManifest?.coverage?.latest_scope_end_exclusive,
          snapshotManifest.scope.end_exclusive,
        ),
        latest_event_at: latestEventAt,
      },
      transforms: {
        event_schema: EVENT_SCHEMA,
        crosswalk_version: dependencies.crosswalk.version,
        tract_boundary_id: dependencies.tractBoundaryId,
        tract_geography_definition: dependencies.tractIndex.geographyDefinition,
        grid_scheme: dependencies.eventContract.spatial.fixed_grid.scheme,
        acs_snapshot_id: dependencies.acsIndex.snapshotId,
        acs_vintage: dependencies.acsIndex.vintage,
        corridor_registry_id: dependencies.corridorRegistry?.registryId || null,
      },
      lineage_registry: 'lineage/registry.json',
      latest_quality_report: `quality/${transactionId}.json`,
      latest_revision_report: `revisions/${transactionId}.json`,
      updated_at: observedAt,
      artifact_identity_note: 'Hashes identify source/artifact bytes only and do not prove truth, freshness, completeness, or authority.',
    };

    await fs.mkdir(path.join(transactionDir, 'candidate-meta'), { recursive: true });
    await fs.writeFile(
      path.join(transactionDir, 'candidate-meta', 'quality.json'),
      `${JSON.stringify(quality, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(transactionDir, 'candidate-meta', 'revision.json'),
      `${JSON.stringify({
        schema: 'engagement-phl-crime-revisions/v1',
        snapshot_id: snapshotManifest.snapshot_id,
        observed_at: observedAt,
        counts: quality.revisions,
        change_details_limit: 10000,
        change_details_truncated: totalChangedRevisions(quality.revisions) > revisionDetails.length,
        changes: revisionDetails,
      }, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(transactionDir, 'candidate-meta', 'lineage.json'),
      `${JSON.stringify(lineage, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(transactionDir, 'candidate-meta', 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    journal.state = 'publishing';
    await writeJsonAtomic(journalPath, journal);
    await publishTransaction({
      warehouseDir,
      transactionDir,
      journal,
      journalPath,
      transactionId,
      partitionCount,
      failAtPublishPartition,
    });
    await removeOwnedDirectory(warehouseDir, transactionDir);
    onProgress({ phase: 'complete', rowCount: canonicalRowCount, snapshotId: snapshotManifest.snapshot_id });
    return { idempotent: false, manifest, quality };
  } catch (error) {
    await recoverWarehouseTransaction(warehouseDir).catch(() => {});
    throw error;
  }
}

export function createOffenseCrosswalk(taxonomy) {
  if (taxonomy?.schema_version !== 1 || typeof taxonomy.taxonomy_version !== 'string'
    || !Array.isArray(taxonomy.themes)) {
    throw new Error('Crime offense taxonomy cannot serve as a versioned crosswalk.');
  }
  const byLabel = new Map();
  for (const theme of taxonomy.themes) {
    for (const category of theme.ucr_categories || []) {
      for (const offense of category.offenses || []) {
        if (typeof offense.code !== 'string' || !offense.code.trim() || byLabel.has(offense.code)) {
          throw new Error('Crime offense crosswalk labels must be non-empty and unique.');
        }
        byLabel.set(offense.code, Object.freeze({
          offenseCode: offense.code,
          ucrCode: String(category.code),
          themeId: theme.id,
        }));
      }
    }
  }
  return Object.freeze({
    version: taxonomy.taxonomy_version,
    knownLabels: Object.freeze([...byLabel.keys()].sort()),
    map(rawLabel, rawUcr) {
      const mapped = byLabel.get(rawLabel);
      if (!mapped) return { status: 'unknown-label', value: null };
      if (String(rawUcr || '') !== mapped.ucrCode) {
        return { status: 'ucr-mismatch', value: null, expectedUcr: mapped.ucrCode };
      }
      return { status: 'mapped', value: mapped };
    },
  });
}

export function canonicalizeSourceRow(sourceRow, snapshotManifest, dependencies, observedAt) {
  const sourceId = sourceIdentifier(sourceRow);
  const eventAt = exactTimestamp(sourceRow.dispatch_date_time, `source ${sourceId} dispatch_date_time`);
  const rawOffense = textOrNull(sourceRow.text_general_code);
  const rawUcr = textOrNull(sourceRow.ucr_general);
  const crosswalk = dependencies.crosswalk.map(rawOffense, rawUcr);
  const coordinateAdmission = validateSourceCoordinate(
    [sourceRow.point_x, sourceRow.point_y],
    dependencies.eventContract.spatial.city_bbox,
  );
  const coordinate = coordinateAdmission.ok
    ? {
      status: 'available',
      value: coordinateAdmission.coordinate,
      crs: dependencies.eventContract.spatial.coordinate_reference_system,
      precision: dependencies.eventContract.spatial.source_precision,
      exact_location_claim: false,
      reason: null,
    }
    : {
      status: 'unavailable',
      value: null,
      crs: dependencies.eventContract.spatial.coordinate_reference_system,
      precision: dependencies.eventContract.spatial.source_precision,
      exact_location_claim: false,
      reason: coordinateAdmission.reason,
    };
  const tract = coordinate.value
    ? dependencies.tractIndex.mapPoint(coordinate.value)
    : { status: 'unmapped', geoid: null, reason: coordinate.reason, candidates: [] };
  const grid = coordinate.value
    ? fixedWebMercatorGridCell(coordinate.value, {
      cellSizeM: dependencies.eventContract.spatial.fixed_grid.projected_cell_size_m,
    })
    : { status: 'unavailable', gridId: null, reason: coordinate.reason };
  const base = {
    schema: EVENT_SCHEMA,
    source_record_id: `cartodb:${sourceId}`,
    source_ids: {
      cartodb_id: String(sourceId),
      objectid: nullableIntegerString(sourceRow.objectid),
      dc_key: nullableIntegerString(sourceRow.dc_key),
    },
    raw_category: {
      offense_label: rawOffense,
      ucr_general: rawUcr,
    },
    normalized_category: crosswalk.value ? {
      status: 'mapped',
      offense_code: crosswalk.value.offenseCode,
      ucr_code: crosswalk.value.ucrCode,
      theme_id: crosswalk.value.themeId,
      crosswalk_version: dependencies.crosswalk.version,
    } : {
      status: crosswalk.status,
      offense_code: null,
      ucr_code: null,
      theme_id: null,
      crosswalk_version: dependencies.crosswalk.version,
    },
    event_at: eventAt,
    generalized_location: {
      value: textOrNull(sourceRow.location_block),
      precision: 'hundred-block-generalized',
      exact_sidewalk_or_street_segment: false,
    },
    coordinate,
    spatial: {
      tract,
      grid,
      route_corridor: null,
    },
    acs: dependencies.acsIndex.mapTract(tract.status === 'mapped' ? tract.geoid : null, { eventAt }),
    source_vintage: {
      snapshot_id: snapshotManifest.snapshot_id,
      source_as_of: snapshotManifest.source_vintage.source_as_of,
    },
    first_seen_at: observedAt,
    last_seen_at: observedAt,
    row_hash: sourceRowIdentity(sourceRow, dependencies.sourceContract.selected_fields),
    lifecycle: {
      state: 'active',
      first_missing_at: null,
      missing_vintages: 0,
      reason: null,
    },
    lineage: {
      source_snapshot_id: snapshotManifest.snapshot_id,
      crosswalk_version: dependencies.crosswalk.version,
      tract_boundary_id: dependencies.tractBoundaryId,
      acs_snapshot_id: dependencies.acsIndex.snapshotId,
      corridor_registry_id: dependencies.corridorRegistry?.registryId || null,
    },
  };
  base.spatial.route_corridor = mapEventToCorridors(base, dependencies.corridorRegistry);
  validateCanonicalEvent(base, dependencies.eventContract);
  return base;
}

export function validateCanonicalEvent(event, eventContract) {
  validateEventContract(eventContract);
  if (event?.schema !== EVENT_SCHEMA
    || JSON.stringify(Object.keys(event)) !== JSON.stringify(eventContract.canonical_event_required_fields)
    || typeof event.source_record_id !== 'string'
    || !exactTimestamp(event.event_at)
    || !exactTimestamp(event.first_seen_at)
    || !exactTimestamp(event.last_seen_at)
    || !/^sha256:[a-f0-9]{64}$/.test(event.row_hash)
    || !eventContract.lifecycle_states.includes(event.lifecycle?.state)
    || event.generalized_location?.exact_sidewalk_or_street_segment !== false
    || event.coordinate?.exact_location_claim !== false
    || (event.acs?.estimate && event.acs?.moe90
      && event.acs.estimate.variable === event.acs.moe90.variable)) {
    throw new Error(`Canonical crime event ${event?.source_record_id || '(missing)'} is invalid.`);
  }
  return event;
}

export function classifyCrimeDataStatus({ availability, rowCount, freshnessStatus } = {}) {
  if (availability === 'unavailable') return 'unavailable';
  if (availability === 'partial') return 'partial';
  if (availability !== 'available') throw new Error('Crime data availability status is unsupported.');
  if (!Number.isInteger(rowCount) || rowCount < 0) throw new Error('Crime data row count is invalid.');
  if (rowCount === 0) return 'zero';
  if (freshnessStatus === 'stale') return 'stale';
  return 'available';
}

export async function recoverWarehouseTransaction(warehouseDir) {
  const transactionsDir = path.join(warehouseDir, '.transactions');
  let entries;
  try {
    entries = await fs.readdir(transactionsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transactionDir = safeOwnedPath(warehouseDir, path.join(transactionsDir, entry.name));
    const journal = await readJsonIfExists(path.join(transactionDir, 'journal.json'));
    if (!journal || journal.schema !== TRANSACTION_SCHEMA) {
      throw new Error(`Warehouse transaction ${entry.name} has no valid recovery journal.`);
    }
    const current = await readJsonIfExists(path.join(warehouseDir, 'manifest.json'));
    if (current?.current_snapshot_id === journal.snapshot_id) {
      await removeOwnedDirectory(warehouseDir, transactionDir);
      continue;
    }
    if (journal.state === 'publishing') {
      for (let partition = 0; partition < journal.published_partitions; partition += 1) {
        const canonicalPath = path.join(warehouseDir, 'canonical', shardName(partition));
        const backupPath = path.join(transactionDir, 'backup', shardName(partition));
        const missingMarker = `${backupPath}.missing`;
        if (await pathExists(missingMarker)) await fs.rm(canonicalPath, { force: true });
        else if (await pathExists(backupPath)) await replaceFileFromCopy(backupPath, canonicalPath);
      }
      const previousManifest = path.join(transactionDir, 'backup-meta', 'manifest.json');
      if (journal.previous_manifest_present && await pathExists(previousManifest)) {
        await replaceFileFromCopy(previousManifest, path.join(warehouseDir, 'manifest.json'));
      } else if (!journal.previous_manifest_present) {
        await fs.rm(path.join(warehouseDir, 'manifest.json'), { force: true });
      }
      const artifactName = safeArtifactName(journal.snapshot_id);
      await fs.rm(path.join(warehouseDir, 'quality', `${artifactName}.json`), { force: true });
      await fs.rm(path.join(warehouseDir, 'revisions', `${artifactName}.json`), { force: true });
      const previousLineage = path.join(transactionDir, 'backup-meta', 'lineage.json');
      if (await pathExists(previousLineage)) {
        await replaceFileFromCopy(previousLineage, path.join(warehouseDir, 'lineage', 'registry.json'));
      }
    }
    await removeOwnedDirectory(warehouseDir, transactionDir);
  }
}

async function publishTransaction({
  warehouseDir,
  transactionDir,
  journal,
  journalPath,
  transactionId,
  partitionCount,
  failAtPublishPartition,
}) {
  await fs.mkdir(path.join(warehouseDir, 'canonical'), { recursive: true });
  await fs.mkdir(path.join(transactionDir, 'backup'), { recursive: true });
  await fs.mkdir(path.join(transactionDir, 'backup-meta'), { recursive: true });
  const currentManifest = path.join(warehouseDir, 'manifest.json');
  if (await pathExists(currentManifest)) await fs.copyFile(currentManifest, path.join(transactionDir, 'backup-meta', 'manifest.json'));
  const currentLineage = path.join(warehouseDir, 'lineage', 'registry.json');
  if (await pathExists(currentLineage)) await fs.copyFile(currentLineage, path.join(transactionDir, 'backup-meta', 'lineage.json'));

  for (let partition = 0; partition < partitionCount; partition += 1) {
    const canonicalPath = path.join(warehouseDir, 'canonical', shardName(partition));
    const backupPath = path.join(transactionDir, 'backup', shardName(partition));
    if (await pathExists(canonicalPath)) await linkOrCopy(canonicalPath, backupPath);
    else await fs.writeFile(`${backupPath}.missing`, 'missing\n', 'utf8');
    journal.published_partitions = partition + 1;
    await writeJsonAtomic(journalPath, journal);
    await fs.rm(canonicalPath, { force: true });
    await fs.rename(path.join(transactionDir, 'candidate', shardName(partition)), canonicalPath);
    if (failAtPublishPartition === partition) throw new Error(`Injected publish failure at partition ${partition}.`);
  }

  await fs.mkdir(path.join(warehouseDir, 'quality'), { recursive: true });
  await fs.mkdir(path.join(warehouseDir, 'revisions'), { recursive: true });
  await fs.mkdir(path.join(warehouseDir, 'lineage'), { recursive: true });
  await replaceFileFromCopy(
    path.join(transactionDir, 'candidate-meta', 'quality.json'),
    path.join(warehouseDir, 'quality', `${transactionId}.json`),
  );
  await replaceFileFromCopy(
    path.join(transactionDir, 'candidate-meta', 'revision.json'),
    path.join(warehouseDir, 'revisions', `${transactionId}.json`),
  );
  await replaceFileFromCopy(
    path.join(transactionDir, 'candidate-meta', 'lineage.json'),
    path.join(warehouseDir, 'lineage', 'registry.json'),
  );
  await replaceFileFromCopy(
    path.join(transactionDir, 'candidate-meta', 'manifest.json'),
    path.join(warehouseDir, 'manifest.json'),
  );
  journal.state = 'committed';
  await writeJsonAtomic(journalPath, journal);
}

async function buildLineageRegistry({
  warehouseDir,
  currentManifest,
  snapshotDir,
  snapshotManifest,
  dependencies,
  observedAt,
}) {
  const existing = await readJsonIfExists(path.join(warehouseDir, 'lineage', 'registry.json'));
  const sources = Array.isArray(existing?.source_snapshots) ? [...existing.source_snapshots] : [];
  sources.push({
    snapshot_id: snapshotManifest.snapshot_id,
    manifest_path: portablePath(snapshotDir, 'manifest.json'),
    source_kind: snapshotManifest.source_kind,
    source_as_of: snapshotManifest.source_vintage.source_as_of,
    retrieved_at: snapshotManifest.source_vintage.retrieved_at,
    scope: snapshotManifest.scope,
    row_count: snapshotManifest.row_count,
    availability: snapshotManifest.availability,
  });
  return {
    schema: LINEAGE_SCHEMA,
    source_snapshots: sources,
    transforms: {
      event_schema: EVENT_SCHEMA,
      crosswalk: {
        version: dependencies.crosswalk.version,
        unknown_policy: dependencies.eventContract.crosswalk.unknown_policy,
      },
      tract: {
        artifact_id: dependencies.tractBoundaryId,
        geography_definition: dependencies.tractIndex.geographyDefinition,
        geoid_count: dependencies.tractIndex.geoids.length,
      },
      grid: dependencies.eventContract.spatial.fixed_grid,
      acs: {
        snapshot_id: dependencies.acsIndex.snapshotId,
        vintage: dependencies.acsIndex.vintage,
        period: dependencies.acsIndex.period,
        estimate_variable: dependencies.acsIndex.estimateVariable,
        moe90_variable: dependencies.acsIndex.moe90Variable,
      },
      corridor: {
        registry_id: dependencies.corridorRegistry?.registryId || null,
        unavailable_is_zero: false,
        positive_relation: 'reported-point-near-route',
      },
    },
    model_input_contract: {
      canonical_parts: 'canonical/part-*.jsonl',
      required_lineage_fields: [
        'source_snapshot_id', 'crosswalk_version', 'tract_boundary_id',
        'acs_snapshot_id', 'corridor_registry_id',
      ],
      previous_warehouse_snapshot_id: currentManifest?.current_snapshot_id || null,
      generated_at: observedAt,
      serving_status: 'not-published',
    },
  };
}

function createQualityAccumulator(snapshotManifest, dependencies, observedAt) {
  return {
    snapshotManifest,
    observedAt,
    dependencies,
    canonicalCount: 0,
    active: 0,
    removalCandidate: 0,
    coordinate: { available: 0, missing: 0, invalid: 0, outside_city_bounds: 0 },
    tract: { mapped: 0, unmapped: 0, ambiguous: 0 },
    grid: { mapped: 0, unavailable: 0 },
    corridor: { available: 0, unavailable: 0, matches: 0 },
    acs: { available: 0, partial: 0, unavailable: 0, 'incompatible-vintage': 0 },
    labels: new Map(),
    revisions: {
      added: 0,
      'late-arriving': 0,
      modified: 0,
      reclassified: 0,
      unchanged: 0,
      reappeared: 0,
      'removal-candidate': 0,
      'transformation-updated': 0,
    },
  };
}

function accumulateCanonicalQuality(accumulator, event) {
  accumulator.canonicalCount += 1;
  if (event.lifecycle.state === 'active') accumulator.active += 1;
  else accumulator.removalCandidate += 1;
  if (event.coordinate.status === 'available') accumulator.coordinate.available += 1;
  else if (event.coordinate.reason === 'coordinate-missing') accumulator.coordinate.missing += 1;
  else if (event.coordinate.reason === 'coordinate-outside-city-bounds') accumulator.coordinate.outside_city_bounds += 1;
  else accumulator.coordinate.invalid += 1;
  accumulator.tract[event.spatial.tract.status] = (accumulator.tract[event.spatial.tract.status] || 0) + 1;
  accumulator.grid[event.spatial.grid.status] = (accumulator.grid[event.spatial.grid.status] || 0) + 1;
  accumulator.corridor[event.spatial.route_corridor.status] += 1;
  accumulator.corridor.matches += event.spatial.route_corridor.matches.length;
  accumulator.acs[event.acs.status] = (accumulator.acs[event.acs.status] || 0) + 1;
  const label = event.raw_category.offense_label || 'unavailable';
  accumulator.labels.set(label, (accumulator.labels.get(label) || 0) + 1);
}

function finalizeQualityReport(accumulator, snapshotManifest, observedAt) {
  const observedLabels = [...accumulator.labels.keys()].sort();
  const known = new Set(accumulator.dependencies.crosswalk.knownLabels);
  const unknownLabels = observedLabels.filter((label) => label !== 'unavailable' && !known.has(label));
  const knownObserved = observedLabels.filter((label) => known.has(label));
  const knownNotObserved = accumulator.dependencies.crosswalk.knownLabels.filter((label) => !accumulator.labels.has(label));
  const freshness = evaluateFreshness(snapshotManifest, accumulator.dependencies.sourceContract, observedAt);
  const sourceStatus = classifyCrimeDataStatus({
    availability: snapshotManifest.availability,
    rowCount: snapshotManifest.row_count,
    freshnessStatus: freshness.status,
  });
  const dayCounts = snapshotManifest.quality?.counts_by_date || {};
  return {
    schema: QUALITY_SCHEMA,
    snapshot_id: snapshotManifest.snapshot_id,
    observed_at: observedAt,
    data_status: sourceStatus,
    status_semantics: {
      unavailable_is_zero: false,
      partial_is_current: false,
      stale_is_current: false,
      zero_requires_complete_query: true,
    },
    source: {
      row_count: snapshotManifest.row_count,
      schema_drift: snapshotManifest.quality?.schema_drift || false,
      duplicate_source_id_count: snapshotManifest.quality?.duplicate_source_id_count ?? null,
      suspected_duplicate_count: snapshotManifest.quality?.suspected_duplicate_count ?? null,
      suspected_duplicate_basis: snapshotManifest.quality?.suspected_duplicate_basis || null,
      counts_by_date: snapshotManifest.quality?.counts_by_date || {},
      counts_by_category: snapshotManifest.quality?.counts_by_category || {},
      daily_count_anomalies: dailyCountAnomalies(dayCounts),
    },
    coordinate: accumulator.coordinate,
    labels: {
      crosswalk_version: accumulator.dependencies.crosswalk.version,
      known_observed: knownObserved,
      unknown_observed: unknownLabels,
      known_not_observed: knownNotObserved,
      unavailable_count: accumulator.labels.get('unavailable') || 0,
    },
    join_coverage: {
      tract: accumulator.tract,
      fixed_grid: accumulator.grid,
      route_corridor: accumulator.corridor,
      acs_estimate_moe: accumulator.acs,
    },
    revisions: accumulator.revisions,
    lifecycle: {
      active: accumulator.active,
      removal_candidate: accumulator.removalCandidate,
    },
    freshness,
    lineage: {
      source_snapshot_id: snapshotManifest.snapshot_id,
      tract_boundary_id: accumulator.dependencies.tractBoundaryId,
      acs_snapshot_id: accumulator.dependencies.acsIndex.snapshotId,
      corridor_registry_id: accumulator.dependencies.corridorRegistry?.registryId || null,
    },
  };
}

function evaluateFreshness(snapshotManifest, sourceContract, observedAt) {
  const end = new Date(`${snapshotManifest.scope.end_exclusive}T00:00:00.000Z`);
  const observed = new Date(observedAt);
  const historical = observed.getTime() - end.getTime() > 14 * 86_400_000;
  if (historical) {
    return {
      status: 'not-applicable-historical-scope',
      source_as_of: snapshotManifest.source_vintage.source_as_of,
      observed_at: observedAt,
      stale_after_days: sourceContract.freshness.stale_after_days,
    };
  }
  const sourceAsOf = new Date(snapshotManifest.source_vintage.source_as_of || '');
  if (Number.isNaN(sourceAsOf.getTime())) {
    return { status: 'unavailable', source_as_of: null, observed_at: observedAt };
  }
  const ageDays = Math.max(0, (observed.getTime() - sourceAsOf.getTime()) / 86_400_000);
  return {
    status: ageDays > sourceContract.freshness.stale_after_days ? 'stale' : 'current-within-policy',
    source_as_of: sourceAsOf.toISOString(),
    observed_at: observedAt,
    age_days: ageDays,
    stale_after_days: sourceContract.freshness.stale_after_days,
  };
}

function dailyCountAnomalies(countsByDate) {
  const entries = Object.entries(countsByDate);
  if (entries.length < 7) return { status: 'not-evaluated-insufficient-days', method: 'median-plus-6-MAD', dates: [] };
  const counts = entries.map(([, count]) => count);
  const median = numericMedian(counts);
  const mad = numericMedian(counts.map((count) => Math.abs(count - median)));
  const thresholdLow = Math.max(0, median - 6 * mad);
  const thresholdHigh = median + 6 * mad;
  return {
    status: 'evaluated',
    method: 'median-plus-6-MAD',
    median,
    mad,
    threshold_low: thresholdLow,
    threshold_high: thresholdHigh,
    dates: entries.filter(([, count]) => count < thresholdLow || count > thresholdHigh)
      .map(([date, count]) => ({ date, count })),
    note: 'Counts are reported for review; statistical flags do not prove source error.',
  };
}

function revisionRecord(sourceId, type, prior, next) {
  return {
    source_record_id: `cartodb:${sourceId}`,
    type,
    prior_row_hash: prior?.row_hash || null,
    row_hash: next.row_hash,
    first_seen_at: next.first_seen_at,
    last_seen_at: next.last_seen_at,
    prior_lifecycle_state: prior?.lifecycle?.state || null,
    lifecycle_state: next.lifecycle.state,
  };
}

function appendRevisionDetail(details, record) {
  if (details.length < 10000) details.push(record);
}

function totalChangedRevisions(revisions) {
  return Object.entries(revisions)
    .filter(([type]) => type !== 'unchanged')
    .reduce((sum, [, count]) => sum + count, 0);
}

function transformIdentity(event) {
  return identityOf({
    normalized_category: event.normalized_category,
    spatial: event.spatial,
    acs: event.acs,
    lineage: {
      crosswalk_version: event.lineage.crosswalk_version,
      tract_boundary_id: event.lineage.tract_boundary_id,
      acs_snapshot_id: event.lineage.acs_snapshot_id,
      corridor_registry_id: event.lineage.corridor_registry_id,
    },
  });
}

function sourceRowIdentity(row, selectedFields) {
  return identityOf(Object.fromEntries(selectedFields.map((field) => [field, row[field] ?? null])));
}

function validateEventContract(value) {
  if (value?.event_schema !== EVENT_SCHEMA || value.warehouse_schema !== WAREHOUSE_SCHEMA
    || value.quality_report_schema !== QUALITY_SCHEMA || value.lineage_registry_schema !== LINEAGE_SCHEMA
    || value.schema_version !== 1 || !Array.isArray(value.canonical_event_required_fields)
    || value.crosswalk?.unknown_policy !== 'fail-closed-null-normalized-category'
    || value.acs?.estimate_and_moe_are_distinct !== true
    || value.artifact_policy?.raw_and_canonical_git_policy !== 'ignored-only') {
    throw new Error('Crime event warehouse contract is invalid.');
  }
  return value;
}

function validateDependencies(value) {
  validateEventContract(value?.eventContract);
  validateSourceContract(value?.sourceContract);
  if (!value.crosswalk || !value.tractIndex || !value.acsIndex) {
    throw new Error('Crime warehouse dependencies are incomplete.');
  }
}

function validateTractGeographyContract(registry, tractIndex, geographyDefinition) {
  if (registry?.registry_schema !== 'engagement-tract-crime-source-registry/v1'
    || registry.expected_geoid_count !== tractIndex.geoids.length
    || registry.geography_definition !== geographyDefinition) {
    throw new Error('Tract boundary registry lacks a compatible geography definition or GEOID count.');
  }
}

async function validateSyntheticSnapshot(manifest, snapshotDir) {
  if (manifest?.schema !== SYNTHETIC_SNAPSHOT_SCHEMA || manifest.source_kind !== 'synthetic'
    || manifest.synthetic_fixture !== true || manifest.serving_eligible !== false
    || manifest.availability !== 'available' || !Array.isArray(manifest.shards)
    || manifest.shards.length !== manifest.partition_count) {
    throw new Error('Synthetic crime snapshot contract is invalid.');
  }
  let rows = 0;
  for (const shard of manifest.shards) {
    const filePath = safeSnapshotPath(snapshotDir, shard.path);
    if ((await fs.stat(filePath)).size !== shard.bytes || await hashFile(filePath) !== shard.identity) {
      throw new Error('Synthetic crime snapshot shard identity drifted.');
    }
    rows += shard.row_count;
  }
  if (rows !== manifest.row_count) throw new Error('Synthetic crime snapshot row count drifted.');
}

async function readCanonicalPartition(filePath, partition, partitionCount) {
  const rows = new Map();
  if (!await pathExists(filePath)) return rows;
  for await (const event of readJsonLines(filePath)) {
    const sourceId = sourceNumericId(event);
    if (rows.has(sourceId) || partitionForSourceId(sourceId, partitionCount) !== partition) {
      throw new Error(`Canonical crime partition ${partition} contains duplicate or misplaced rows.`);
    }
    rows.set(sourceId, event);
  }
  return rows;
}

async function* readJsonLines(filePath) {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch (error) {
      throw new Error(`${filePath}:${lineNumber} is not valid JSON: ${error.message}`);
    }
  }
}

async function writeJsonLines(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(filePath, 'w');
  try {
    for (const row of rows) await handle.write(`${JSON.stringify(row)}\n`);
  } finally {
    await handle.close();
  }
}

function eventInScope(event, scope) {
  const date = event.event_at.slice(0, 10);
  return date >= scope.start && date < scope.end_exclusive;
}

function sourceIdentifier(row) {
  const number = Number(row?.cartodb_id);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Crime source row cartodb_id is invalid.');
  return number;
}

function sourceNumericId(event) {
  const match = String(event?.source_record_id || '').match(/^cartodb:(\d+)$/);
  const number = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Canonical event source_record_id is invalid.');
  return number;
}

function nullableIntegerString(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  return /^\d+$/.test(text) ? text : null;
}

function textOrNull(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function exactTimestamp(value, label = null) {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (label) throw new Error(`${label} is not a valid timestamp.`);
  return null;
}

function exactNow(now) {
  const value = now();
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Warehouse observation clock is invalid.');
  return parsed.toISOString();
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

function numericMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function minText(left, right) {
  return left && left < right ? left : right;
}

function maxText(left, right) {
  return left && left > right ? left : right;
}

function shardName(partition) {
  return `part-${String(partition).padStart(3, '0')}.jsonl`;
}

function safeArtifactName(identity) {
  const match = String(identity || '').match(/^sha256:([a-f0-9]{64})$/);
  if (!match) throw new Error('Artifact identity is invalid.');
  return match[1];
}

function safeSnapshotPath(snapshotDir, relativePath) {
  if (path.isAbsolute(relativePath) || relativePath.includes('..')) throw new Error('Snapshot shard path is unsafe.');
  const root = path.resolve(snapshotDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Snapshot shard path escapes its root.');
  return resolved;
}

function safeOwnedPath(warehouseDir, targetPath) {
  const root = path.resolve(warehouseDir);
  const target = path.resolve(targetPath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Warehouse-owned path must be a child of the warehouse root.');
  }
  return target;
}

async function removeOwnedDirectory(warehouseDir, targetPath) {
  const target = safeOwnedPath(warehouseDir, targetPath);
  await fs.rm(target, { recursive: true, force: true });
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

async function replaceFileFromCopy(source, destination) {
  const temporary = `${destination}.${process.pid}-${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, temporary);
  await fs.rm(destination, { force: true });
  await fs.rename(temporary, destination);
}

async function linkOrCopy(source, destination) {
  try {
    await fs.link(source, destination);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    await fs.copyFile(source, destination);
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

function portablePath(directory, fileName) {
  return path.resolve(directory, fileName).replaceAll('\\', '/');
}
