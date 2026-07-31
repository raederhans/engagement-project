const DB_NAME = 'engagement-diary';
const STORE_NAME = 'route_entries';
const BACKUP_SCHEMA_VERSION = 1;

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
  return {
    id: String(id),
    createdAt,
    routeId,
    label: String(label),
    mode: properties.mode === 'bike' ? 'bike' : 'walk',
    score: Number(payload?.overall_rating) || 0,
    tags: Array.isArray(payload?.tags) ? [...new Set(payload.tags.map(String))] : [],
    segmentIds: Array.isArray(payload?.segment_ids) ? payload.segment_ids.map(String) : [],
    routeGeometry: isRouteGeometry(routeFeature?.geometry) ? structuredClone(routeFeature.geometry) : null,
    routeSourceVersion: String(properties.source_version || 'demo-v1'),
    payload: structuredClone(payload || {}),
  };
}

export function createDiaryLocalRepository({ adapter = createIndexedDbAdapter() } = {}) {
  return {
    async save(entry) {
      await adapter.put(structuredClone(entry));
      return entry;
    },
    async list() {
      const rows = await adapter.getAll();
      return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    async clear() {
      await adapter.clear();
    },
    async replace(entries) {
      await adapter.replaceAll((entries || []).map((entry) => structuredClone(entry)));
      return this.list();
    },
  };
}

export function serializeDiaryBackup(entries = [], { generatedAt = new Date().toISOString() } = {}) {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    generatedAt,
    entries: entries.map((entry) => structuredClone(entry)),
  };
}

export function parseDiaryBackup(value) {
  let backup;
  try {
    backup = typeof value === 'string' ? JSON.parse(value) : structuredClone(value);
  } catch {
    throw new Error('Diary backup is not valid JSON.');
  }
  if (!backup || backup.schemaVersion !== BACKUP_SCHEMA_VERSION || !Array.isArray(backup.entries)) {
    throw new Error('Unsupported Diary backup schema.');
  }
  return backup.entries.map(normalizeStoredEntry);
}

function normalizeStoredEntry(entry) {
  const createdAt = String(entry?.createdAt || '');
  const score = Number(entry?.score);
  if (
    !entry
    || !String(entry.id || '').trim()
    || !Number.isFinite(Date.parse(createdAt))
    || !Number.isFinite(score)
    || score < 1
    || score > 5
    || !Array.isArray(entry.tags)
    || !Array.isArray(entry.segmentIds)
    || (entry.routeGeometry != null && !isRouteGeometry(entry.routeGeometry))
    || !entry.payload
    || typeof entry.payload !== 'object'
  ) {
    throw new Error('Invalid Diary entry in backup.');
  }
  return {
    id: String(entry.id),
    createdAt,
    routeId: entry.routeId == null ? null : String(entry.routeId),
    label: String(entry.label || entry.routeId || 'Saved route'),
    mode: entry.mode === 'bike' ? 'bike' : 'walk',
    score,
    tags: [...new Set(entry.tags.map(String))],
    segmentIds: entry.segmentIds.map(String),
    routeGeometry: entry.routeGeometry == null ? null : structuredClone(entry.routeGeometry),
    routeSourceVersion: String(entry.routeSourceVersion || 'legacy'),
    payload: structuredClone(entry.payload),
  };
}

function isRouteGeometry(geometry) {
  return geometry?.type === 'LineString' || geometry?.type === 'MultiLineString';
}

export function createIndexedDbAdapter(indexedDb = globalThis.indexedDB) {
  if (!indexedDb) {
    const unavailable = async () => {
      throw new Error('Local Diary storage is unavailable in this browser.');
    };
    return {
      put: unavailable,
      getAll: unavailable,
      clear: unavailable,
      replaceAll: unavailable,
    };
  }
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open local Diary storage.'));
  });
  const run = async (mode, operation) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        let result;
        let request;
        try {
          request = operation(tx.objectStore(STORE_NAME));
        } catch (error) {
          tx.abort();
          reject(error);
          return;
        }
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => {
          reject(request.error || new Error('Local Diary storage failed.'));
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Local Diary transaction failed.'));
        tx.onabort = () => reject(tx.error || new Error('Local Diary transaction was aborted.'));
      });
    } finally {
      db.close();
    }
  };
  return {
    put: (entry) => run('readwrite', (store) => store.put(entry)),
    getAll: () => run('readonly', (store) => store.getAll()),
    clear: () => run('readwrite', (store) => store.clear()),
    async replaceAll(entries) {
      const db = await open();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Local Diary replacement failed.'));
          tx.onabort = () => reject(tx.error || new Error('Local Diary replacement was aborted.'));
          try {
            store.clear();
            for (const entry of entries) store.put(entry);
          } catch (error) {
            tx.abort();
            reject(error);
          }
        });
      } finally {
        db.close();
      }
    },
  };
}

export const diaryLocalRepository = createDiaryLocalRepository();
