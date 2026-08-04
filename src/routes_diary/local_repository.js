import {
  createDiaryBackupPlan,
  createDiarySnapshotToken,
  normalizeDiaryDraft,
  normalizeDiaryEntry,
  parseDiaryPrivateBackup,
  serializeDiaryPrivateBackup,
} from './diary_data_portability.js';

const DB_NAME = 'engagement-diary';
const DB_VERSION = 2;
const ENTRY_STORE = 'route_entries';
const DRAFT_STORE = 'rating_drafts';

export function createDiaryEntry({
  payload,
  routeFeature,
  createdAt = new Date().toISOString(),
  id = globalThis.crypto?.randomUUID?.() || `local-${Date.now()}`,
} = {}) {
  const properties = routeFeature?.properties || {};
  const routeId = properties.route_id || payload?.route_id || null;
  const label = properties.name
    || [properties.from, properties.to].filter(Boolean).join(' → ')
    || routeId
    || 'Saved route';
  return normalizeDiaryEntry({
    id: String(id),
    createdAt,
    updatedAt: createdAt,
    routeId,
    label: String(label),
    mode: properties.mode === 'bike' ? 'bike' : 'walk',
    score: Number(payload?.overall_rating) || 0,
    tags: Array.isArray(payload?.tags) ? payload.tags : [],
    segmentIds: Array.isArray(payload?.segment_ids) ? payload.segment_ids : [],
    routeGeometry: routeFeature?.geometry || null,
    routeSourceVersion: String(properties.source_version || 'demo-v1'),
    notes: payload?.notes || '',
    segmentOverrides: payload?.segment_overrides || {},
  });
}

export function createDiaryDraft({
  routeId,
  sourceVersion = 'unknown',
  updatedAt = new Date().toISOString(),
  step = 'rating',
  rating = null,
  tags = [],
  notes = '',
  overrides = {},
} = {}) {
  return normalizeDiaryDraft({
    routeId,
    sourceVersion,
    updatedAt,
    step,
    rating,
    tags,
    notes,
    overrides,
  });
}

export function createDiaryLocalRepository({ adapter = createIndexedDbAdapter() } = {}) {
  const getAllEntries = adapter.getAllEntries?.bind(adapter) || adapter.getAll?.bind(adapter);
  const putEntry = adapter.putEntry?.bind(adapter) || adapter.put?.bind(adapter);
  const clearEntries = adapter.clearEntries?.bind(adapter) || adapter.clear?.bind(adapter);
  const draftIntentRevisions = new Map();
  let operationTail = Promise.resolve();

  const enqueue = (operation) => {
    const task = operationTail.catch(() => {}).then(operation);
    operationTail = task.catch(() => {});
    return task;
  };

  const readEntriesWithWarnings = async () => {
    const rows = await requireAdapter(getAllEntries, 'list entries')();
    const result = normalizeRows(rows, normalizeDiaryEntry, 'entry', (row) => row?.id);
    result.entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return result;
  };

  const readDraftsWithWarnings = async () => {
    if (!adapter.getAllDrafts) return { drafts: [], warnings: [] };
    const rows = await adapter.getAllDrafts();
    return normalizeRows(rows, normalizeDiaryDraft, 'draft', (row) => row?.routeId);
  };

  const readSnapshot = async () => {
    if (adapter.getSnapshot) {
      return normalizeSnapshotWithWarnings(await adapter.getSnapshot());
    }
    const [entryResult, draftResult] = await Promise.all([
      readEntriesWithWarnings(),
      readDraftsWithWarnings(),
    ]);
    return {
      entries: entryResult.entries,
      drafts: draftResult.drafts,
      warnings: [...entryResult.warnings, ...draftResult.warnings],
    };
  };

  const api = {
    async save(entry) {
      const normalized = normalizeDiaryEntry(entry);
      await enqueue(() => requireAdapter(putEntry, 'save entries')(structuredClone(normalized)));
      return normalized;
    },
    async list() {
      return (await api.listWithWarnings()).entries;
    },
    async listWithWarnings() {
      return enqueue(readEntriesWithWarnings);
    },
    async delete(id) {
      await enqueue(() => requireAdapter(adapter.deleteEntry?.bind(adapter), 'delete entries')(String(id)));
    },
    async clear() {
      await enqueue(() => requireAdapter(clearEntries, 'clear entries')());
    },
    async replace(entries) {
      const legacyAdapterValues = adapter.replaceAll && !adapter.getAllEntries
        ? (entries || []).map((entry) => structuredClone(entry))
        : null;
      const normalized = legacyAdapterValues == null
        ? normalizeRowsStrict(entries, normalizeDiaryEntry, 'entry')
        : null;
      await enqueue(async () => {
        if (adapter.replaceAll) {
          await adapter.replaceAll(
            legacyAdapterValues || normalized.map((entry) => structuredClone(entry)),
          );
        } else if (adapter.replaceSnapshot) {
          const drafts = adapter.getAllDrafts ? await adapter.getAllDrafts() : [];
          await adapter.replaceSnapshot({ entries: normalized, drafts });
        } else {
          throw unavailableOperation('replace entries');
        }
      });
      return api.list();
    },
    async saveDraft(draft) {
      const normalized = normalizeDiaryDraft(draft);
      const routeId = normalized.routeId;
      const revision = (draftIntentRevisions.get(routeId) || 0) + 1;
      draftIntentRevisions.set(routeId, revision);
      return enqueue(async () => {
        if (draftIntentRevisions.get(routeId) !== revision) {
          return { applied: false, reason: 'stale', draft: null };
        }
        const putDraft = requireAdapter(adapter.putDraft?.bind(adapter), 'save drafts');
        const write = async (candidate) => normalizeDraftWriteResult(
          await putDraft(structuredClone(candidate)),
          candidate,
        );
        let result = await write(normalized);
        if (draftIntentRevisions.get(routeId) !== revision) {
          return { applied: false, reason: 'stale', draft: null };
        }
        if (!result.applied && result.reason === 'superseded' && result.draft) {
          const retryDraft = createDiaryDraft({
            ...normalized,
            updatedAt: timestampAfter(normalized.updatedAt, result.draft.updatedAt),
          });
          result = await write(retryDraft);
          if (draftIntentRevisions.get(routeId) !== revision) {
            return { applied: false, reason: 'stale', draft: null };
          }
        }
        return result;
      });
    },
    async getDraft(routeId) {
      const row = await enqueue(() => requireAdapter(adapter.getDraft?.bind(adapter), 'read drafts')(String(routeId)));
      if (row == null) return null;
      return normalizeDiaryDraft(row);
    },
    async listDrafts() {
      return (await api.listDraftsWithWarnings()).drafts;
    },
    async listDraftsWithWarnings() {
      return enqueue(readDraftsWithWarnings);
    },
    async deleteDraft(routeId) {
      await enqueue(() => requireAdapter(adapter.deleteDraft?.bind(adapter), 'delete drafts')(String(routeId)));
    },
    async commitEntry(entry, { draftRouteId = entry?.routeId } = {}) {
      const normalized = normalizeDiaryEntry(entry);
      const routeId = String(draftRouteId || normalized.routeId || '');
      if (!routeId) throw new Error('Diary draft routeId is required for an atomic commit.');
      await enqueue(() => requireAdapter(adapter.commitEntry?.bind(adapter), 'commit entries')(normalized, routeId));
      return normalized;
    },
    async snapshot() {
      return enqueue(readSnapshot);
    },
    async applyBackup(backupValue, { strategy = 'merge', expectedSnapshotToken } = {}) {
      const result = await enqueue(() => requireAdapter(
        adapter.applyBackup?.bind(adapter),
        'atomically apply Diary backups',
      )(backupValue, { strategy, expectedSnapshotToken }));
      return {
        plan: result.plan,
        snapshot: normalizeSnapshotWithWarnings(result.snapshot),
      };
    },
    async mergeSnapshot(snapshot) {
      const normalized = normalizeSnapshot(snapshot);
      await enqueue(() => requireAdapter(adapter.mergeSnapshot?.bind(adapter), 'merge Diary snapshots')(normalized));
      return api.snapshot();
    },
    async replaceSnapshot(snapshot) {
      const normalized = normalizeSnapshot(snapshot);
      await enqueue(() => requireAdapter(adapter.replaceSnapshot?.bind(adapter), 'replace Diary snapshots')(normalized));
      return api.snapshot();
    },
    async clearAll() {
      await enqueue(() => requireAdapter(adapter.clearAll?.bind(adapter), 'clear Diary storage')());
    },
  };
  return api;
}

function normalizeDraftWriteResult(result, candidate) {
  if (result && typeof result === 'object' && 'applied' in result) {
    return {
      applied: Boolean(result.applied),
      ...(result.applied ? {} : { reason: result.reason || 'superseded' }),
      draft: result.draft == null ? null : normalizeDiaryDraft(result.draft),
    };
  }
  return { applied: true, draft: candidate };
}

function timestampAfter(candidateTimestamp, currentTimestamp) {
  const candidateTime = Date.parse(candidateTimestamp);
  const currentTime = Date.parse(currentTimestamp);
  const floor = Math.max(
    Number.isFinite(candidateTime) ? candidateTime : 0,
    Number.isFinite(currentTime) ? currentTime : 0,
  );
  return new Date(floor + 1).toISOString();
}

export function serializeDiaryBackup(entries = [], { generatedAt = new Date().toISOString() } = {}) {
  return serializeDiaryPrivateBackup({ entries, drafts: [] }, { generatedAt });
}

export function parseDiaryBackup(value) {
  return parseDiaryPrivateBackup(value).entries;
}

function normalizeSnapshot(snapshot) {
  return {
    entries: normalizeRowsStrict(snapshot?.entries || [], normalizeDiaryEntry, 'entry'),
    drafts: normalizeRowsStrict(snapshot?.drafts || [], normalizeDiaryDraft, 'draft'),
  };
}

function normalizeSnapshotWithWarnings(snapshot) {
  const entryResult = normalizeRows(snapshot?.entries, normalizeDiaryEntry, 'entry', (row) => row?.id);
  const draftResult = normalizeRows(snapshot?.drafts, normalizeDiaryDraft, 'draft', (row) => row?.routeId);
  return {
    entries: entryResult.entries,
    drafts: draftResult.drafts,
    warnings: [
      ...(Array.isArray(snapshot?.warnings) ? snapshot.warnings : []),
      ...entryResult.warnings,
      ...draftResult.warnings,
    ],
  };
}

function normalizeRows(rows, normalize, type, keyOf) {
  const values = [];
  const warnings = [];
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    try {
      values.push(normalize(row));
    } catch (error) {
      warnings.push({
        scope: type,
        key: String(keyOf(row) || index),
        message: `Invalid Diary ${type}: ${error.message}`,
      });
    }
  }
  return type === 'entry' ? { entries: values, warnings } : { drafts: values, warnings };
}

function normalizeRowsStrict(rows, normalize, type) {
  if (!Array.isArray(rows)) throw new Error(`Diary ${type} collection must be an array.`);
  return rows.map((row, index) => {
    try {
      return normalize(row);
    } catch (error) {
      throw new Error(`Invalid Diary ${type} at index ${index}: ${error.message}`);
    }
  });
}

function unavailableOperation(operation) {
  return new Error(`Local Diary storage cannot ${operation}.`);
}

function requireAdapter(operation, name) {
  if (!operation) throw unavailableOperation(name);
  return operation;
}

export function migrateLegacyDiaryEntryRecord(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {};
  const lifted = {
    id: raw.id,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt || raw.createdAt,
    routeId: raw.routeId ?? payload.route_id,
    label: raw.label,
    mode: raw.mode,
    score: raw.score ?? payload.overall_rating,
    tags: raw.tags ?? payload.tags,
    segmentIds: raw.segmentIds ?? payload.segment_ids,
    routeGeometry: raw.routeGeometry ?? null,
    routeSourceVersion: raw.routeSourceVersion,
    notes: raw.notes ?? payload.notes,
    segmentOverrides: raw.segmentOverrides ?? payload.segment_overrides,
  };
  try {
    return { value: normalizeDiaryEntry(lifted), warning: null };
  } catch (error) {
    return {
      value: lifted,
      warning: `Legacy Diary entry ${String(raw.id || '(unknown)')} could not be fully normalized: ${error.message}`,
    };
  }
}

export function createIndexedDbAdapter(indexedDb = globalThis.indexedDB) {
  if (!indexedDb) {
    const unavailable = async () => {
      throw new Error('Local Diary storage is unavailable in this browser.');
    };
    return {
      putEntry: unavailable,
      getAllEntries: unavailable,
      deleteEntry: unavailable,
      clearEntries: unavailable,
      putDraft: unavailable,
      getDraft: unavailable,
      getAllDrafts: unavailable,
      deleteDraft: unavailable,
      commitEntry: unavailable,
      clearAll: unavailable,
      mergeSnapshot: unavailable,
      replaceSnapshot: unavailable,
      getSnapshot: unavailable,
      applyBackup: unavailable,
      put: unavailable,
      getAll: unavailable,
      clear: unavailable,
      replaceAll: unavailable,
    };
  }

  const open = () => new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRY_STORE)) {
        const entries = db.createObjectStore(ENTRY_STORE, { keyPath: 'id' });
        entries.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        const drafts = db.createObjectStore(DRAFT_STORE, { keyPath: 'routeId' });
        drafts.createIndex('updatedAt', 'updatedAt');
      }
      if (event.oldVersion < 2 && db.objectStoreNames.contains(ENTRY_STORE)) {
        const entries = request.transaction.objectStore(ENTRY_STORE);
        const cursorRequest = entries.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const migrated = migrateLegacyDiaryEntryRecord(cursor.value);
          cursor.update(migrated.value);
          if (migrated.warning) console.warn(`[Diary] ${migrated.warning}`);
          cursor.continue();
        };
        cursorRequest.onerror = () => console.warn('[Diary] Legacy entry migration cursor failed.');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open local Diary storage.'));
  });

  const transact = async (storeNames, mode, operation) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        let result;
        try {
          result = operation(tx);
        } catch (error) {
          tx.abort();
          reject(error);
          return;
        }
        if (result && typeof result === 'object' && 'onsuccess' in result) {
          result.onsuccess = () => { result = result.result; };
          result.onerror = () => reject(result.error || new Error('Local Diary storage failed.'));
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Local Diary transaction failed.'));
        tx.onabort = () => reject(tx.error || new Error('Local Diary transaction was aborted.'));
      });
    } finally {
      db.close();
    }
  };

  const putEntry = (entry) => transact(ENTRY_STORE, 'readwrite', (tx) => tx.objectStore(ENTRY_STORE).put(entry));
  const getAllEntries = () => transact(ENTRY_STORE, 'readonly', (tx) => tx.objectStore(ENTRY_STORE).getAll());
  const deleteEntry = (id) => transact(ENTRY_STORE, 'readwrite', (tx) => tx.objectStore(ENTRY_STORE).delete(id));
  const clearEntries = () => transact(ENTRY_STORE, 'readwrite', (tx) => tx.objectStore(ENTRY_STORE).clear());

  const getSnapshot = () => transact([ENTRY_STORE, DRAFT_STORE], 'readonly', (tx) => {
    const snapshot = { entries: [], drafts: [] };
    const entriesRequest = tx.objectStore(ENTRY_STORE).getAll();
    const draftsRequest = tx.objectStore(DRAFT_STORE).getAll();
    entriesRequest.onsuccess = () => { snapshot.entries = entriesRequest.result || []; };
    draftsRequest.onsuccess = () => { snapshot.drafts = draftsRequest.result || []; };
    return snapshot;
  });

  const replaceStores = (snapshot, clearFirst) => transact(
    [ENTRY_STORE, DRAFT_STORE],
    'readwrite',
    (tx) => {
      const entries = tx.objectStore(ENTRY_STORE);
      const drafts = tx.objectStore(DRAFT_STORE);
      if (clearFirst) {
        entries.clear();
        drafts.clear();
      }
      for (const entry of snapshot.entries) entries.put(entry);
      for (const draft of snapshot.drafts) drafts.put(draft);
    },
  );

  const applyBackup = async (backupValue, { strategy = 'merge', expectedSnapshotToken } = {}) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction([ENTRY_STORE, DRAFT_STORE], 'readwrite');
        const entriesStore = tx.objectStore(ENTRY_STORE);
        const draftsStore = tx.objectStore(DRAFT_STORE);
        const entriesRequest = entriesStore.getAll();
        const draftsRequest = draftsStore.getAll();
        let entries;
        let drafts;
        let failure = null;
        let result = null;

        const abortWith = (error) => {
          if (failure) return;
          failure = error;
          try { tx.abort(); } catch {}
        };
        const applyWhenReady = () => {
          if (!entries || !drafts || failure) return;
          try {
            const current = normalizeSnapshotWithWarnings({ entries, drafts });
            const plan = createDiaryBackupPlan(current, backupValue, { mode: strategy });
            if (
              strategy === 'replace'
              && (!expectedSnapshotToken || expectedSnapshotToken !== createDiarySnapshotToken(current))
            ) {
              const error = new Error('Diary data changed since preview. Choose the backup again before replacing local data.');
              error.code = 'DIARY_BACKUP_PREVIEW_STALE';
              throw error;
            }
            if (strategy === 'replace') {
              entriesStore.clear();
              draftsStore.clear();
            }
            for (const entry of plan.snapshot.entries) entriesStore.put(entry);
            for (const draft of plan.snapshot.drafts) draftsStore.put(draft);
            result = {
              plan,
              snapshot: {
                ...plan.snapshot,
                warnings: current.warnings,
              },
            };
          } catch (error) {
            abortWith(error);
          }
        };

        entriesRequest.onsuccess = () => {
          entries = entriesRequest.result || [];
          applyWhenReady();
        };
        draftsRequest.onsuccess = () => {
          drafts = draftsRequest.result || [];
          applyWhenReady();
        };
        entriesRequest.onerror = () => { failure = entriesRequest.error; };
        draftsRequest.onerror = () => { failure = draftsRequest.error; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(failure || tx.error || new Error('Local Diary import transaction failed.'));
        tx.onabort = () => reject(failure || tx.error || new Error('Local Diary import transaction was aborted.'));
      });
    } finally {
      db.close();
    }
  };

  return {
    putEntry,
    getAllEntries,
    deleteEntry,
    clearEntries,
    getSnapshot,
    putDraft: (draft) => transact(DRAFT_STORE, 'readwrite', (tx) => {
      const store = tx.objectStore(DRAFT_STORE);
      const outcome = { applied: false, draft: null };
      const request = store.get(draft.routeId);
      request.onsuccess = () => {
        const current = request.result;
        const currentTime = Date.parse(current?.updatedAt);
        const draftTime = Date.parse(draft.updatedAt);
        if (!current || !Number.isFinite(currentTime) || draftTime >= currentTime) {
          store.put(draft);
          outcome.applied = true;
          outcome.draft = draft;
        } else {
          outcome.draft = current;
        }
      };
      return outcome;
    }),
    getDraft: (routeId) => transact(DRAFT_STORE, 'readonly', (tx) => tx.objectStore(DRAFT_STORE).get(routeId)),
    getAllDrafts: () => transact(DRAFT_STORE, 'readonly', (tx) => tx.objectStore(DRAFT_STORE).getAll()),
    deleteDraft: (routeId) => transact(DRAFT_STORE, 'readwrite', (tx) => tx.objectStore(DRAFT_STORE).delete(routeId)),
    commitEntry: (entry, routeId) => transact([ENTRY_STORE, DRAFT_STORE], 'readwrite', (tx) => {
      tx.objectStore(ENTRY_STORE).put(entry);
      tx.objectStore(DRAFT_STORE).delete(routeId);
    }),
    clearAll: () => transact([ENTRY_STORE, DRAFT_STORE], 'readwrite', (tx) => {
      tx.objectStore(ENTRY_STORE).clear();
      tx.objectStore(DRAFT_STORE).clear();
    }),
    mergeSnapshot: (snapshot) => replaceStores(snapshot, false),
    replaceSnapshot: (snapshot) => replaceStores(snapshot, true),
    applyBackup,
    put: putEntry,
    getAll: getAllEntries,
    clear: clearEntries,
    replaceAll: (entries) => transact(ENTRY_STORE, 'readwrite', (tx) => {
      const store = tx.objectStore(ENTRY_STORE);
      store.clear();
      for (const entry of entries) store.put(entry);
    }),
  };
}

export const diaryLocalRepository = createDiaryLocalRepository();
