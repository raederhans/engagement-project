import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDiaryEntry, serializeDiaryPrivateBackup, parseDiaryPrivateBackup } from '../../src/routes_diary/diary_data_portability.js';
import { filterLocalDiaryEntries } from '../../src/routes_diary/diary_view_models.js';
import { createDiaryLocalController } from '../../src/routes_diary/diary_local_controller.js';
import { validateRatingPayload } from '../../src/routes_diary/rating_payload_validator.js';
import { resolveDiaryFeatureOn } from '../../src/state/app_mode_state.js';
import { diaryRouteDistance } from '../../src/routes_diary/diary_trip_geometry.js';

const entry = { id: 'one', createdAt: '2026-09-14T12:00:00Z', label: 'Park', mode: 'walk', score: 4, tags: [], notes: '' };

test('route distance sums attached lines and keeps missing geometry unavailable', () => {
  assert.equal(diaryRouteDistance(null), null);
  const length = diaryRouteDistance({ type: 'LineString', coordinates: [[0, 0], [1, 0]] });
  assert.ok(length > 111000 && length < 111300);
  assert.equal(diaryRouteDistance({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 0]], [[0, 0], [1, 0]]] }), length * 2);
});

test('Diary is available by default in built previews as well as development', () => {
  assert.equal(resolveDiaryFeatureOn({ search: '', pathname: '/', developmentEnabled: false }), true);
  assert.equal(resolveDiaryFeatureOn({ search: '', pathname: '/', developmentEnabled: false, envEnabled: false }), false);
});

test('optional travel date round trips through private backup and old records remain unchanged', () => {
  const old = normalizeDiaryEntry(entry);
  assert.equal('occurredAt' in old, false);
  const dated = normalizeDiaryEntry({ ...entry, occurredAt: '2020-02-10T14:15:00Z', favorite: true });
  const backup = serializeDiaryPrivateBackup({ entries: [dated] });
  assert.equal(parseDiaryPrivateBackup(JSON.stringify(backup)).entries[0].occurredAt, dated.occurredAt);
  assert.equal(parseDiaryPrivateBackup(JSON.stringify(backup)).entries[0].favorite, true);
  assert.throws(() => normalizeDiaryEntry({ ...entry, favorite: 'yes' }));
  assert.throws(() => normalizeDiaryEntry({ ...entry, occurredAt: 'invalid' }));
});

test('journal filters use trip time, Philadelphia hours, mode and text together', () => {
  const now = Date.parse('2026-09-14T23:00:00Z');
  const rows = [
    { ...entry, occurredAt: '2020-01-01T14:00:00Z' },
    { ...entry, id: 'two', occurredAt: '2026-09-14T14:00:00Z', notes: 'Trees' },
    { ...entry, id: 'three', mode: 'bike', occurredAt: '2026-09-14T23:00:00Z', notes: 'Trees' },
  ];
  assert.deepEqual(filterLocalDiaryEntries(rows, { period: '7d', timeOfDay: 'day', query: 'trees', now }).map((row) => row.id), ['two']);
  assert.deepEqual(filterLocalDiaryEntries(rows, { period: 'all', mode: 'bike', timeOfDay: 'evening', now }).map((row) => row.id), ['three']);
  assert.deepEqual(filterLocalDiaryEntries(rows, { period: 'all', now }).map((row) => row.id), ['three', 'two', 'one']);
});

test('successful draft save refreshes snapshot immediately and stale save does not publish', async () => {
  const changes = [];
  const snapshot = { entries: [], drafts: [{ routeId: 'demo-1' }], warnings: [] };
  let applied = true;
  const controller = createDiaryLocalController({
    repository: { snapshot: async () => snapshot },
    lifecycle: { persistDraft: async () => ({ applied }) },
    onChange: (view) => changes.push(view),
  });
  await controller.persistDraft('demo-1', {});
  assert.equal(controller.getViewState().snapshot.drafts.length, 1);
  const before = changes.length;
  applied = false;
  await controller.persistDraft('demo-1', {});
  assert.equal(changes.length, before);
});

test('rating submission accepts no tags and positive tags but rejects unsupported tags', () => {
  const payload = { route_id: 'demo', segment_ids: ['one'], overall_rating: 5, tags: [], mode: 'walk', user_hash: 'local-user' };
  assert.equal(validateRatingPayload(payload).ok, true);
  assert.equal(validateRatingPayload({ ...payload, tags: ['well_lit'] }).ok, true);
  assert.equal(validateRatingPayload({ ...payload, tags: ['unsupported'] }).ok, false);
});
