import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseRestoreRegistry,
  planArtifactRestore,
  restoreArtifacts,
  verifyArtifactRestore,
} from './lib/artifact_restore/index.mjs';
import { restoreError } from './lib/artifact_restore/errors.mjs';
import {
  assertSafeExistingDirectory,
  assertSafeFileWithinRoot,
} from './lib/artifact_restore/safe_paths.mjs';

const MODES = new Set(['plan', 'restore', 'verify']);
const OPTION_NAMES = new Set([
  'registry',
  'target',
  'location',
  'file-location-root',
  'concurrency',
  'registry-sha256',
  'registry-identity',
]);
const FLAG_NAMES = new Set(['replace-existing']);

export async function main(argv, {
  fileSystem = fs,
  fetchImpl = globalThis.fetch,
  promote = undefined,
  parseArtifactRegistry = undefined,
  stdout = process.stdout,
} = {}) {
  const options = parseArguments(argv);
  const registryPath = path.resolve(options.registry);
  const registryDirectory = path.dirname(registryPath);
  await assertSafeFileWithinRoot(registryDirectory, path.basename(registryPath), {
    fileSystem,
    label: 'artifact registry',
  });
  const registryBytes = await fileSystem.readFile(registryPath);
  const observedRegistrySha256 = createHash('sha256').update(registryBytes).digest('hex');
  if (options.registrySha256 !== undefined
    && observedRegistrySha256 !== options.registrySha256) {
    throw restoreError(
      'REGISTRY_SHA256_MISMATCH',
      'Artifact registry raw bytes do not match --registry-sha256.',
    );
  }
  const registry = await parseRestoreRegistry(
    registryBytes.toString('utf8'),
    { locationScheme: options.location },
    { parseArtifactRegistry },
  );
  if (options.registryIdentity !== undefined
    && registry.registry_identity !== options.registryIdentity) {
    throw restoreError(
      'REGISTRY_IDENTITY_MISMATCH',
      'Artifact registry canonical identity does not match --registry-identity.',
    );
  }
  if (options.fileLocationRoot !== undefined && registry.location_scheme !== 'file') {
    throw restoreError(
      'FILE_LOCATION_ROOT_FORBIDDEN',
      '--file-location-root is valid only for a selected file location.',
    );
  }
  const fileLocationRoot = path.resolve(options.fileLocationRoot ?? registryDirectory);
  if (registry.location_scheme === 'file') {
    await assertSafeExistingDirectory(fileLocationRoot, {
      fileSystem,
      label: 'file artifact location root',
    });
  }
  const common = {
    registry,
    targetRoot: path.resolve(options.target),
    concurrency: options.concurrency,
    fileSystem,
  };

  let result;
  if (options.mode === 'plan') {
    result = await planArtifactRestore(common);
  } else if (options.mode === 'verify') {
    result = await verifyArtifactRestore(common);
  } else {
    result = await restoreArtifacts({
      ...common,
      fileLocationRoot,
      fetchImpl,
      replaceExisting: options.replaceExisting,
      ...(promote === undefined ? {} : { promote }),
    });
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function parseArguments(argv) {
  if (!Array.isArray(argv) || !MODES.has(argv[0])) {
    throw restoreError(
      'MODE_REQUIRED',
      'First argument must explicitly select plan, restore, or verify.',
    );
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== 'string' || !token.startsWith('--')) {
      throw restoreError('INVALID_ARGUMENT', 'Artifact restore accepts only named options after mode.');
    }
    const separator = token.indexOf('=');
    const name = token.slice(2, separator === -1 ? undefined : separator);
    if ((!OPTION_NAMES.has(name) && !FLAG_NAMES.has(name)) || Object.hasOwn(values, name)) {
      throw restoreError('INVALID_ARGUMENT', `Unknown or duplicate option --${name}.`);
    }
    if (FLAG_NAMES.has(name)) {
      if (separator !== -1) {
        throw restoreError('INVALID_ARGUMENT', `Flag --${name} does not accept a value.`);
      }
      values[name] = true;
      continue;
    }
    let value;
    if (separator !== -1) value = token.slice(separator + 1);
    else {
      index += 1;
      value = argv[index];
    }
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw restoreError('INVALID_ARGUMENT', `Option --${name} requires a value.`);
    }
    values[name] = value;
  }
  if (!values.registry || !values.target) {
    throw restoreError('MISSING_ARGUMENT', 'Both --registry and --target are required.');
  }
  if (values.location !== undefined && values.location !== 'file' && values.location !== 'https') {
    throw restoreError('INVALID_LOCATION_SELECTION', '--location must be file or https.');
  }
  if (values['replace-existing'] && argv[0] !== 'restore') {
    throw restoreError('INVALID_ARGUMENT', '--replace-existing is valid only in restore mode.');
  }
  if (values['registry-sha256'] !== undefined
    && !/^[a-f0-9]{64}$/.test(values['registry-sha256'])) {
    throw restoreError(
      'INVALID_REGISTRY_SHA256',
      '--registry-sha256 must be exactly 64 lowercase hexadecimal characters.',
    );
  }
  if (values['registry-identity'] !== undefined
    && !/^sha256:[a-f0-9]{64}$/.test(values['registry-identity'])) {
    throw restoreError(
      'INVALID_REGISTRY_IDENTITY',
      '--registry-identity must be an exact sha256 identity.',
    );
  }
  const concurrency = values.concurrency === undefined ? 4 : Number(values.concurrency);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32
    || String(concurrency) !== (values.concurrency ?? '4')) {
    throw restoreError('INVALID_CONCURRENCY', '--concurrency must be an integer between 1 and 32.');
  }
  return Object.freeze({
    mode: argv[0],
    registry: values.registry,
    target: values.target,
    location: values.location,
    fileLocationRoot: values['file-location-root'],
    registrySha256: values['registry-sha256'],
    registryIdentity: values['registry-identity'],
    replaceExisting: values['replace-existing'] === true,
    concurrency,
  });
}

export function renderCliError(error) {
  return JSON.stringify({
    protocol: 'ArtifactRestoreError/v1',
    status: 'failed',
    code: typeof error?.code === 'string' ? error.code : 'ARTIFACT_RESTORE_FAILED',
    message: typeof error?.message === 'string' ? error.message : 'Artifact restore failed.',
    ...(error?.details === undefined ? {} : { details: error.details }),
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${renderCliError(error)}\n`);
    process.exitCode = 1;
  });
}
