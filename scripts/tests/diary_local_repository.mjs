#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDiaryDraft,
  createDiaryEntry,
  createDiaryLocalRepository,
  migrateLegacyDiaryEntryRecord,
} from '../../src/routes_diary/local_repository.js';
import {
  DIARY_BACKUP_KIND,
  createDiaryBackupPlan,
  parseDiaryPrivateBackup,
  serializeDiaryPrivateBackup,
} from '../../src/routes_diary/diary_data_portability.js';

const routeFeature = {
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [[-75.2, 39.9], [-75.1, 40]],
  },
  properties: {
    route_id: 'route-1',
    name: 'Home to school',
    mode: 'bike',
    source_version: 'demo-2026-08',
  },
};

function makeEntry(id = 'entry-1', createdAt = '2026-08-04T00:00:00.000Z') {
  return createDiaryEntry({
    id,
    createdAt,
    payload: {
      route_id: 'route-1',
      overall_rating: 4,
      tags: ['poor_lighting', 'poor_lighting'],
      segment_ids: ['seg-1'],
      notes: 'Needs a safer crossing',
      segment_overrides: { 'seg-1': 2 },
      user_hash: 'must-never-be-stored',
    },
    routeFeature,
  });
}

test('canonical entries preserve useful rating data without transport payload or user hash', () => {
  const entry = makeEntry();
  assert.equal(entry.kind, 'engagement-diary-entry');
  assert.equal(entry.schemaVersion, 2);
  assert.equal(entry.routeId, 'route-1');
  assert.equal(entry.score, 4);
  assert.deepEqual(entry.tags, ['poor_lighting']);
  assert.equal(entry.notes, 'Needs a safer crossing');
  assert.deepEqual(entry.segmentOverrides, { 'seg-1': 2 });
  assert.equal('payload' in entry, false);
  assert.equal(JSON.stringify(entry).includes('must-never-be-stored'), false);
});

test('v1 rows migrate to the canonical schema without transport payload or user hash', () => {
  const migrated = migrateLegacyDiaryEntryRecord({
    id: 'legacy-entry',
    createdAt: '2026-08-01T00:00:00.000Z',
    label: 'Legacy route',
    mode: 'walk',
    user_hash: 'top-level-secret',
    payload: {
      route_id: 'route-1',
      overall_rating: 4,
      tags: ['poor_lighting'],
      segment_ids: ['seg-1'],
      notes: 'Preserve this note',
      segment_overrides: { 'seg-1': 2 },
      user_hash: 'nested-secret',
    },
  });

  assert.equal(migrated.warning, null);
  assert.equal(migrated.value.kind, 'engagement-diary-entry');
  assert.equal(migrated.value.schemaVersion, 2);
  assert.equal(migrated.value.routeId, 'route-1');
  assert.equal(migrated.value.notes, 'Preserve this note');
  assert.equal('payload' in migrated.value, false);
  assert.equal(JSON.stringify(migrated.value).includes('secret'), false);
});

test('transport segment override arrays are converted into the canonical private schema', () => {
  const entry = createDiaryEntry({
    id: 'entry-array-overrides',
    createdAt: '2026-08-04T00:00:00.000Z',
    payload: {
      overall_rating: 4,
      tags: [],
      segment_ids: ['seg-1'],
      segment_overrides: [{ segment_id: 'seg-1', rating: 2 }],
      user_hash: 'discard-me',
    },
    routeFeature,
  });
  assert.deepEqual(entry.segmentOverrides, { 'seg-1': 2 });
  assert.equal(JSON.stringify(entry).includes('discard-me'), false);
});

test('canonical drafts are keyed by route and contain only resumable local form state', () => {
  const draft = createDiaryDraft({
    routeId: 'route-1',
    sourceVersion: 'demo-2026-08',
    updatedAt: '2026-08-04T01:00:00.000Z',
    step: 'segments',
    rating: 3,
    tags: ['traffic'],
    notes: 'Resume later',
    overrides: { 'seg-1': 2 },
    user_hash: 'ignored',
  });
  assert.deepEqual(draft, {
    kind: 'engagement-diary-draft',
    schemaVersion: 2,
    routeId: 'route-1',
    sourceVersion: 'demo-2026-08',
    updatedAt: '2026-08-04T01:00:00.000Z',
    step: 'segments',
    rating: 3,
    tags: ['traffic'],
    notes: 'Resume later',
    overrides: { 'seg-1': 2 },
  });
});

test('repository isolates corrupt rows and exposes warnings instead of failing the whole list', async () => {
  const good = makeEntry();
  const repository = createDiaryLocalRepository({
    adapter: {
      async getAllEntries() { return [good, { id: 'broken' }]; },
      async getAllDrafts() { return [{ routeId: 'broken' }]; },
    },
  });
  const snapshot = await repository.snapshot();
  assert.deepEqual(snapshot.entries, [good]);
  assert.deepEqual(snapshot.drafts, []);
  assert.equal(snapshot.warnings.length, 2);
  assert.match(snapshot.warnings[0].message, /invalid diary entry/i);
  assert.match(snapshot.warnings[1].message, /invalid diary draft/i);
});

test('repository supports entry and draft CRUD plus atomic entry commit with draft deletion', async () => {
  const calls = [];
  const entry = makeEntry();
  const draft = createDiaryDraft({
    routeId: 'route-1',
    updatedAt: '2026-08-04T01:00:00.000Z',
    rating: 4,
  });
  const repository = createDiaryLocalRepository({
    adapter: {
      async putEntry(value) { calls.push(['putEntry', value.id]); },
      async deleteEntry(id) { calls.push(['deleteEntry', id]); },
      async putDraft(value) { calls.push(['putDraft', value.routeId]); },
      async getDraft() { return draft; },
      async deleteDraft(routeId) { calls.push(['deleteDraft', routeId]); },
      async commitEntry(value, routeId) { calls.push(['commitEntry', value.id, routeId]); },
      async getAllEntries() { return [entry]; },
      async getAllDrafts() { return [draft]; },
    },
  });

  await repository.save(entry);
  await repository.delete(entry.id);
  await repository.saveDraft(draft);
  assert.deepEqual(await repository.getDraft('route-1'), draft);
  await repository.deleteDraft('route-1');
  await repository.commitEntry(entry, { draftRouteId: 'route-1' });

  assert.deepEqual(calls, [
    ['putEntry', 'entry-1'],
    ['deleteEntry', 'entry-1'],
    ['putDraft', 'route-1'],
    ['deleteDraft', 'route-1'],
    ['commitEntry', 'entry-1', 'route-1'],
  ]);
});

test('repository reports the actual current draft when the adapter rejects an older write', async () => {
  const current = createDiaryDraft({
    routeId: 'route-1',
    updatedAt: '2030-01-01T00:00:00.000Z',
    rating: 2,
  });
  const attempted = createDiaryDraft({
    routeId: 'route-1',
    updatedAt: '2026-08-04T01:00:00.000Z',
    rating: 5,
  });
  const repository = createDiaryLocalRepository({
    adapter: {
      async putDraft() {
        return { applied: false, draft: current };
      },
    },
  });

  assert.deepEqual(await repository.saveDraft(attempted), {
    applied: false,
    reason: 'superseded',
    draft: current,
  });
});

test('private backup v2 round-trips entries and drafts while legacy v1 is migrated', () => {
  const entry = makeEntry();
  const draft = createDiaryDraft({
    routeId: 'route-1',
    updatedAt: '2026-08-04T01:00:00.000Z',
    rating: 4,
  });
  const backup = serializeDiaryPrivateBackup({ entries: [entry], drafts: [draft] }, {
    generatedAt: '2026-08-04T02:00:00.000Z',
  });
  assert.equal(backup.kind, DIARY_BACKUP_KIND);
  assert.equal(backup.schemaVersion, 2);
  assert.deepEqual(parseDiaryPrivateBackup(JSON.stringify(backup)), {
    kind: DIARY_BACKUP_KIND,
    schemaVersion: 2,
    generatedAt: '2026-08-04T02:00:00.000Z',
    entries: [entry],
    drafts: [draft],
    migratedFrom: null,
  });

  const legacy = {
    schemaVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    entries: [{
      id: 'legacy-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      routeId: 'route-legacy',
      label: 'Legacy route',
      mode: 'walk',
      score: 5,
      tags: ['calm'],
      segmentIds: ['seg-9'],
      routeGeometry: routeFeature.geometry,
      routeSourceVersion: 'legacy-v1',
      payload: { overall_rating: 5, notes: 'Migrated', user_hash: 'remove-me' },
    }],
  };
  const migrated = parseDiaryPrivateBackup(legacy);
  assert.equal(migrated.migratedFrom, 1);
  assert.equal(migrated.entries[0].notes, 'Migrated');
  assert.equal('payload' in migrated.entries[0], false);
  assert.equal(JSON.stringify(migrated).includes('remove-me'), false);
});

test('backup validation rejects duplicates, invalid times, geometry, and excessive input', () => {
  const entry = makeEntry();
  assert.throws(
    () => parseDiaryPrivateBackup({
      kind: DIARY_BACKUP_KIND,
      schemaVersion: 2,
      generatedAt: '2026-08-04T00:00:00.000Z',
      entries: [entry, entry],
      drafts: [],
    }),
    /duplicate diary entry/i,
  );
  assert.throws(
    () => parseDiaryPrivateBackup({
      kind: DIARY_BACKUP_KIND,
      schemaVersion: 2,
      generatedAt: 'not-a-time',
      entries: [],
      drafts: [],
    }),
    /generatedat/i,
  );
  assert.throws(
    () => parseDiaryPrivateBackup({
      kind: DIARY_BACKUP_KIND,
      schemaVersion: 2,
      generatedAt: '2026-08-04T00:00:00.000Z',
      entries: [{ ...entry, routeGeometry: { type: 'LineString', coordinates: [['bad']] } }],
      drafts: [],
    }),
    /geometry/i,
  );
  assert.throws(
    () => parseDiaryPrivateBackup('x'.repeat(10 * 1024 * 1024 + 1)),
    /too large/i,
  );
  assert.throws(
    () => parseDiaryPrivateBackup({
      kind: DIARY_BACKUP_KIND,
      schemaVersion: 2,
      generatedAt: '2026-08-04T00:00:00.000Z',
      entries: [],
      drafts: [],
      unexpected: true,
    }),
    /unknown diary backup field/i,
  );
  assert.throws(
    () => parseDiaryPrivateBackup({
      kind: DIARY_BACKUP_KIND,
      schemaVersion: 2,
      generatedAt: '2026-08-04T00:00:00.000Z',
      entries: [{ ...entry, unexpected: true }],
      drafts: [],
    }),
    /unknown diary entry field/i,
  );
  assert.throws(
    () => parseDiaryPrivateBackup({
      kind: DIARY_BACKUP_KIND,
      schemaVersion: 2,
      generatedAt: '2026-08-04T00:00:00.000Z',
      entries: [{ ...entry, kind: undefined, schemaVersion: undefined }],
      drafts: [],
    }),
    /invalid diary entry schema/i,
  );
});

test('backup preview defaults to merge and requires an explicit replace decision', () => {
  const existing = makeEntry('same', '2026-08-01T00:00:00.000Z');
  const newer = makeEntry('same', '2026-08-03T00:00:00.000Z');
  const added = makeEntry('added', '2026-08-02T00:00:00.000Z');
  const backup = serializeDiaryPrivateBackup({ entries: [newer, added], drafts: [] });

  const merge = createDiaryBackupPlan({ entries: [existing], drafts: [] }, backup);
  assert.equal(merge.mode, 'merge');
  assert.deepEqual(merge.summary, {
    entriesAdded: 1,
    entriesUpdated: 1,
    entriesUnchanged: 0,
    entriesRetained: 0,
    entryConflicts: 0,
    draftsAdded: 0,
    draftsUpdated: 0,
    draftsUnchanged: 0,
    draftsRetained: 0,
    draftConflicts: 0,
    entriesRemoved: 0,
    draftsRemoved: 0,
  });
  assert.deepEqual(merge.snapshot.entries.map((item) => item.id).sort(), ['added', 'same']);

  const replace = createDiaryBackupPlan({ entries: [existing], drafts: [] }, backup, { mode: 'replace' });
  assert.equal(replace.mode, 'replace');
  assert.equal(replace.requiresExplicitConfirmation, true);
  assert.equal(replace.summary.entriesRemoved, 0);
});

test('replace preview token changes when local content changes but the summary does not', () => {
  const localBefore = makeEntry('same-local-key', '2026-08-01T00:00:00.000Z');
  const localAfter = { ...localBefore, notes: 'Edited after preview' };
  const backup = serializeDiaryPrivateBackup({ entries: [], drafts: [] });

  const before = createDiaryBackupPlan({ entries: [localBefore], drafts: [] }, backup, { mode: 'replace' });
  const after = createDiaryBackupPlan({ entries: [localAfter], drafts: [] }, backup, { mode: 'replace' });

  assert.deepEqual(after.summary, before.summary);
  assert.notEqual(after.snapshotToken, before.snapshotToken);
});

test('merge keeps newer local data and reports equal-time conflicts without overwriting', () => {
  const localNewer = makeEntry('same', '2026-08-04T00:00:00.000Z');
  const importedOlder = makeEntry('same', '2026-08-03T00:00:00.000Z');
  const localConflict = makeEntry('conflict', '2026-08-04T00:00:00.000Z');
  const importedConflict = {
    ...makeEntry('conflict', '2026-08-04T00:00:00.000Z'),
    notes: 'different at the same timestamp',
  };
  const backup = serializeDiaryPrivateBackup({
    entries: [importedOlder, importedConflict],
    drafts: [],
  });

  const merge = createDiaryBackupPlan({
    entries: [localNewer, localConflict],
    drafts: [],
  }, backup);

  assert.equal(merge.summary.entriesRetained, 1);
  assert.equal(merge.summary.entryConflicts, 1);
  assert.deepEqual(merge.snapshot.entries, [localNewer, localConflict]);
});

test('merge preserves local-only records while replace reports and removes omitted entries and drafts', async () => {
  const shared = makeEntry('shared', '2026-08-04T00:00:00.000Z');
  const localOnly = makeEntry('local-only', '2026-08-03T00:00:00.000Z');
  const localDraft = createDiaryDraft({
    routeId: 'local-draft',
    updatedAt: '2026-08-04T01:00:00.000Z',
    rating: 3,
  });
  const backup = serializeDiaryPrivateBackup({ entries: [shared], drafts: [] });

  const merge = createDiaryBackupPlan({
    entries: [shared, localOnly],
    drafts: [localDraft],
  }, backup, { mode: 'merge' });
  assert.deepEqual(merge.snapshot.entries.map((item) => item.id).sort(), ['local-only', 'shared']);
  assert.deepEqual(merge.snapshot.drafts, [localDraft]);

  const replace = createDiaryBackupPlan({
    entries: [shared, localOnly],
    drafts: [localDraft],
  }, backup, { mode: 'replace' });
  assert.equal(replace.summary.entriesRemoved, 1);
  assert.equal(replace.summary.draftsRemoved, 1);
  assert.deepEqual(replace.snapshot.entries, [shared]);
  assert.deepEqual(replace.snapshot.drafts, []);

  let stored = { entries: [shared, localOnly], drafts: [localDraft] };
  const repository = createDiaryLocalRepository({
    adapter: {
      async getAllEntries() { return stored.entries; },
      async getAllDrafts() { return stored.drafts; },
      async mergeSnapshot(snapshot) {
        stored = {
          entries: [...stored.entries, ...snapshot.entries.filter((incoming) => (
            !stored.entries.some((current) => current.id === incoming.id)
          ))],
          drafts: [...stored.drafts, ...snapshot.drafts.filter((incoming) => (
            !stored.drafts.some((current) => current.routeId === incoming.routeId)
          ))],
        };
      },
      async replaceSnapshot(snapshot) { stored = structuredClone(snapshot); },
    },
  });
  await repository.mergeSnapshot(merge.snapshot);
  assert.deepEqual((await repository.snapshot()).entries.map((item) => item.id).sort(), ['local-only', 'shared']);
  await repository.replaceSnapshot(replace.snapshot);
  assert.deepEqual(await repository.snapshot(), { entries: [shared], drafts: [], warnings: [] });
});

test('repository snapshots entries and drafts through one atomic adapter operation', async () => {
  const entry = makeEntry('atomic-entry');
  const draft = createDiaryDraft({
    routeId: 'atomic-draft',
    updatedAt: '2026-08-04T02:00:00.000Z',
    rating: 4,
  });
  let snapshotCalls = 0;
  const repository = createDiaryLocalRepository({
    adapter: {
      async getSnapshot() {
        snapshotCalls += 1;
        return { entries: [entry], drafts: [draft] };
      },
      async getAllEntries() {
        throw new Error('entries must not be read in a separate transaction');
      },
      async getAllDrafts() {
        throw new Error('drafts must not be read in a separate transaction');
      },
    },
  });

  assert.deepEqual(await repository.snapshot(), {
    entries: [entry],
    drafts: [draft],
    warnings: [],
  });
  assert.equal(snapshotCalls, 1);
});

test('repository applies a backup through the adapter atomic replan operation', async () => {
  const incoming = makeEntry('incoming', '2026-08-04T03:00:00.000Z');
  const backup = serializeDiaryPrivateBackup({ entries: [incoming], drafts: [] });
  const preview = createDiaryBackupPlan({ entries: [], drafts: [] }, backup, { mode: 'replace' });
  let received = null;
  const repository = createDiaryLocalRepository({
    adapter: {
      async applyBackup(value, options) {
        received = { value, options };
        return {
          plan: createDiaryBackupPlan({ entries: [], drafts: [] }, value, { mode: options.strategy }),
          snapshot: { entries: [incoming], drafts: [] },
        };
      },
    },
  });

  const result = await repository.applyBackup(preview.backup, {
    strategy: 'replace',
    expectedSnapshotToken: preview.snapshotToken,
  });
  assert.equal(received.value.kind, DIARY_BACKUP_KIND);
  assert.deepEqual(received.options, {
    strategy: 'replace',
    expectedSnapshotToken: preview.snapshotToken,
  });
  assert.deepEqual(result.snapshot, { entries: [incoming], drafts: [], warnings: [] });
});

test('repository serializes commit and delete before a later import enters the adapter', async () => {
  let releaseCommit;
  let commitStarted;
  const commitGate = new Promise((resolve) => { releaseCommit = resolve; });
  const started = new Promise((resolve) => { commitStarted = resolve; });
  const order = [];
  const entry = makeEntry('queued-entry');
  const backup = serializeDiaryPrivateBackup({ entries: [], drafts: [] });
  const repository = createDiaryLocalRepository({
    adapter: {
      async commitEntry() {
        order.push('commit-start');
        commitStarted();
        await commitGate;
        order.push('commit-end');
      },
      async deleteEntry() {
        order.push('delete');
      },
      async applyBackup(value, options) {
        order.push('import');
        const plan = createDiaryBackupPlan({ entries: [], drafts: [] }, value, { mode: options.strategy });
        return { plan, snapshot: { entries: [], drafts: [] } };
      },
    },
  });

  const commit = repository.commitEntry(entry, { draftRouteId: 'route-1' });
  await started;
  const deletion = repository.delete(entry.id);
  const imported = repository.applyBackup(backup, { strategy: 'merge' });
  await Promise.resolve();
  assert.deepEqual(order, ['commit-start']);
  releaseCommit();
  await Promise.all([commit, deletion, imported]);
  assert.deepEqual(order, ['commit-start', 'commit-end', 'delete', 'import']);
});

test('repository snapshot waits for an already-started draft write', async () => {
  let releaseDraft;
  let draftStarted;
  const draftGate = new Promise((resolve) => { releaseDraft = resolve; });
  const started = new Promise((resolve) => { draftStarted = resolve; });
  const order = [];
  const draft = createDiaryDraft({
    routeId: 'route-queued',
    updatedAt: '2026-08-04T05:00:00.000Z',
    rating: 5,
  });
  const repository = createDiaryLocalRepository({
    adapter: {
      async putDraft() {
        order.push('draft-start');
        draftStarted();
        await draftGate;
        order.push('draft-end');
      },
      async getSnapshot() {
        order.push('snapshot');
        return { entries: [], drafts: [draft] };
      },
    },
  });

  const saved = repository.saveDraft(draft);
  await started;
  const snapshot = repository.snapshot();
  await Promise.resolve();
  assert.deepEqual(order, ['draft-start']);
  releaseDraft();
  await saved;
  assert.deepEqual(await snapshot, { entries: [], drafts: [draft], warnings: [] });
  assert.deepEqual(order, ['draft-start', 'draft-end', 'snapshot']);
});
