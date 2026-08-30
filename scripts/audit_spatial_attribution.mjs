#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertTaskOwnedDfev1Path } from './lib/dfev1_path.mjs';
import {
  buildSpatialAttributionReport,
  SPATIAL_ATTRIBUTION_REPORT_SCHEMA,
} from './lib/spatial_attribution_report.mjs';

const OPTION_NAMES = new Set(['denominator-audit', 'method-comparison', 'output']);

export async function main(argv, {
  fileSystem = fs,
  workspace = process.cwd(),
  pathGuard = assertTaskOwnedDfev1Path,
  readInput = readAggregateInput,
  buildReport = buildSpatialAttributionReport,
  publishReport = publishJsonNoOverwrite,
  createId = randomUUID,
  stdout = process.stdout,
} = {}) {
  const options = parseArguments(argv);
  const paths = {
    denominatorAudit: await pathGuard(options.denominatorAudit, {
      workspace,
      label: 'Denominator audit input',
    }),
    methodComparison: await pathGuard(options.methodComparison, {
      workspace,
      label: 'Method comparison input',
    }),
    output: await pathGuard(options.output, {
      workspace,
      label: 'Spatial attribution report output',
    }),
  };
  assertDistinctExplicitPaths(paths);
  const workspaceReal = await fileSystem.realpath(workspace);

  const [denominator, methods] = await Promise.all([
    readInput(paths.denominatorAudit, {
      fileSystem,
      label: 'denominator audit',
      allowedRoot: workspaceReal,
    }),
    readInput(paths.methodComparison, {
      fileSystem,
      label: 'method comparison',
      allowedRoot: workspaceReal,
    }),
  ]);
  const report = buildReport({
    denominatorAudit: denominator.value,
    methodComparison: methods.value,
    observedInputBytes: {
      denominator_audit: denominator.bytesIdentity,
      method_comparison: methods.bytesIdentity,
    },
  });
  const contents = `${JSON.stringify(report, null, 2)}\n`;
  await publishReport(paths.output, contents, {
    fileSystem,
    createId,
    allowedRoot: workspaceReal,
    assertDestination: () => pathGuard(paths.output, {
      workspace,
      label: 'Spatial attribution report output',
    }),
  });

  const result = Object.freeze({
    schema: 'engagement-spatial-attribution-report-cli-result/v1',
    status: 'local-attribution-audit-written',
    report_schema: SPATIAL_ATTRIBUTION_REPORT_SCHEMA,
    report_identity: report.artifact_identity,
    output: paths.output,
  });
  stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

export function parseArguments(argv) {
  if (!Array.isArray(argv)) throw cliError('INVALID_ARGUMENT', 'CLI arguments must be an array.');
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== 'string' || !token.startsWith('--')) {
      throw cliError('INVALID_ARGUMENT', 'Spatial attribution CLI accepts only named options.');
    }
    const separator = token.indexOf('=');
    const name = token.slice(2, separator === -1 ? undefined : separator);
    if (!OPTION_NAMES.has(name) || Object.hasOwn(values, name)) {
      throw cliError('INVALID_ARGUMENT', `Unknown or duplicate option --${name}.`);
    }
    let value;
    if (separator === -1) {
      index += 1;
      value = argv[index];
    } else {
      value = token.slice(separator + 1);
    }
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw cliError('INVALID_ARGUMENT', `Option --${name} requires an explicit path.`);
    }
    values[name] = value;
  }
  for (const name of OPTION_NAMES) {
    if (!Object.hasOwn(values, name)) {
      throw cliError('MISSING_ARGUMENT', `Required option --${name} was not provided.`);
    }
  }
  return Object.freeze({
    denominatorAudit: values['denominator-audit'],
    methodComparison: values['method-comparison'],
    output: values.output,
  });
}

export async function readAggregateInput(filePath, {
  fileSystem = fs,
  label = 'aggregate input',
  allowedRoot = undefined,
} = {}) {
  const lexicalStat = await fileSystem.lstat(filePath);
  if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink?.()) {
    throw cliError('UNSAFE_INPUT', `${label} must be a regular non-symbolic-link file.`);
  }
  const realPath = await fileSystem.realpath(filePath);
  if (allowedRoot !== undefined && !isInsideOrEqual(allowedRoot, realPath)) {
    throw cliError('UNSAFE_INPUT', `${label} resolved outside the current worktree.`);
  }
  const handle = await fileSystem.open(realPath, 'r');
  let before;
  let after;
  let bytes;
  try {
    before = await handle.stat();
    if (!before.isFile()) {
      throw cliError('UNSAFE_INPUT', `${label} must be a regular non-symbolic-link file.`);
    }
    bytes = await handle.readFile();
    after = await handle.stat();
  } finally {
    await handle.close();
  }
  const currentRealPath = await fileSystem.realpath(filePath);
  const currentLexical = await fileSystem.lstat(filePath);
  const current = await fileSystem.lstat(currentRealPath);
  if (!after.isFile() || currentLexical.isSymbolicLink?.() || !currentLexical.isFile()
    || current.isSymbolicLink?.() || !current.isFile()
    || !sameResolvedPath(realPath, currentRealPath)
    || !sameFileIdentity(before, after)
    || !sameFileIdentity(after, current)) {
    throw cliError('INPUT_CHANGED', `${label} changed while it was being read.`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw cliError('INVALID_JSON', `${label} is not valid JSON: ${error.message}`);
  }
  return Object.freeze({
    value,
    bytesIdentity: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  });
}

export async function publishJsonNoOverwrite(destination, contents, {
  fileSystem = fs,
  createId = randomUUID,
  assertDestination = async () => {},
  allowedRoot = undefined,
} = {}) {
  if (typeof destination !== 'string' || !destination
    || typeof contents !== 'string' || !contents) {
    throw cliError('INVALID_OUTPUT', 'Output destination and JSON contents are required.');
  }
  if (path.resolve(destination) === path.parse(path.resolve(destination)).root) {
    throw cliError('UNSAFE_OUTPUT', 'Output destination cannot be a filesystem root.');
  }
  const parent = path.dirname(destination);
  let parentStat;
  try {
    parentStat = await fileSystem.lstat(parent);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw cliError('UNSAFE_OUTPUT', 'Output parent must be an existing real directory.');
    }
    throw error;
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink?.()) {
    throw cliError('UNSAFE_OUTPUT', 'Output parent must be an existing real directory.');
  }
  await assertDestination();
  const realParent = await fileSystem.realpath(parent);
  if (allowedRoot !== undefined && !isInsideOrEqual(allowedRoot, realParent)) {
    throw cliError('UNSAFE_OUTPUT', 'Output parent resolved outside the current worktree.');
  }
  const realDestination = path.join(realParent, path.basename(destination));
  if (await exists(realDestination, fileSystem)) {
    throw cliError('OUTPUT_EXISTS', `Output already exists: ${destination}`);
  }
  const stagingToken = createId();
  if (typeof stagingToken !== 'string' || !/^[a-zA-Z0-9-]+$/.test(stagingToken)) {
    throw cliError('INVALID_STAGING_ID', 'Staging identifier is invalid.');
  }
  const staging = path.join(
    realParent,
    `.${path.basename(destination)}.staging-${stagingToken}`,
  );
  let published = false;
  let verified = false;
  let stagingIdentity;
  try {
    await fileSystem.writeFile(staging, contents, { encoding: 'utf8', flag: 'wx' });
    stagingIdentity = await fileSystem.lstat(staging);
    const stagingReal = await fileSystem.realpath(staging);
    const currentRealParent = await fileSystem.realpath(realParent);
    if (!sameResolvedPath(stagingReal, staging)
      || !sameResolvedPath(currentRealParent, realParent)
      || (allowedRoot !== undefined
        && (!isInsideOrEqual(allowedRoot, stagingReal)
          || !isInsideOrEqual(allowedRoot, currentRealParent)))) {
      throw cliError('OUTPUT_PATH_CHANGED', 'Output path changed before atomic publication.');
    }
    await fileSystem.link(staging, realDestination);
    published = true;
    await assertDestination();
    const publishedRealPath = await fileSystem.realpath(destination);
    if (!sameResolvedPath(publishedRealPath, realDestination)) {
      throw cliError('OUTPUT_PATH_CHANGED', 'Output path changed during atomic publication.');
    }
    verified = true;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw cliError('OUTPUT_EXISTS', `Output already exists: ${destination}`);
    }
    throw error;
  } finally {
    // Once path drift is observed, string-based cleanup could cross a replaced
    // junction. Preserve the staging link for manual inspection in that case.
    if (verified) {
      await removeOwnedStaging(staging, stagingIdentity, allowedRoot, fileSystem);
    }
  }
  if (!published) throw cliError('OUTPUT_NOT_PUBLISHED', 'Spatial attribution report was not published.');
  return destination;
}

export function renderCliError(error) {
  return JSON.stringify({
    protocol: 'SpatialAttributionReportError/v1',
    status: 'failed',
    code: typeof error?.code === 'string' ? error.code : 'SPATIAL_ATTRIBUTION_REPORT_FAILED',
    message: typeof error?.message === 'string'
      ? error.message
      : 'Spatial attribution report failed.',
  });
}

function assertDistinctExplicitPaths(paths) {
  const values = Object.values(paths).map((entry) => path.resolve(entry));
  if (new Set(values.map((entry) => (
    process.platform === 'win32' ? entry.toLowerCase() : entry
  ))).size !== values.length) {
    throw cliError('PATH_COLLISION', 'Both inputs and the output must use distinct explicit paths.');
  }
}

function cliError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sameFileIdentity(left, right) {
  return left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && (left.dev === undefined || right.dev === undefined || left.dev === right.dev)
    && (left.ino === undefined || right.ino === undefined || left.ino === right.ino);
}

function sameResolvedPath(left, right) {
  const leftPath = path.resolve(left);
  const rightPath = path.resolve(right);
  return process.platform === 'win32'
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

function isInsideOrEqual(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function removeOwnedStaging(staging, expected, allowedRoot, fileSystem) {
  if (!expected) return;
  try {
    const real = await fileSystem.realpath(staging);
    const stat = await fileSystem.lstat(real);
    if (!sameResolvedPath(real, staging)
      || (allowedRoot !== undefined && !isInsideOrEqual(allowedRoot, real))
      || !sameFileIdentity(expected, stat)) return;
    await fileSystem.rm(real, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') return;
  }
}

async function exists(target, fileSystem) {
  try {
    await fileSystem.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${renderCliError(error)}\n`);
    process.exitCode = 1;
  });
}
