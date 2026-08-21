#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import { createKnownRouteEvidenceRequest } from '../src/routes_crime/known_route_evidence_contract.js';
import {
  matchKnownRouteToCenterline,
  requestPhiladelphiaCenterlineCatalog,
} from '../src/routes_crime/known_route_centerline.js';
import {
  addCanonicalGeneralizedIncident,
  createGeneralizedIncidentAccumulator,
} from '../src/routes_crime/known_route_contributions.js';
import {
  createKnownRouteEvidenceCheckpoint,
  createSafeKnownRouteAggregateReport,
  restoreKnownRouteEvidenceAccumulator,
} from './lib/known_route_evidence_checkpoint.mjs';

const options = parseOptions(process.argv.slice(2));
const outputRoot = path.resolve(options.output
  || path.join('.dfev1', 'known-route-evidence-v1', 'full-warehouse'));
const routeFile = path.resolve(options.routeInput
  || path.join('.dfev1', 'known-route-evidence-v1', 'inputs', 'public-route.json'));
const warehouseRoot = path.resolve(options.warehouse || '');
requireTaskOwnedOutput(outputRoot);
requireTaskOwnedOutput(routeFile);
if (!options.allowPublicCenterlineRequest) {
  throw new Error('The full Known Route build requires --allow-public-centerline-request for the disclosed public fixture bbox request.');
}
if (!options.warehouse) throw new Error('--warehouse is required.');

const checkpointPath = path.join(outputRoot, 'checkpoint.json');
const reportPath = path.join(outputRoot, 'aggregate-report.json');
const runStarted = Date.now();
let maximumRssBytes = process.memoryUsage().rss;

try {
  const publicRoute = await readPublicRoute(routeFile);
  const normalizedRoute = createKnownRouteEvidenceRequest({
    routeInput: publicRoute.routeInput,
    transportMode: 'walking',
  });
  const catalog = await requestPhiladelphiaCenterlineCatalog({ normalizedRoute, consent: true });
  if (catalog?.status === 'unavailable') throw new Error(`centerline-${catalog.reason}`);
  const match = matchKnownRouteToCenterline({ normalizedRoute, catalog });
  if (match.status !== 'matched') throw new Error(`map-match-${match.reason}`);

  const manifestPath = path.join(warehouseRoot, 'manifest.json');
  const manifestBytes = await fs.readFile(manifestPath);
  const warehouseManifestIdentity = `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`;
  const warehouseManifest = admitWarehouseManifest(JSON.parse(manifestBytes.toString('utf8')));
  const expected = {
    warehouseIdentity: `${warehouseManifestIdentity}:${warehouseManifest.current_snapshot_id}`,
    routeIdentity: normalizedRoute.sessionRouteIdentity,
    centerlineDataVersion: match.dataVersion,
    catalogIdentity: catalog.catalogIdentity,
    corridorIdentity: match.corridorIdentity,
    partitionCount: warehouseManifest.partition_count,
  };

  const saved = await readJsonIfPresent(checkpointPath);
  const resumedPartitions = saved?.completedPartitions || 0;
  const restoredCompletedCheckpoint = Boolean(saved?.completion
    && resumedPartitions === warehouseManifest.partition_count);
  let checkpoint;
  let accumulator;
  if (saved) {
    accumulator = restoreKnownRouteEvidenceAccumulator(saved, { matchedEdges: match.matchedEdges, expected });
    checkpoint = saved;
  } else {
    accumulator = createGeneralizedIncidentAccumulator({ matchedEdges: match.matchedEdges });
    checkpoint = createKnownRouteEvidenceCheckpoint({
      ...expected,
      completedPartitions: 0,
      accumulator,
      startedAt: new Date().toISOString(),
    });
    await writeJsonAtomic(checkpointPath, checkpoint);
  }

  for (let partition = checkpoint.completedPartitions; partition < warehouseManifest.partition_count; partition += 1) {
    const shard = path.join(warehouseRoot, 'canonical', `part-${String(partition).padStart(3, '0')}.jsonl`);
    const rowsBefore = accumulator.rowsRead;
    await streamCanonicalPartition(shard, accumulator, partition);
    maximumRssBytes = Math.max(maximumRssBytes, process.memoryUsage().rss);
    checkpoint = createKnownRouteEvidenceCheckpoint({
      ...expected,
      completedPartitions: partition + 1,
      accumulator,
      startedAt: checkpoint.startedAt,
    });
    await writeJsonAtomic(checkpointPath, checkpoint);
    process.stdout.write(`[known-route-evidence-build] partition ${partition + 1}/${warehouseManifest.partition_count}: ${accumulator.rowsRead - rowsBefore} rows; cumulative ${accumulator.rowsRead}.\n`);
  }

  if (accumulator.rowsRead !== warehouseManifest.canonical_row_count) {
    throw new Error(`Full warehouse row count mismatch: ${accumulator.rowsRead}/${warehouseManifest.canonical_row_count}.`);
  }
  maximumRssBytes = Math.max(maximumRssBytes, process.memoryUsage().rss);
  const completion = checkpoint.completion || {
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - runStarted,
    maximumRssBytes,
    resumedPartitions,
  };
  checkpoint = createKnownRouteEvidenceCheckpoint({
    ...expected,
    completedPartitions: warehouseManifest.partition_count,
    accumulator,
    startedAt: checkpoint.startedAt,
    completion,
  });
  await writeJsonAtomic(checkpointPath, checkpoint);
  const report = createSafeKnownRouteAggregateReport({
    warehouseManifest,
    warehouseManifestIdentity,
    routeLabel: publicRoute.label,
    match,
    catalogFeatureCount: catalog.featureCount,
    accumulator,
    completion,
  });
  await writeJsonAtomic(reportPath, report);
  const reportBytes = (await fs.stat(reportPath)).size;
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    publicRoute: report.publicRoute.label,
    warehouseRowsRead: report.warehouse.canonicalRowsRead,
    partitions: report.warehouse.partitionCount,
    eligibleGeneralizedRows: report.reportedIncidentEvidence.route.eligibleGeneralizedRows,
    contributingRows: report.reportedIncidentEvidence.route.contributingRows,
    excludedRows: Object.values(report.reportedIncidentEvidence.excluded).reduce((sum, value) => sum + value, 0),
    routeContributionUnits: report.reportedIncidentEvidence.route.contributionUnits,
    analysisSegments: report.reportedIncidentEvidence.segments.length,
    durationMs: completion.durationMs,
    maximumRssBytes: completion.maximumRssBytes,
    restoredCompletedCheckpoint,
    runResumedPartitions: resumedPartitions,
    artifactResumedPartitions: completion.resumedPartitions,
    semanticIdentity: report.semanticIdentity,
    reportBytes,
    report: path.relative(process.cwd(), reportPath).replaceAll('\\', '/'),
  })}\n`);
} catch (error) {
  process.stderr.write(`[known-route-evidence-build] unavailable: ${error?.message || error}\n`);
  process.exitCode = 1;
}

async function streamCanonicalPartition(file, accumulator, partition) {
  const input = createReadStream(file, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error(`Canonical partition ${partition} contains invalid JSON at line ${lineNumber}.`);
      }
      addCanonicalGeneralizedIncident(accumulator, event);
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

function admitWarehouseManifest(value) {
  if (value?.schema !== 'engagement-phl-crime-event-warehouse/v1'
    || value.mode !== 'official-local-candidate'
    || value.serving_eligible !== false
    || value.partition_count !== 64
    || value.canonical_row_count !== 3_583_548
    || value.active_row_count !== 3_583_548
    || value.removal_candidate_count !== 0
    || !/^sha256:[a-f0-9]{64}$/.test(value.current_snapshot_id || '')
    || value.coverage?.earliest_scope_start !== '2006-01-01'
    || value.coverage?.latest_scope_end_exclusive !== '2026-08-22'
    || value.transforms?.event_schema !== 'engagement-phl-crime-event/v1'
    || value.transforms?.corridor_registry_id !== null) {
    throw new Error('M1 warehouse manifest does not match the frozen M4 input contract.');
  }
  return value;
}

function parseOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value.startsWith('--warehouse=')) result.warehouse = value.slice('--warehouse='.length);
    else if (value === '--warehouse') result.warehouse = args[++index];
    else if (value.startsWith('--output=')) result.output = value.slice('--output='.length);
    else if (value === '--output') result.output = args[++index];
    else if (value.startsWith('--route-input=')) result.routeInput = value.slice('--route-input='.length);
    else if (value === '--route-input') result.routeInput = args[++index];
    else if (value === '--allow-public-centerline-request') result.allowPublicCenterlineRequest = true;
    else throw new Error(`Unknown Known Route build option: ${value}`);
  }
  return result;
}

function requireTaskOwnedOutput(file) {
  const taskRoot = path.resolve('.dfev1', 'known-route-evidence-v1');
  const relative = path.relative(taskRoot, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Known Route build output and public input must stay under the task-owned ignored directory.');
  }
}

async function readPublicRoute(file) {
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  if (value?.schema !== 'known-route-public-smoke/v1'
    || typeof value.label !== 'string' || !value.label.trim()
    || typeof value.disclosure !== 'string' || !/public, non-private/i.test(value.disclosure)
    || !value.routeInput || Object.keys(value).some((key) => !['schema', 'label', 'disclosure', 'routeInput'].includes(key))) {
    throw new Error('Known Route public build input is invalid.');
  }
  return value;
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(destination, value) {
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
