#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDiaryLocalLifecycle } from '../../src/routes_diary/diary_local_lifecycle.js';
import {
  createDiaryDraft,
  createDiaryEntry,
  createDiaryLocalRepository,
} from '../../src/routes_diary/local_repository.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function makeEntry(id = 'entry-a', routeId = 'route-a') {
  return createDiaryEntry({
    id,
    createdAt: '2026-08-04T01:00:00.000Z',
    payload: { route_id: routeId, overall_rating: 4 },
    routeFeature: {
      properties: { route_id: routeId, name: 'Route A', source_version: 'demo-v1' },
      geometry: null,
    },
  });
}

test('rapid draft changes persist only the newest route-scoped value', async () => {
  const saved = [];
  const repository = createDiaryLocalRepository({
    adapter: {
      async putDraft(draft) {
        saved.push(draft);
        return { applied: true, draft };
      },
    },
  });
  const lifecycle = createDiaryLocalLifecycle({
    repository,
    now: () => '2026-08-04T01:00:00.000Z',
  });

  const first = lifecycle.persistDraft('route-a', { step: 'overall', overallRating: 2 });
  const second = lifecycle.persistDraft('route-a', { step: 'details', overallRating: 4 });

  assert.deepEqual(await first, { applied: false, reason: 'stale' });
  assert.equal((await second).applied, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].routeId, 'route-a');
  assert.equal(saved[0].rating, 4);
  assert.equal(saved[0].sourceVersion, 'demo-v1');
  assert.equal(saved[0].kind, 'engagement-diary-draft');
});

test('draft queues are isolated by route', async () => {
  const saved = [];
  const lifecycle = createDiaryLocalLifecycle({
    repository: createDiaryLocalRepository({
      adapter: {
        async putDraft(draft) {
          saved.push(draft.routeId);
          return { applied: true, draft };
        },
      },
    }),
  });

  await Promise.all([
    lifecycle.persistDraft('route-a', { overallRating: 3 }),
    lifecycle.persistDraft('route-b', { overallRating: 5 }),
  ]);
  assert.deepEqual(new Set(saved), new Set(['route-a', 'route-b']));
});

test('entry commit waits for an in-flight draft write and then uses one repository transaction', async () => {
  const gate = deferred();
  const started = deferred();
  const order = [];
  const lifecycle = createDiaryLocalLifecycle({
    repository: createDiaryLocalRepository({
      adapter: {
        async putDraft(draft) {
          order.push('draft-start');
          started.resolve();
          await gate.promise;
          order.push('draft-end');
          return { applied: true, draft };
        },
        async commitEntry(entry, routeId) {
          order.push(`commit:${routeId}`);
          return entry;
        },
      },
    }),
  });

  const draft = lifecycle.persistDraft('route-a', { overallRating: 4 });
  await started.promise;
  const commit = lifecycle.commitEntry(makeEntry(), 'route-a');
  await Promise.resolve();
  assert.deepEqual(order, ['draft-start']);
  gate.resolve();
  await draft;
  assert.equal((await commit).applied, true);
  assert.deepEqual(order, ['draft-start', 'draft-end', 'commit:route-a']);
});

test('failed local commit rejects without clearing recovery state in the controller', async () => {
  const firstGate = deferred();
  const firstStarted = deferred();
  const savedRatings = [];
  const lifecycle = createDiaryLocalLifecycle({
    repository: createDiaryLocalRepository({
      adapter: {
        async putDraft(draft) {
          if (draft.rating === 3) {
            firstStarted.resolve();
            await firstGate.promise;
          }
          savedRatings.push(draft.rating);
          return { applied: true, draft };
        },
        async commitEntry() {
          throw new Error('transaction failed');
        },
      },
    }),
  });
  const first = lifecycle.persistDraft('route-a', { overallRating: 3 });
  await firstStarted.promise;
  const latest = lifecycle.persistDraft('route-a', { overallRating: 4 });
  const commit = lifecycle.commitEntry(makeEntry(), 'route-a');
  firstGate.resolve();
  await assert.rejects(
    commit,
    /transaction failed/,
  );
  await Promise.all([first, latest]);
  assert.deepEqual(savedRatings, [3, 4]);
});

test('disposing the UI owner still lets the newest queued draft reach storage', async () => {
  const firstGate = deferred();
  const firstStarted = deferred();
  const savedRatings = [];
  const lifecycle = createDiaryLocalLifecycle({
    repository: createDiaryLocalRepository({
      adapter: {
        async putDraft(draft) {
          if (draft.rating === 2) {
            firstStarted.resolve();
            await firstGate.promise;
          }
          savedRatings.push(draft.rating);
          return { applied: true, draft };
        },
      },
    }),
    now: () => '2026-08-04T01:00:00.000Z',
  });

  const first = lifecycle.persistDraft('route-a', { overallRating: 2 });
  await firstStarted.promise;
  const latest = lifecycle.persistDraft('route-a', { overallRating: 5 });
  lifecycle.dispose();
  firstGate.resolve();

  await Promise.all([first, latest]);
  assert.deepEqual(savedRatings, [2, 5]);
});

test('a lifecycle snapshot includes the latest draft intent accepted before the snapshot', async () => {
  const firstGate = deferred();
  const firstStarted = deferred();
  const stored = new Map();
  const repository = createDiaryLocalRepository({
    adapter: {
      async putDraft(draft) {
        if (draft.rating === 2) {
          firstStarted.resolve();
          await firstGate.promise;
        }
        stored.set(draft.routeId, structuredClone(draft));
        return { applied: true, draft };
      },
      async getSnapshot() {
        return { entries: [], drafts: [...stored.values()] };
      },
    },
  });
  const lifecycle = createDiaryLocalLifecycle({
    repository,
    now: () => '2026-08-04T01:00:00.000Z',
  });

  const first = lifecycle.persistDraft('route-a', { overallRating: 2 });
  await firstStarted.promise;
  const latest = lifecycle.persistDraft('route-a', { overallRating: 5 });
  const snapshot = lifecycle.snapshot();
  firstGate.resolve();

  await Promise.all([first, latest]);
  assert.equal((await snapshot).drafts[0].rating, 5);
});

test('a replace started after an old lifecycle draft intent remains final', async () => {
  const firstGate = deferred();
  const firstStarted = deferred();
  const stored = new Map();
  const order = [];
  const repository = createDiaryLocalRepository({
    adapter: {
      async putDraft(draft) {
        order.push(`draft-${draft.rating}-start`);
        if (draft.rating === 2) {
          firstStarted.resolve();
          await firstGate.promise;
        }
        stored.set(draft.routeId, structuredClone(draft));
        order.push(`draft-${draft.rating}-end`);
        return { applied: true, draft };
      },
      async applyBackup() {
        order.push('replace');
        stored.clear();
        return {
          plan: { snapshotToken: 'preview-token' },
          snapshot: { entries: [], drafts: [], warnings: [] },
        };
      },
      async getSnapshot() {
        return { entries: [], drafts: [...stored.values()] };
      },
    },
  });
  const oldLifecycle = createDiaryLocalLifecycle({ repository });
  const newLifecycle = createDiaryLocalLifecycle({ repository });

  const first = oldLifecycle.persistDraft('route-a', { overallRating: 2 });
  await firstStarted.promise;
  const latest = oldLifecycle.persistDraft('route-a', { overallRating: 5 });
  oldLifecycle.dispose();
  const replaced = newLifecycle.applyImport({
    backup: { kind: 'engagement-diary-private-backup', schemaVersion: 2 },
    snapshotToken: 'preview-token',
  }, {
    strategy: 'replace',
    confirmReplace: true,
  });
  firstGate.resolve();

  await Promise.all([first, latest, replaced]);
  assert.deepEqual(order, [
    'draft-2-start',
    'draft-2-end',
    'draft-5-start',
    'draft-5-end',
    'replace',
  ]);
  assert.deepEqual((await repository.snapshot()).drafts, []);
});

test('loading a future-dated draft advances the next local edit timestamp', async () => {
  const saved = [];
  const lifecycle = createDiaryLocalLifecycle({
    repository: {
      async getDraft(routeId) {
        return {
          kind: 'engagement-diary-draft',
          routeId,
          sourceVersion: 'demo-v1',
          updatedAt: '2030-01-01T00:00:00.000Z',
          step: 'overall',
          rating: 2,
          tags: [],
          notes: '',
          overrides: [],
        };
      },
      async saveDraft(draft) {
        saved.push(draft);
        return { applied: true, draft };
      },
    },
    now: () => '2026-08-04T01:00:00.000Z',
  });

  await lifecycle.loadDraft('route-a');
  const result = await lifecycle.persistDraft('route-a', { overallRating: 5 });

  assert.equal(result.applied, true);
  assert.equal(saved[0].updatedAt, '2030-01-01T00:00:00.001Z');
});

test('a newer cross-tab draft advances the clock and retries the current edit once', async () => {
  const attemptedAt = [];
  let calls = 0;
  const lifecycle = createDiaryLocalLifecycle({
    repository: createDiaryLocalRepository({
      adapter: {
        async putDraft(draft) {
          calls += 1;
          attemptedAt.push(draft.updatedAt);
          if (calls === 1) {
            return {
              applied: false,
              reason: 'superseded',
              draft: createDiaryDraft({
                routeId: 'route-a',
                updatedAt: '2040-01-01T00:00:00.000Z',
              }),
            };
          }
          return { applied: true, draft };
        },
      },
    }),
    now: () => '2026-08-04T01:00:00.000Z',
  });

  const result = await lifecycle.persistDraft('route-a', { overallRating: 5 });

  assert.equal(result.applied, true);
  assert.equal(result.draft.rating, 5);
  assert.equal(attemptedAt.length, 2);
  assert.ok(Date.parse(attemptedAt[0]) < Date.parse('2040-01-01T00:00:00.000Z'));
  assert.equal(attemptedAt[1], '2040-01-01T00:00:00.001Z');
});

test('an older cross-tab retry cannot supersede a newer local draft intent', async () => {
  const firstStarted = deferred();
  const firstGate = deferred();
  const attemptedRatings = [];
  let storedDraft = null;
  const repository = createDiaryLocalRepository({
    adapter: {
      async putDraft(draft) {
        attemptedRatings.push(draft.rating);
        if (attemptedRatings.length === 1) {
          firstStarted.resolve();
          await firstGate.promise;
          return {
            applied: false,
            reason: 'superseded',
            draft: createDiaryDraft({
              routeId: draft.routeId,
              updatedAt: '2040-01-01T00:00:00.000Z',
              rating: 1,
            }),
          };
        }
        storedDraft = structuredClone(draft);
        return { applied: true, draft };
      },
    },
  });
  const lifecycle = createDiaryLocalLifecycle({
    repository,
    now: () => '2026-08-04T01:00:00.000Z',
  });

  const older = lifecycle.persistDraft('route-a', { overallRating: 2 });
  await firstStarted.promise;
  const newer = lifecycle.persistDraft('route-a', { overallRating: 5 });
  firstGate.resolve();

  assert.deepEqual(await older, { applied: false, reason: 'stale' });
  assert.equal((await newer).applied, true);
  assert.deepEqual(attemptedRatings, [2, 5]);
  assert.equal(storedDraft?.rating, 5);
});

test('a repeatedly superseded cross-tab draft stops after one retry', async () => {
  let calls = 0;
  const lifecycle = createDiaryLocalLifecycle({
    repository: createDiaryLocalRepository({
      adapter: {
        async putDraft() {
          calls += 1;
          return {
            applied: false,
            reason: 'superseded',
            draft: createDiaryDraft({
              routeId: 'route-a',
              updatedAt: `2050-01-01T00:00:00.00${calls}Z`,
            }),
          };
        },
      },
    }),
  });

  assert.deepEqual(
    await lifecycle.persistDraft('route-a', { overallRating: 5 }),
    { applied: false, reason: 'superseded' },
  );
  assert.equal(calls, 2);
});

test('a disposed Diary owner cannot apply late draft, delete, or import results', async () => {
  const draftGate = deferred();
  const deleteGate = deferred();
  const importGate = deferred();
  const lifecycle = createDiaryLocalLifecycle({
    repository: {
      getDraft: () => draftGate.promise,
      deleteEntry: () => deleteGate.promise,
      applyBackup: () => importGate.promise,
    },
  });

  const draft = lifecycle.loadDraft('route-a');
  const deletion = lifecycle.deleteEntry('entry-a');
  const imported = lifecycle.applyImport({}, { strategy: 'merge' });
  lifecycle.dispose();
  draftGate.resolve({ routeId: 'route-a', overallRating: 4 });
  deleteGate.resolve();
  importGate.resolve({ entries: [], drafts: [] });

  assert.deepEqual(await draft, { applied: false, reason: 'stale', draft: null });
  assert.deepEqual(await deletion, { applied: false, reason: 'stale' });
  assert.deepEqual(await imported, { applied: false, reason: 'stale' });
});

test('backup apply delegates the import intent for an atomic latest-state replan', async () => {
  const calls = [];
  const lifecycle = createDiaryLocalLifecycle({
    repository: {
      async applyBackup(backup, options) {
        calls.push({ backup, options });
        return {
          plan: { snapshotToken: options.expectedSnapshotToken },
          snapshot: { entries: [{ id: 'incoming' }], drafts: [], warnings: [] },
        };
      },
    },
  });
  const expectedSummary = { entriesAdded: 1, entriesRemoved: 0 };
  const expectedSnapshotToken = '{"entries":[],"drafts":[],"warnings":[]}';
  const backup = { kind: 'engagement-diary-private-backup', schemaVersion: 2 };

  const result = await lifecycle.applyImport({ backup, summary: expectedSummary, snapshotToken: expectedSnapshotToken }, {
    strategy: 'merge',
  });

  assert.deepEqual(calls, [{
    backup,
    options: { strategy: 'merge', expectedSnapshotToken },
  }]);
  assert.deepEqual(result, {
    applied: true,
    plan: { snapshotToken: expectedSnapshotToken },
    snapshot: { entries: [{ id: 'incoming' }], drafts: [], warnings: [] },
  });
});
