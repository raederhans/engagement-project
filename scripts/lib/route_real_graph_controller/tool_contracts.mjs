import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  boundedText,
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  exactTimestamp,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import {
  EXTRACTOR_PACKAGE_FILENAME,
  EXTRACTOR_TOOL_ID,
  EXTRACTOR_VERSION,
} from '../route_real_graph_build/contracts.mjs';
import { parseContractJsonText } from '../route_real_graph_build/bounded_json.mjs';
import {
  CONTROLLER_CLAIMS,
  CONTROLLER_LIMITATIONS,
  DOWNLOAD_TRANSPORT_OBSERVATION_CLAIM_SCHEMA,
  INSTALLED_TOOL_OBSERVATION_CLAIM_SCHEMA,
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  assertControllerExactPath,
  deriveControllerCurlPaths,
  deriveControllerToolPaths,
} from './contracts.mjs';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FILE_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export function parseInstalledToolObservationClaim(jsonText) {
  requirePrimitiveJsonText(jsonText, arguments.length, 1, 'installed-tool-json-arguments');
  const claim = exactDataObject(parseContractJsonText(jsonText), [
    'schema', 'claimId', 'policyIdentity', 'workspaceRootAbsolute', 'toolId',
    'package', 'installationManifest', 'binaryBeforeVersion', 'version',
    'binaryAfterVersion', 'bindings', 'claims', 'limitations',
  ], 'installed osmium observation claim');
  if (claim.schema !== INSTALLED_TOOL_OBSERVATION_CLAIM_SCHEMA) fail('installed-tool-schema', 'installed osmium observation schema is unsupported');
  exactClaimHeader(claim, EXTRACTOR_TOOL_ID, 'installed osmium');
  const paths = deriveControllerToolPaths(claim.workspaceRootAbsolute);
  claim.package = admitClosedFileObservation(claim.package, paths.packageAbsolutePath, 'osmium package');
  claim.installationManifest = admitInstallationManifestCapture(
    claim.installationManifest,
    paths.manifestAbsolutePath,
    claim.package,
    paths,
  );
  claim.binaryBeforeVersion = admitClosedFileObservation(
    claim.binaryBeforeVersion,
    paths.binaryAbsolutePath,
    'osmium binary before version',
  );
  claim.version = admitVersionObservation(
    claim.version,
    paths.binaryAbsolutePath,
    'osmium',
    EXTRACTOR_VERSION,
    /^osmium version 1\.19\.1(?:\n|$)/u,
  );
  claim.binaryAfterVersion = admitClosedFileObservation(
    claim.binaryAfterVersion,
    paths.binaryAbsolutePath,
    'osmium binary after version',
  );
  assertFileObservationStable(claim.binaryBeforeVersion, claim.binaryAfterVersion, 'osmium binary');
  assertClockChain([
    claim.package.observedAt,
    claim.installationManifest.observedAt,
    claim.binaryBeforeVersion.observedAt,
    claim.version.startedAt,
    claim.version.endedAt,
    claim.binaryAfterVersion.observedAt,
  ], 'osmium observation chain');
  bindExactIdentities(claim, {
    packageObservationIdentity: contentIdentity(claim.package),
    installationManifestIdentity: contentIdentity(claim.installationManifest),
    binaryBeforeVersionIdentity: contentIdentity(claim.binaryBeforeVersion),
    versionObservationIdentity: contentIdentity(claim.version),
    binaryAfterVersionIdentity: contentIdentity(claim.binaryAfterVersion),
  }, 'osmium');
  exactClaimBoundary(claim);
  return freezeData(claim, 'validated caller osmium observation claim');
}

export function installedToolObservationClaimIdentity(jsonText) {
  if (arguments.length !== 1) fail('installed-tool-identity-arguments', 'installed-tool identity accepts one JSON text argument');
  return contentIdentity(parseInstalledToolObservationClaim(jsonText));
}

export function parseDownloadTransportObservationClaim(jsonText) {
  requirePrimitiveJsonText(jsonText, arguments.length, 1, 'download-transport-json-arguments');
  const claim = exactDataObject(parseContractJsonText(jsonText), [
    'schema', 'claimId', 'policyIdentity', 'workspaceRootAbsolute', 'toolId',
    'version', 'binaryBeforeVersion', 'versionObservation', 'binaryAfterVersion',
    'bindings', 'claims', 'limitations',
  ], 'installed curl observation claim');
  if (claim.schema !== DOWNLOAD_TRANSPORT_OBSERVATION_CLAIM_SCHEMA) fail('download-transport-schema', 'installed curl observation schema is unsupported');
  boundedText(claim.version, 'curl version', { max: 40, pattern: /^\d+(?:\.\d+){1,3}$/ });
  exactClaimHeader(claim, `curl/${claim.version}/supervisor-observed`, 'installed curl');
  const paths = deriveControllerCurlPaths(claim.workspaceRootAbsolute);
  claim.binaryBeforeVersion = admitClosedFileObservation(
    claim.binaryBeforeVersion,
    paths.binaryAbsolutePath,
    'curl binary before version',
  );
  claim.versionObservation = admitVersionObservation(
    claim.versionObservation,
    paths.binaryAbsolutePath,
    'curl',
    claim.version,
    new RegExp(`^curl ${escapeRegex(claim.version)}(?:[ .\\n]|$)`, 'u'),
  );
  claim.binaryAfterVersion = admitClosedFileObservation(
    claim.binaryAfterVersion,
    paths.binaryAbsolutePath,
    'curl binary after version',
  );
  assertFileObservationStable(claim.binaryBeforeVersion, claim.binaryAfterVersion, 'curl binary');
  assertClockChain([
    claim.binaryBeforeVersion.observedAt,
    claim.versionObservation.startedAt,
    claim.versionObservation.endedAt,
    claim.binaryAfterVersion.observedAt,
  ], 'curl observation chain');
  bindExactIdentities(claim, {
    binaryBeforeVersionIdentity: contentIdentity(claim.binaryBeforeVersion),
    versionObservationIdentity: contentIdentity(claim.versionObservation),
    binaryAfterVersionIdentity: contentIdentity(claim.binaryAfterVersion),
  }, 'curl');
  exactClaimBoundary(claim);
  return freezeData(claim, 'validated caller curl observation claim');
}

export function downloadTransportObservationClaimIdentity(jsonText) {
  if (arguments.length !== 1) fail('download-transport-identity-arguments', 'download transport identity accepts one JSON text argument');
  return contentIdentity(parseDownloadTransportObservationClaim(jsonText));
}

function exactClaimHeader(claim, expectedToolId, label) {
  boundedText(claim.claimId, `${label} claimId`, { max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ });
  exactSha256(claim.policyIdentity, `${label} policy identity`);
  if (claim.policyIdentity !== ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY) fail('tool-policy-drift', `${label} policy identity drifted`);
  if (claim.toolId !== expectedToolId) fail('tool-id-drift', `${label} tool identity drifted`);
}

function exactClaimBoundary(claim) {
  if (canonicalStringify(claim.claims) !== canonicalStringify(CONTROLLER_CLAIMS)) fail('controller-claims-drift', 'tool claim changed the source-only claim boundary');
  if (canonicalStringify(claim.limitations) !== canonicalStringify(CONTROLLER_LIMITATIONS)) fail('controller-limitations-drift', 'tool claim limitations drifted');
}

function admitClosedFileObservation(value, expectedPath, label) {
  const observation = exactDataObject(value, [
    'absolutePath', 'sha256', 'byteCount', 'fileIdentity', 'observedAt',
    'closedBeforeObservation', 'flushedBeforeObservation',
    'completeByteTraversal', 'reparsePoint',
  ], `${label} closed-file observation`);
  assertControllerExactPath(observation.absolutePath, expectedPath, `${label}.absolutePath`);
  exactSha256(observation.sha256, `${label}.sha256`);
  exactPositiveByteCount(observation.byteCount, `${label}.byteCount`);
  boundedText(observation.fileIdentity, `${label}.fileIdentity`, { max: 160, pattern: FILE_IDENTITY_PATTERN });
  exactTimestamp(observation.observedAt, `${label}.observedAt`);
  exactTrue(observation.closedBeforeObservation, `${label}.closedBeforeObservation`);
  exactTrue(observation.flushedBeforeObservation, `${label}.flushedBeforeObservation`);
  exactTrue(observation.completeByteTraversal, `${label}.completeByteTraversal`);
  exactFalse(observation.reparsePoint, `${label}.reparsePoint`);
  return observation;
}

function admitInstallationManifestCapture(value, expectedPath, packageObservation, paths) {
  const capture = admitExactCapture(value, expectedPath, 'osmium installation manifest', 131_072);
  let manifestText;
  try {
    manifestText = Buffer.from(capture.base64, 'base64').toString('utf8');
    if (Buffer.from(manifestText, 'utf8').toString('base64') !== capture.base64) throw new Error('roundtrip');
  } catch {
    fail('installation-manifest-utf8', 'installation manifest must be exact well-formed UTF-8');
  }
  const manifest = exactDataObject(parseContractJsonText(manifestText), [
    'schema', 'name', 'version', 'build', 'subdir', 'channel', 'packageFilename',
    'packageObservationIdentity', 'installedPrefixAbsolute', 'binaryRelativePath',
  ], 'controller osmium installation manifest');
  if (
    manifest.schema !== 'route-real-graph-controller-osmium-installation-manifest/v1'
    || manifest.name !== 'osmium-tool'
    || manifest.version !== EXTRACTOR_VERSION
    || manifest.build !== 'h60971b7_0'
    || manifest.subdir !== 'win-64'
    || manifest.channel !== 'conda-forge'
    || manifest.packageFilename !== EXTRACTOR_PACKAGE_FILENAME
    || manifest.packageObservationIdentity !== contentIdentity(packageObservation)
    || manifest.installedPrefixAbsolute !== paths.installedPrefixAbsolute
    || manifest.binaryRelativePath !== 'Library\\bin\\osmium.exe'
  ) fail('installation-manifest-drift', 'installation manifest does not bind the exact package and installed binary slot');
  return capture;
}

function admitExactCapture(value, expectedPath, label, maximumBytes) {
  const capture = exactDataObject(value, [
    'absolutePath', 'encoding', 'base64', 'sha256', 'byteCount', 'observedAt',
    'closedBeforeObservation', 'flushedBeforeObservation',
    'completeByteTraversal', 'reparsePoint', 'truncated',
  ], `${label} capture`);
  assertControllerExactPath(capture.absolutePath, expectedPath, `${label}.absolutePath`);
  if (capture.encoding !== 'base64') fail('capture-encoding', `${label} must use base64`);
  const bytes = decodeCanonicalBase64(capture.base64, label, maximumBytes);
  if (capture.byteCount !== bytes.length || bytes.length === 0) fail('capture-byte-count', `${label} byte count drifted`);
  exactSha256(capture.sha256, `${label}.sha256`);
  if (capture.sha256 !== sha256Bytes(bytes)) fail('capture-sha256', `${label} SHA-256 was not recomputed`);
  exactTimestamp(capture.observedAt, `${label}.observedAt`);
  exactTrue(capture.closedBeforeObservation, `${label}.closedBeforeObservation`);
  exactTrue(capture.flushedBeforeObservation, `${label}.flushedBeforeObservation`);
  exactTrue(capture.completeByteTraversal, `${label}.completeByteTraversal`);
  exactFalse(capture.reparsePoint, `${label}.reparsePoint`);
  exactFalse(capture.truncated, `${label}.truncated`);
  return capture;
}

function admitVersionObservation(value, expectedBinaryPath, toolName, expectedVersion, outputPattern) {
  const observation = exactDataObject(value, [
    'executableAbsolutePath', 'argv', 'stdout', 'stderr', 'exitCode', 'signal',
    'startedAt', 'endedAt', 'parsedVersion', 'shell', 'windowsHide', 'stdin',
    'retryUsed', 'fallbackUsed',
  ], `${toolName} version observation`);
  assertControllerExactPath(observation.executableAbsolutePath, expectedBinaryPath, `${toolName} version executable`);
  if (!Array.isArray(observation.argv) || canonicalStringify(observation.argv) !== '["--version"]') fail('version-argv-drift', `${toolName} version argv must be exactly [--version]`);
  observation.stdout = admitInlineCapture(observation.stdout, `${toolName} version stdout`);
  observation.stderr = admitInlineCapture(observation.stderr, `${toolName} version stderr`);
  if (observation.exitCode !== 0 || observation.signal !== null) fail('version-exit', `${toolName} version command did not exit exactly 0`);
  exactTimestamp(observation.startedAt, `${toolName} version startedAt`);
  exactTimestamp(observation.endedAt, `${toolName} version endedAt`);
  if (observation.parsedVersion !== expectedVersion) fail('version-drift', `${toolName} parsed version drifted`);
  const stdoutText = Buffer.from(observation.stdout.base64, 'base64').toString('utf8');
  if (!outputPattern.test(stdoutText) || stdoutText.includes('\r') || stdoutText.includes('\0')) fail('version-output', `${toolName} version stdout drifted`);
  exactFalse(observation.shell, `${toolName} version shell`);
  exactTrue(observation.windowsHide, `${toolName} version windowsHide`);
  if (observation.stdin !== 'ignore') fail('version-stdin', `${toolName} version stdin must be ignored`);
  exactFalse(observation.retryUsed, `${toolName} version retryUsed`);
  exactFalse(observation.fallbackUsed, `${toolName} version fallbackUsed`);
  return observation;
}

function admitInlineCapture(value, label) {
  const capture = exactDataObject(value, ['encoding', 'base64', 'sha256', 'byteCount', 'truncated'], label);
  if (capture.encoding !== 'base64') fail('capture-encoding', `${label} must use base64`);
  const bytes = decodeCanonicalBase64(capture.base64, label, 32_768);
  if (capture.byteCount !== bytes.length) fail('capture-byte-count', `${label} byte count drifted`);
  exactSha256(capture.sha256, `${label}.sha256`);
  if (capture.sha256 !== sha256Bytes(bytes)) fail('capture-sha256', `${label} SHA-256 drifted`);
  exactFalse(capture.truncated, `${label}.truncated`);
  return capture;
}

function assertFileObservationStable(before, after, label) {
  for (const key of ['absolutePath', 'sha256', 'byteCount', 'fileIdentity']) {
    if (before[key] !== after[key]) fail('tool-post-version-drift', `${label} changed across version execution`);
  }
}

function assertClockChain(clocks, label) {
  for (let index = 1; index < clocks.length; index += 1) {
    if (Date.parse(clocks[index]) < Date.parse(clocks[index - 1])) fail('tool-clock-order', `${label} moved backwards`);
  }
}

function bindExactIdentities(claim, expected, label) {
  claim.bindings = exactDataObject(claim.bindings, Object.keys(expected), `${label} bindings`);
  if (canonicalStringify(claim.bindings) !== canonicalStringify(expected)) fail('tool-binding-drift', `${label} observation identities were not recomputed`);
}

function decodeCanonicalBase64(value, label, maximumBytes) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximumBytes / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('capture-base64', `${label} must be bounded canonical base64`);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maximumBytes || bytes.toString('base64') !== value) fail('capture-base64', `${label} must be bounded canonical base64`);
  return bytes;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function exactSha256(value, label) {
  return boundedText(value, label, { max: 71, pattern: SHA256_PATTERN });
}

function exactPositiveByteCount(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('invalid-byte-count', `${label} must be a positive safe integer`);
}

function exactTrue(value, label) {
  if (value !== true) fail('boolean-true-required', `${label} must be true`);
}

function exactFalse(value, label) {
  if (value !== false) fail('boolean-false-required', `${label} must be false`);
}

function requirePrimitiveJsonText(value, actualArguments, expectedArguments, code) {
  if (typeof value !== 'string') fail('json-text-required', 'tool observation ingress requires primitive JSON text');
  if (actualArguments !== expectedArguments) fail(code, 'tool observation ingress received unsupported arguments');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
