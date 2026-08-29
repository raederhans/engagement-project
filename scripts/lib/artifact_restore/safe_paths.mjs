import fs from 'node:fs/promises';
import path from 'node:path';

import { restoreError } from './errors.mjs';

const WINDOWS_DEVICE_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function validateRelativeArtifactPath(value, label = 'artifact path') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw restoreError('INVALID_ARTIFACT_PATH', `${label} must be a non-empty bounded string.`);
  }
  if (value.includes(String.fromCharCode(0))) {
    throw restoreError('UNSAFE_ARTIFACT_PATH', `${label} must not contain NUL bytes.`);
  }
  if (value.includes('\0') || value.includes('\\')) {
    throw restoreError(
      'UNSAFE_ARTIFACT_PATH',
      `${label} must use canonical forward-slash relative syntax.`,
    );
  }
  if (value.startsWith('/') || value.endsWith('/') || /^[a-zA-Z]:/.test(value)
    || value.startsWith('//') || value.startsWith('\\\\?\\') || value.startsWith('\\\\.\\')) {
    throw restoreError('UNSAFE_ARTIFACT_PATH', `${label} must not be absolute or device-qualified.`);
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw restoreError('UNSAFE_ARTIFACT_PATH', `${label} contains an unsafe path segment.`);
  }
  for (const segment of segments) {
    if (segment.endsWith('.') || segment.endsWith(' ') || segment.includes(':')
      || WINDOWS_DEVICE_SEGMENT.test(segment)) {
      throw restoreError('UNSAFE_ARTIFACT_PATH', `${label} is not portable across supported filesystems.`);
    }
  }
  return segments.join('/');
}

export function canonicalTargetKey(relativePath, platform = process.platform) {
  const validated = validateRelativeArtifactPath(relativePath);
  return platform === 'win32' ? validated.toLowerCase() : validated;
}

export function resolveArtifactPath(root, relativePath) {
  const validated = validateRelativeArtifactPath(relativePath);
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, ...validated.split('/'));
  if (!isWithin(absoluteRoot, candidate)) {
    throw restoreError('ARTIFACT_PATH_ESCAPE', 'Artifact path escapes the requested root.');
  }
  return candidate;
}

export async function assertSafeExistingDirectory(directory, {
  fileSystem = fs,
  label = 'directory',
} = {}) {
  const absolute = path.resolve(directory);
  await assertNoLinkComponents(absolute, {
    fileSystem,
    allowMissingTail: false,
    finalKind: 'directory',
    label,
  });
  return absolute;
}

export async function assertSafeArtifactRoot(root, {
  fileSystem = fs,
  allowMissing = false,
  label = 'artifact root',
} = {}) {
  const absolute = path.resolve(root);
  const result = await assertNoLinkComponents(absolute, {
    fileSystem,
    allowMissingTail: allowMissing,
    finalKind: 'directory',
    label,
  });
  if (!result.exists && !allowMissing) {
    throw restoreError('MISSING_ARTIFACT_ROOT', `${label} does not exist.`);
  }
  if (!result.exists && result.deepestExisting !== path.dirname(absolute)) {
    throw restoreError(
      'MISSING_ARTIFACT_PARENT',
      `${label} may be absent only when its direct parent already exists.`,
    );
  }
  return Object.freeze({ absolute, exists: result.exists });
}

export async function assertSafeFileWithinRoot(root, relativePath, {
  fileSystem = fs,
  label = 'artifact file',
} = {}) {
  const absoluteRoot = await assertSafeExistingDirectory(root, { fileSystem, label: `${label} root` });
  const absolute = resolveArtifactPath(absoluteRoot, relativePath);
  const result = await assertNoLinkComponents(absolute, {
    fileSystem,
    allowMissingTail: false,
    finalKind: 'file',
    label,
  });
  const [rootReal, fileReal] = await Promise.all([
    fileSystem.realpath(absoluteRoot),
    fileSystem.realpath(absolute),
  ]);
  if (!isWithin(rootReal, fileReal)) {
    throw restoreError('ARTIFACT_REALPATH_ESCAPE', `${label} resolves outside its declared root.`);
  }
  return Object.freeze({ absolute, real: fileReal, stat: result.finalStat });
}

export async function assertSafeDestinationWithinRoot(root, relativePath, {
  fileSystem = fs,
  label = 'artifact destination',
} = {}) {
  const absoluteRoot = await assertSafeExistingDirectory(root, { fileSystem, label: `${label} root` });
  const absolute = resolveArtifactPath(absoluteRoot, relativePath);
  const parent = path.dirname(absolute);
  await assertNoLinkComponents(parent, {
    fileSystem,
    allowMissingTail: true,
    finalKind: 'directory',
    label: `${label} parent`,
  });
  return Object.freeze({ absolute, parent });
}

export function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..'
    && !path.isAbsolute(relative));
}

async function assertNoLinkComponents(absolutePath, {
  fileSystem,
  allowMissingTail,
  finalKind,
  label,
}) {
  const absolute = path.resolve(absolutePath);
  const parsed = path.parse(absolute);
  const relative = absolute.slice(parsed.root.length);
  const segments = relative.split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  let deepestExisting = parsed.root;
  let missing = false;
  let finalStat;

  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    if (missing) continue;
    try {
      const stat = await fileSystem.lstat(cursor);
      if (stat.isSymbolicLink?.()) {
        throw restoreError('SYMLINK_OR_REPARSE', `${label} contains a symlink or reparse point.`);
      }
      deepestExisting = cursor;
      finalStat = stat;
    } catch (error) {
      if (error?.code === 'ENOENT' && allowMissingTail) {
        missing = true;
        finalStat = undefined;
        continue;
      }
      throw error;
    }
  }

  const exists = !missing;
  if (exists && finalKind === 'directory' && !finalStat?.isDirectory?.()) {
    throw restoreError('UNSAFE_ARTIFACT_ROOT', `${label} must be a real directory.`);
  }
  if (exists && finalKind === 'file' && !finalStat?.isFile?.()) {
    throw restoreError('UNSAFE_ARTIFACT_FILE', `${label} must be a regular file.`);
  }
  return Object.freeze({ absolute, exists, deepestExisting, finalStat });
}
