import { win32 } from 'node:path';
import { fail, freezeData } from '../route_graph_candidate/safe_data.mjs';

const PRIVATE_BUILD_ROOT = 'output/route-real-graph-build-private/pa-260813-philadelphia-core-v2';
const DRIVE_ROOT_SYSTEM_DIRECTORY_NAMES = Object.freeze([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
]);

export const FROZEN_RELATIVE_PATHS = freezeData({
  workingDirectory: PRIVATE_BUILD_ROOT,
  outputDirectory: PRIVATE_BUILD_ROOT,
  logPath: 'logs/route-real-graph-build-260813-philadelphia-core-v2.log',
  artifacts: {
    sourcePartial: `${PRIVATE_BUILD_ROOT}/pennsylvania-260813.osm.pbf.partial`,
    sourcePbf: `${PRIVATE_BUILD_ROOT}/pennsylvania-260813.osm.pbf`,
    sourceFileInfo: `${PRIVATE_BUILD_ROOT}/pennsylvania-260813.fileinfo.json`,
    coreBoundary: `${PRIVATE_BUILD_ROOT}/philadelphia-city-limits-core.geojson`,
    bufferBoundary: `${PRIVATE_BUILD_ROOT}/philadelphia-city-limits-buffer-1000m.geojson`,
    bufferExtractPbf: `${PRIVATE_BUILD_ROOT}/philadelphia-buffer-1000m.osm.pbf`,
    walkingFilteredPbf: `${PRIVATE_BUILD_ROOT}/philadelphia-walking-filtered.osm.pbf`,
    intermediateOpl: `${PRIVATE_BUILD_ROOT}/philadelphia-walking-intermediate.osm.opl`,
    intermediateFileInfo: `${PRIVATE_BUILD_ROOT}/philadelphia-walking-intermediate.fileinfo.json`,
    buildEvidence: `${PRIVATE_BUILD_ROOT}/route-real-graph-build-evidence.json`,
  },
}, 'frozen route real graph relative paths');

export function admitWorkspaceRoot(workspaceRootAbsolute) {
  assertPrimitivePath(workspaceRootAbsolute, 'workspace root');
  if (workspaceRootAbsolute.startsWith('\\\\')) {
    fail('workspace-root-unc', 'workspace root must not be a UNC path');
  }
  if (!/^[A-Z]:\\/.test(workspaceRootAbsolute)) {
    fail('workspace-root-drive', 'workspace root must use an uppercase Windows drive path');
  }
  if (workspaceRootAbsolute.includes('/')) {
    fail('workspace-root-separator', 'workspace root must use canonical Windows separators');
  }
  if (win32.normalize(workspaceRootAbsolute) !== workspaceRootAbsolute) {
    fail('workspace-root-normalization', 'workspace root must already be normalized');
  }
  const parsed = win32.parse(workspaceRootAbsolute);
  const segments = workspaceRootAbsolute.slice(parsed.root.length).split('\\');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail('workspace-root-segment', 'workspace root contains an empty or relative segment');
  }
  if (segments.some(hasInvalidWindowsSegment)) {
    fail('workspace-root-segment', 'workspace root contains an invalid Windows segment');
  }
  if (segments.some(hasShortNameAlias)) {
    fail('workspace-root-short-name', 'workspace root must not contain a DOS 8.3 short-name alias');
  }
  if (DRIVE_ROOT_SYSTEM_DIRECTORY_NAMES.includes(segments[0].toLowerCase())) {
    fail('workspace-root-system', 'workspace root must not be inside a Windows system directory');
  }
  if (segments.at(-1) !== 'engagement_project') {
    fail('workspace-root-project', 'workspace root must end with exact engagement_project casing');
  }
  return workspaceRootAbsolute;
}

export function deriveWorkspacePaths(workspaceRootAbsolute) {
  const root = admitWorkspaceRoot(workspaceRootAbsolute);
  return freezeData({
    workspaceRootAbsolute: root,
    workingDirectoryAbsolute: joinFrozen(root, FROZEN_RELATIVE_PATHS.workingDirectory),
    outputDirectoryAbsolute: joinFrozen(root, FROZEN_RELATIVE_PATHS.outputDirectory),
    logPathAbsolute: joinFrozen(root, FROZEN_RELATIVE_PATHS.logPath),
    artifacts: Object.fromEntries(
      Object.entries(FROZEN_RELATIVE_PATHS.artifacts).map(([key, value]) => [key, joinFrozen(root, value)]),
    ),
  }, 'derived route real graph workspace paths');
}

export function assertExactWorkspacePath(actual, expected, label) {
  assertPrimitivePath(expected, 'expected workspace path');
  assertPrimitiveLabel(label);
  assertCanonicalAbsolutePath(actual, label);
  if (actual !== expected) fail('path-slot-drift', `${label} does not equal its frozen workspace slot`);
  return actual;
}

export function assertCanonicalAbsolutePath(value, label) {
  assertPrimitiveLabel(label);
  assertPrimitivePath(value, label);
  if (value.startsWith('\\\\')) fail('absolute-path-unc', `${label} must not be UNC`);
  if (!/^[A-Z]:\\/.test(value) || value.includes('/')) {
    fail('absolute-path-format', `${label} must be a canonical uppercase-drive Windows path`);
  }
  if (win32.normalize(value) !== value) fail('absolute-path-normalization', `${label} is not normalized`);
  const parsed = win32.parse(value);
  const segments = value.slice(parsed.root.length).split('\\');
  if (segments.some(hasInvalidWindowsSegment)) {
    fail('absolute-path-segment', `${label} contains an invalid Windows path segment`);
  }
  if (segments.some(hasShortNameAlias)) {
    fail('absolute-path-short-name', `${label} must not contain a DOS 8.3 short-name alias`);
  }
  return value;
}

function joinFrozen(root, relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.includes('\\')
    || relativePath.startsWith('/')
    || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    fail('relative-path-policy', 'frozen relative path is invalid');
  }
  const result = win32.join(root, ...relativePath.split('/'));
  assertCanonicalAbsolutePath(result, 'derived workspace path');
  const containmentPrefix = `${root}\\`;
  if (!result.startsWith(containmentPrefix)) {
    fail('path-containment', 'derived workspace path escaped the installed workspace root');
  }
  return result;
}

function assertPrimitivePath(value, label) {
  assertPrimitiveLabel(label);
  if (typeof value !== 'string' || !value || value.length > 1_024 || value.includes('\0')) {
    fail('path-text-required', `${label} must be bounded primitive path text`);
  }
}

function assertPrimitiveLabel(label) {
  if (typeof label !== 'string' || !label || label.length > 160) {
    fail('path-label-required', 'path validator label must be bounded primitive text');
  }
}

function hasInvalidWindowsSegment(segment) {
  return !segment
    || segment === '.'
    || segment === '..'
    || /[ .]$/.test(segment)
    || /[<>:"|?*\u0000-\u001f]/u.test(segment)
    || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(segment);
}

function hasShortNameAlias(segment) {
  return segment.includes('~');
}
