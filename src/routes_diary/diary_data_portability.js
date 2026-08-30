export const DIARY_BACKUP_KIND = 'engagement-diary-private-backup';
export const DIARY_BACKUP_SCHEMA_VERSION = 2;
export const DIARY_ENTRY_KIND = 'engagement-diary-entry';
export const DIARY_DRAFT_KIND = 'engagement-diary-draft';

const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_DRAFTS = 500;
const MAX_TAGS = 64;
const MAX_SEGMENTS = 20_000;
const MAX_NOTES_LENGTH = 20_000;

const BACKUP_V2_FIELDS = new Set([
  'kind',
  'schemaVersion',
  'generatedAt',
  'entries',
  'drafts',
]);
const ENTRY_V2_FIELDS = new Set([
  'kind',
  'schemaVersion',
  'id',
  'createdAt',
  'updatedAt',
  'routeId',
  'label',
  'mode',
  'score',
  'tags',
  'segmentIds',
  'routeGeometry',
  'routeSourceVersion',
  'notes',
  'segmentOverrides',
]);
const DRAFT_V2_FIELDS = new Set([
  'kind',
  'schemaVersion',
  'routeId',
  'sourceVersion',
  'updatedAt',
  'step',
  'rating',
  'tags',
  'notes',
  'overrides',
]);

export function normalizeDiaryEntry(value, { allowLegacy = true } = {}) {
  const entry = value && typeof value === 'object' ? value : null;
  if (!entry) throw new Error('Invalid Diary entry: expected an object.');
  if (!allowLegacy && (entry.kind !== DIARY_ENTRY_KIND || entry.schemaVersion !== 2)) {
    throw new Error('Invalid Diary entry schema.');
  }
  if (entry.kind === DIARY_ENTRY_KIND && entry.schemaVersion === 2) {
    assertKnownKeys(entry, ENTRY_V2_FIELDS, 'entry');
  }

  const payload = allowLegacy && entry.payload && typeof entry.payload === 'object'
    ? entry.payload
    : {};
  const id = requiredText(entry.id, 'Diary entry id', 200);
  const createdAt = validTime(entry.createdAt, 'Diary entry createdAt');
  const updatedAt = validTime(entry.updatedAt || createdAt, 'Diary entry updatedAt');
  const score = ratingValue(entry.score ?? payload.overall_rating, 'Diary entry score');
  const tags = stringList(entry.tags ?? payload.tags, 'Diary entry tags', MAX_TAGS);
  const segmentIds = stringList(
    entry.segmentIds ?? payload.segment_ids,
    'Diary entry segmentIds',
    MAX_SEGMENTS,
  );
  const routeGeometry = entry.routeGeometry == null
    ? null
    : normalizeRouteGeometry(entry.routeGeometry);

  return {
    kind: DIARY_ENTRY_KIND,
    schemaVersion: 2,
    id,
    createdAt,
    updatedAt,
    routeId: optionalText(entry.routeId ?? payload.route_id, 200),
    label: optionalText(entry.label, 500) || optionalText(entry.routeId ?? payload.route_id, 200) || 'Saved route',
    mode: entry.mode === 'bike' ? 'bike' : 'walk',
    score,
    tags,
    segmentIds,
    routeGeometry,
    routeSourceVersion: optionalText(entry.routeSourceVersion, 200) || 'legacy',
    notes: optionalText(entry.notes ?? payload.notes, MAX_NOTES_LENGTH) || '',
    segmentOverrides: normalizeOverrides(entry.segmentOverrides ?? payload.segment_overrides),
  };
}

export function normalizeDiaryDraft(value, { allowLegacy = true } = {}) {
  const draft = value && typeof value === 'object' ? value : null;
  if (!draft) throw new Error('Invalid Diary draft: expected an object.');
  if (!allowLegacy && (draft.kind !== DIARY_DRAFT_KIND || draft.schemaVersion !== 2)) {
    throw new Error('Invalid Diary draft schema.');
  }
  if (draft.kind === DIARY_DRAFT_KIND && draft.schemaVersion === 2) {
    assertKnownKeys(draft, DRAFT_V2_FIELDS, 'draft');
  }
  return {
    kind: DIARY_DRAFT_KIND,
    schemaVersion: 2,
    routeId: requiredText(draft.routeId, 'Diary draft routeId', 200),
    sourceVersion: optionalText(draft.sourceVersion, 200) || 'unknown',
    updatedAt: validTime(draft.updatedAt, 'Diary draft updatedAt'),
    step: optionalText(draft.step, 100) || 'rating',
    rating: optionalRating(draft.rating, 'Diary draft rating'),
    tags: stringList(draft.tags, 'Diary draft tags', MAX_TAGS),
    notes: optionalText(draft.notes, MAX_NOTES_LENGTH) || '',
    overrides: normalizeOverrides(draft.overrides),
  };
}

export function serializeDiaryPrivateBackup(
  { entries = [], drafts = [] } = {},
  { generatedAt = new Date().toISOString() } = {},
) {
  const backup = {
    kind: DIARY_BACKUP_KIND,
    schemaVersion: DIARY_BACKUP_SCHEMA_VERSION,
    generatedAt: validTime(generatedAt, 'Diary backup generatedAt'),
    entries: normalizeCollection(entries, 'entry'),
    drafts: normalizeCollection(drafts, 'draft'),
  };
  assertUnique(backup.entries, (entry) => entry.id, 'Diary entry');
  assertUnique(backup.drafts, (draft) => draft.routeId, 'Diary draft');
  assertBackupSize(JSON.stringify(backup));
  return backup;
}

export function parseDiaryPrivateBackup(value) {
  assertBackupSize(value);
  let raw;
  try {
    raw = typeof value === 'string' ? JSON.parse(value) : structuredClone(value);
  } catch {
    throw new Error('Diary backup is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object') throw new Error('Unsupported Diary backup schema.');

  const isLegacy = raw.schemaVersion === 1 && raw.kind == null;
  const isCurrent = raw.kind === DIARY_BACKUP_KIND && raw.schemaVersion === 2;
  if (!isLegacy && !isCurrent) throw new Error('Unsupported Diary backup schema.');
  if (isCurrent) assertKnownKeys(raw, BACKUP_V2_FIELDS, 'backup');
  if (!Array.isArray(raw.entries) || (!isLegacy && !Array.isArray(raw.drafts))) {
    throw new Error('Unsupported Diary backup schema.');
  }
  const generatedAt = isLegacy && raw.generatedAt == null
    ? new Date(0).toISOString()
    : validTime(raw.generatedAt, 'Diary backup generatedAt');
  const entries = normalizeCollection(raw.entries, 'entry', { allowLegacy: isLegacy });
  const drafts = normalizeCollection(isLegacy ? [] : raw.drafts, 'draft', { allowLegacy: isLegacy });
  assertUnique(entries, (entry) => entry.id, 'Diary entry');
  assertUnique(drafts, (draft) => draft.routeId, 'Diary draft');

  return {
    kind: DIARY_BACKUP_KIND,
    schemaVersion: 2,
    generatedAt,
    entries,
    drafts,
    migratedFrom: isLegacy ? 1 : null,
  };
}

export function createDiaryBackupPlan(
  currentSnapshot,
  backupValue,
  { mode = 'merge' } = {},
) {
  if (mode !== 'merge' && mode !== 'replace') {
    throw new Error('Diary backup plan mode must be merge or replace.');
  }
  const snapshotToken = createDiarySnapshotToken(currentSnapshot);
  const current = {
    entries: normalizeCollection(currentSnapshot?.entries || [], 'entry'),
    drafts: normalizeCollection(currentSnapshot?.drafts || [], 'draft'),
  };
  const incoming = parseDiaryPrivateBackup(backupValue);
  const entryPlan = mergeCollection(current.entries, incoming.entries, (entry) => entry.id, mode);
  const draftPlan = mergeCollection(current.drafts, incoming.drafts, (draft) => draft.routeId, mode);
  return deepFreeze({
    mode,
    snapshotToken,
    requiresExplicitConfirmation: mode === 'replace',
    source: incoming,
    backup: {
      kind: DIARY_BACKUP_KIND,
      schemaVersion: DIARY_BACKUP_SCHEMA_VERSION,
      generatedAt: incoming.generatedAt,
      entries: incoming.entries,
      drafts: incoming.drafts,
    },
    summary: {
      entriesAdded: entryPlan.added,
      entriesUpdated: entryPlan.updated,
      entriesUnchanged: entryPlan.unchanged,
      entriesRetained: entryPlan.retained,
      entryConflicts: entryPlan.conflicts,
      draftsAdded: draftPlan.added,
      draftsUpdated: draftPlan.updated,
      draftsUnchanged: draftPlan.unchanged,
      draftsRetained: draftPlan.retained,
      draftConflicts: draftPlan.conflicts,
      entriesRemoved: entryPlan.removed,
      draftsRemoved: draftPlan.removed,
    },
    snapshot: {
      entries: entryPlan.values,
      drafts: draftPlan.values,
    },
  });
}

export function createDiarySnapshotToken(snapshot) {
  const entries = normalizeCollection(snapshot?.entries || [], 'entry')
    .sort((a, b) => a.id.localeCompare(b.id));
  const drafts = normalizeCollection(snapshot?.drafts || [], 'draft')
    .sort((a, b) => a.routeId.localeCompare(b.routeId));
  const warnings = (Array.isArray(snapshot?.warnings) ? snapshot.warnings : [])
    .map((warning) => ({
      scope: String(warning?.scope || ''),
      key: String(warning?.key || ''),
      message: String(warning?.message || ''),
    }))
    .sort((a, b) => (
      a.scope.localeCompare(b.scope)
      || a.key.localeCompare(b.key)
      || a.message.localeCompare(b.message)
    ));
  return JSON.stringify({ entries, drafts, warnings });
}

function normalizeCollection(values, type, { allowLegacy = true } = {}) {
  if (!Array.isArray(values)) throw new Error(`Diary ${type} collection must be an array.`);
  const limit = type === 'entry' ? MAX_ENTRIES : MAX_DRAFTS;
  if (values.length > limit) throw new Error(`Diary backup contains too many ${type}s.`);
  return values.map((value, index) => {
    try {
      return type === 'entry'
        ? normalizeDiaryEntry(value, { allowLegacy })
        : normalizeDiaryDraft(value, { allowLegacy });
    } catch (error) {
      throw new Error(`Invalid Diary ${type} at index ${index}: ${error.message}`);
    }
  });
}

function mergeCollection(current, incoming, keyOf, mode) {
  const currentByKey = new Map(current.map((value) => [keyOf(value), value]));
  const incomingByKey = new Map(incoming.map((value) => [keyOf(value), value]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let retained = 0;
  let conflicts = 0;
  const selectedByKey = new Map(currentByKey);
  for (const [key, value] of incomingByKey) {
    const existing = currentByKey.get(key);
    if (!existing) {
      added += 1;
      selectedByKey.set(key, value);
    } else if (JSON.stringify(existing) === JSON.stringify(value)) {
      unchanged += 1;
    } else if (mode === 'replace' || Date.parse(value.updatedAt) > Date.parse(existing.updatedAt)) {
      updated += 1;
      selectedByKey.set(key, value);
    } else if (Date.parse(value.updatedAt) < Date.parse(existing.updatedAt)) {
      retained += 1;
    } else {
      conflicts += 1;
    }
  }
  const removed = mode === 'replace'
    ? [...currentByKey.keys()].filter((key) => !incomingByKey.has(key)).length
    : 0;
  const values = mode === 'replace'
    ? [...incomingByKey.values()]
    : [...selectedByKey.values()];
  return { values, added, updated, unchanged, retained, conflicts, removed };
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unknown Diary ${label} field: ${key}.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertBackupSize(value) {
  let byteLength;
  try {
    const json = typeof value === 'string' ? value : JSON.stringify(value);
    byteLength = new TextEncoder().encode(json).byteLength;
  } catch {
    throw new Error('Diary backup is not serializable.');
  }
  if (byteLength > MAX_BACKUP_BYTES) throw new Error('Diary backup is too large.');
}

function assertUnique(values, keyOf, label) {
  const keys = new Set();
  for (const value of values) {
    const key = keyOf(value);
    if (keys.has(key)) throw new Error(`Duplicate ${label} key: ${key}.`);
    keys.add(key);
  }
}

function requiredText(value, label, maxLength) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) throw new Error(`${label} is invalid.`);
  return text;
}

function optionalText(value, maxLength) {
  if (value == null) return null;
  const text = String(value).trim();
  if (text.length > maxLength) throw new Error('Diary text value is too long.');
  return text || null;
}

function validTime(value, label) {
  const text = String(value ?? '');
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error(`${label} is invalid.`);
  return text;
}

function ratingValue(value, label) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new Error(`${label} is invalid.`);
  return rating;
}

function optionalRating(value, label) {
  if (value == null || value === '') return null;
  return ratingValue(value, label);
}

function stringList(value, label, limit) {
  const values = value == null ? [] : value;
  if (!Array.isArray(values) || values.length > limit) throw new Error(`${label} is invalid.`);
  return [...new Set(values.map((item) => requiredText(item, label, 500)))];
}

function normalizeOverrides(value) {
  if (value == null) return {};
  const entries = Array.isArray(value)
    ? value.map((override) => [override?.segment_id, override?.rating])
    : typeof value === 'object'
      ? Object.entries(value)
      : null;
  if (!entries) throw new Error('Diary segment overrides are invalid.');
  if (entries.length > MAX_SEGMENTS) throw new Error('Diary segment overrides are too large.');
  return Object.fromEntries(entries.map(([segmentId, rating]) => [
    requiredText(segmentId, 'Diary segment override id', 500),
    ratingValue(rating, 'Diary segment override rating'),
  ]));
}

function normalizeRouteGeometry(geometry) {
  if (!geometry || (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString')) {
    throw new Error('Diary route geometry is invalid.');
  }
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Diary route geometry is invalid.');
  let coordinateCount = 0;
  const normalizedLines = lines.map((line) => {
    if (!Array.isArray(line) || line.length < 2) throw new Error('Diary route geometry is invalid.');
    return line.map((coordinate) => {
      coordinateCount += 1;
      if (
        coordinateCount > MAX_SEGMENTS * 10
        || !Array.isArray(coordinate)
        || coordinate.length < 2
        || !Number.isFinite(Number(coordinate[0]))
        || !Number.isFinite(Number(coordinate[1]))
      ) {
        throw new Error('Diary route geometry is invalid.');
      }
      const longitude = Number(coordinate[0]);
      const latitude = Number(coordinate[1]);
      if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        throw new Error('Diary route geometry is invalid.');
      }
      return [longitude, latitude];
    });
  });
  return {
    type: geometry.type,
    coordinates: geometry.type === 'LineString' ? normalizedLines[0] : normalizedLines,
  };
}
