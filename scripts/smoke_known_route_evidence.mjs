#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createKnownRouteEvidenceRequest,
} from '../src/routes_crime/known_route_evidence_contract.js';
import {
  CENTERLINE_MATCH_CONTRACT,
  PHILADELPHIA_CENTERLINE_SOURCE,
  matchKnownRouteToCenterline,
  requestPhiladelphiaCenterlineCatalog,
} from '../src/routes_crime/known_route_centerline.js';
import {
  associateKnownRouteWithHin2025,
} from '../src/routes_crime/hin_2025_context.js';
import {
  acquireOfficialHin2025,
  validateHin2025Snapshot,
} from './lib/hin_2025_snapshot.mjs';
import { validateHin2025Receipt } from './lib/hin_2025_receipt.mjs';

const options = parseOptions(process.argv.slice(2));
const output = path.resolve(options.output
  || path.join('.dfev1', 'known-route-evidence-v1', 'official-smoke', 'report.json'));
const routeFile = path.resolve(options.routeInput
  || path.join('.dfev1', 'known-route-evidence-v1', 'inputs', 'public-route.json'));
requireTaskOwnedOutput(output);
requireTaskOwnedOutput(routeFile);

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
  const repeatMatch = matchKnownRouteToCenterline({ normalizedRoute, catalog });
  const deterministicMatch = repeatMatch.corridorIdentity === match.corridorIdentity
    && JSON.stringify(repeatMatch.matchedEdges) === JSON.stringify(match.matchedEdges);
  if (!deterministicMatch) throw new Error('map-match-not-deterministic');

  const officialHin = await acquireOfficialHin2025({ timeoutMs: 20_000 });
  const localHinSnapshot = JSON.parse(await fs.readFile(path.join('public', 'data', 'hin_2025.snapshot.json'), 'utf8'));
  const localHinReceipt = JSON.parse(await fs.readFile(path.join('public', 'data', 'hin_2025.receipt.json'), 'utf8'));
  const admittedLocalHin = validateHin2025Snapshot(localHinSnapshot);
  validateHin2025Receipt(localHinReceipt, { snapshot: localHinSnapshot });
  const hinAssociation = associateKnownRouteWithHin2025({
    routeInput: publicRoute.routeInput,
    snapshot: { ...localHinSnapshot, lifecycleReceipt: localHinReceipt },
  });

  const report = {
    schema: 'known-route-evidence-official-smoke/v1',
    status: 'partial',
    observedAt: new Date().toISOString(),
    publicRoute: {
      label: publicRoute.label,
      disclosure: publicRoute.disclosure,
      exactGeometryIncluded: false,
      citywideValidityClaim: false,
    },
    centerline: {
      status: 'matched-reference-topology',
      sourceId: PHILADELPHIA_CENTERLINE_SOURCE.sourceId,
      serviceItemId: PHILADELPHIA_CENTERLINE_SOURCE.serviceItemId,
      sourceUrl: PHILADELPHIA_CENTERLINE_SOURCE.catalogUrl,
      layerUrl: PHILADELPHIA_CENTERLINE_SOURCE.layerUrl,
      licenseUrl: PHILADELPHIA_CENTERLINE_SOURCE.licenseUrl,
      dataVersion: match.dataVersion,
      sourceAsOf: match.sourceAsOf,
      queryFeatureCount: catalog.featureCount,
      matchedAnalysisSegmentCount: match.matchedEdges.length,
      distinctMatchedNodeCount: new Set(match.matchedEdges.flatMap((edge) => [edge.fromNode, edge.toNode])).size,
      connectedNodeChain: true,
      maximumMatchDistanceM: match.maximumMatchDistanceM,
      deterministicRepeat: deterministicMatch,
      method: match.method,
      transportSemantics: match.transportSemantics,
      admission: { ...CENTERLINE_MATCH_CONTRACT },
      limitations: [...PHILADELPHIA_CENTERLINE_SOURCE.limitations],
    },
    hin: {
      status: 'partial',
      sourceItemId: localHinReceipt.source.itemId,
      sourceUrl: localHinReceipt.source.officialContext,
      networkVintage: localHinReceipt.source.networkVintage,
      crashDataPeriod: [...localHinReceipt.source.crashDataPeriod],
      sourceAsOf: new Date(officialHin.layer.editingInfo.dataLastEditDate).toISOString(),
      officialFeatureCount: officialHin.countResult.count,
      officialGeometryCounts: admittedLocalHin.geometryCounts,
      localSnapshotIdentity: localHinReceipt.artifact.identity,
      associatedStreetNameCount: hinAssociation.status === 'ready' ? hinAssociation.matches.length : 0,
      admittedZero: hinAssociation.status === 'no-associated-streets',
      limitation: 'Historical planning-network proximity only; not an individual crash count, route certification, prediction, safety score, or safer-route advice.',
    },
    rawCrash: {
      status: 'unavailable',
      reason: 'No raw official crash record set was acquired and validated for M4; no count or zero inferred.',
    },
    accessibility: {
      status: 'unavailable',
      reason: 'No reviewed citywide source proves sidewalk continuity, curb-ramp accessibility, wheelchair passability, or current obstruction state.',
    },
    privacy: {
      containsRouteCoordinates: false,
      containsRouteEndpoints: false,
      containsEventRows: false,
      containsSourceRecordIds: false,
    },
  };
  await writeJsonAtomic(output, report);
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    publicRoute: report.publicRoute.label,
    centerlineVersion: report.centerline.dataVersion,
    queryFeatures: report.centerline.queryFeatureCount,
    matchedSegments: report.centerline.matchedAnalysisSegmentCount,
    matchedNodes: report.centerline.distinctMatchedNodeCount,
    maximumMatchDistanceM: report.centerline.maximumMatchDistanceM,
    deterministicRepeat: report.centerline.deterministicRepeat,
    hinFeatures: report.hin.officialFeatureCount,
    hinAssociationStatus: hinAssociation.status,
    rawCrash: report.rawCrash.status,
    accessibility: report.accessibility.status,
    output: path.relative(process.cwd(), output).replaceAll('\\', '/'),
  })}\n`);
} catch (error) {
  process.stderr.write(`[known-route-evidence-smoke] unavailable: ${error?.message || error}\n`);
  process.exitCode = 1;
}

function parseOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value.startsWith('--output=')) result.output = value.slice('--output='.length);
    else if (value === '--output') result.output = args[++index];
    else if (value.startsWith('--route-input=')) result.routeInput = value.slice('--route-input='.length);
    else if (value === '--route-input') result.routeInput = args[++index];
    else throw new Error(`Unknown Known Route smoke option: ${value}`);
  }
  return result;
}

async function readPublicRoute(file) {
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  if (value?.schema !== 'known-route-public-smoke/v1'
    || typeof value.label !== 'string' || !value.label.trim()
    || typeof value.disclosure !== 'string' || !/public, non-private/i.test(value.disclosure)
    || !value.routeInput || Object.keys(value).some((key) => !['schema', 'label', 'disclosure', 'routeInput'].includes(key))) {
    throw new Error('Known Route public smoke input is invalid.');
  }
  return value;
}

function requireTaskOwnedOutput(file) {
  const taskRoot = path.resolve('.dfev1', 'known-route-evidence-v1');
  const relative = path.relative(taskRoot, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Known Route smoke output must stay under the task-owned ignored directory.');
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
