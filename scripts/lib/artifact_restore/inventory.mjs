import fs from 'node:fs/promises';
import path from 'node:path';

import { mapBounded } from './concurrency.mjs';
import { restoreError } from './errors.mjs';
import { inspectArtifact } from './integrity.mjs';
import {
  assertSafeArtifactRoot,
  assertSafeFileWithinRoot,
  canonicalTargetKey,
  isWithin,
} from './safe_paths.mjs';

export async function inspectTargetInventory({
  registry,
  targetRoot,
  concurrency = 4,
  fileSystem = fs,
  platform = process.platform,
}) {
  const root = await assertSafeArtifactRoot(targetRoot, {
    fileSystem,
    allowMissing: true,
    label: 'artifact target root',
  });
  if (!root.exists) {
    const objects = registry.objects.map((object) => objectState(object, 'missing'));
    return freezeInventory({
      root: root.absolute,
      target_state: 'missing',
      objects,
      root_snapshot: null,
    });
  }

  const expectedFiles = new Map(registry.objects.map((object) => [
    canonicalTargetKey(object.path, platform),
    object.path,
  ]));
  const expectedDirectories = expectedDirectoryKeys(registry.objects, platform);
  const observed = await walkTarget(root.absolute, { fileSystem, platform });
  for (const entry of observed.files) {
    if (!expectedFiles.has(canonicalTargetKey(entry, platform))) {
      throw restoreError(
        'UNREGISTERED_TARGET_CONTENT',
        'Artifact target contains an unregistered file.',
        { path: entry },
      );
    }
  }
  for (const entry of observed.directories) {
    if (!expectedDirectories.has(canonicalTargetKey(entry, platform))) {
      throw restoreError(
        'UNREGISTERED_TARGET_CONTENT',
        'Artifact target contains an unregistered directory.',
        { path: entry },
      );
    }
  }

  const observedKeys = new Set(observed.files.map((entry) => canonicalTargetKey(entry, platform)));
  const objects = await mapBounded(registry.objects, concurrency, async (object) => {
    if (!observedKeys.has(canonicalTargetKey(object.path, platform))) {
      return objectState(object, 'missing');
    }
    const safe = await assertSafeFileWithinRoot(root.absolute, object.path, {
      fileSystem,
      label: object.path,
    });
    try {
      const integrity = await inspectArtifact(safe.absolute, object.expected, {
        fileSystem,
        label: object.path,
      });
      return objectState(object, 'verified', integrity);
    } catch (error) {
      if (error?.code === 'ARTIFACT_INTEGRITY_MISMATCH') {
        return objectState(
          object,
          'corrupt',
          error.details?.actual,
          error.details?.mismatches ?? [],
        );
      }
      throw error;
    }
  });

  const rootStat = await fileSystem.lstat(root.absolute);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink?.()) {
    throw restoreError('TARGET_CHANGED_DURING_SCAN', 'Artifact target changed while it was scanned.');
  }
  const targetState = objects.every(({ state }) => state === 'verified')
    ? 'complete'
    : objects.some(({ state }) => state === 'corrupt') ? 'corrupt' : 'partial';
  return freezeInventory({
    root: root.absolute,
    target_state: targetState,
    objects,
    root_snapshot: statSnapshot(rootStat),
  });
}

export function assertVerifiedInventory(inventory) {
  if (inventory.target_state !== 'complete'
    || inventory.objects.some(({ state }) => state !== 'verified')) {
    throw restoreError(
      'TARGET_NOT_VERIFIED',
      'Artifact target is missing, partial, corrupt, or otherwise unverified.',
      { target_state: inventory.target_state },
    );
  }
  return inventory;
}

export async function assertTargetSnapshot(targetRoot, snapshot, { fileSystem = fs } = {}) {
  if (snapshot === null) {
    try {
      await fileSystem.lstat(targetRoot);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    throw restoreError('TARGET_CHANGED_BEFORE_PROMOTION', 'Artifact target appeared before promotion.');
  }
  const stat = await fileSystem.lstat(targetRoot);
  const current = statSnapshot(stat);
  if (JSON.stringify(current) !== JSON.stringify(snapshot)) {
    throw restoreError('TARGET_CHANGED_BEFORE_PROMOTION', 'Artifact target changed before promotion.');
  }
}

function objectState(object, state, integrity = undefined, mismatches = undefined) {
  return Object.freeze({
    object_id: object.object_id,
    path: object.path,
    state,
    action: state === 'verified' ? 'reuse' : 'fetch',
    ...(integrity === undefined ? {} : { integrity: Object.freeze({ ...integrity }) }),
    ...(mismatches === undefined ? {} : { mismatches: Object.freeze([...mismatches]) }),
  });
}

function freezeInventory({ root, target_state: targetState, objects, root_snapshot: snapshot }) {
  const counts = objects.reduce((result, object) => {
    result[object.state] += 1;
    return result;
  }, { verified: 0, missing: 0, corrupt: 0 });
  return Object.freeze({
    root,
    target_state: targetState,
    objects: Object.freeze(objects),
    counts: Object.freeze(counts),
    root_snapshot: snapshot === null ? null : Object.freeze(snapshot),
  });
}

function expectedDirectoryKeys(objects, platform) {
  const directories = new Set();
  for (const object of objects) {
    const segments = object.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(canonicalTargetKey(segments.slice(0, index).join('/'), platform));
    }
  }
  return directories;
}

async function walkTarget(root, { fileSystem, platform }) {
  const files = [];
  const directories = [];
  const rootReal = await fileSystem.realpath(root);

  async function visit(relativeDirectory) {
    const absoluteDirectory = relativeDirectory
      ? path.join(root, ...relativeDirectory.split('/'))
      : root;
    const real = await fileSystem.realpath(absoluteDirectory);
    if (!isWithin(rootReal, real)) {
      throw restoreError('ARTIFACT_REALPATH_ESCAPE', 'Artifact target directory resolves outside its root.');
    }
    const entries = await fileSystem.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolute = path.join(absoluteDirectory, entry.name);
      const stat = await fileSystem.lstat(absolute);
      if (entry.isSymbolicLink() || stat.isSymbolicLink?.()) {
        throw restoreError('SYMLINK_OR_REPARSE', 'Artifact target contains a symlink or reparse point.');
      }
      if (stat.isDirectory()) {
        directories.push(relative);
        await visit(relative);
      } else if (stat.isFile()) {
        files.push(relative);
      } else {
        throw restoreError('UNSAFE_TARGET_ENTRY', 'Artifact target contains a non-file entry.');
      }
    }
  }

  await visit('');
  const duplicateKeys = new Set();
  for (const relative of [...files, ...directories]) {
    const key = canonicalTargetKey(relative, platform);
    if (duplicateKeys.has(key)) {
      throw restoreError('DUPLICATE_TARGET', 'Artifact target contains duplicate canonical paths.');
    }
    duplicateKeys.add(key);
  }
  return Object.freeze({ files: Object.freeze(files), directories: Object.freeze(directories) });
}

function statSnapshot(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}
