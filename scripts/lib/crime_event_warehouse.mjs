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
  validateCrimeSourceRow,
  validateCrimeSourceSnapshot,
  validateSourceContract,
} from './crime_event_source.mjs';

const EVENT_SCHEMA = 'engagement-phl-crime-event/v1';
const WAREHOUSE_SCHEMA = 'engagement-phl-crime-event-warehouse/v1';
const QUALITY_SCHEMA = 'engagement-phl-crime-data-quality/v1';
const LINEAGE_SCHEMA = 'engagement-phl-crime-lineage/v1';
const SYNTHETIC_SNAPSHOT_SCHEMA = 'engagement-phl-crime-synthetic-snapshot/v1';
const TRANSACTION_SCHEMA = 'engagement-phl-crime-warehouse-transaction/v1';
const REVISION_SCHEMA = 'engagement-phl-crime-revisions/v1';
const BACKFILL_CHECKPOINT_SCHEMA = 'engagement-phl-crime-backfill-checkpoint/v1';
const SOURCE_SNAPSHOT_SCHEMA = 'engagement-phl-crime-source-snapshot/v1';
const EVENT_CONTRACT_URL = new URL('../data/crime_event_contract.v1.json', import.meta.url);
const SOURCE_CONTRACT_URL = new URL('../data/crime_event_source_contract.json', import.meta.url);
const TAXONOMY_URL = new URL('../../src/data/crime_taxonomy.v1.json', import.meta.url);
const TRACT_GEOJSON_URL = new URL('../../public/data/tracts_phl.geojson', import.meta.url);
const TRACT_SOURCE_REGISTRY_URL = new URL('../data/tract_source_contract.json', import.meta.url);
const ACS_SNAPSHOT_URL = new URL('../../src/data/acs_tracts_2024_pa101.json', import.meta.url);
export const CRIME_WAREHOUSE_RECEIPT_SCHEMA = 'engagement-phl-crime-warehouse-receipt/v3';

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
  failAfterPublishMetadata = null,
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
  if (currentManifest) await validateWarehouseLineageBindings(warehouseDir, currentManifest);
  if (currentManifest?.applied_snapshot_ids?.includes(snapshotManifest.snapshot_id)) {
    if (currentManifest.current_snapshot_id === snapshotManifest.snapshot_id) {
      await validateWarehouseCanonicalBindings(warehouseDir, currentManifest);
    }
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
  const priorEarliestEventAt = currentManifest?.coverage?.earliest_event_at || null;
  const priorLatestEventAt = currentManifest?.coverage?.latest_event_at || null;
  let earliestEventAt = priorEarliestEventAt;
  let latestEventAt = priorLatestEventAt;
  let canonicalRowCount = 0;
  const canonicalPartitions = [];

  try {
    for (let partition = 0; partition < partitionCount; partition += 1) {
      const rawShard = snapshotManifest.shards[partition];
      const rawPath = safeSnapshotPath(snapshotDir, rawShard.path);
      const canonicalPath = path.join(warehouseDir, 'canonical', shardName(partition));
      const existing = await readCanonicalPartition(
        canonicalPath,
        partition,
        partitionCount,
        dependencies.eventContract,
      );
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
        if (!earliestEventAt || next.event_at < earliestEventAt) earliestEventAt = next.event_at;
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
      const candidate = await writeJsonLines(candidatePath, rows);
      canonicalPartitions.push({
        partition,
        path: path.posix.join('canonical', shardName(partition)),
        row_count: candidate.row_count,
        bytes: candidate.bytes,
        identity: candidate.identity,
      });
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
      canonicalPartitions,
    });
    const manifest = {
      schema: WAREHOUSE_SCHEMA,
      mode: snapshotManifest.source_kind === 'synthetic' ? 'synthetic-test' : 'official-local-candidate',
      serving_eligible: false,
      partition_count: partitionCount,
      canonical_partitions: canonicalPartitions,
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
        earliest_event_at: earliestEventAt,
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
        schema: REVISION_SCHEMA,
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
      failAfterPublishMetadata,
    });
    await removeOwnedDirectory(warehouseDir, transactionDir);
    onProgress({ phase: 'complete', rowCount: canonicalRowCount, snapshotId: snapshotManifest.snapshot_id });
    return { idempotent: false, manifest, quality };
  } catch (error) {
    try {
      await recoverWarehouseTransaction(warehouseDir);
    } catch (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        'Crime warehouse publication failed and transaction recovery also failed.',
      );
    }
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
  return validateCanonicalEventAgainstContract(event, eventContract);
}

function validateCanonicalEventAgainstContract(event, eventContract) {
  if (event?.schema !== EVENT_SCHEMA
    || JSON.stringify(Object.keys(event)) !== JSON.stringify(eventContract.canonical_event_required_fields)
    || typeof event.source_record_id !== 'string'
    || !exactTimestamp(event.event_at)
    || !exactTimestamp(event.first_seen_at)
    || !exactTimestamp(event.last_seen_at)
    || exactTimestamp(event.first_seen_at) > exactTimestamp(event.last_seen_at)
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

export async function createCrimeWarehouseAdmissionReceipt(evidenceRoot) {
  const evidence = await inspectCrimeWarehouseEvidence(evidenceRoot);
  const receipt = { ...evidence, identity: identityOf(evidence) };
  validateCrimeWarehouseReceiptShape(receipt);
  return Object.freeze(structuredClone(receipt));
}

export async function validateCrimeWarehouseAdmissionReceipt(evidenceRoot) {
  const root = await canonicalDirectoryRoot(evidenceRoot, 'Crime warehouse evidence root');
  const receiptArtifact = await readRelativeJsonArtifact(root, 'receipt.json', 'crime warehouse receipt');
  const receipt = receiptArtifact.value;
  validateCrimeWarehouseReceiptShape(receipt);
  const evidence = await inspectCrimeWarehouseEvidence(root.absolute);
  const expectedIdentity = identityOf(evidence);
  if (receipt.identity !== expectedIdentity) {
    throw new Error('Crime warehouse receipt identity drifted from its declared evidence.');
  }
  if (stableSerialization(withoutIdentity(receipt)) !== stableSerialization(evidence)) {
    throw new Error('Crime warehouse receipt fields drifted from the real producer output.');
  }
  return Object.freeze({
    receipt: structuredClone(receipt),
    path: receiptArtifact.absolute,
    bytes: receiptArtifact.bytes.length,
    sha256: rawSha256(receiptArtifact.bytes),
  });
}

export async function publishCrimeWarehouseAdmissionReceipt(evidenceRoot) {
  const root = await canonicalDirectoryRoot(evidenceRoot, 'Crime warehouse evidence root');
  const receipt = await createCrimeWarehouseAdmissionReceipt(root.absolute);
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  const destination = path.join(root.absolute, 'receipt.json');
  const existing = await readJsonIfExists(destination);
  if (existing && stableSerialization(existing) === stableSerialization(receipt)) {
    const admitted = await validateCrimeWarehouseAdmissionReceipt(root.absolute);
    return Object.freeze({ ...admitted, idempotent: true });
  }
  await writeJsonAtomic(destination, receipt);
  const admitted = await validateCrimeWarehouseAdmissionReceipt(root.absolute);
  if (admitted.bytes !== Buffer.byteLength(text)) {
    throw new Error('Crime warehouse receipt bytes changed during serialized publication.');
  }
  return Object.freeze({ ...admitted, idempotent: false });
}

async function inspectCrimeWarehouseEvidence(evidenceRoot) {
  const root = await canonicalDirectoryRoot(evidenceRoot, 'Crime warehouse evidence root');
  const [eventContract, sourceContract, taxonomy, tractGeoJson, tractSourceRegistry, acsSnapshot] = await Promise.all([
    readJsonUrl(EVENT_CONTRACT_URL),
    readJsonUrl(SOURCE_CONTRACT_URL),
    readJsonUrl(TAXONOMY_URL),
    readJsonUrl(TRACT_GEOJSON_URL),
    readJsonUrl(TRACT_SOURCE_REGISTRY_URL),
    readJsonUrl(ACS_SNAPSHOT_URL),
  ]);
  validateEventContract(eventContract);
  validateSourceContract(sourceContract);
  const manifestArtifact = await readRelativeJsonArtifact(
    root,
    'warehouse/manifest.json',
    'warehouse manifest',
  );
  const checkpointArtifact = await readRelativeJsonArtifact(
    root,
    'backfill-checkpoint.json',
    'backfill checkpoint',
  );
  const manifest = manifestArtifact.value;
  const checkpoint = checkpointArtifact.value;
  if (manifest?.schema !== WAREHOUSE_SCHEMA
    || manifest.mode !== 'official-local-candidate'
    || manifest.serving_eligible !== false
    || checkpoint?.schema !== BACKFILL_CHECKPOINT_SCHEMA) {
    throw new Error('Crime warehouse admission requires official-local-candidate producer output.');
  }

  const lineageRelative = warehouseCompanionRelative(manifest.lineage_registry, 'lineage registry');
  const qualityRelative = warehouseCompanionRelative(manifest.latest_quality_report, 'latest quality report');
  const revisionRelative = warehouseCompanionRelative(manifest.latest_revision_report, 'latest revision report');
  const [lineageArtifact, qualityArtifact, revisionArtifact] = await Promise.all([
    readRelativeJsonArtifact(root, lineageRelative, 'lineage registry'),
    readRelativeJsonArtifact(root, qualityRelative, 'latest quality report'),
    readRelativeJsonArtifact(root, revisionRelative, 'latest revision report'),
  ]);
  const lineage = lineageArtifact.value;
  const quality = qualityArtifact.value;
  const revision = revisionArtifact.value;
  if (lineage?.schema !== LINEAGE_SCHEMA
    || quality?.schema !== QUALITY_SCHEMA
    || revision?.schema !== REVISION_SCHEMA) {
    throw new Error('Crime warehouse companion schema drifted.');
  }
  if (quality.snapshot_id !== manifest.current_snapshot_id
    || revision.snapshot_id !== manifest.current_snapshot_id
    || quality.lineage?.source_snapshot_id !== manifest.current_snapshot_id) {
    throw new Error('Crime warehouse quality or revision companion drifted from current_snapshot_id.');
  }

  const periods = validateBackfillPeriods(checkpoint);
  const sourceSnapshots = await inspectLineageSourceSnapshots(
    root,
    lineage,
    manifest,
    sourceContract,
    periods,
  );
  const currentSource = sourceSnapshots.items.find(
    ({ value }) => value.snapshot_id === manifest.current_snapshot_id,
  );
  if (!currentSource) throw new Error('Crime warehouse lineage lacks the current source revision.');
  if (manifest.transforms?.corridor_registry_id !== null) {
    throw new Error('Crime warehouse admission cannot recompute an unbound corridor registry transform.');
  }
  const dependencies = await createWarehouseDependencies({
    eventContract,
    sourceContract,
    taxonomy,
    tractGeoJson,
    tractSourceRegistry,
    acsSnapshot,
    corridorRegistry: null,
  });
  const canonical = await inspectCanonicalPartitions(
    root,
    manifest,
    eventContract,
    sourceSnapshots,
    dependencies,
  );
  validateCrimeWarehouseProducerSemantics({
    manifest,
    checkpoint,
    lineage,
    quality,
    revision,
    sourceSnapshots,
    currentSource: currentSource.value,
    canonical,
    periods,
  });

  const clocks = {
    source_as_of: currentSource.value.source_vintage.source_as_of,
    retrieved_at: currentSource.value.source_vintage.retrieved_at,
    built_at: manifest.updated_at,
    observed_at: checkpoint.updated_at,
  };
  validateReceiptClockOrder(clocks, {
    start: manifest.coverage.earliest_scope_start,
    end_exclusive: manifest.coverage.latest_scope_end_exclusive,
    earliest_event_at: manifest.coverage.earliest_event_at,
    latest_event_at: manifest.coverage.latest_event_at,
  });
  const evidence = {
    schema: CRIME_WAREHOUSE_RECEIPT_SCHEMA,
    mode: 'official-local-candidate',
    serving_eligible: false,
    source: {
      dataset_id: currentSource.value.dataset_id,
      provider: currentSource.value.provider,
      source_table: currentSource.value.source_table,
      schema: currentSource.value.schema,
      revision: manifest.current_snapshot_id,
    },
    warehouse: {
      schema: manifest.schema,
      event_schema: manifest.transforms.event_schema,
      current_snapshot_id: manifest.current_snapshot_id,
    },
    coverage: {
      start: manifest.coverage.earliest_scope_start,
      end_exclusive: manifest.coverage.latest_scope_end_exclusive,
      earliest_event_at: manifest.coverage.earliest_event_at,
      latest_event_at: manifest.coverage.latest_event_at,
    },
    counts: {
      acquired_rows: checkpoint.final_quality.acquired_rows,
      expected_date_scoped_rows: checkpoint.final_quality.expected_date_scoped_rows,
      canonical_rows: manifest.canonical_row_count,
      active_rows: manifest.active_row_count,
      removal_candidate_rows: manifest.removal_candidate_count,
      source_snapshots: sourceSnapshots.items.length,
      canonical_partitions: manifest.partition_count,
    },
    clocks,
    data_quality: {
      status: quality.data_status,
      status_semantics: structuredClone(quality.status_semantics),
      coordinate: structuredClone(quality.coordinate),
      tract: structuredClone(quality.join_coverage.tract),
      fixed_grid: structuredClone(quality.join_coverage.fixed_grid),
      route_corridor: structuredClone(quality.join_coverage.route_corridor),
      acs_estimate_moe: structuredClone(quality.join_coverage.acs_estimate_moe),
      unknown_label_count: quality.labels.unknown_observed.length,
    },
    artifacts: {
      warehouse_manifest: artifactDescriptor(manifestArtifact, manifest.schema),
      backfill_checkpoint: artifactDescriptor(checkpointArtifact, checkpoint.schema),
      lineage_registry: artifactDescriptor(lineageArtifact, lineage.schema),
      latest_quality_report: artifactDescriptor(qualityArtifact, quality.schema),
      latest_revision_report: artifactDescriptor(revisionArtifact, revision.schema),
      current_source_manifest: artifactDescriptor(currentSource.artifact, currentSource.value.schema),
      source_manifests: sourceSnapshots.aggregate,
      canonical,
    },
    authority: {
      producer_validated_local_candidate: true,
      integration_authority: false,
      serving_authority: false,
      deletion_authority: false,
    },
    limitations: [
      'Raw hashes bind exact local bytes; they do not prove upstream completeness, accuracy, or continuing freshness.',
      'Serialized multi-file transaction recovery is validated; instantaneous multi-file atomic visibility is not claimed.',
      'Ambiguous, unmapped, partial, stale, and unavailable states are not zero or current.',
    ],
  };
  return evidence;
}

async function inspectLineageSourceSnapshots(root, lineage, manifest, sourceContract, periods) {
  if (!Array.isArray(lineage?.source_snapshots) || lineage.source_snapshots.length === 0) {
    throw new Error('Crime warehouse lineage source snapshot registry is empty.');
  }
  if (lineage.source_snapshots.length !== periods.length) {
    throw new Error('Crime warehouse lineage source snapshots do not match the exact backfill periods.');
  }
  const items = [];
  const seen = new Set();
  let totalBytes = 0;
  let totalRows = 0;
  let rawBytes = 0;
  let rawShardCount = 0;
  let earliestEventAt = null;
  let latestEventAt = null;
  const rawBindings = [];
  for (const [index, entry] of lineage.source_snapshots.entries()) {
    const expectedPeriod = periods[index];
    if (!entry || typeof entry.manifest_path !== 'string' || seen.has(entry.snapshot_id)) {
      throw new Error('Crime warehouse lineage source identities must be unique and complete.');
    }
    seen.add(entry.snapshot_id);
    const relative = await relativePathInsideRoot(root, entry.manifest_path, 'source manifest');
    const artifact = await readRelativeJsonArtifact(root, relative, 'source manifest');
    const value = artifact.value;
    await validateCrimeSourceSnapshot(value, path.dirname(artifact.absolute), { sourceContract });
    if (value?.schema !== SOURCE_SNAPSHOT_SCHEMA
      || value.source_kind !== 'official'
      || value.availability !== 'available'
      || value.provider !== sourceContract.provider
      || value.source_url !== sourceContract.api_url
      || value.source_catalog_url !== sourceContract.official_catalog_url
      || stableSerialization(value.source_schema) !== stableSerialization(sourceContract.expected_query_schema)
      || value.snapshot_id !== entry.snapshot_id
      || value.source_vintage?.id !== entry.snapshot_id
      || value.source_vintage?.source_as_of !== entry.source_as_of
      || value.source_vintage?.retrieved_at !== entry.retrieved_at
      || value.row_count !== entry.row_count
      || value.scope?.start !== expectedPeriod.start
      || value.scope?.end_exclusive !== expectedPeriod.end_exclusive
      || value.scope?.completeness !== 'complete-query-required'
      || value.scope?.ordering !== 'cartodb_id ASC'
      || stableSerialization(value.scope) !== stableSerialization(entry.scope)) {
      throw new Error(`Crime warehouse lineage source manifest drifted for ${entry.snapshot_id || '(missing)'}.`);
    }
    const minimum = exactTimestamp(value.source_summary_after?.min_event_at);
    const maximum = exactTimestamp(value.source_summary_after?.max_event_at);
    if ((value.row_count > 0 && (!minimum || !maximum)) || (minimum && maximum && minimum > maximum)) {
      throw new Error('Crime warehouse source manifest event coverage is invalid.');
    }
    earliestEventAt = minimum && (!earliestEventAt || minimum < earliestEventAt) ? minimum : earliestEventAt;
    latestEventAt = maximum && (!latestEventAt || maximum > latestEventAt) ? maximum : latestEventAt;
    totalRows += value.row_count;
    totalBytes += artifact.bytes.length;
    const raw = await inspectSourceRawShards(root, artifact.relative, value, sourceContract);
    const recomputedSnapshotId = identityOf({
      dataset_id: value.dataset_id,
      source_table: value.source_table,
      scope: { start: value.scope.start, end_exclusive: value.scope.end_exclusive },
      row_count: raw.rows,
      source_as_of: value.source_vintage.source_as_of,
      source_schema: sourceContract.expected_query_schema,
      shards: value.shards.map(({ path: shardPath, row_count: rowCount, bytes: shardBytes, identity }) => ({
        path: shardPath,
        row_count: rowCount,
        bytes: shardBytes,
        identity,
      })),
    });
    if (recomputedSnapshotId !== value.snapshot_id) {
      throw new Error(`Crime warehouse source snapshot identity drifted for ${value.snapshot_id}.`);
    }
    if (raw.rows !== value.row_count
      || raw.earliest_event_at !== minimum
      || raw.latest_event_at !== maximum
      || stableSerialization(value.source_summary_before) !== stableSerialization(value.source_summary_after)
      || value.source_summary_before?.row_count !== raw.rows
      || value.source_summary_after?.row_count !== raw.rows
      || value.source_summary_after?.distinct_source_ids !== raw.rows
      || value.source_summary_after?.distinct_dc_keys !== raw.distinct_dc_keys
      || value.source_summary_after?.suspected_duplicate_dc_key_excess !== raw.rows - raw.distinct_dc_keys
      || exactTimestamp(value.source_summary_after?.min_event_at) !== raw.earliest_event_at
      || exactTimestamp(value.source_summary_after?.max_event_at) !== raw.latest_event_at
      || stableSerialization(value.quality?.counts_by_date) !== stableSerialization(raw.counts_by_date)
      || stableSerialization(value.quality?.counts_by_category) !== stableSerialization(raw.counts_by_category)
      || value.quality?.coordinate_missing !== raw.coordinate_missing
      || value.quality?.coordinate_invalid !== raw.coordinate_invalid
      || value.quality?.coordinate_outside_city_bounds !== raw.coordinate_outside_city_bounds
      || value.quality?.duplicate_source_id_count !== 0
      || value.quality?.suspected_duplicate_count !== raw.rows - raw.distinct_dc_keys) {
      throw new Error(`Crime warehouse source snapshot semantic counts drifted for ${value.snapshot_id}.`);
    }
    rawBytes += raw.bytes;
    rawShardCount += raw.count;
    rawBindings.push(...raw.bindings);
    items.push({ value, artifact, raw });
  }
  if (stableSerialization([...seen]) !== stableSerialization(manifest.applied_snapshot_ids)) {
    throw new Error('Crime warehouse applied revisions drifted from lineage order.');
  }
  const bindings = items.map(({ artifact, value }) => ({
    path: artifact.relative,
    bytes: artifact.bytes.length,
    sha256: rawSha256(artifact.bytes),
    revision: value.snapshot_id,
  }));
  return {
    items,
    totalRows,
    earliestEventAt,
    latestEventAt,
    aggregate: {
      count: items.length,
      bytes: totalBytes,
      sha256: identityOf(bindings),
      raw_shard_count: rawShardCount,
      raw_bytes: rawBytes,
      raw_sha256: identityOf(rawBindings),
    },
  };
}

async function inspectSourceRawShards(root, manifestRelative, manifest, sourceContract) {
  finiteInteger(manifest.partition_count, 'source manifest partition_count', { minimum: 1 });
  if (!Array.isArray(manifest.shards) || manifest.shards.length !== manifest.partition_count) {
    throw new Error('Crime warehouse source manifest raw shard set drifted.');
  }
  const manifestDirectory = path.posix.dirname(manifestRelative);
  const bindings = [];
  const partitionPaths = [];
  let bytes = 0;
  let rows = 0;
  let earliestEventAt = null;
  let latestEventAt = null;
  let coordinateMissing = 0;
  let coordinateInvalid = 0;
  let coordinateOutsideCityBounds = 0;
  const countsByDate = new Map();
  const countsByCategory = new Map();
  const distinctDcKeys = new Set();
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = sourceContract.source_semantics.city_bbox;
  for (let partition = 0; partition < manifest.partition_count; partition += 1) {
    const shard = manifest.shards[partition];
    const expectedPath = `rows/part-${String(partition).padStart(3, '0')}.jsonl`;
    if (shard?.partition !== partition || shard.path !== expectedPath) {
      throw new Error('Crime warehouse source manifest raw shard order drifted.');
    }
    finiteInteger(shard.row_count, 'source raw shard row_count');
    finiteInteger(shard.bytes, 'source raw shard bytes');
    if (!/^sha256:[a-f0-9]{64}$/.test(shard.identity || '')) {
      throw new Error('Crime warehouse source raw shard identity is invalid.');
    }
    const relative = `${manifestDirectory}/${canonicalRelativePath(shard.path, 'source raw shard')}`;
    const resolved = await resolveCanonicalRelative(root, relative, {
      expectDirectory: false,
      label: 'source raw shard',
    });
    const stat = await fs.stat(resolved.absolute);
    const identity = await hashFile(resolved.absolute);
    if (stat.size !== shard.bytes || identity !== shard.identity) {
      throw new Error(`Crime warehouse source raw shard bytes drifted for ${relative}.`);
    }
    let actualRows = 0;
    let previousSourceId = 0;
    for await (const sourceRow of readJsonLines(resolved.absolute)) {
      validateCrimeSourceRow(sourceRow, sourceContract);
      const sourceId = sourceIdentifier(sourceRow);
      if (sourceId <= previousSourceId || partitionForSourceId(sourceId, manifest.partition_count) !== partition) {
        throw new Error(`Crime warehouse source raw shard ${partition} has duplicate, unordered, or misplaced IDs.`);
      }
      previousSourceId = sourceId;
      const eventAt = exactTimestamp(sourceRow.dispatch_date_time, `source ${sourceId} dispatch_date_time`);
      const eventDate = eventAt.slice(0, 10);
      if (eventDate < manifest.scope.start || eventDate >= manifest.scope.end_exclusive) {
        throw new Error(`Crime warehouse source row ${sourceId} is outside its declared period.`);
      }
      earliestEventAt = !earliestEventAt || eventAt < earliestEventAt ? eventAt : earliestEventAt;
      latestEventAt = !latestEventAt || eventAt > latestEventAt ? eventAt : latestEventAt;
      countsByDate.set(eventDate, (countsByDate.get(eventDate) || 0) + 1);
      const category = textOrNull(sourceRow.text_general_code) || 'unavailable';
      countsByCategory.set(category, (countsByCategory.get(category) || 0) + 1);
      if (sourceRow.dc_key != null) distinctDcKeys.add(String(sourceRow.dc_key));
      if (sourceRow.point_x == null || sourceRow.point_y == null) coordinateMissing += 1;
      else if (!Number.isFinite(sourceRow.point_x) || !Number.isFinite(sourceRow.point_y)
        || sourceRow.point_x < -180 || sourceRow.point_x > 180
        || sourceRow.point_y < -90 || sourceRow.point_y > 90) coordinateInvalid += 1;
      else if (sourceRow.point_x < minLongitude || sourceRow.point_x > maxLongitude
        || sourceRow.point_y < minLatitude || sourceRow.point_y > maxLatitude) coordinateOutsideCityBounds += 1;
      actualRows += 1;
    }
    if (actualRows !== shard.row_count) {
      throw new Error(`Crime warehouse source raw shard ${partition} row count drifted from its bytes.`);
    }
    bytes += stat.size;
    rows += actualRows;
    bindings.push({ path: relative, bytes: stat.size, sha256: identity });
    partitionPaths.push(resolved.absolute);
  }
  if (rows !== manifest.row_count) throw new Error('Crime warehouse source raw shard row count drifted.');
  return {
    count: bindings.length,
    bytes,
    bindings,
    partition_paths: partitionPaths,
    rows,
    earliest_event_at: earliestEventAt,
    latest_event_at: latestEventAt,
    counts_by_date: Object.fromEntries([...countsByDate.entries()].sort()),
    counts_by_category: Object.fromEntries([...countsByCategory.entries()].sort()),
    coordinate_missing: coordinateMissing,
    coordinate_invalid: coordinateInvalid,
    coordinate_outside_city_bounds: coordinateOutsideCityBounds,
    distinct_dc_keys: distinctDcKeys.size,
  };
}

async function inspectCanonicalPartitions(root, manifest, eventContract, sourceSnapshots, dependencies) {
  const partitionCount = manifest.partition_count;
  finiteInteger(partitionCount, 'warehouse partition_count', { minimum: 1 });
  const directoryRelative = 'warehouse/canonical';
  const directory = await resolveCanonicalRelative(root, directoryRelative, { expectDirectory: true });
  const names = (await fs.readdir(directory.absolute)).filter((name) => /^part-\d{3}\.jsonl$/.test(name)).sort();
  const expectedNames = Array.from(
    { length: partitionCount },
    (_, index) => `part-${String(index).padStart(3, '0')}.jsonl`,
  );
  if (stableSerialization(names) !== stableSerialization(expectedNames)) {
    throw new Error('Crime warehouse canonical partition name set drifted.');
  }
  const bindings = [];
  let bytes = 0;
  const counts = emptyCanonicalInspectionCounts();
  let earliestEventAt = null;
  let latestEventAt = null;
  const unknownLabels = new Set();
  const revisions = emptyRevisionCounts();
  for (const [partition, name] of names.entries()) {
    const relative = `${directoryRelative}/${name}`;
    const artifact = await resolveCanonicalRelative(root, relative, {
      expectDirectory: false,
      label: 'canonical partition',
    });
    const stat = await fs.stat(artifact.absolute);
    let partitionRows = 0;
    let previousSourceId = 0;
    const canonicalIterator = readJsonLines(artifact.absolute)[Symbol.asyncIterator]();
    let canonicalNext = await canonicalIterator.next();
    const rawCursors = await Promise.all(sourceSnapshots.items.map(async (item, snapshotIndex) => {
      const iterator = readJsonLines(item.raw.partition_paths[partition])[Symbol.asyncIterator]();
      return {
        snapshotIndex,
        snapshot: item.value,
        iterator,
        next: await iterator.next(),
      };
    }));
    while (rawCursors.some(({ next }) => !next.done)) {
      const sourceId = Math.min(...rawCursors
        .filter(({ next }) => !next.done)
        .map(({ next }) => sourceIdentifier(next.value)));
      const occurrences = rawCursors
        .filter(({ next }) => !next.done && sourceIdentifier(next.value) === sourceId)
        .map(({ snapshotIndex, snapshot, next }) => ({ snapshotIndex, snapshot, row: next.value }));
      if (canonicalNext.done || sourceNumericId(canonicalNext.value) !== sourceId) {
        throw new Error(`Crime warehouse canonical partition ${partition} is not one-to-one with source ID ${sourceId}.`);
      }
      const event = canonicalNext.value;
      partitionRows += 1;
      validateCanonicalEventAgainstContract(event, eventContract);
      if (sourceId <= previousSourceId || partitionForSourceId(sourceId, partitionCount) !== partition) {
        throw new Error(`Crime warehouse canonical partition ${partition} has duplicate, unordered, or misplaced IDs.`);
      }
      previousSourceId = sourceId;
      if (event.source_ids?.cartodb_id !== String(sourceId)
        || event.lineage?.source_snapshot_id !== event.source_vintage?.snapshot_id
        || !manifest.applied_snapshot_ids.includes(event.source_vintage?.snapshot_id)) {
        throw new Error(`Canonical crime event ${event.source_record_id} has inconsistent source identity or lineage.`);
      }
      validateCanonicalRawBinding(event, occurrences.at(-1), dependencies);
      const revisionType = classifyRecomputedRevision(occurrences, sourceSnapshots.items, dependencies);
      if (revisionType) revisions[revisionType] += 1;
      accumulateInspectedCanonicalQuality(counts, event, unknownLabels);
      earliestEventAt = !earliestEventAt || event.event_at < earliestEventAt ? event.event_at : earliestEventAt;
      latestEventAt = !latestEventAt || event.event_at > latestEventAt ? event.event_at : latestEventAt;
      canonicalNext = await canonicalIterator.next();
      for (const cursor of rawCursors) {
        if (!cursor.next.done && sourceIdentifier(cursor.next.value) === sourceId) {
          cursor.next = await cursor.iterator.next();
        }
      }
    }
    if (!canonicalNext.done) {
      throw new Error(`Crime warehouse canonical partition ${partition} contains an extra source ID.`);
    }
    bytes += stat.size;
    bindings.push({
      partition,
      path: relative,
      row_count: partitionRows,
      bytes: stat.size,
      sha256: await hashFile(artifact.absolute),
    });
  }
  return {
    path: directoryRelative,
    partition_count: partitionCount,
    bytes,
    sha256: identityOf(bindings.map(({ path: bindingPath, bytes: bindingBytes, sha256 }) => ({
      path: bindingPath,
      bytes: bindingBytes,
      sha256,
    }))),
    partition_bindings: bindings.map((binding) => ({
      partition: binding.partition,
      path: binding.path.replace(/^warehouse\//, ''),
      row_count: binding.row_count,
      bytes: binding.bytes,
      identity: binding.sha256,
    })),
    counts,
    earliest_event_at: earliestEventAt,
    latest_event_at: latestEventAt,
    unknown_labels: [...unknownLabels].sort(),
    revision_counts: revisions,
  };
}

function validateCanonicalRawBinding(event, occurrence, dependencies) {
  const expected = canonicalizeSourceRow(
    occurrence.row,
    occurrence.snapshot,
    dependencies,
    event.last_seen_at,
  );
  if (stableSerialization(rawDerivedCanonicalFields(event))
    !== stableSerialization(rawDerivedCanonicalFields(expected))) {
    throw new Error(`Canonical crime event ${event.source_record_id} drifted from its source row transforms.`);
  }
}

function rawDerivedCanonicalFields(event) {
  return {
    schema: event.schema,
    source_record_id: event.source_record_id,
    source_ids: event.source_ids,
    raw_category: event.raw_category,
    normalized_category: event.normalized_category,
    event_at: event.event_at,
    generalized_location: event.generalized_location,
    coordinate: event.coordinate,
    spatial: event.spatial,
    acs: event.acs,
    source_vintage: event.source_vintage,
    row_hash: event.row_hash,
    lineage: event.lineage,
  };
}

function classifyRecomputedRevision(occurrences, sourceItems, dependencies) {
  const currentIndex = sourceItems.length - 1;
  const current = occurrences.find(({ snapshotIndex }) => snapshotIndex === currentIndex);
  const prior = occurrences.filter(({ snapshotIndex }) => snapshotIndex < currentIndex).at(-1);
  if (!current) {
    const latest = occurrences.at(-1);
    if (sourceRowInScope(latest.row, sourceItems[currentIndex].value.scope)) return 'removal-candidate';
    return null;
  }
  if (!prior) {
    const priorLatestEventAt = sourceItems.slice(0, currentIndex)
      .map(({ value }) => value.source_summary_after?.max_event_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    return priorLatestEventAt && exactTimestamp(current.row.dispatch_date_time) < priorLatestEventAt
      ? 'late-arriving' : 'added';
  }
  let wasRemovalCandidate = false;
  for (let index = prior.snapshotIndex + 1; index < currentIndex; index += 1) {
    if (sourceRowInScope(prior.row, sourceItems[index].value.scope)
      && !occurrences.some(({ snapshotIndex }) => snapshotIndex === index)) {
      wasRemovalCandidate = true;
      break;
    }
  }
  if (wasRemovalCandidate) return 'reappeared';
  const priorHash = sourceRowIdentity(prior.row, dependencies.sourceContract.selected_fields);
  const currentHash = sourceRowIdentity(current.row, dependencies.sourceContract.selected_fields);
  if (priorHash === currentHash) {
    const priorEvent = canonicalizeSourceRow(
      prior.row,
      prior.snapshot,
      dependencies,
      prior.snapshot.source_vintage.retrieved_at,
    );
    const currentEvent = canonicalizeSourceRow(
      current.row,
      current.snapshot,
      dependencies,
      current.snapshot.source_vintage.retrieved_at,
    );
    return transformIdentity(priorEvent) === transformIdentity(currentEvent)
      ? 'unchanged' : 'transformation-updated';
  }
  return textOrNull(prior.row.text_general_code) !== textOrNull(current.row.text_general_code)
    || textOrNull(prior.row.ucr_general) !== textOrNull(current.row.ucr_general)
    ? 'reclassified' : 'modified';
}

function sourceRowInScope(row, scope) {
  const date = exactTimestamp(row.dispatch_date_time).slice(0, 10);
  return date >= scope.start && date < scope.end_exclusive;
}

function emptyRevisionCounts() {
  return {
    added: 0,
    'late-arriving': 0,
    modified: 0,
    reclassified: 0,
    unchanged: 0,
    reappeared: 0,
    'removal-candidate': 0,
    'transformation-updated': 0,
  };
}

function emptyCanonicalInspectionCounts() {
  return {
    canonical_rows: 0,
    lifecycle: { active: 0, removal_candidate: 0 },
    coordinate: { available: 0, missing: 0, invalid: 0, outside_city_bounds: 0 },
    tract: { mapped: 0, unmapped: 0, ambiguous: 0 },
    fixed_grid: { mapped: 0, unavailable: 0 },
    route_corridor: { available: 0, unavailable: 0, matches: 0 },
    acs_estimate_moe: { available: 0, partial: 0, unavailable: 0, 'incompatible-vintage': 0 },
    unavailable_label_count: 0,
  };
}

function accumulateInspectedCanonicalQuality(counts, event, unknownLabels) {
  if (event.event_at !== exactTimestamp(event.event_at)
    || event.first_seen_at !== exactTimestamp(event.first_seen_at)
    || event.last_seen_at !== exactTimestamp(event.last_seen_at)) {
    throw new Error(`Canonical crime event ${event.source_record_id} timestamps are not canonical UTC values.`);
  }
  counts.canonical_rows += 1;
  if (event.lifecycle.state === 'active') {
    if (event.lifecycle.first_missing_at !== null || event.lifecycle.missing_vintages !== 0
      || event.lifecycle.reason !== null) {
      throw new Error(`Canonical crime event ${event.source_record_id} active lifecycle is invalid.`);
    }
    counts.lifecycle.active += 1;
  } else {
    if (!exactTimestamp(event.lifecycle.first_missing_at)
      || !Number.isInteger(event.lifecycle.missing_vintages) || event.lifecycle.missing_vintages < 1
      || event.lifecycle.reason !== 'absent-from-complete-query-scope') {
      throw new Error(`Canonical crime event ${event.source_record_id} removal lifecycle is invalid.`);
    }
    counts.lifecycle.removal_candidate += 1;
  }

  if (event.coordinate.status === 'available') counts.coordinate.available += 1;
  else if (event.coordinate.status !== 'unavailable') {
    throw new Error(`Canonical crime event ${event.source_record_id} coordinate status is invalid.`);
  } else if (event.coordinate.reason === 'coordinate-missing') counts.coordinate.missing += 1;
  else if (event.coordinate.reason === 'coordinate-outside-city-bounds') counts.coordinate.outside_city_bounds += 1;
  else counts.coordinate.invalid += 1;

  incrementSupportedStatus(counts.tract, event.spatial?.tract?.status, ['mapped', 'unmapped', 'ambiguous'], event);
  incrementSupportedStatus(counts.fixed_grid, event.spatial?.grid?.status, ['mapped', 'unavailable'], event);
  incrementSupportedStatus(
    counts.route_corridor,
    event.spatial?.route_corridor?.status,
    ['available', 'unavailable'],
    event,
  );
  if (!Array.isArray(event.spatial?.route_corridor?.matches)) {
    throw new Error(`Canonical crime event ${event.source_record_id} route matches are invalid.`);
  }
  counts.route_corridor.matches += event.spatial.route_corridor.matches.length;
  incrementSupportedStatus(
    counts.acs_estimate_moe,
    event.acs?.status,
    ['available', 'partial', 'unavailable', 'incompatible-vintage'],
    event,
  );
  if (event.raw_category?.offense_label == null) counts.unavailable_label_count += 1;
  if (event.normalized_category?.status === 'unknown-label') {
    if (typeof event.raw_category?.offense_label !== 'string' || !event.raw_category.offense_label) {
      throw new Error(`Canonical crime event ${event.source_record_id} unknown label is invalid.`);
    }
    unknownLabels.add(event.raw_category.offense_label);
  }
}

function incrementSupportedStatus(target, status, supported, event) {
  if (!supported.includes(status)) {
    throw new Error(`Canonical crime event ${event.source_record_id} has unsupported DQ status ${status || '(missing)'}.`);
  }
  target[status] += 1;
}

function validateBackfillPeriods(checkpoint) {
  const start = exactDateText(checkpoint?.start, 'backfill checkpoint start');
  const through = exactDateText(checkpoint?.through, 'backfill checkpoint through');
  if (start >= through) throw new Error('Crime warehouse checkpoint range is empty or reversed.');
  const expected = [];
  let cursor = start;
  while (cursor < through) {
    const nextYear = `${Number(cursor.slice(0, 4)) + 1}-01-01`;
    const endExclusive = nextYear < through ? nextYear : through;
    expected.push({ start: cursor, end_exclusive: endExclusive });
    cursor = endExclusive;
  }
  if (stableSerialization(checkpoint.periods) !== stableSerialization(expected)) {
    throw new Error('Crime warehouse checkpoint periods are not the exact continuous range derived from start/through.');
  }
  const expectedKeys = expected.map(({ start: periodStart, end_exclusive: periodEnd }) => (
    `${periodStart}_${periodEnd}`
  ));
  if (stableSerialization(Object.keys(checkpoint.completed || {})) !== stableSerialization(expectedKeys)) {
    throw new Error('Crime warehouse completed period keys have a gap, overlap, or order drift.');
  }
  for (const key of expectedKeys) {
    const completed = checkpoint.completed[key];
    if (!/^sha256:[a-f0-9]{64}$/.test(completed?.snapshot_id || '')
      || !exactTimestamp(completed?.completed_at)) {
      throw new Error(`Crime warehouse completed period ${key} metadata is invalid.`);
    }
    finiteInteger(completed.source_rows, `completed period ${key} source_rows`);
    finiteInteger(completed.canonical_rows, `completed period ${key} canonical_rows`);
  }
  return expected;
}

function validateCrimeWarehouseProducerSemantics({
  manifest,
  checkpoint,
  lineage,
  quality,
  revision,
  sourceSnapshots,
  currentSource,
  canonical,
  periods,
}) {
  const counts = [
    ['canonical_row_count', manifest.canonical_row_count],
    ['active_row_count', manifest.active_row_count],
    ['removal_candidate_count', manifest.removal_candidate_count],
    ['acquired_rows', checkpoint.final_quality?.acquired_rows],
    ['expected_date_scoped_rows', checkpoint.final_quality?.expected_date_scoped_rows],
  ];
  counts.forEach(([label, value]) => finiteInteger(value, label));
  if (stableSerialization(manifest.canonical_partitions)
      !== stableSerialization(canonical.partition_bindings)
    || stableSerialization(lineage.canonical_partitions)
      !== stableSerialization(canonical.partition_bindings)) {
    throw new Error('Crime warehouse manifest or lineage canonical partition binding drifted.');
  }
  if (checkpoint.final_quality?.date_scoped_count_complete !== true
    || checkpoint.start !== manifest.coverage?.earliest_scope_start
    || checkpoint.through !== manifest.coverage?.latest_scope_end_exclusive
    || Object.keys(checkpoint.completed || {}).length !== sourceSnapshots.items.length
    || checkpoint.final_quality.acquired_rows !== checkpoint.final_quality.expected_date_scoped_rows
    || checkpoint.final_quality.acquired_rows !== sourceSnapshots.totalRows
    || checkpoint.final_quality.acquired_rows !== manifest.canonical_row_count
    || manifest.active_row_count + manifest.removal_candidate_count !== manifest.canonical_row_count
    || quality.lifecycle?.active !== manifest.active_row_count
    || quality.lifecycle?.removal_candidate !== manifest.removal_candidate_count
    || canonical.partition_count !== manifest.partition_count
    || canonical.counts.canonical_rows !== manifest.canonical_row_count
    || canonical.counts.lifecycle.active !== manifest.active_row_count
    || canonical.counts.lifecycle.removal_candidate !== manifest.removal_candidate_count
    || lineage.model_input_contract?.serving_status !== 'not-published') {
    throw new Error('Crime warehouse manifest/checkpoint/lineage row or coverage contract drifted.');
  }
  if (sourceSnapshots.earliestEventAt !== manifest.coverage.earliest_event_at
    || sourceSnapshots.latestEventAt !== manifest.coverage.latest_event_at
    || canonical.earliest_event_at !== manifest.coverage.earliest_event_at
    || canonical.latest_event_at !== manifest.coverage.latest_event_at
    || currentSource.scope?.end_exclusive !== checkpoint.through
    || currentSource.source_vintage?.source_as_of !== manifest.coverage.latest_event_at) {
    throw new Error('Crime warehouse source revision or event coverage drifted.');
  }
  const completedSnapshotIds = Object.values(checkpoint.completed).map(({ snapshot_id: id }) => id);
  if (stableSerialization(completedSnapshotIds) !== stableSerialization(manifest.applied_snapshot_ids)) {
    throw new Error('Crime warehouse checkpoint revision order drifted.');
  }
  let cumulativeRows = 0;
  periods.forEach((period, index) => {
    const periodId = `${period.start}_${period.end_exclusive}`;
    const completed = checkpoint.completed[periodId];
    const source = sourceSnapshots.items[index].value;
    cumulativeRows += source.row_count;
    if (completed.snapshot_id !== source.snapshot_id
      || completed.source_rows !== source.row_count
      || completed.canonical_rows !== cumulativeRows
      || source.scope.start !== period.start
      || source.scope.end_exclusive !== period.end_exclusive) {
      throw new Error(`Crime warehouse period ${periodId} completion drifted from its source manifest.`);
    }
  });
  const dqSums = [
    ['coordinate', quality.coordinate, ['available', 'missing', 'invalid', 'outside_city_bounds']],
    ['tract', quality.join_coverage?.tract, ['mapped', 'unmapped', 'ambiguous']],
    ['fixed grid', quality.join_coverage?.fixed_grid, ['mapped', 'unavailable']],
    ['route corridor', quality.join_coverage?.route_corridor, ['available', 'unavailable']],
    ['ACS estimate/MOE', quality.join_coverage?.acs_estimate_moe,
      ['available', 'partial', 'unavailable', 'incompatible-vintage']],
  ];
  for (const [label, value, keys] of dqSums) {
    const sum = keys.reduce((total, key) => total + finiteInteger(value?.[key], `${label}.${key}`), 0);
    if (sum !== manifest.canonical_row_count) throw new Error(`Crime warehouse ${label} DQ counts drifted.`);
  }
  const recomputedDq = [
    ['coordinate', quality.coordinate, canonical.counts.coordinate],
    ['tract', quality.join_coverage?.tract, canonical.counts.tract],
    ['fixed grid', quality.join_coverage?.fixed_grid, canonical.counts.fixed_grid],
    ['route corridor', quality.join_coverage?.route_corridor, canonical.counts.route_corridor],
    ['ACS estimate/MOE', quality.join_coverage?.acs_estimate_moe, canonical.counts.acs_estimate_moe],
    ['lifecycle', quality.lifecycle, canonical.counts.lifecycle],
  ];
  for (const [label, declared, recomputed] of recomputedDq) {
    if (stableSerialization(declared) !== stableSerialization(recomputed)) {
      throw new Error(`Crime warehouse ${label} DQ counts drifted from canonical bytes.`);
    }
  }
  if (quality.labels?.unavailable_count !== canonical.counts.unavailable_label_count
    || stableSerialization(quality.labels?.unknown_observed) !== stableSerialization(canonical.unknown_labels)) {
    throw new Error('Crime warehouse label DQ counts drifted from canonical bytes.');
  }
  validateRevisionSemantics(revision, quality, currentSource, canonical.revision_counts);
  if (quality.status_semantics?.unavailable_is_zero !== false
    || quality.status_semantics?.partial_is_current !== false
    || quality.status_semantics?.stale_is_current !== false
    || !Array.isArray(quality.labels?.unknown_observed)
    || revision.observed_at !== manifest.updated_at
    || quality.observed_at !== manifest.updated_at
    || lineage.model_input_contract?.generated_at !== manifest.updated_at) {
    throw new Error('Crime warehouse DQ, revision, or lineage clock semantics drifted.');
  }
}

function validateRevisionSemantics(revision, quality, currentSource, recomputedCounts) {
  const revisionTypes = [
    'added', 'late-arriving', 'modified', 'reclassified', 'unchanged', 'reappeared',
    'removal-candidate', 'transformation-updated',
  ];
  if (stableSerialization(Object.keys(revision.counts || {})) !== stableSerialization(revisionTypes)
    || stableSerialization(revision.counts) !== stableSerialization(quality.revisions)
    || stableSerialization(revision.counts) !== stableSerialization(recomputedCounts)) {
    throw new Error('Crime warehouse revision report counts drifted from mechanically recomputed source history.');
  }
  const total = revisionTypes.reduce(
    (sum, type) => sum + finiteInteger(revision.counts[type], `revision counts.${type}`),
    0,
  );
  if (total !== currentSource.row_count + revision.counts['removal-candidate']) {
    throw new Error('Crime warehouse revision counts do not match the current source bytes and lifecycle changes.');
  }
  finiteInteger(revision.change_details_limit, 'revision change_details_limit', { minimum: 1 });
  if (!Array.isArray(revision.changes)) throw new Error('Crime warehouse revision change details are invalid.');
  const changed = total - revision.counts.unchanged;
  const expectedDetails = Math.min(changed, revision.change_details_limit);
  if (revision.changes.length !== expectedDetails
    || revision.change_details_truncated !== (changed > revision.change_details_limit)) {
    throw new Error('Crime warehouse revision detail truncation drifted from declared counts.');
  }
  for (const change of revision.changes) {
    if (!revisionTypes.includes(change?.type) || change.type === 'unchanged'
      || typeof change.source_record_id !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(change.row_hash || '')
      || !exactTimestamp(change.first_seen_at)
      || !exactTimestamp(change.last_seen_at)) {
      throw new Error('Crime warehouse revision change detail is invalid.');
    }
  }
}

function validateCrimeWarehouseReceiptShape(receipt) {
  exactObjectKeys(receipt, [
    'schema', 'mode', 'serving_eligible', 'source', 'warehouse', 'coverage', 'counts', 'clocks',
    'data_quality', 'artifacts', 'authority', 'limitations', 'identity',
  ], 'crime warehouse receipt');
  if (receipt.schema !== CRIME_WAREHOUSE_RECEIPT_SCHEMA
    || receipt.mode !== 'official-local-candidate'
    || receipt.serving_eligible !== false
    || receipt.authority?.producer_validated_local_candidate !== true
    || receipt.authority?.integration_authority !== false
    || receipt.authority?.serving_authority !== false
    || receipt.authority?.deletion_authority !== false) {
    throw new Error('Crime warehouse receipt cannot admit synthetic, serving, integration, or deletion authority.');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(receipt.identity || '')
    || !/^sha256:[a-f0-9]{64}$/.test(receipt.source?.revision || '')
    || receipt.source.revision !== receipt.warehouse?.current_snapshot_id) {
    throw new Error('Crime warehouse receipt identity or source revision is invalid.');
  }
  Object.entries(receipt.counts || {}).forEach(([label, value]) => finiteInteger(value, `receipt counts.${label}`));
  validateReceiptClockOrder(receipt.clocks, receipt.coverage);
  for (const [name, artifact] of Object.entries(receipt.artifacts || {})) {
    if (name === 'canonical' || name === 'source_manifests') {
      if (!/^sha256:[a-f0-9]{64}$/.test(artifact?.sha256 || '')) {
        throw new Error(`Crime warehouse receipt ${name} aggregate identity is invalid.`);
      }
      if (name === 'canonical') {
        canonicalRelativePath(artifact?.path, 'receipt canonical directory');
        finiteInteger(artifact?.partition_count, 'receipt canonical partition_count', { minimum: 1 });
        finiteInteger(artifact?.bytes, 'receipt canonical bytes');
      } else {
        finiteInteger(artifact?.count, 'receipt source manifest count', { minimum: 1 });
        finiteInteger(artifact?.bytes, 'receipt source manifest bytes');
        finiteInteger(artifact?.raw_shard_count, 'receipt source raw shard count', { minimum: 1 });
        finiteInteger(artifact?.raw_bytes, 'receipt source raw shard bytes');
        if (!/^sha256:[a-f0-9]{64}$/.test(artifact?.raw_sha256 || '')) {
          throw new Error('Crime warehouse receipt source raw shard aggregate identity is invalid.');
        }
      }
      continue;
    }
    canonicalRelativePath(artifact?.path, `receipt artifact ${name}`);
    finiteInteger(artifact?.bytes, `receipt artifact ${name} bytes`);
    if (!/^sha256:[a-f0-9]{64}$/.test(artifact?.sha256 || '') || typeof artifact?.schema !== 'string') {
      throw new Error(`Crime warehouse receipt ${name} binding is invalid.`);
    }
  }
  if (receipt.data_quality?.status_semantics?.unavailable_is_zero !== false
    || receipt.data_quality?.status_semantics?.partial_is_current !== false
    || receipt.data_quality?.status_semantics?.stale_is_current !== false) {
    throw new Error('Crime warehouse receipt changed fail-closed status semantics.');
  }
}

function validateReceiptClockOrder(clocks, coverage) {
  const sourceAsOf = exactTimestamp(clocks?.source_as_of);
  const retrievedAt = exactTimestamp(clocks?.retrieved_at);
  const builtAt = exactTimestamp(clocks?.built_at);
  const observedAt = exactTimestamp(clocks?.observed_at);
  const earliestEventAt = exactTimestamp(coverage?.earliest_event_at);
  const latestEventAt = exactTimestamp(coverage?.latest_event_at);
  const start = exactDateText(coverage?.start, 'coverage start');
  const end = exactDateText(coverage?.end_exclusive, 'coverage end');
  if (!sourceAsOf || !retrievedAt || !builtAt || !observedAt || !earliestEventAt || !latestEventAt
    || start >= end
    || sourceAsOf > retrievedAt
    || retrievedAt > builtAt
    || builtAt > observedAt
    || earliestEventAt > latestEventAt
    || `${start}T00:00:00.000Z` > earliestEventAt
    || latestEventAt >= `${end}T00:00:00.000Z`
    || builtAt < latestEventAt) {
    throw new Error('Crime warehouse receipt clocks or event coverage are not finite and monotonic.');
  }
}

function artifactDescriptor(artifact, schema) {
  return {
    path: artifact.relative,
    bytes: artifact.bytes.length,
    sha256: rawSha256(artifact.bytes),
    schema,
  };
}

function warehouseCompanionRelative(value, label) {
  return `warehouse/${canonicalRelativePath(value, label)}`;
}

async function canonicalDirectoryRoot(value, label) {
  const absolute = path.resolve(value || '');
  const stat = await fs.lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory.`);
  return { absolute, real: await fs.realpath(absolute) };
}

async function relativePathInsideRoot(root, candidate, label) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    throw new Error(`Crime warehouse ${label} must identify an absolute producer path before receipt canonicalization.`);
  }
  const targetReal = await fs.realpath(candidate);
  const relative = path.relative(root.real, targetReal);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Crime warehouse ${label} escaped its evidence root.`);
  }
  return canonicalRelativePath(relative.split(path.sep).join('/'), label);
}

async function readRelativeJsonArtifact(root, relative, label) {
  const artifact = await readRelativeBytes(root, relative, label);
  try {
    artifact.value = JSON.parse(artifact.bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Crime warehouse ${label} is not valid JSON: ${error.message}`);
  }
  return artifact;
}

async function readRelativeBytes(root, relative, label) {
  const resolved = await resolveCanonicalRelative(root, relative, { expectDirectory: false, label });
  return {
    relative: resolved.relative,
    absolute: resolved.absolute,
    bytes: await fs.readFile(resolved.absolute),
  };
}

async function resolveCanonicalRelative(root, relative, { expectDirectory = false, label = 'artifact' } = {}) {
  const canonical = canonicalRelativePath(relative, label);
  const segments = canonical.split('/');
  let cursor = root.absolute;
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error(`Crime warehouse ${label} uses a symbolic link or junction.`);
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`Crime warehouse ${label} has a non-directory ancestor.`);
    }
  }
  const stat = await fs.lstat(cursor);
  if ((expectDirectory && !stat.isDirectory()) || (!expectDirectory && !stat.isFile())) {
    throw new Error(`Crime warehouse ${label} has the wrong filesystem type.`);
  }
  const real = await fs.realpath(cursor);
  const containment = path.relative(root.real, real);
  if (!containment || containment.startsWith('..') || path.isAbsolute(containment)) {
    throw new Error(`Crime warehouse ${label} escaped its evidence root.`);
  }
  return { relative: canonical, absolute: cursor };
}

function canonicalRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value) || value.includes(':') || path.posix.normalize(value) !== value
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Crime warehouse ${label} must use a canonical safe relative path.`);
  }
  return value;
}

function rawSha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function withoutIdentity(value) {
  const copy = structuredClone(value);
  delete copy.identity;
  return copy;
}

function exactObjectKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stableSerialization(Object.keys(value).sort()) !== stableSerialization([...keys].sort())) {
    throw new Error(`Crime warehouse ${label} schema is invalid.`);
  }
}

function finiteInteger(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Crime warehouse ${label} must be a finite non-negative integer.`);
  }
  return value;
}

function exactDateText(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`Crime warehouse ${label} must be an exact date.`);
  }
  return value;
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
      } else {
        await fs.rm(path.join(warehouseDir, 'lineage', 'registry.json'), { force: true });
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
  failAfterPublishMetadata,
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
  if (failAfterPublishMetadata === 'quality') throw new Error('Injected metadata publish failure after quality.');
  await replaceFileFromCopy(
    path.join(transactionDir, 'candidate-meta', 'revision.json'),
    path.join(warehouseDir, 'revisions', `${transactionId}.json`),
  );
  if (failAfterPublishMetadata === 'revision') throw new Error('Injected metadata publish failure after revision.');
  await replaceFileFromCopy(
    path.join(transactionDir, 'candidate-meta', 'lineage.json'),
    path.join(warehouseDir, 'lineage', 'registry.json'),
  );
  if (failAfterPublishMetadata === 'lineage') throw new Error('Injected metadata publish failure after lineage.');
  await replaceFileFromCopy(
    path.join(transactionDir, 'candidate-meta', 'manifest.json'),
    path.join(warehouseDir, 'manifest.json'),
  );
  if (failAfterPublishMetadata === 'manifest') throw new Error('Injected metadata publish failure after manifest.');
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
  canonicalPartitions,
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
    canonical_partitions: structuredClone(canonicalPartitions),
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
    revisions: emptyRevisionCounts(),
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
    || value.artifact_policy?.raw_and_canonical_git_policy !== 'ignored-only'
    || value.artifact_policy?.canonical_partition_binding
      !== 'exact-bytes-in-warehouse-manifest-and-lineage'
    || value.artifact_policy?.same_vintage_policy
      !== 'verify-bound-partition-bytes-before-idempotent-return') {
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

async function validateWarehouseLineageBindings(warehouseDir, manifest) {
  const lineage = await readJsonIfExists(path.join(warehouseDir, 'lineage', 'registry.json'));
  const lineageSnapshotIds = lineage?.source_snapshots?.map(({ snapshot_id: snapshotId }) => snapshotId);
  if (lineage?.schema !== LINEAGE_SCHEMA
    || stableSerialization(lineageSnapshotIds) !== stableSerialization(manifest.applied_snapshot_ids)
    || stableSerialization(lineage.canonical_partitions)
      !== stableSerialization(manifest.canonical_partitions)) {
    throw new Error('Crime warehouse lineage canonical partition binding drifted.');
  }
  return lineage;
}

async function validateWarehouseCanonicalBindings(warehouseDir, manifest) {
  const bindings = manifest?.canonical_partitions;
  const partitionCount = manifest?.partition_count;
  if (!Number.isInteger(partitionCount) || partitionCount < 1
    || !Array.isArray(bindings) || bindings.length !== partitionCount) {
    throw new Error('Crime warehouse canonical partition binding drifted.');
  }
  const canonicalDir = path.join(warehouseDir, 'canonical');
  const actualNames = (await fs.readdir(canonicalDir))
    .filter((name) => /^part-\d{3}\.jsonl$/.test(name))
    .sort();
  const expectedNames = Array.from({ length: partitionCount }, (_, partition) => shardName(partition));
  if (stableSerialization(actualNames) !== stableSerialization(expectedNames)) {
    throw new Error('Crime warehouse canonical partition binding drifted.');
  }
  let rowCount = 0;
  for (let partition = 0; partition < partitionCount; partition += 1) {
    const binding = bindings[partition];
    const expectedPath = path.posix.join('canonical', shardName(partition));
    if (binding?.partition !== partition || binding.path !== expectedPath
      || !Number.isSafeInteger(binding.row_count) || binding.row_count < 0
      || !Number.isSafeInteger(binding.bytes) || binding.bytes < 0
      || !/^sha256:[a-f0-9]{64}$/.test(binding.identity || '')) {
      throw new Error('Crime warehouse canonical partition binding drifted.');
    }
    const filePath = path.join(warehouseDir, ...binding.path.split('/'));
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size !== binding.bytes || await hashFile(filePath) !== binding.identity) {
      throw new Error('Crime warehouse canonical partition binding drifted.');
    }
    rowCount += binding.row_count;
  }
  if (rowCount !== manifest.canonical_row_count) {
    throw new Error('Crime warehouse canonical partition binding drifted.');
  }
  return bindings;
}

async function readCanonicalPartition(filePath, partition, partitionCount, eventContract) {
  const rows = new Map();
  if (!await pathExists(filePath)) return rows;
  for await (const event of readJsonLines(filePath)) {
    validateCanonicalEventAgainstContract(event, eventContract);
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
  const hash = createHash('sha256');
  let bytes = 0;
  let rowCount = 0;
  try {
    for (const row of rows) {
      const line = `${JSON.stringify(row)}\n`;
      await handle.write(line);
      hash.update(line);
      bytes += Buffer.byteLength(line);
      rowCount += 1;
    }
  } finally {
    await handle.close();
  }
  return { row_count: rowCount, bytes, identity: `sha256:${hash.digest('hex')}` };
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

async function readJsonUrl(url) {
  return JSON.parse(await fs.readFile(url, 'utf8'));
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
