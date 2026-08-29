import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { restoreError } from './errors.mjs';
import { assertSafeArtifactRoot, assertSafeExistingDirectory } from './safe_paths.mjs';

export async function createStageDirectory(targetRoot, { fileSystem = fs } = {}) {
  const absoluteTarget = path.resolve(targetRoot);
  const parent = path.dirname(absoluteTarget);
  await assertSafeExistingDirectory(parent, { fileSystem, label: 'artifact target parent' });
  const base = path.basename(absoluteTarget);
  return fileSystem.mkdtemp(path.join(parent, `.${base}.artifact-restore-stage-`));
}

export async function promoteDirectoryAtomic({
  stageRoot,
  targetRoot,
  fileSystem = fs,
  backupToken = randomUUID(),
  verifyBackupBeforeInstall = async () => {},
  verifyBackupBeforeCleanup = async () => {},
  verifyPromoted = async () => {},
}) {
  const stage = path.resolve(stageRoot);
  const target = path.resolve(targetRoot);
  const parent = path.dirname(target);
  if (path.dirname(stage) !== parent || stage === target) {
    throw restoreError(
      'NON_ATOMIC_STAGE',
      'Artifact staging and target directories must be distinct siblings.',
    );
  }
  await assertSafeArtifactRoot(stage, { fileSystem, label: 'artifact staging root' });
  const targetState = await assertSafeArtifactRoot(target, {
    fileSystem,
    allowMissing: true,
    label: 'artifact target root',
  });

  const backup = path.join(parent, `.${path.basename(target)}.artifact-restore-backup-${backupToken}`);
  if (await pathExists(backup, fileSystem)) {
    throw restoreError('BACKUP_COLLISION', 'Artifact restore backup path already exists.');
  }

  let backedUp = false;
  let installed = false;
  try {
    if (targetState.exists) {
      await fileSystem.rename(target, backup);
      backedUp = true;
      await verifyBackupBeforeInstall(backup);
      if (await pathExists(target, fileSystem)) {
        throw restoreError(
          'TARGET_REAPPEARED_DURING_PROMOTION',
          'Artifact target reappeared while its prior contents were being verified.',
        );
      }
    }
    await fileSystem.rename(stage, target);
    installed = true;
    await verifyPromoted(target);
  } catch (error) {
    const rollbackErrors = [];
    try {
      const stageExists = await pathExists(stage, fileSystem);
      const targetExists = await pathExists(target, fileSystem);
      if (installed) {
        if (targetExists && !stageExists) await fileSystem.rename(target, stage);
        else {
          throw restoreError(
            'AMBIGUOUS_PROMOTION_STATE',
            'Artifact promotion could not safely reclaim the installed staging directory.',
          );
        }
        installed = false;
      } else if (targetExists && stageExists) {
        throw restoreError(
          'AMBIGUOUS_PROMOTION_STATE',
          'Artifact promotion left both staging and target directories present.',
        );
      }
      if (backedUp) {
        await fileSystem.rename(backup, target);
        backedUp = false;
      }
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Artifact promotion failed and rollback was incomplete.',
      );
    }
    throw restoreError(
      'PROMOTION_FAILED',
      'Artifact promotion failed; the previous target was restored.',
      undefined,
      { cause: error },
    );
  }

  let backupCleanup = 'not_needed';
  if (backedUp) {
    try {
      await verifyBackupBeforeCleanup(backup);
    } catch {
      // The promoted target is already verified. Preserve the prior target even when its
      // post-install snapshot changed so a separate owner can inspect and clean it explicitly.
    }
    // Runtime replacement authority is not deletion authority. Retain every prior target until
    // the registry retention owner separately approves cleanup.
    backupCleanup = 'pending';
  }
  return Object.freeze({ replaced: targetState.exists, backup_cleanup: backupCleanup });
}

async function pathExists(candidate, fileSystem) {
  try {
    await fileSystem.lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
