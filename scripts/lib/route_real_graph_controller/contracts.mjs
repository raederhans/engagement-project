import { win32 } from 'node:path';

import { fail, freezeData } from '../route_graph_candidate/safe_data.mjs';
import { admitWorkspaceRoot, assertCanonicalAbsolutePath } from '../route_real_graph_build/workspace_paths.mjs';
import { ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY } from '../route_real_graph_build/policy.mjs';
import { OPL_DISTANCE_MECHANICS_IDENTITY, TRUSTED_BUILD_EVIDENCE_SCHEMA } from '../route_real_graph_bridge/contracts.mjs';
import { OSM_WALK_PROFILE_IDENTITY, OSM_WALK_PROFILE_SCHEMA } from '../route_real_graph_osm/profile.mjs';
import { OSM_ADAPTER_RESULT_SCHEMA, OSM_INTERMEDIATE_SCHEMA } from '../route_real_graph_osm/schemas.mjs';

export { ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY };

export const INSTALLED_TOOL_OBSERVATION_CLAIM_SCHEMA =
  'route-real-graph-installed-osmium-observation-claim/v2';
export const DOWNLOAD_TRANSPORT_OBSERVATION_CLAIM_SCHEMA =
  'route-real-graph-installed-curl-observation-claim/v1';
export const INSTALLED_TOOL_CLAIM_INSPECTION_SCHEMA =
  'route-real-graph-installed-tool-claim-inspection/v2';
export const PERSISTENT_NONCE_STORE_CLAIM_SCHEMA =
  'route-real-graph-persistent-nonce-store-claim/v3';
export const PERSISTENT_NONCE_STORE_INSPECTION_SCHEMA =
  'route-real-graph-persistent-nonce-store-inspection/v3';
export const CONTROLLER_TRACE_CLAIM_SCHEMA = 'route-real-graph-controller-trace-claim/v6';
export const CONTROLLER_TRACE_INSPECTION_SCHEMA =
  'route-real-graph-controller-trace-inspection/v6';
export const CONTROLLER_ACQUISITION_PLAN_SCHEMA =
  'route-real-graph-controller-acquisition-plan/v1';
export const CONTROLLER_EXTRACTION_PLAN_SCHEMA =
  'route-real-graph-controller-extraction-plan/v2';
export const CONTROLLER_PHASE_BINDING_SCHEMA =
  'route-real-graph-controller-phase-binding/v1';
export const CONTROLLER_EVIDENCE_BINDING_SCHEMA =
  'route-real-graph-controller-evidence-binding/v2';
export const CONTROLLER_STATUS_SCHEMA = 'route-real-graph-controller-status/v1';
export const CONTROLLER_RUNTIME_CAPABILITY_SCHEMA =
  'route-real-graph-controller-runtime-capability/v1';

export const CONTROLLER_TOOL_ROOT_RELATIVE =
  'output/route-real-graph-tools-private/osmium-tool-1.19.1-win-64';
export const CONTROLLER_CURL_ROOT_RELATIVE =
  'output/route-real-graph-tools-private/curl-supervisor-observed';
export const CONTROLLER_STATE_ROOT_RELATIVE =
  'output/route-real-graph-build-private/controller-state-v1';

export const CONTROLLER_PROCESS_CONSTRAINTS = freezeData({
  shell: false,
  windowsHide: true,
  stdin: 'ignore',
  environmentMode: 'exact-allowlist-no-caller-inheritance',
  environmentKeys: ['SystemRoot', 'TEMP', 'TMP'],
  successExitCodes: [0],
  retryAllowed: false,
  fallbackAllowed: false,
  responseFilesAllowed: false,
  pathLookupAllowed: false,
  stdoutLimitBytes: 1_048_576,
  stderrLimitBytes: 1_048_576,
  deadlineComparison: 'ordinary-events-strictly-before-deadline',
  treeContainment: 'windows-job-object-capability-required-currently-unavailable',
}, 'RD-G exact future process constraints');

export const CONTROLLER_NORMALIZATION_BINDING = freezeData({
  schema: 'route-real-graph-controller-normalization-binding/v1',
  bridgeMechanicsIdentity: OPL_DISTANCE_MECHANICS_IDENTITY,
  trustedBuildEvidenceSchema: TRUSTED_BUILD_EVIDENCE_SCHEMA,
  rdBProfileSchema: OSM_WALK_PROFILE_SCHEMA,
  rdBProfileIdentity: OSM_WALK_PROFILE_IDENTITY,
  rdBIntermediateSchema: OSM_INTERMEDIATE_SCHEMA,
  rdBAdapterResultSchema: OSM_ADAPTER_RESULT_SCHEMA,
  requiredResultIdentities: [
    'bridgeIdentity',
    'bridgeMetadataIdentity',
    'rdBIntermediateIdentity',
    'rdBAdapterIdentity',
    'rdBTopologyIdentity',
    'rdBGeometryIdentity',
  ],
}, 'RD-F and RD-B normalization contract binding');

export const CONTROLLER_CLAIMS = freezeData({
  unifiedSourcePlanImplemented: false,
  progressivePhasePlansImplemented: true,
  persistentStoreContractImplemented: true,
  persistentStoreEventSequenceImplemented: true,
  strictTraceGrammarImplemented: false,
  strictSuccessfulEvidenceTraceGrammarImplemented: true,
  canonicalPhaseBindingImplemented: true,
  canonicalEvidenceBindingImplemented: true,
  successfulEvidenceClosureTraceImplemented: true,
  successfulTraceBindsCompletionStore: true,
  installedControllerObserved: false,
  installedToolAdmitted: false,
  commandAuthorization: false,
  commandsRunnable: false,
  liveFilesystemCapability: false,
  liveProcessCapability: false,
  actualAcquisition: false,
  actualExtraction: false,
  actualIntermediate: false,
  actualGraph: false,
  sourceHealthCurrent: false,
  runtimeAuthorized: false,
  publicationAuthorized: false,
}, 'RD-G source-only claims');

export const CONTROLLER_LIMITATIONS = Object.freeze([
  'Caller JSON, hashes, version text, paths, manifests, and internally consistent traces are validation-only claims and never execution authority.',
  'All controller, osmium, curl, persistent-store, live-release, build-evidence, bridge, and graph-authority registries remain empty and expose no mutation seam.',
  'The source-only plan and grammar do not execute a process, access the network, acquire or parse PBF, write shared output, or install a positive observation.',
  'The acquisition pre-run plan binds only the canonical RD-A/RD-E three-document chain; the extraction pre-run plan additionally binds its exact predecessor store snapshot, persisted acquisition plan/result terminal, receipt, extraction release, and five-document phase closure.',
  'A successful trace additionally requires the canonical RD-F six-document evidence closure and binds both progressive plans, three exact persistent-store snapshots, and both monotonic append-only transitions.',
  'A successful controller trace equals the canonical projection of the exact RD-A/RD-E/RD-F evidence chain; the projection remains caller-only and cannot attest that its process, file, or clock claims occurred.',
  'Failed, crashed, and expired live traces remain unavailable until the separately reviewed native controller can produce durable state and Job Object evidence; the successful evidence-closure parser cannot be used for those terminal states.',
  'Windows Job Object tree containment, handle-level reparse-safe no-follow access, durable directory commit, and atomic no-replace promotion remain unavailable until a separately reviewed native capability proves them.',
  'Each nonce is an append-only event stream with consumption ordinal exactly one and one-to-one nonce, release, and lease identities; terminal states are final, and recovery requires a new release and nonce.',
  'Successful terminals must strictly follow their bound evidence and must be strictly earlier than the next release issuance or current lease deadline; equality fails closed.',
  'No result establishes Source Health current, real graph admission, runtime, product, performance, publication, or deployment readiness.',
]);

export function deriveControllerToolPaths(workspaceRootAbsolute) {
  if (arguments.length !== 1) fail('controller-tool-path-arguments', 'controller tool path derivation accepts one argument');
  const root = admitWorkspaceRoot(workspaceRootAbsolute);
  const toolRootAbsolute = joinFrozen(root, CONTROLLER_TOOL_ROOT_RELATIVE);
  const installedPrefixAbsolute = joinFrozen(toolRootAbsolute, 'prefix');
  return freezeData({
    workspaceRootAbsolute: root,
    toolRootAbsolute,
    packageAbsolutePath: joinFrozen(
      toolRootAbsolute,
      'packages/osmium-tool-1.19.1-h60971b7_0.conda',
    ),
    installedPrefixAbsolute,
    binaryAbsolutePath: joinFrozen(installedPrefixAbsolute, 'Library/bin/osmium.exe'),
    manifestAbsolutePath: joinFrozen(
      toolRootAbsolute,
      'observations/controller-osmium-installation-manifest-v1.json',
    ),
  }, 'RD-G frozen private osmium paths');
}

export function deriveControllerCurlPaths(workspaceRootAbsolute) {
  if (arguments.length !== 1) fail('controller-curl-path-arguments', 'controller curl path derivation accepts one argument');
  const root = admitWorkspaceRoot(workspaceRootAbsolute);
  const curlRootAbsolute = joinFrozen(root, CONTROLLER_CURL_ROOT_RELATIVE);
  return freezeData({
    workspaceRootAbsolute: root,
    curlRootAbsolute,
    binaryAbsolutePath: joinFrozen(curlRootAbsolute, 'bin/curl.exe'),
  }, 'RD-G frozen private curl paths');
}

export function deriveControllerStatePaths(workspaceRootAbsolute) {
  if (arguments.length !== 1) fail('controller-state-path-arguments', 'controller state path derivation accepts one argument');
  const root = admitWorkspaceRoot(workspaceRootAbsolute);
  const stateRootAbsolute = joinFrozen(root, CONTROLLER_STATE_ROOT_RELATIVE);
  return freezeData({
    workspaceRootAbsolute: root,
    stateRootAbsolute,
    ledgerAbsolutePath: joinFrozen(stateRootAbsolute, 'persistent-nonce-ledger-v1.json'),
  }, 'RD-G frozen persistent controller state paths');
}

export function assertControllerExactPath(actual, expected, label) {
  assertCanonicalAbsolutePath(actual, label);
  if (actual !== expected) fail('controller-path-drift', `${label} drifted from its frozen path`);
  return actual;
}

function joinFrozen(root, relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.includes('\\')
    || relativePath.startsWith('/')
    || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) fail('controller-relative-path', 'controller relative path is invalid');
  const result = win32.join(root, ...relativePath.split('/'));
  assertCanonicalAbsolutePath(result, 'controller derived path');
  if (!result.startsWith(`${root}\\`)) fail('controller-path-containment', 'controller derived path escaped its root');
  return result;
}
