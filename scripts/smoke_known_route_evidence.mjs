#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createKnownRouteEvidenceRequest,
} from '../src/routes_crime/known_route_evidence_contract.js';
import {
  PHILADELPHIA_CENTERLINE_SOURCE,
  matchKnownRouteToCenterline,
  requestPhiladelphiaCenterlineCatalog,
} from '../src/routes_crime/known_route_centerline.js';
import {
  associateKnownRouteWithHin2025,
} from '../src/routes_crime/hin_2025_context.js';
import {
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
  const consent = { publicCenterlineRequest: true };
  const catalog = await requestPhiladelphiaCenterlineCatalog({ normalizedRoute, consent });
  if (catalog?.status === 'unavailable') throw new Error(`centerline-${catalog.reason}`);
  const centerlineRetrievedAt = reportClock();
  const match = matchKnownRouteToCenterline({ normalizedRoute, catalog });
  if (match.status !== 'matched') throw new Error(`map-match-${match.reason}`);
  const repeatMatch = matchKnownRouteToCenterline({ normalizedRoute, catalog });
  const deterministicMatch = repeatMatch.corridorIdentity === match.corridorIdentity
    && JSON.stringify(repeatMatch.matchedEdges) === JSON.stringify(match.matchedEdges);
  if (!deterministicMatch) throw new Error('map-match-not-deterministic');

  const localHinSnapshot = JSON.parse(await fs.readFile(path.join('public', 'data', 'hin_2025.snapshot.json'), 'utf8'));
  const localHinReceipt = JSON.parse(await fs.readFile(path.join('public', 'data', 'hin_2025.receipt.json'), 'utf8'));
  const admittedLocalHin = validateHin2025Snapshot(localHinSnapshot);
  validateHin2025Receipt(localHinReceipt, { snapshot: localHinSnapshot });
  const officialHin = await observeOfficialHin(localHinReceipt, 20_000);
  const hinAssociation = associateKnownRouteWithHin2025({
    routeInput: publicRoute.routeInput,
    snapshot: { ...localHinSnapshot, lifecycleReceipt: localHinReceipt },
  });

  const report = {
    schema: 'known-route-evidence-official-smoke/v1',
    status: 'partial',
    observedAt: new Date().toISOString(),
    fixture: {
      classification: 'explicit-public-non-private',
      synthetic: false,
      geometryIncluded: false,
    },
    consent: {
      publicCenterlineRequest: consent.publicCenterlineRequest,
      disclosureAccepted: true,
    },
    centerline: {
      status: 'matched-reference-topology',
      sourceUrl: PHILADELPHIA_CENTERLINE_SOURCE.catalogUrl,
      layerUrl: PHILADELPHIA_CENTERLINE_SOURCE.layerUrl,
      licenseUrl: PHILADELPHIA_CENTERLINE_SOURCE.licenseUrl,
      clocks: { sourceAsOf: match.sourceAsOf, retrievedAt: centerlineRetrievedAt },
      deterministicRepeat: deterministicMatch,
      method: match.method,
      transportSemantics: match.transportSemantics,
      limitations: [...PHILADELPHIA_CENTERLINE_SOURCE.limitations],
    },
    hin: {
      status: 'partial',
      sourceUrl: localHinReceipt.source.officialContext,
      networkVintage: localHinReceipt.source.networkVintage,
      crashDataPeriod: [...localHinReceipt.source.crashDataPeriod],
      clocks: {
        sourceAsOf: officialHin.sourceAsOf,
        retrievedAt: localHinReceipt.artifact.retrievedAt,
        builtAt: localHinReceipt.artifact.builtAt,
        observedAt: officialHin.observedAt,
      },
      trackedFeatureCount: admittedLocalHin.featureCount,
      officialCountConsistent: true,
      localAssociationExecuted: ['ready', 'no-associated-streets'].includes(hinAssociation.status),
      limitation: 'Historical planning-network context only; raw crash and live-condition evidence remain unavailable.',
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
      containsRouteOrEdgeIds: false,
      containsAddresses: false,
      containsEventRows: false,
      containsSourceRecordIds: false,
    },
  };
  await writeJsonAtomic(output, report);
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    fixture: report.fixture.classification,
    publicCenterlineRequest: report.consent.publicCenterlineRequest,
    centerlineSourceAsOf: report.centerline.clocks.sourceAsOf,
    deterministicRepeat: report.centerline.deterministicRepeat,
    hinSourceAsOf: report.hin.clocks.sourceAsOf,
    hinOfficialCountConsistent: report.hin.officialCountConsistent,
    rawCrash: report.rawCrash.status,
    accessibility: report.accessibility.status,
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
    || typeof value.disclosure !== 'string' || !/public, non-private/i.test(value.disclosure)
    || value.classification !== 'explicit-public-non-private'
    || value.synthetic !== false
    || value.consent?.publicCenterlineRequest !== true
    || Object.keys(value.consent).length !== 1
    || value.routeInput?.source !== 'manual-draw'
    || Object.keys(value).some((key) => !['schema', 'classification', 'synthetic', 'consent', 'disclosure', 'routeInput'].includes(key))) {
    throw new Error('Known Route public smoke input is invalid.');
  }
  return value;
}

async function observeOfficialHin(receipt, timeoutMs) {
  const metadataUrl = new URL(receipt.source.layerUrl);
  metadataUrl.searchParams.set('f', 'pjson');
  const signal = AbortSignal.timeout(timeoutMs);
  const before = await requestJson(metadataUrl, { method: 'GET', signal });
  const count = await requestJson(`${receipt.source.layerUrl}/query`, {
    method: 'POST', signal, body: new URLSearchParams({ where: '1=1', returnCountOnly: 'true', f: 'json' }),
  });
  const after = await requestJson(metadataUrl, { method: 'GET', signal });
  const project = (value) => ({
    serviceItemId: value?.serviceItemId,
    name: value?.name,
    geometryType: value?.geometryType,
    objectIdField: value?.objectIdField,
    fields: value?.fields?.map(({ name, type }) => ({ name, type })),
    dataLastEditDate: value?.editingInfo?.dataLastEditDate,
    schemaLastEditDate: value?.editingInfo?.schemaLastEditDate,
  });
  const admitted = project(before);
  if (JSON.stringify(admitted) !== JSON.stringify(project(after))
    || admitted.serviceItemId !== receipt.source.itemId
    || admitted.name !== receipt.source.layerName
    || admitted.geometryType !== receipt.source.geometryType
    || admitted.objectIdField !== 'objectid'
    || JSON.stringify(admitted.fields) !== JSON.stringify(receipt.source.fields)
    || new Date(admitted.dataLastEditDate).toISOString() !== receipt.source.sourceAsOf
    || count?.count !== receipt.artifact.featureCount
    || Object.keys(count).some((key) => key !== 'count')) {
    throw new Error('HIN official metadata/count drifted from the tracked snapshot receipt.');
  }
  return { sourceAsOf: receipt.source.sourceAsOf, observedAt: reportClock() };
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' } : {}),
    },
    ...options,
  });
  if (!response.ok) throw new Error(`Official source request failed (${response.status}).`);
  const value = await response.json();
  if (value?.error) throw new Error('Official source returned an error.');
  return value;
}

function reportClock() {
  return new Date().toISOString();
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
