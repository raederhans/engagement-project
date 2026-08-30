import fs from 'node:fs/promises';

import { mapBounded } from './concurrency.mjs';
import { restoreError } from './errors.mjs';
import {
  assertTargetSnapshot,
  assertVerifiedInventory,
  inspectTargetInventory,
} from './inventory.mjs';
import { createStageDirectory, promoteDirectoryAtomic } from './promotion.mjs';
import { stageFromLocation } from './transport.mjs';

export async function planArtifactRestore({
  registry,
  targetRoot,
  concurrency = 4,
  fileSystem = fs,
  platform = process.platform,
}) {
  const inventory = await inspectTargetInventory({
    registry,
    targetRoot,
    concurrency,
    fileSystem,
    platform,
  });
  return resultDocument('plan', registry, inventory, {
    no_op: inventory.target_state === 'complete',
    promoted: false,
    restored: 0,
    reused: inventory.counts.verified,
    pending: inventory.counts.missing + inventory.counts.corrupt,
  });
}

export async function verifyArtifactRestore({
  registry,
  targetRoot,
  concurrency = 4,
  fileSystem = fs,
  platform = process.platform,
}) {
  const inventory = assertVerifiedInventory(await inspectTargetInventory({
    registry,
    targetRoot,
    concurrency,
    fileSystem,
    platform,
  }));
  return resultDocument('verify', registry, inventory, {
    verified: inventory.objects.length,
    no_op: true,
    promoted: false,
  });
}

export async function restoreArtifacts({
  registry,
  targetRoot,
  fileLocationRoot,
  concurrency = 4,
  fetchImpl = globalThis.fetch,
  fileSystem = fs,
  platform = process.platform,
  promote = promoteDirectoryAtomic,
  replaceExisting = false,
}) {
  const initial = await inspectTargetInventory({
    registry,
    targetRoot,
    concurrency,
    fileSystem,
    platform,
  });
  if (initial.target_state === 'complete') {
    return resultDocument('restore', registry, initial, {
      no_op: true,
      promoted: false,
      restored: 0,
      reused: initial.objects.length,
      verified: initial.objects.length,
      backup_cleanup: 'not_needed',
      stage_cleanup: 'not_needed',
    });
  }
  if (initial.root_snapshot !== null && replaceExisting !== true) {
    throw restoreError(
      'TARGET_REPLACEMENT_NOT_AUTHORIZED',
      'Artifact target already exists and is not complete; pass --replace-existing to authorize operational replacement. Registry authority.deletion remains false.',
      { target_state: initial.target_state, registry_deletion_authority: registry.authority.deletion },
    );
  }

  const stageRoot = await createStageDirectory(targetRoot, { fileSystem });
  let promotedInventory;
  let result;
  let operationError;
  try {
    const initialByPath = new Map(initial.objects.map((object) => [object.path, object]));
    const staged = await mapBounded(registry.objects, concurrency, async (object) => {
      const existing = initialByPath.get(object.path);
      if (existing?.state === 'verified') {
        await stageFromLocation({
          location: { scheme: 'file', path: object.path },
          destinationRoot: stageRoot,
          destinationPath: object.path,
          expected: object.expected,
          fileLocationRoot: initial.root,
          fileSystem,
        });
        return Object.freeze({ path: object.path, action: 'reused' });
      }
      await stageFromLocation({
        location: object.source,
        destinationRoot: stageRoot,
        destinationPath: object.path,
        expected: object.expected,
        fileLocationRoot,
        fetchImpl,
        fileSystem,
      });
      return Object.freeze({ path: object.path, action: 'restored' });
    });

    assertVerifiedInventory(await inspectTargetInventory({
      registry,
      targetRoot: stageRoot,
      concurrency,
      fileSystem,
      platform,
    }));
    const beforePromotion = await inspectTargetInventory({
      registry,
      targetRoot,
      concurrency,
      fileSystem,
      platform,
    });
    assertInventoryUnchanged(initial, beforePromotion);
    await assertTargetSnapshot(targetRoot, initial.root_snapshot, { fileSystem });

    const promotion = await promote({
      stageRoot,
      targetRoot,
      fileSystem,
      verifyBackupBeforeInstall: async (backupRoot) => {
        const backupInventory = await inspectTargetInventory({
          registry,
          targetRoot: backupRoot,
          concurrency,
          fileSystem,
          platform,
        });
        assertInventoryUnchanged(initial, backupInventory);
      },
      verifyBackupBeforeCleanup: async (backupRoot) => {
        const backupInventory = await inspectTargetInventory({
          registry,
          targetRoot: backupRoot,
          concurrency,
          fileSystem,
          platform,
        });
        assertInventoryUnchanged(initial, backupInventory);
      },
      verifyPromoted: async (promotedRoot) => {
        promotedInventory = assertVerifiedInventory(await inspectTargetInventory({
          registry,
          targetRoot: promotedRoot,
          concurrency,
          fileSystem,
          platform,
        }));
      },
    });
    const restored = staged.filter(({ action }) => action === 'restored').length;
    const reused = staged.length - restored;
    result = resultDocument('restore', registry, promotedInventory, {
      no_op: false,
      promoted: true,
      restored,
      reused,
      verified: promotedInventory.objects.length,
      backup_cleanup: promotion?.backup_cleanup ?? 'unknown',
      object_actions: Object.fromEntries(staged.map(({ path, action }) => [path, action])),
    });
  } catch (error) {
    operationError = error;
  }

  let cleanupError;
  try {
    await fileSystem.rm(stageRoot, { recursive: true, force: true });
  } catch (error) {
    cleanupError = error;
  }
  if (operationError) {
    if (cleanupError) {
      throw restoreError(
        'RESTORE_FAILED_WITH_STAGING_RESIDUE',
        'Artifact restore failed and its private staging directory could not be removed.',
        { operation_code: operationError?.code ?? 'ARTIFACT_RESTORE_FAILED' },
        { cause: new AggregateError([operationError, cleanupError]) },
      );
    }
    throw operationError;
  }
  return Object.freeze({
    ...result,
    stage_cleanup: cleanupError ? 'pending' : 'complete',
  });
}

function assertInventoryUnchanged(initial, current) {
  if (initial.target_state !== current.target_state
    || JSON.stringify(inventoryFingerprint(initial))
      !== JSON.stringify(inventoryFingerprint(current))) {
    throw restoreError(
      'TARGET_CHANGED_BEFORE_PROMOTION',
      'Artifact target inventory changed while restore was staging.',
    );
  }
}

function inventoryFingerprint(inventory) {
  return inventory.objects.map(({ path, state, integrity }) => [
    path,
    state,
    integrity ?? null,
  ]);
}

function resultDocument(mode, registry, inventory, details) {
  const {
    backup_cleanup: backupCleanup,
    stage_cleanup: stageCleanup,
    object_actions: objectActions = {},
    ...counts
  } = details;
  return Object.freeze({
    protocol: 'ArtifactRestoreResult/v1',
    mode,
    status: mode === 'plan' ? 'planned' : 'verified',
    registry_identity: registry.registry_identity,
    artifact_sets: Object.freeze([registry.artifact_set_id]),
    location_scheme: registry.location_scheme,
    target_state: inventory.target_state,
    ...(backupCleanup === undefined ? {} : { backup_cleanup: backupCleanup }),
    ...(stageCleanup === undefined ? {} : { stage_cleanup: stageCleanup }),
    counts: Object.freeze({ ...counts }),
    objects: Object.freeze(inventory.objects.map(({ object_id: objectId, path, state, action }) => (
      Object.freeze({ object_id: objectId, path, state, action: objectActions[path] ?? action })
    ))),
    retention: registry.retention,
    authority: registry.authority,
  });
}
