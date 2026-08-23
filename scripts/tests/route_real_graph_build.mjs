import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { contentIdentity } from '../lib/route_graph_candidate/safe_data.mjs';
import * as buildSurface from '../lib/route_real_graph_build/index.mjs';
import * as privateRegistry from '../lib/route_real_graph_build/private_registry.mjs';
import {
  admitWorkspaceRoot,
  assertExactWorkspacePath,
  deriveWorkspacePaths,
} from '../lib/route_real_graph_build/workspace_paths.mjs';

const {
  BOUNDARY_POLICY_ID,
  BUILD_AUTHORITY_LIMITATION,
  BUILD_CLAIM_LIMITATION,
  EXTRACTOR_PACKAGE_FILENAME,
  EXTRACTOR_TOOL_ID,
  EXTRACTOR_VERSION,
  INTERNAL_DIGEST_LIMITATION,
  REAL_GRAPH_ACQUISITION_RELEASE_SCHEMA,
  REAL_GRAPH_EXTRACTION_RELEASE_SCHEMA,
  REAL_GRAPH_INTERMEDIATE_ADAPTER_SCHEMA,
  REAL_GRAPH_OBSERVED_PAYLOAD_RECEIPT_SCHEMA,
  REAL_GRAPH_OWNER_LEASE_SCHEMA,
  REAL_GRAPH_SUPERVISOR_ADMISSION_SCHEMA,
  RELEASE_CERTIFICATE_LIMITATION,
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT,
  acquisitionReleaseIdentity,
  createBoundaryBufferCandidate,
  inspectRouteRealGraphBuildControl,
  observedPayloadReceiptIdentity,
  parseAcquisitionReleaseJson,
  parseBoundaryGeoJsonText,
  parseContractJsonText,
  parseExtractionReleaseJson,
  parseObservedPayloadReceiptJson,
  parseRealGraphBuildPolicyJson,
  parseSupervisorAdmissionJson,
} = buildSurface;

const ROUTE_REAL_GRAPH_BUILD_POLICY = parseRealGraphBuildPolicyJson(
  ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT,
);

const FIXTURE_ROOT = new URL('../fixtures/route-real-graph-build/', import.meta.url);
const WORKSPACE_ROOT = 'C:\\Users\\raede\\.codex\\worktrees\\synthetic-rde\\engagement_project';
const LIMITATIONS = [
  BUILD_AUTHORITY_LIMITATION,
  RELEASE_CERTIFICATE_LIMITATION,
  BUILD_CLAIM_LIMITATION,
  INTERNAL_DIGEST_LIMITATION,
];

function json(value) {
  return JSON.stringify(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasCode(expectedCode) {
  return (error) => {
    assert.equal(error?.code, expectedCode);
    return true;
  };
}

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_ROOT), 'utf8'));
}

function makeLease({
  ownerId,
  nonce,
  issuedAt,
  deadlineAt,
}) {
  const identityInput = {
    schema: REAL_GRAPH_OWNER_LEASE_SCHEMA,
    ownerId,
    nonce,
    issuedAt,
    deadlineAt,
  };
  return {
    schema: identityInput.schema,
    leaseIdentity: contentIdentity(identityInput),
    ownerId,
    nonce,
    issuedAt,
    deadlineAt,
  };
}

function makeAdmission() {
  const paths = deriveWorkspacePaths(WORKSPACE_ROOT);
  return {
    schema: REAL_GRAPH_SUPERVISOR_ADMISSION_SCHEMA,
    admissionId: 'synthetic-supervisor-admission/v2',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    admittedRevision: 'a'.repeat(40),
    workspaceRootAbsolute: WORKSPACE_ROOT,
    sourceManifestIdentity: `sha256:${'1'.repeat(64)}`,
    boundaryBinding: {
      policyId: BOUNDARY_POLICY_ID,
      core: {
        absolutePath: paths.artifacts.coreBoundary,
        sha256: `sha256:${'2'.repeat(64)}`,
        byteCount: 2_002,
        observedAt: '2026-08-14T08:00:00.000Z',
      },
      buffer: {
        absolutePath: paths.artifacts.bufferBoundary,
        sha256: `sha256:${'3'.repeat(64)}`,
        byteCount: 3_003,
        builtAt: '2026-08-14T08:01:00.000Z',
      },
      builderIdentity: `sha256:${'4'.repeat(64)}`,
    },
    intermediateAdapter: {
      schema: REAL_GRAPH_INTERMEDIATE_ADAPTER_SCHEMA,
      identity: `sha256:${'5'.repeat(64)}`,
      admittedRevision: 'b'.repeat(40),
      acceptedAt: '2026-08-14T08:02:00.000Z',
      status: 'reviewed-admitted',
    },
    extractorObservation: {
      toolId: EXTRACTOR_TOOL_ID,
      version: EXTRACTOR_VERSION,
      packageChannel: 'conda-forge',
      packagePlatform: 'win-64',
      packageFilename: EXTRACTOR_PACKAGE_FILENAME,
      absolutePackagePath: `${WORKSPACE_ROOT}\\tools\\osmium-tool-1.19.1-h60971b7_0.conda`,
      packageSha256: `sha256:${'6'.repeat(64)}`,
      packageByteCount: 6_006,
      packageObservedAt: '2026-08-14T08:03:00.000Z',
      absoluteBinaryPath: `${WORKSPACE_ROOT}\\tools\\osmium\\Library\\bin\\osmium.exe`,
      versionArguments: ['--version'],
      versionOutput: 'synthetic osmium version 1.19.1 observation',
      binarySha256: `sha256:${'7'.repeat(64)}`,
      binaryByteCount: 7_007,
      observedAt: '2026-08-14T08:04:00.000Z',
    },
    transportObservation: {
      toolId: 'curl/8.0.1/supervisor-observed',
      version: '8.0.1',
      absoluteBinaryPath: `${WORKSPACE_ROOT}\\tools\\curl\\curl.exe`,
      versionArguments: ['--version'],
      versionOutput: 'synthetic curl 8.0.1 observation',
      binarySha256: `sha256:${'8'.repeat(64)}`,
      binaryByteCount: 8_008,
      observedAt: '2026-08-14T08:05:00.000Z',
    },
    acceptedAt: '2026-08-14T08:06:00.000Z',
    evidenceRef: 'synthetic-contract-test-only',
    limitations: LIMITATIONS,
  };
}

function makeAcquisitionRelease(admissionJsonText) {
  const admission = parseSupervisorAdmissionJson(
    admissionJsonText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const paths = deriveWorkspacePaths(admission.workspaceRootAbsolute);
  return {
    schema: REAL_GRAPH_ACQUISITION_RELEASE_SCHEMA,
    releaseId: 'synthetic-acquisition-release/v1',
    admissionIdentity: contentIdentity(admission),
    datedUrl: ROUTE_REAL_GRAPH_BUILD_POLICY.source.datedUrl,
    transportObservationIdentity: contentIdentity(admission.transportObservation),
    workspaceRootAbsolute: admission.workspaceRootAbsolute,
    paths: {
      workingDirectoryAbsolute: paths.workingDirectoryAbsolute,
      outputDirectoryAbsolute: paths.outputDirectoryAbsolute,
      logPathAbsolute: paths.logPathAbsolute,
      sourcePartialPathAbsolute: paths.artifacts.sourcePartial,
      sourceFinalPathAbsolute: paths.artifacts.sourcePbf,
    },
    ownerLease: makeLease({
      ownerId: 'synthetic-acquisition-owner',
      nonce: 'a'.repeat(32),
      issuedAt: '2026-08-14T08:10:00.000Z',
      deadlineAt: '2026-08-14T08:30:00.000Z',
    }),
    trustedController: {
      identity: `sha256:${'c'.repeat(64)}`,
      observedAt: '2026-08-14T08:11:00.000Z',
    },
    oneShotConsumption: {
      required: true,
      consumptionOrdinal: 0,
      consumedAt: null,
    },
    preflight: unobservedPreflight(),
    retryAllowed: false,
    fallbackAllowed: false,
    limitations: LIMITATIONS,
  };
}

function makeObservedReceipt(acquisitionJsonText, admissionJsonText) {
  const admission = parseSupervisorAdmissionJson(
    admissionJsonText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const acquisition = parseAcquisitionReleaseJson(
    acquisitionJsonText,
    admissionJsonText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  return {
    schema: REAL_GRAPH_OBSERVED_PAYLOAD_RECEIPT_SCHEMA,
    receiptId: 'synthetic-observed-payload-receipt/v1',
    acquisitionReleaseIdentity: contentIdentity(acquisition),
    admissionIdentity: contentIdentity(admission),
    ownerLeaseIdentity: acquisition.ownerLease.leaseIdentity,
    ownerNonce: acquisition.ownerLease.nonce,
    trustedControllerIdentity: acquisition.trustedController.identity,
    controllerObservedAt: acquisition.trustedController.observedAt,
    consumptionOrdinal: 1,
    consumedAt: '2026-08-14T08:12:00.000Z',
    sourcePayload: {
      absolutePath: acquisition.paths.sourceFinalPathAbsolute,
      sha256: `sha256:${'9'.repeat(64)}`,
      byteCount: 9_009,
      retrievedAt: '2026-08-14T08:15:00.000Z',
      observedAt: '2026-08-14T08:16:00.000Z',
    },
    partialRemoved: true,
    retryUsed: false,
    fallbackUsed: false,
    limitations: LIMITATIONS,
  };
}

function makeExtractionRelease(receiptJsonText, acquisitionJsonText, admissionJsonText) {
  const admission = parseSupervisorAdmissionJson(
    admissionJsonText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const receipt = parseObservedPayloadReceiptJson(
    receiptJsonText,
    acquisitionJsonText,
    admissionJsonText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const paths = deriveWorkspacePaths(admission.workspaceRootAbsolute);
  return {
    schema: REAL_GRAPH_EXTRACTION_RELEASE_SCHEMA,
    releaseId: 'synthetic-extraction-release/v1',
    admissionIdentity: contentIdentity(admission),
    observedPayloadReceiptIdentity: contentIdentity(receipt),
    extractorObservationIdentity: contentIdentity(admission.extractorObservation),
    boundaryBinding: clone(admission.boundaryBinding),
    intermediateAdapterIdentity: contentIdentity(admission.intermediateAdapter),
    workspaceRootAbsolute: admission.workspaceRootAbsolute,
    paths: {
      workingDirectoryAbsolute: paths.workingDirectoryAbsolute,
      outputDirectoryAbsolute: paths.outputDirectoryAbsolute,
      logPathAbsolute: paths.logPathAbsolute,
      sourcePbfAbsolute: paths.artifacts.sourcePbf,
      sourceFileInfoAbsolute: paths.artifacts.sourceFileInfo,
      coreBoundaryAbsolute: paths.artifacts.coreBoundary,
      bufferBoundaryAbsolute: paths.artifacts.bufferBoundary,
      bufferExtractPbfAbsolute: paths.artifacts.bufferExtractPbf,
      walkingFilteredPbfAbsolute: paths.artifacts.walkingFilteredPbf,
      intermediateOplAbsolute: paths.artifacts.intermediateOpl,
      intermediateFileInfoAbsolute: paths.artifacts.intermediateFileInfo,
      buildEvidenceAbsolute: paths.artifacts.buildEvidence,
    },
    ownerLease: makeLease({
      ownerId: 'synthetic-extraction-owner',
      nonce: 'b'.repeat(32),
      issuedAt: '2026-08-14T08:17:00.000Z',
      deadlineAt: '2026-08-14T08:40:00.000Z',
    }),
    trustedController: {
      identity: `sha256:${'d'.repeat(64)}`,
      observedAt: '2026-08-14T08:18:00.000Z',
    },
    oneShotConsumption: {
      required: true,
      consumptionOrdinal: 0,
      consumedAt: null,
    },
    preflight: unobservedPreflight(),
    retryAllowed: false,
    fallbackAllowed: false,
    limitations: LIMITATIONS,
  };
}

function unobservedPreflight() {
  return {
    status: 'not-observed',
    symlinkAndReparseCheckRequired: true,
    preExistingOutputCheckRequired: true,
    exactByteRevalidationRequired: true,
  };
}

function simpleRing(offset = 0) {
  return [
    [-75 + offset, 39],
    [-74.99 + offset, 39],
    [-74.99 + offset, 39.01],
    [-75 + offset, 39],
  ];
}

function boundaryText(geometry) {
  return json({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { dataClassification: 'synthetic-contract-fixture' },
      geometry,
    }],
  });
}

test('freezes the v2 policy and default non-capability control', async () => {
  const policyFixture = await readJson('policy-audit.json');
  const controlFixture = await readJson('expected-control.json');
  assert.equal(ROUTE_REAL_GRAPH_BUILD_POLICY.schema, policyFixture.policySchema);
  assert.equal(ROUTE_REAL_GRAPH_BUILD_POLICY.policyId, policyFixture.policyId);
  assert.equal(ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY, policyFixture.expectedPolicyIdentity);
  assert.equal(ROUTE_REAL_GRAPH_BUILD_POLICY.acquisitionCommandPlan.length, 1);
  assert.equal(ROUTE_REAL_GRAPH_BUILD_POLICY.extractionCommandPlan.length, 6);
  assert.equal(Object.isFrozen(ROUTE_REAL_GRAPH_BUILD_POLICY), true);

  const control = inspectRouteRealGraphBuildControl();
  const actual = Object.fromEntries(
    Object.keys(controlFixture.expected).map((key) => [key, control[key]]),
  );
  assert.deepEqual(actual, controlFixture.expected);
  assert.equal(control.supervisorAdmissionIdentity, null);
  assert.equal(control.acquisitionReleaseIdentity, null);
  assert.equal(control.observedPayloadReceiptIdentity, null);
});

test('policy content drift requires an explicit version change', () => {
  const changed = clone(ROUTE_REAL_GRAPH_BUILD_POLICY);
  changed.source.datedUrl = 'https://download.geofabrik.de/north-america/us/pennsylvania-260812.osm.pbf';
  assert.throws(() => parseRealGraphBuildPolicyJson(json(changed)), hasCode('build-policy-content-drift'));
});

test('rejects Proxy, object, getter, symbol, and sparse array ingress without reflection traps', async () => {
  const admissionText = json(makeAdmission());
  const acquisitionText = json(makeAcquisitionRelease(admissionText));
  const receiptText = json(makeObservedReceipt(acquisitionText, admissionText));
  let trapCount = 0;
  const hostileProxy = new Proxy({}, {
    get() {
      trapCount += 1;
      throw new Error('get trap must not execute');
    },
    getOwnPropertyDescriptor() {
      trapCount += 1;
      throw new Error('descriptor trap must not execute');
    },
    getPrototypeOf() {
      trapCount += 1;
      throw new Error('prototype trap must not execute');
    },
    ownKeys() {
      trapCount += 1;
      throw new Error('ownKeys trap must not execute');
    },
  });
  assert.throws(() => parseContractJsonText(hostileProxy), hasCode('json-text-required'));
  assert.throws(() => parseRealGraphBuildPolicyJson(hostileProxy), hasCode('json-text-required'));
  assert.throws(
    () => parseSupervisorAdmissionJson(hostileProxy, ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY),
    hasCode('json-text-required'),
  );
  assert.throws(
    () => parseAcquisitionReleaseJson(
      hostileProxy,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('json-text-required'),
  );
  assert.throws(
    () => parseObservedPayloadReceiptJson(
      hostileProxy,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('json-text-required'),
  );
  assert.throws(
    () => parseExtractionReleaseJson(
      hostileProxy,
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('json-text-required'),
  );
  await assert.rejects(() => createBoundaryBufferCandidate(hostileProxy), hasCode('json-text-required'));
  assert.equal(trapCount, 0);

  assert.throws(
    () => assertExactWorkspacePath(hostileProxy, hostileProxy, hostileProxy),
    hasCode('path-text-required'),
  );
  assert.equal(trapCount, 0);

  let getterCalls = 0;
  const getterObject = {};
  Object.defineProperty(getterObject, 'type', {
    get() {
      getterCalls += 1;
      return 'Feature';
    },
  });
  assert.throws(() => parseBoundaryGeoJsonText(getterObject), hasCode('json-text-required'));
  assert.equal(getterCalls, 0);
  assert.throws(() => parseContractJsonText(Symbol('hostile')), hasCode('json-text-required'));

  const sparse = [];
  sparse.length = 4_000_000_000;
  assert.equal(Object.keys(sparse).length, 0);
  assert.throws(() => parseBoundaryGeoJsonText(sparse), hasCode('json-text-required'));
  assert.equal(sparse.length, 4_000_000_000);
});

test('bounded parser rejects code-unit, depth, item, duplicate, blocked-key, and negative-zero attacks', () => {
  assert.throws(() => parseContractJsonText(' '.repeat(262_145)), hasCode('json-code-unit-limit'));
  const deep = '['.repeat(5_000) + '0' + ']'.repeat(5_000);
  assert.throws(() => parseContractJsonText(deep), hasCode('json-depth-limit'));
  const itemHeavy = json({
    a: Array(2_048).fill(0),
    b: Array(2_048).fill(0),
    c: Array(2_048).fill(0),
    d: Array(2_048).fill(0),
  });
  assert.throws(() => parseContractJsonText(itemHeavy), hasCode('json-item-limit'));
  assert.throws(() => parseContractJsonText('{"a":1,"a":2}'), hasCode('json-duplicate-key'));
  assert.throws(
    () => parseContractJsonText('{"\\u005f\\u005fproto__":1}'),
    hasCode('json-blocked-key'),
  );
  assert.throws(() => parseContractJsonText('{"value":-0}'), hasCode('json-negative-zero'));
});

test('admits a synthetic future supervisor record only through JSON text', () => {
  const admission = makeAdmission();
  const admitted = parseSupervisorAdmissionJson(
    json(admission),
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(admitted.workspaceRootAbsolute, WORKSPACE_ROOT);
  assert.throws(
    () => parseSupervisorAdmissionJson(admission, ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY),
    hasCode('json-text-required'),
  );
});

test('rejects DOS 8.3 aliases across public admission, release, receipt, and evidence paths', () => {
  const admissionCases = [
    (admission) => {
      admission.extractorObservation.absolutePackagePath =
        'C:\\PROGRA~1\\conda\\pkgs\\osmium-tool-1.19.1-h60971b7_0.conda';
    },
    (admission) => {
      admission.extractorObservation.absoluteBinaryPath =
        'C:\\PROGRA~1\\osmium\\Library\\bin\\osmium.exe';
    },
    (admission) => {
      admission.transportObservation.absoluteBinaryPath = 'C:\\Users\\RAEDE~1\\curl.exe';
    },
    (admission) => {
      admission.boundaryBinding.core.absolutePath = shortAliasPath(
        admission.boundaryBinding.core.absolutePath,
      );
    },
  ];
  for (const mutate of admissionCases) {
    const hostile = makeAdmission();
    mutate(hostile);
    assert.throws(
      () => parseSupervisorAdmissionJson(
        json(hostile),
        ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
      ),
      hasCode('absolute-path-short-name'),
    );
  }

  const admissionText = json(makeAdmission());
  const acquisition = makeAcquisitionRelease(admissionText);
  const hostileAcquisition = clone(acquisition);
  hostileAcquisition.paths.sourcePartialPathAbsolute = shortAliasPath(
    hostileAcquisition.paths.sourcePartialPathAbsolute,
  );
  assert.throws(
    () => parseAcquisitionReleaseJson(
      json(hostileAcquisition),
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('absolute-path-short-name'),
  );

  const acquisitionText = json(acquisition);
  const receipt = makeObservedReceipt(acquisitionText, admissionText);
  const hostileReceipt = clone(receipt);
  hostileReceipt.sourcePayload.absolutePath = shortAliasPath(
    hostileReceipt.sourcePayload.absolutePath,
  );
  assert.throws(
    () => parseObservedPayloadReceiptJson(
      json(hostileReceipt),
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('absolute-path-short-name'),
  );

  const receiptText = json(receipt);
  const extraction = makeExtractionRelease(receiptText, acquisitionText, admissionText);
  const hostileExtraction = clone(extraction);
  hostileExtraction.paths.buildEvidenceAbsolute = shortAliasPath(
    hostileExtraction.paths.buildEvidenceAbsolute,
  );
  assert.throws(
    () => parseExtractionReleaseJson(
      json(hostileExtraction),
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('absolute-path-short-name'),
  );
});

test('derives exact workspace paths and rejects drive-root system directories, short names, and wrong slots', () => {
  const paths = deriveWorkspacePaths(WORKSPACE_ROOT);
  assert.equal(paths.workspaceRootAbsolute, WORKSPACE_ROOT);
  assert.equal(paths.artifacts.sourcePbf.startsWith(`${WORKSPACE_ROOT}\\`), true);
  const rejectedWorkspaceRoots = [
    ['C:\\windows\\engagement_project', 'workspace-root-system'],
    ['C:\\WINDOWS\\engagement_project', 'workspace-root-system'],
    ['C:\\Program files\\engagement_project', 'workspace-root-system'],
    ['C:\\PROGRAM FILES (X86)\\engagement_project', 'workspace-root-system'],
    ['C:\\programdata\\engagement_project', 'workspace-root-system'],
    ['C:\\PROGRA~1\\engagement_project', 'workspace-root-short-name'],
  ];
  for (const [workspaceRoot, code] of rejectedWorkspaceRoots) {
    assert.throws(() => admitWorkspaceRoot(workspaceRoot), hasCode(code));
  }
  assert.equal(
    admitWorkspaceRoot('C:\\Users\\someone\\Windows\\engagement_project'),
    'C:\\Users\\someone\\Windows\\engagement_project',
  );
  assert.throws(
    () => admitWorkspaceRoot('\\\\server\\share\\engagement_project'),
    hasCode('workspace-root-unc'),
  );
  assert.throws(
    () => admitWorkspaceRoot('c:\\Users\\raede\\engagement_project'),
    hasCode('workspace-root-drive'),
  );

  const admissionText = json(makeAdmission());
  const base = makeAcquisitionRelease(admissionText);
  const cases = [
    ['C:\\Windows\\pennsylvania-260813.osm.pbf', 'path-slot-drift'],
    [`${base.paths.sourceFinalPathAbsolute}-sibling`, 'path-slot-drift'],
    [base.paths.sourceFinalPathAbsolute.replace('engagement_project', 'Engagement_Project'), 'path-slot-drift'],
    [`${WORKSPACE_ROOT}\\output\\..\\pennsylvania-260813.osm.pbf`, 'absolute-path-normalization'],
    [base.paths.sourcePartialPathAbsolute, 'path-slot-drift'],
    [`${base.paths.sourceFinalPathAbsolute}:stream`, 'absolute-path-segment'],
  ];
  for (const [path, code] of cases) {
    const hostile = clone(base);
    hostile.paths.sourceFinalPathAbsolute = path;
    assert.throws(
      () => parseAcquisitionReleaseJson(
        json(hostile),
        admissionText,
        ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
      ),
      hasCode(code),
    );
  }

  const outsideCore = makeAdmission();
  outsideCore.boundaryBinding.core.absolutePath = 'C:\\Windows\\philadelphia-city-limits-core.geojson';
  assert.throws(
    () => parseSupervisorAdmissionJson(
      json(outsideCore),
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('path-slot-drift'),
  );

  const swappedBoundary = makeAdmission();
  const corePath = swappedBoundary.boundaryBinding.core.absolutePath;
  swappedBoundary.boundaryBinding.core.absolutePath = swappedBoundary.boundaryBinding.buffer.absolutePath;
  swappedBoundary.boundaryBinding.buffer.absolutePath = corePath;
  assert.throws(
    () => parseSupervisorAdmissionJson(
      json(swappedBoundary),
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('path-slot-drift'),
  );
});

function shortAliasPath(path) {
  const alias = path.replace('\\raede\\', '\\RAEDE~1\\');
  assert.notEqual(alias, path);
  return alias;
}

test('AcquisitionRelease permits no pre-existing payload binding and remains non-executable', () => {
  const admissionText = json(makeAdmission());
  const release = makeAcquisitionRelease(admissionText);
  assert.equal('sourcePayload' in release, false);
  assert.equal('commandsRunnable' in release, false);
  const admitted = parseAcquisitionReleaseJson(
    json(release),
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  assert.equal(admitted.oneShotConsumption.consumptionOrdinal, 0);
  assert.equal(admitted.preflight.status, 'not-observed');
  assert.equal(admitted.preflight.symlinkAndReparseCheckRequired, true);
  assert.equal(admitted.preflight.preExistingOutputCheckRequired, true);
  assert.equal(admitted.preflight.exactByteRevalidationRequired, true);

  const forgedPayload = clone(release);
  forgedPayload.sourcePayload = { sha256: `sha256:${'f'.repeat(64)}` };
  assert.throws(
    () => parseAcquisitionReleaseJson(
      json(forgedPayload),
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('schema-mismatch'),
  );
});

test('rejects expired, replayed, and lease-drifted acquisition releases', () => {
  const admissionText = json(makeAdmission());
  const base = makeAcquisitionRelease(admissionText);

  const expired = clone(base);
  expired.trustedController.observedAt = expired.ownerLease.deadlineAt;
  assert.throws(
    () => parseAcquisitionReleaseJson(json(expired), admissionText, ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY),
    hasCode('release-expired'),
  );

  const replayed = clone(base);
  replayed.oneShotConsumption.consumptionOrdinal = 1;
  replayed.oneShotConsumption.consumedAt = '2026-08-14T08:12:00.000Z';
  assert.throws(
    () => parseAcquisitionReleaseJson(json(replayed), admissionText, ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY),
    hasCode('acquisition-release-replayed'),
  );

  const nonceDrift = clone(base);
  nonceDrift.ownerLease.nonce = 'f'.repeat(32);
  assert.throws(
    () => parseAcquisitionReleaseJson(json(nonceDrift), admissionText, ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY),
    hasCode('owner-lease-identity'),
  );
});

test('ObservedPayloadReceipt binds controller-computed payload bytes, clocks, lease, and final path', () => {
  const admissionText = json(makeAdmission());
  const acquisitionText = json(makeAcquisitionRelease(admissionText));
  const receipt = makeObservedReceipt(acquisitionText, admissionText);
  const admitted = parseObservedPayloadReceiptJson(
    json(receipt),
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  assert.equal(admitted.sourcePayload.byteCount, 9_009);
  assert.match(observedPayloadReceiptIdentity(
    json(receipt),
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  ), /^sha256:[a-f0-9]{64}$/);

  const wrongPath = clone(receipt);
  wrongPath.sourcePayload.absolutePath = 'C:\\Windows\\pennsylvania-260813.osm.pbf';
  assert.throws(
    () => parseObservedPayloadReceiptJson(
      json(wrongPath),
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('path-slot-drift'),
  );

  const replay = clone(receipt);
  replay.consumptionOrdinal = 2;
  assert.throws(
    () => parseObservedPayloadReceiptJson(
      json(replay),
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('payload-receipt-replay'),
  );
});

test('ExtractionRelease requires an exact observed receipt, osmium, and RD-B adapter identity', () => {
  const admissionText = json(makeAdmission());
  const acquisitionText = json(makeAcquisitionRelease(admissionText));
  const receiptText = json(makeObservedReceipt(acquisitionText, admissionText));
  const extraction = makeExtractionRelease(receiptText, acquisitionText, admissionText);
  const admitted = parseExtractionReleaseJson(
    json(extraction),
    receiptText,
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal('commandsRunnable' in admitted, false);

  assert.throws(
    () => parseExtractionReleaseJson(
      json(extraction),
      'null',
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('object-required'),
  );

  const receiptDrift = clone(extraction);
  receiptDrift.observedPayloadReceiptIdentity = `sha256:${'e'.repeat(64)}`;
  assert.throws(
    () => parseExtractionReleaseJson(
      json(receiptDrift),
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('extraction-receipt-drift'),
  );

  const toolDrift = clone(extraction);
  toolDrift.extractorObservationIdentity = `sha256:${'e'.repeat(64)}`;
  assert.throws(
    () => parseExtractionReleaseJson(
      json(toolDrift),
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('extraction-tool-drift'),
  );

  const adapterDrift = clone(extraction);
  adapterDrift.intermediateAdapterIdentity = `sha256:${'e'.repeat(64)}`;
  assert.throws(
    () => parseExtractionReleaseJson(
      json(adapterDrift),
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('extraction-adapter-drift'),
  );

  const wrongArtifactSlot = clone(extraction);
  wrongArtifactSlot.paths.intermediateOplAbsolute = extraction.paths.intermediateFileInfoAbsolute;
  assert.throws(
    () => parseExtractionReleaseJson(
      json(wrongArtifactSlot),
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('path-slot-drift'),
  );
});

test('mechanically rejects every core/buffer bytes-clock-builder drift between admission and extraction', async (t) => {
  const admissionText = json(makeAdmission());
  const acquisitionText = json(makeAcquisitionRelease(admissionText));
  const receiptText = json(makeObservedReceipt(acquisitionText, admissionText));
  const base = makeExtractionRelease(receiptText, acquisitionText, admissionText);
  const mutations = {
    'core SHA-256': (value) => { value.boundaryBinding.core.sha256 = `sha256:${'a'.repeat(64)}`; },
    'core byte count': (value) => { value.boundaryBinding.core.byteCount += 1; },
    'core observedAt': (value) => { value.boundaryBinding.core.observedAt = '2026-08-14T08:00:01.000Z'; },
    'buffer SHA-256': (value) => { value.boundaryBinding.buffer.sha256 = `sha256:${'b'.repeat(64)}`; },
    'buffer byte count': (value) => { value.boundaryBinding.buffer.byteCount += 1; },
    'buffer builtAt': (value) => { value.boundaryBinding.buffer.builtAt = '2026-08-14T08:01:01.000Z'; },
    'builder identity': (value) => { value.boundaryBinding.builderIdentity = `sha256:${'c'.repeat(64)}`; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, () => {
      const hostile = clone(base);
      mutate(hostile);
      assert.throws(
        () => parseExtractionReleaseJson(
          json(hostile),
          receiptText,
          acquisitionText,
          admissionText,
          ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
        ),
        hasCode('extraction-boundary-drift'),
      );
    });
  }
});

test('rejects replayed or expired extraction certificates without claiming a transition', () => {
  const admissionText = json(makeAdmission());
  const acquisitionText = json(makeAcquisitionRelease(admissionText));
  const receiptText = json(makeObservedReceipt(acquisitionText, admissionText));
  const base = makeExtractionRelease(receiptText, acquisitionText, admissionText);

  const expired = clone(base);
  expired.trustedController.observedAt = expired.ownerLease.deadlineAt;
  assert.throws(
    () => parseExtractionReleaseJson(
      json(expired),
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('release-expired'),
  );

  const replayed = clone(base);
  replayed.oneShotConsumption.consumptionOrdinal = 1;
  replayed.oneShotConsumption.consumedAt = '2026-08-14T08:19:00.000Z';
  assert.throws(
    () => parseExtractionReleaseJson(
      json(replayed),
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('extraction-release-replayed'),
  );

  const premature = clone(base);
  premature.ownerLease = makeLease({
    ownerId: 'synthetic-extraction-owner',
    nonce: 'b'.repeat(32),
    issuedAt: '2026-08-14T08:15:00.000Z',
    deadlineAt: '2026-08-14T08:40:00.000Z',
  });
  premature.trustedController.observedAt = '2026-08-14T08:18:00.000Z';
  assert.throws(
    () => parseExtractionReleaseJson(
      json(premature),
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('extraction-release-order'),
  );
});

test('enforces polygon, ring, per-ring point, and total point bounds before Turf load', async () => {
  const polygons = Array.from({ length: 33 }, (_, index) => [simpleRing(index / 1_000)]);
  await assert.rejects(
    () => createBoundaryBufferCandidate(boundaryText({ type: 'MultiPolygon', coordinates: polygons })),
    hasCode('boundary-polygon-limit'),
  );

  const rings = Array.from({ length: 257 }, (_, index) => simpleRing(index / 1_000));
  await assert.rejects(
    () => createBoundaryBufferCandidate(boundaryText({ type: 'Polygon', coordinates: rings })),
    hasCode('boundary-ring-limit'),
  );

  const tooLongRing = Array.from({ length: 50_001 }, (_, index) => (
    index === 50_000 ? [-75, 39] : [-75 + (index % 100) / 100_000, 39]
  ));
  await assert.rejects(
    () => createBoundaryBufferCandidate(boundaryText({ type: 'Polygon', coordinates: [tooLongRing] })),
    hasCode('boundary-ring-point-limit'),
  );

  const totalPointRings = Array.from({ length: 3 }, (_, ringIndex) => (
    Array.from({ length: 33_334 }, (_, index) => (
      index === 33_333
        ? [-75 + ringIndex / 1_000, 39]
        : [-75 + ringIndex / 1_000 + (index % 100) / 100_000, 39]
    ))
  ));
  await assert.rejects(
    () => createBoundaryBufferCandidate(boundaryText({ type: 'Polygon', coordinates: totalPointRings })),
    hasCode('boundary-point-limit'),
  );
});

test('accepts only boundary JSON text and keeps a derived candidate non-authoritative', async () => {
  const boundaryJsonText = await readFile(new URL('synthetic-city-limit.geojson', FIXTURE_ROOT), 'utf8');
  try {
    const candidate = await createBoundaryBufferCandidate(boundaryJsonText);
    assert.equal(candidate.authorityVerified, false);
    assert.equal(candidate.buildEligible, false);
    assert.equal(candidate.algorithm.distance, 1_000);
    assert.equal(candidate.algorithm.steps, 32);
    assert.equal(candidate.crossStatePolicy.unsupportedOutcome, 'coverage-unavailable-not-no-route');
  } catch (error) {
    assert.equal(error?.code, 'boundary-builder-unavailable');
  }
  const boundaryObject = JSON.parse(boundaryJsonText);
  await assert.rejects(
    () => createBoundaryBufferCandidate(boundaryObject),
    hasCode('json-text-required'),
  );
});

test('keeps the OPL bridge, build evidence, current, public, and cross-state claims fail closed', () => {
  const { intermediate, boundary, licence, controller } = ROUTE_REAL_GRAPH_BUILD_POLICY;
  assert.equal(intermediate.parserStatus, 'rd-b-exact-adapter-unavailable');
  assert.equal(intermediate.bridgeStatus, 'separate-reviewed-opl-to-rd-b-bridge-required');
  assert.equal(intermediate.buildEvidenceStatus, 'trusted-controller-build-evidence-unavailable');
  assert.equal(intermediate.hiddenParserAllowed, false);
  assert.equal(boundary.crossState.delawareRiverCrossing, 'unsupported');
  assert.equal(boundary.crossState.newJerseyCrossing, 'unsupported');
  assert.equal(boundary.crossState.unsupportedOutcome, 'coverage-unavailable-not-no-route');
  assert.equal(licence.dataLicence, 'ODbL-1.0');
  assert.equal(licence.attributionText, 'OpenStreetMap contributors');
  assert.equal(licence.publicReleaseEligible, false);
  assert.equal(controller.status, 'not-implemented');
  assert.equal(controller.commandsRunnable, false);
  assert.equal(controller.releaseCertificateExecutable, false);
});

test('exports no old circular live release or caller registry mutation surface', () => {
  assert.equal('admitLiveProcessRelease' in buildSurface, false);
  assert.equal('REAL_GRAPH_LIVE_RELEASE_SCHEMA' in buildSurface, false);
  assert.equal('requirePrivateLivePreflightPlan' in buildSurface, false);
  assert.equal('ROUTE_REAL_GRAPH_BUILD_POLICY' in buildSurface, false);
  assert.equal('readInstalledSupervisorAdmissionJsonText' in buildSurface, false);
  assert.equal('readInstalledAcquisitionReleaseJsonText' in buildSurface, false);
  assert.equal('readInstalledObservedPayloadReceiptJsonText' in buildSurface, false);
  assert.equal('readInstalledExtractionReleaseJsonText' in buildSurface, false);
  assert.throws(() => inspectRouteRealGraphBuildControl('{}'), hasCode('caller-authority-forbidden'));
});

test('keeps all four module-private certificate registries empty', () => {
  assert.equal(privateRegistry.readInstalledSupervisorAdmissionJsonText(), null);
  assert.equal(privateRegistry.readInstalledAcquisitionReleaseJsonText(), null);
  assert.equal(privateRegistry.readInstalledObservedPayloadReceiptJsonText(), null);
  assert.equal(privateRegistry.readInstalledExtractionReleaseJsonText(), null);
});

test('library surface contains no process, network, credential, or write primitive', async () => {
  const files = [
    'boundary_policy.mjs',
    'bounded_json.mjs',
    'build_control.mjs',
    'contracts.mjs',
    'index.mjs',
    'policy.mjs',
    'private_registry.mjs',
    'workspace_paths.mjs',
  ];
  for (const name of files) {
    const source = await readFile(new URL(`../lib/route_real_graph_build/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]node:child_process['"]/u, name);
    assert.doesNotMatch(source, /\b(?:spawn|exec|execFile|fork|fetch|writeFile|appendFile|createWriteStream)\s*\(/u, name);
    assert.doesNotMatch(source, /process\.env/u, name);
  }
});

test('identity helpers consume only primitive JSON text', () => {
  const admissionText = json(makeAdmission());
  const acquisition = makeAcquisitionRelease(admissionText);
  assert.match(acquisitionReleaseIdentity(
    json(acquisition),
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  ), /^sha256:[a-f0-9]{64}$/);
  assert.throws(
    () => acquisitionReleaseIdentity(
      acquisition,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    ),
    hasCode('json-text-required'),
  );
  assert.equal(typeof ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT, 'string');
});
