import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalStringify,
  contentIdentity,
  fail,
  freezeData,
  parseStrictJson,
} from '../route_real_graph_authority/safe_data.mjs';

export const OSRM_MATURE_ENGINE_RECEIPT_SCHEMA =
  'route-real-graph-osrm-mature-engine-receipt/v3';
export const OSRM_GRAPH_ARTIFACT_SCHEMA = 'route-real-engine-graph-artifact/v1';

const EXPECTED_M4_SOURCE_FINAL =
  '9c9b6a071aa87af09b7ed351856d3642622926fc';
const EXPECTED_M4_HANDOFF_IDENTITY =
  'sha256:c0ea04ced25bc10054f0527d50416dcd16da9f409b6a52e70c9094b18119c63f';
const EXPECTED_M4_HANDOFF_FILE_SHA256 =
  'sha256:68aa8579be0150259ee33094d9b5c57415ef47d733cfc0b54a0f2fe44398c470';
const ROOTS = Object.freeze({
  build: '.dfev1/route-real-graph-m5-1/build/osrm-26.8.0-foot-pennsylvania-260824',
  engineArchive:
    '.dfev1/route-real-graph-m5-1/toolchain-audit/github/node_osrm-v26.8.0-8-win32-x64-Release.tar.gz',
  npmArchive:
    '.dfev1/route-real-graph-m5-1/toolchain-audit/npm/project-osrm-osrm-26.8.0.tgz',
  native:
    '.dfev1/route-real-graph-m5-1/toolchain/osrm-26.8.0-win32-x64/native/binding_napi_v8',
  profiles:
    '.dfev1/route-real-graph-m5-1/toolchain/osrm-26.8.0-win32-x64/profiles/profiles',
  source: '.dfev1/route-real-graph-m5-1/source/geofabrik-pennsylvania-260824',
  cityBoundary: '.dfev1/route-real-graph-m5-1/source/philadelphia-city-limits',
  m4Input: '.dfev1/route-real-graph-m5-1/input/m4-persistent-20260829',
  probeEvidence: '.dfev1/route-real-graph-m5-1-repair-p2/source-final-owned-queries',
  receipt: '.dfev1/route-real-graph-m5-1-repair-p2/source-final-owned-queries/mature-engine-receipt-persistent-20260829-v3.json',
});

export const OSRM_RECEIPT_HASH_BLOCK_BYTES = 4 * 1_024 * 1_024;

const ENGINE_EXECUTABLES = Object.freeze([
  'osrm-components.exe',
  'osrm-contract.exe',
  'osrm-customize.exe',
  'osrm-datastore.exe',
  'osrm-extract.exe',
  'osrm-partition.exe',
  'osrm-routed.exe',
]);

const TOPOLOGY_SUFFIXES = new Set([
  '.cells', '.cnbg', '.cnbg_to_ebg', '.ebg', '.ebg_nodes', '.edges', '.enw',
  '.icd', '.mldgr', '.nbg_nodes', '.partition', '.restrictions', '.tld', '.tls',
  '.turn_duration_penalties', '.turn_penalties_index', '.turn_weight_penalties',
]);
const GEOMETRY_SUFFIXES = new Set([
  '.fileIndex', '.geometry', '.names', '.ramIndex',
]);

export function finalizeOsrmMatureEngineReceipt() {
  if (arguments.length !== 0) {
    fail('osrm-receipt-arguments', 'receipt finalization accepts no caller paths or facts');
  }
  const projectRoot = realpathSync(process.cwd());
  const receipt = buildReceipt(projectRoot);
  const receiptPath = resolveOwned(projectRoot, ROOTS.receipt);
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (existsSync(receiptPath)) {
    const current = readFileSync(receiptPath, 'utf8');
    if (current !== serialized) {
      fail('osrm-receipt-drift', 'existing mature-engine receipt differs from the deterministic rebuild');
    }
  } else {
    writeFileSync(receiptPath, serialized, { encoding: 'utf8', flag: 'wx' });
  }
  return receipt;
}

export function validateInstalledOsrmMatureEngineReceipt() {
  if (arguments.length !== 0) {
    fail('osrm-receipt-arguments', 'installed validation accepts no caller path or fact overrides');
  }
  const projectRoot = realpathSync(process.cwd());
  const receiptPath = resolveOwned(projectRoot, ROOTS.receipt);
  if (!existsSync(receiptPath)) {
    fail('osrm-receipt-unavailable', 'the installed ignored mature-engine receipt is unavailable');
  }
  const actual = parseReceipt(readFileSync(receiptPath, 'utf8'));
  const expected = buildReceipt(projectRoot);
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    fail('osrm-receipt-validation-drift', 'receipt or an exact bound artifact has drifted');
  }
  return expected;
}

export function inspectOsrmMatureEngineReceiptJson(receiptJsonText) {
  if (arguments.length !== 1 || typeof receiptJsonText !== 'string') {
    fail('osrm-receipt-inspection-arguments', 'receipt inspection accepts one primitive JSON text');
  }
  return parseReceipt(receiptJsonText);
}

function buildReceipt(projectRoot) {
  const buildRoot = resolveOwned(projectRoot, ROOTS.build);
  const sourceRoot = resolveOwned(projectRoot, ROOTS.source);
  const boundaryRoot = resolveOwned(projectRoot, ROOTS.cityBoundary);
  const nativeRoot = resolveOwned(projectRoot, ROOTS.native);
  const profileRoot = resolveOwned(projectRoot, ROOTS.profiles);
  for (const required of [buildRoot, sourceRoot, boundaryRoot, nativeRoot, profileRoot]) {
    if (!existsSync(required)) fail('osrm-evidence-unavailable', `required ignored root is unavailable: ${required}`);
  }

  const engineArchive = fileBinding(projectRoot, ROOTS.engineArchive);
  assertBinding(engineArchive, 17_584_979,
    'sha256:623f60bb4202e21309db91ec9d84b508a134db6d8dda8ab0abc02613719ff728',
    'OSRM GitHub Release archive');
  const npmArchive = fileBinding(projectRoot, ROOTS.npmArchive);
  assertBinding(npmArchive, 46_489,
    'sha256:f3e9b176c43a10613a88ad5fbf014972d9180260b684a2269b3ca2ea2939dfb4',
    'OSRM npm profile archive');

  const toolInventory = inventory(nativeRoot, projectRoot, () => true);
  for (const executable of ENGINE_EXECUTABLES) {
    if (!toolInventory.some(({ path: relative }) => relative.endsWith(`/${executable}`))) {
      fail('osrm-tool-inventory', `official engine inventory is missing ${executable}`);
    }
  }
  const profileInventory = inventory(profileRoot, projectRoot, (name) => name.endsWith('.lua'));
  if (!profileInventory.some(({ path: relative }) => relative.endsWith('/foot.lua'))) {
    fail('osrm-profile-inventory', 'official profile closure is missing foot.lua');
  }

  const pbf = fileBinding(projectRoot, `${ROOTS.source}/pennsylvania-260824.osm.pbf`);
  assertBinding(pbf, 345_485_741,
    'sha256:b8f3db07ac7def4d9b7faf66d061e96987edd75e0ec7573eb9c70167327af174',
    'dated Geofabrik PBF');
  const providerMd5 = readFileSync(
    resolveOwned(projectRoot, `${ROOTS.source}/pennsylvania-260824.osm.pbf.md5`),
    'utf8',
  ).trim();
  if (providerMd5 !== '68b20ae85d690a409619c4c46b172956  pennsylvania-260824.osm.pbf') {
    fail('osrm-source-sidecar', 'Geofabrik MD5 sidecar bytes have drifted');
  }
  const actualMd5 = digestFile(resolveOwned(projectRoot, pbf.path), 'md5');
  if (actualMd5 !== '68b20ae85d690a409619c4c46b172956') {
    fail('osrm-source-md5', 'dated PBF does not match the provider MD5 sidecar');
  }
  const providerBoundary = fileBinding(projectRoot, `${ROOTS.source}/pennsylvania.poly`);
  const providerBounds = polyBounds(resolveOwned(projectRoot, providerBoundary.path));
  const cityBoundary = fileBinding(projectRoot, `${ROOTS.cityBoundary}/city-limits.geojson`);
  assertBinding(cityBoundary, 109_010,
    'sha256:7cf4bb28468d048f2f775ae6f7a3f9d2db85f861e2b70839c18e097614dc69e2',
    'Philadelphia City Limits GeoJSON');
  const cityGeometry = inspectCityBoundary(resolveOwned(projectRoot, cityBoundary.path));

  const extractLog = readFileSync(resolveOwned(projectRoot, `${ROOTS.build}/logs/extract.log`), 'utf8');
  const partitionLog = readFileSync(resolveOwned(projectRoot, `${ROOTS.build}/logs/partition.log`), 'utf8');
  const customizeLog = readFileSync(resolveOwned(projectRoot, `${ROOTS.build}/logs/customize.log`), 'utf8');
  const statistics = extractStatistics(extractLog, partitionLog, customizeLog);
  const logInventory = [
    fileBinding(projectRoot, `${ROOTS.build}/logs/extract.log`),
    fileBinding(projectRoot, `${ROOTS.build}/logs/partition.log`),
    fileBinding(projectRoot, `${ROOTS.build}/logs/customize.log`),
  ];

  const graphInventory = inventory(buildRoot, projectRoot, (name) => name.startsWith('graph.osrm'));
  if (graphInventory.length !== 26) fail('osrm-graph-inventory', 'OSRM graph must contain exactly 26 admitted files');
  const totalBytes = graphInventory.reduce((sum, item) => sum + item.bytes, 0);
  if (totalBytes !== 2_533_170_416) fail('osrm-graph-bytes', 'OSRM graph inventory byte total has drifted');
  const topologyFiles = graphInventory.filter(({ path: relative }) => (
    TOPOLOGY_SUFFIXES.has(relative.slice(relative.indexOf('.osrm') + 5))
  ));
  const geometryFiles = graphInventory.filter(({ path: relative }) => (
    GEOMETRY_SUFFIXES.has(relative.slice(relative.indexOf('.osrm') + 5))
  ));
  if (topologyFiles.length !== TOPOLOGY_SUFFIXES.size || geometryFiles.length !== GEOMETRY_SUFFIXES.size) {
    fail('osrm-graph-identity-definition', 'topology or geometry identity file set is incomplete');
  }

  const probe = inspectPublicProbe(projectRoot);
  const m4Handoff = inspectM4Handoff(projectRoot);

  const receiptCore = {
    schema: OSRM_MATURE_ENGINE_RECEIPT_SCHEMA,
    status: 'complete',
    dataClassification: 'public-osm-derived-local-routing-graph',
    engine: {
      name: 'Project OSRM',
      version: '26.8.0',
      algorithm: 'MLD',
      releaseUrl: 'https://github.com/Project-OSRM/osrm-backend/releases/tag/v26.8.0',
      nativeAsset: {
        url: 'https://github.com/Project-OSRM/osrm-backend/releases/download/v26.8.0/node_osrm-v26.8.0-8-win32-x64-Release.tar.gz',
        githubPublishedAt: '2026-08-01T08:47:17Z',
        ...engineArchive,
      },
      profilePackage: {
        name: '@project-osrm/osrm',
        version: '26.8.0',
        url: 'https://registry.npmjs.org/@project-osrm/osrm/-/osrm-26.8.0.tgz',
        npmIntegrity: 'sha512-lu7g7VL+rLJu6TSExhCmgFqFX6Mn6m56Fk2dorN9GT1aqRhTnVXn8UV4k6ieO3XKf+XrOdbIo9EWD/U6oWyGog==',
        provenanceUrl: 'https://registry.npmjs.org/-/npm/v1/attestations/@project-osrm%2fosrm@26.8.0',
        ...npmArchive,
      },
      toolInventory,
      toolIdentity: contentIdentity(toolInventory),
      sourceCommitClaimed: null,
      sourceCommitLimitation: 'Release asset and npm profile provenance are bound separately; no unified source commit is claimed.',
    },
    input: {
      provider: 'Geofabrik GmbH',
      providerPage: 'https://download.geofabrik.de/north-america/us/pennsylvania.html',
      datedUrl: 'https://download.geofabrik.de/north-america/us/pennsylvania-260824.osm.pbf',
      region: 'north-america/us/pennsylvania',
      format: 'osm.pbf',
      sourceAsOf: statistics.sourceAsOf,
      pbf,
      providerMd5: actualMd5,
      providerBoundary: {
        url: 'https://download.geofabrik.de/north-america/us/pennsylvania.poly',
        ...providerBoundary,
        bounds: providerBounds,
      },
      mutableLatestUsed: false,
      fallbackUsed: false,
    },
    authorityBoundary: {
      provider: 'City of Philadelphia ArcGIS Online',
      dataset: 'City Limits',
      url: 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/City_Limits/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
      file: cityBoundary,
      ...cityGeometry,
      use: 'Authority is limited to coordinates inside this exact public municipal polygon; the graph itself retains Pennsylvania extract coverage.',
    },
    profile: {
      mode: 'walking',
      entrypoint: `${ROOTS.profiles}/foot.lua`,
      inventory: profileInventory,
      profileIdentity: contentIdentity(profileInventory),
      travelTimeWeight: 'duration',
      accessibilityAuthority: false,
      realtimeAuthority: false,
    },
    build: {
      platform: 'win32-x64',
      nodeVersionObserved: process.version,
      commands: [
        ['osrm-extract.exe', '-p', 'profiles/foot.lua', '-o', 'build/graph.osrm', 'source/pennsylvania-260824.osm.pbf'],
        ['osrm-partition.exe', 'build/graph.osrm'],
        ['osrm-customize.exe', 'build/graph.osrm'],
      ],
      configuration: {
        threads: 24,
        profileApiVersion: 2,
        smallComponentSize: 1_000,
        conditionalRestrictionsParsed: false,
      },
      logs: logInventory,
      logIdentity: contentIdentity(logInventory),
      statistics,
    },
    graph: {
      schema: OSRM_GRAPH_ARTIFACT_SCHEMA,
      artifactRoot: ROOTS.build,
      inventory: graphInventory,
      fileCount: graphInventory.length,
      totalBytes,
      artifactIdentity: contentIdentity(graphInventory),
      topologyIdentity: contentIdentity(topologyFiles),
      geometryIdentity: contentIdentity(geometryFiles),
      topologyIdentityDefinition: [...TOPOLOGY_SUFFIXES].sort(),
      geometryIdentityDefinition: [...GEOMETRY_SUFFIXES].sort(),
      coverage: 'Pennsylvania Geofabrik extract including Philadelphia; not a city-only clipped PBF.',
    },
    publicProbe: probe,
    licensing: {
      engine: {
        license: 'BSD-2-Clause',
        url: 'https://github.com/Project-OSRM/osrm-backend/blob/v26.8.0/LICENSE.TXT',
        redistribution: 'Binary or source redistribution must retain the copyright notice, conditions, and disclaimer.',
      },
      inputAndGraph: {
        license: 'ODbL-1.0',
        url: 'https://opendatacommons.org/licenses/odbl/1-0/',
        attributionGuidance: 'https://osmfoundation.org/wiki/Licence/Attribution_Guidelines',
        publicAttribution: '© OpenStreetMap contributors, ODbL 1.0 — extract processed by Geofabrik GmbH',
        publicAttributionUrl: 'https://www.openstreetmap.org/copyright',
        redistributionBoundary: 'Treat the routing graph conservatively as a Derivative Database; public redistribution requires ODbL notice and the database or machine-readable alterations/method. Internal local use is not public redistribution.',
        legalAdvice: false,
      },
    },
    m4Handoff,
    authority: {
      graphArtifact: true,
      matureEngine: true,
      localRouting: true,
      mode: 'walking',
      travelTime: true,
      accessibility: false,
      realtime: false,
      safety: false,
      m2RouteEvidence: false,
      privateRuntimeProductPromotion: false,
      publicPublication: false,
      redistribution: false,
    },
    privacy: {
      remoteRoutingApiUsed: false,
      privateAddressUsed: false,
      privateCoordinatesUsed: false,
      privateRouteGeometryUsed: false,
      diaryUsed: false,
      userInputUsed: false,
      probeUsesFixedPublicCoordinatesOnly: true,
    },
    limitations: [
      'The graph is built from the complete Pennsylvania extract; Philadelphia authority is a separately bound municipal-polygon scope, not a city-only PBF claim.',
      'The standard OSRM foot profile establishes walking access and duration routing only; it does not establish wheelchair or other accessibility authority.',
      'The public deterministic probe proves one fixed local route only; it does not authorize private runtime, candidate generation, Pareto ranking, product promotion, publication, or deployment.',
      'M4 Street Centerline remains reference-only and M2 remains not-promoted/unavailable; neither contributes routing, mode, travel-time, accessibility, or safety authority.',
      'Historical Geofabrik dated files may be retained only temporarily; reproducibility therefore requires preserving these exact local bytes and receipt hashes.',
    ],
  };
  return freezeData({ ...receiptCore, receiptIdentity: contentIdentity(receiptCore) }, 'OSRM mature-engine receipt');
}

function parseReceipt(text) {
  const value = parseStrictJson(text, {
    label: 'OSRM mature-engine receipt',
    maxCodeUnits: 2_000_000,
    maxDepth: 32,
    maxItems: 20_000,
  });
  if (!value || value.schema !== OSRM_MATURE_ENGINE_RECEIPT_SCHEMA || typeof value.receiptIdentity !== 'string') {
    fail('osrm-receipt-schema', 'mature-engine receipt schema or identity is unavailable');
  }
  const { receiptIdentity, ...core } = value;
  if (receiptIdentity !== contentIdentity(core)) {
    fail('osrm-receipt-identity', 'mature-engine receipt identity does not bind its canonical facts');
  }
  return freezeData(value, 'inspected OSRM mature-engine receipt');
}

function inventory(root, projectRoot, predicate) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => fileBinding(projectRoot, path.join(entry.parentPath, entry.name)))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

function fileBinding(projectRoot, value) {
  const absolute = resolveOwned(projectRoot, value);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    fail('osrm-file-unavailable', `required file is unavailable: ${value}`);
  }
  const relative = path.relative(projectRoot, absolute).replaceAll('\\', '/');
  return freezeData({
    path: relative,
    bytes: statSync(absolute).size,
    sha256: `sha256:${digestFile(absolute, 'sha256')}`,
  }, `file binding ${relative}`);
}

function resolveOwned(projectRoot, value) {
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value);
  if (path.isAbsolute(value)) return absolute;
  const relative = path.relative(projectRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('osrm-path-boundary', 'owned path resolves outside the project root');
  }
  return absolute;
}

export function digestFileInFixedBlocks(filename, algorithm = 'sha256') {
  if (arguments.length < 1 || arguments.length > 2 || typeof filename !== 'string'
    || !['sha256', 'md5'].includes(algorithm)) {
    fail('osrm-file-digest-arguments', 'fixed-block digest requires one path and an optional admitted algorithm');
  }
  const digest = createHash(algorithm);
  const buffer = Buffer.allocUnsafe(OSRM_RECEIPT_HASH_BLOCK_BYTES);
  const descriptor = openSync(filename, 'r');
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return digest.digest('hex');
}

function digestFile(filename, algorithm) {
  return digestFileInFixedBlocks(filename, algorithm);
}

function assertBinding(binding, bytes, sha256, label) {
  if (binding.bytes !== bytes || binding.sha256 !== sha256) {
    fail('osrm-binding-drift', `${label} bytes or SHA-256 has drifted`);
  }
}

function polyBounds(filename) {
  const points = readFileSync(filename, 'utf8').split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));
  if (points.length < 3) fail('osrm-provider-boundary', 'provider polygon has insufficient coordinates');
  return boundsOf(points);
}

function inspectCityBoundary(filename) {
  const value = JSON.parse(readFileSync(filename, 'utf8'));
  if (value?.type !== 'FeatureCollection' || value.features?.length !== 1
    || value.features[0]?.geometry?.type !== 'Polygon') {
    fail('osrm-city-boundary', 'Philadelphia boundary must be one Polygon feature');
  }
  const points = [];
  collectCoordinates(value.features[0].geometry.coordinates, points);
  if (points.length !== 2_957) fail('osrm-city-boundary', 'Philadelphia boundary coordinate count has drifted');
  return { geometryType: 'Polygon', featureCount: 1, coordinatePairs: points.length, bounds: boundsOf(points) };
}

function collectCoordinates(value, points) {
  if (Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)) {
    points.push(value);
    return;
  }
  if (!Array.isArray(value)) fail('osrm-city-boundary', 'boundary coordinates are malformed');
  for (const child of value) collectCoordinates(child, points);
}

function boundsOf(points) {
  return freezeData({
    west: Math.min(...points.map(([longitude]) => longitude)),
    south: Math.min(...points.map(([, latitude]) => latitude)),
    east: Math.max(...points.map(([longitude]) => longitude)),
    north: Math.max(...points.map(([, latitude]) => latitude)),
  }, 'coordinate bounds');
}

function extractStatistics(extract, partition, customize) {
  return {
    sourceAsOf: exactMatch(extract, /timestamp: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/, 'source timestamp'),
    inputNodes: integerMatch(extract, /Raw input contains (\d+) nodes/, 'input nodes'),
    inputWays: integerMatch(extract, /nodes, (\d+) ways/, 'input ways'),
    processedNodes: integerMatch(extract, /Processed (\d+) nodes/, 'processed nodes'),
    processedSegments: integerMatch(extract, /Processed (\d+) edges\r?\n/, 'processed segments'),
    edgeBasedNodes: integerMatch(extract, /Generated (\d+) nodes \(0 of which are duplicates\)/, 'edge-based nodes'),
    edgeBasedEdges: integerMatch(extract, /contains (\d+) edges\r?\n\[.*Timing statistics/, 'edge-based edges'),
    stronglyConnectedComponents: integerMatch(extract, /Found (\d+) SCC \(4 large/, 'extract SCC count'),
    mldCells: [1, 2, 3, 4].map((level) => integerMatch(
      partition,
      new RegExp(`level ${level} #cells (\\d+)`, 'i'),
      `MLD level ${level} cells`,
    )),
    customizationObserved: /MLD customization writing took/.test(customize),
  };
}

function exactMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) fail('osrm-log-evidence', `OSRM log is missing ${label}`);
  return match[1];
}

function integerMatch(text, pattern, label) {
  return Number(exactMatch(text, pattern, label));
}

function inspectPublicProbe(projectRoot) {
  const run1 = fileBinding(projectRoot, `${ROOTS.probeEvidence}/probe-run1.json`);
  const run2 = fileBinding(projectRoot, `${ROOTS.probeEvidence}/probe-run2.json`);
  const replayManifest = fileBinding(projectRoot, `${ROOTS.probeEvidence}/probe-replay-manifest.json`);
  const transcriptBinding = fileBinding(projectRoot, `${ROOTS.probeEvidence}/probe-owned-transcript.json`);
  const run1Bytes = readFileSync(resolveOwned(projectRoot, run1.path));
  const run2Bytes = readFileSync(resolveOwned(projectRoot, run2.path));
  if (!run1Bytes.equals(run2Bytes) || run1.bytes !== run2.bytes || run1.sha256 !== run2.sha256) {
    fail('osrm-public-probe-replay', 'public probe run1 and run2 bytes are not exactly equal');
  }
  const manifest = JSON.parse(readFileSync(resolveOwned(projectRoot, replayManifest.path), 'utf8'));
  if (manifest?.schema !== 'route-real-osrm-public-probe-replay/v2'
    || manifest.equal !== true
    || manifest.run1?.path !== run1.path || manifest.run1?.bytes !== run1.bytes
    || manifest.run1?.sha256 !== run1.sha256
    || manifest.run2?.path !== run2.path || manifest.run2?.bytes !== run2.bytes
    || manifest.run2?.sha256 !== run2.sha256) {
    fail('osrm-public-probe-manifest', 'probe replay manifest does not bind both actual response files');
  }
  const transcript = JSON.parse(readFileSync(
    resolveOwned(projectRoot, transcriptBinding.path),
    'utf8',
  ));
  const { transcriptIdentity, ...transcriptCore } = transcript;
  const port = transcript?.transport?.port;
  const expectedUrl = `http://127.0.0.1:${port}/route/v1/walking/`
    + '-75.163570,39.952583;-75.150282,39.948873'
    + '?alternatives=false&steps=false&geometries=geojson&overview=full';
  const expectedExecutable = fileBinding(
    projectRoot,
    `${ROOTS.native}/osrm-routed.exe`,
  );
  const expectedArguments = [
    '--algorithm', 'mld', '--ip', '127.0.0.1', '--port', String(port), 'graph.osrm',
  ];
  const requestOwnershipIntact = (request) => (
    ['ownershipBefore', 'ownershipAfter'].every((key) => (
      request?.[key]?.method === 'windows-tcp-table-owning-process'
      && request[key].childPid === transcript.launch?.childPid
      && request[key].owningProcessId === transcript.launch?.childPid
      && request[key].exclusiveOwnerMatch === true
    ))
  );
  if (transcript?.schema !== 'route-real-osrm-owned-public-probe-transcript/v2'
    || transcriptIdentity !== contentIdentity(transcriptCore)
    || transcript.fixtureId !== 'philadelphia-city-hall-to-independence-hall/public-v1'
    || transcript.transport?.protocol !== 'http'
    || transcript.transport?.host !== '127.0.0.1'
    || !Number.isSafeInteger(port) || port < 1 || port > 65_535
    || transcript.transport?.allocation !== 'os-assigned-loopback-candidate'
    || canonicalStringify(transcript.launch?.executable) !== canonicalStringify(expectedExecutable)
    || transcript.launch?.graphPath !== `${ROOTS.build}/graph.osrm`
    || transcript.launch?.cwd !== ROOTS.build
    || canonicalStringify(transcript.launch?.arguments) !== canonicalStringify(expectedArguments)
    || !Number.isSafeInteger(transcript.launch?.childPid) || transcript.launch.childPid < 1
    || transcript.readiness?.method !== 'windows-tcp-table-owning-process'
    || transcript.readiness?.command !== 'netstat.exe -ano -p tcp'
    || transcript.readiness?.childPid !== transcript.launch.childPid
    || transcript.readiness?.owningProcessId !== transcript.launch.childPid
    || transcript.readiness?.childAlive !== true
    || transcript.readiness?.exclusiveOwnerMatch !== true
    || !Number.isSafeInteger(transcript.readiness?.attempts)
    || transcript.readiness.attempts < 1 || transcript.readiness.attempts > 100
    || transcript.requests?.length !== 2
    || transcript.requests[0]?.sequence !== 1 || transcript.requests[0]?.url !== expectedUrl
    || !requestOwnershipIntact(transcript.requests[0])
    || canonicalStringify(transcript.requests[0]?.response) !== canonicalStringify(run1)
    || transcript.requests[1]?.sequence !== 2 || transcript.requests[1]?.url !== expectedUrl
    || !requestOwnershipIntact(transcript.requests[1])
    || canonicalStringify(transcript.requests[1]?.response) !== canonicalStringify(run2)
    || transcript.teardown?.targetedChildPid !== transcript.launch.childPid
    || transcript.teardown?.terminationRequested !== true
    || transcript.teardown?.portReleasedByChild !== true
    || transcript.teardown?.foreignProcessTerminated !== false
    || transcript.privateRuntimeProductPromotion !== false
    || transcript.candidateGenerationAuthorized !== false) {
    fail('osrm-public-probe-transcript', 'probe transcript does not bind transport, child ownership, exact launch, queries, and teardown');
  }
  const value = JSON.parse(run1Bytes.toString('utf8'));
  const route = value?.routes?.[0];
  if (value?.code !== 'Ok' || value.routes?.length !== 1 || value.waypoints?.length !== 2
    || route?.geometry?.type !== 'LineString' || route.geometry.coordinates?.length !== 84
    || route.distance !== 1_547.8 || route.duration !== 1_114 || route.weight !== 1_114
    || route.weight_name !== 'duration') {
    fail('osrm-public-probe', 'fixed public local route proof has drifted');
  }
  return {
    fixtureId: 'philadelphia-city-hall-to-independence-hall/public-v1',
    coordinates: [[-75.163570, 39.952583], [-75.150282, 39.948873]],
    endpoint: `http://127.0.0.1:${port}/route/v1/walking`,
    transport: transcript.transport,
    launch: transcript.launch,
    readiness: transcript.readiness,
    teardown: transcript.teardown,
    localLoopbackOnly: true,
    responderOwnershipVerified: true,
    deterministicRepeatedResponse: true,
    run1,
    run2,
    replayManifest,
    transcript: transcriptBinding,
    transcriptIdentity,
    result: {
      code: 'Ok', routeCount: 1, waypointCount: 2,
      distanceMetres: route.distance, durationSeconds: route.duration,
      weight: route.weight, weightName: route.weight_name,
      geometryType: route.geometry.type, geometryPoints: route.geometry.coordinates.length,
    },
    authorityBoundary: 'This proves one public fixture only and does not authorize private or product runtime.',
  };
}

function inspectM4Handoff(projectRoot) {
  const relativePath = `${ROOTS.m4Input}/final-handoff.json`;
  const handoffPath = resolveOwned(projectRoot, relativePath);
  if (!existsSync(handoffPath)) fail('osrm-m4-handoff', 'exact M4 ignored handoff copy is unavailable');
  const bytes = statSync(handoffPath).size;
  const sha256 = `sha256:${digestFile(handoffPath, 'sha256')}`;
  const handoff = JSON.parse(readFileSync(handoffPath, 'utf8'));
  if (bytes !== 5_401 || sha256 !== EXPECTED_M4_HANDOFF_FILE_SHA256
    || handoff.identity !== EXPECTED_M4_HANDOFF_IDENTITY
    || handoff.authority?.centerlineTopology !== 'reference-only'
    || handoff.authority?.mode !== false || handoff.authority?.accessibility !== false
    || handoff.authority?.routing !== false || handoff.authority?.safety !== false
    || handoff.governance?.m2?.outcome?.promotionStatus !== 'not-promoted'
    || handoff.governance?.m2?.outcome?.availability !== 'unavailable') {
    fail('osrm-m4-handoff', 'exact M4 handoff identity or authority boundary has drifted');
  }
  return {
    sourceFinalRevision: EXPECTED_M4_SOURCE_FINAL,
    path: relativePath,
    bytes,
    sha256,
    handoffIdentity: handoff.identity,
    warehouseIdentity: handoff.warehouseIdentity,
    routeIdentity: handoff.routeIdentity,
    centerlineTopology: 'reference-only',
    m2PromotionStatus: 'not-promoted',
    m2Availability: 'unavailable',
    contributesRoutingAuthority: false,
  };
}

const isMain = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const validateOnly = process.argv.length === 3 && process.argv[2] === '--validate-only';
  if (process.argv.length !== (validateOnly ? 3 : 2)) {
    fail('osrm-receipt-cli', 'usage: node osrm_mature_engine_receipt.mjs [--validate-only]');
  }
  const receipt = validateOnly
    ? validateInstalledOsrmMatureEngineReceipt()
    : finalizeOsrmMatureEngineReceipt();
  process.stdout.write(`${JSON.stringify({
    status: validateOnly ? 'validated' : 'finalized',
    receiptIdentity: receipt.receiptIdentity,
    graphArtifactIdentity: receipt.graph.artifactIdentity,
    topologyIdentity: receipt.graph.topologyIdentity,
    geometryIdentity: receipt.graph.geometryIdentity,
    artifactFiles: receipt.graph.fileCount,
    artifactBytes: receipt.graph.totalBytes,
  })}\n`);
}
