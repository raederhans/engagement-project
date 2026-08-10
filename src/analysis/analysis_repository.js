import { openDB } from 'idb';

import {
  renameAnalysisArtifact,
  validateAnalysisArtifact,
} from './analysis_artifact.js';

export const ANALYSIS_DB_NAME = 'engagement-analysis';
export const ANALYSIS_DB_VERSION = 1;
export const ANALYSIS_STORE_NAME = 'analysis_artifacts';
export const ANALYSIS_UPDATED_AT_INDEX = 'updatedAt';

function requireArtifactId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.length > 160) throw new Error('Invalid analysis artifact id.');
  return id;
}

function warningFor(row, error) {
  return {
    id: typeof row?.id === 'string' ? row.id : null,
    message: error instanceof Error ? error.message : String(error),
  };
}

export function createAnalysisRepository({ adapter } = {}) {
  if (!adapter) throw new Error('Analysis repository requires a storage adapter.');

  async function get(id) {
    const row = await adapter.get(requireArtifactId(id));
    return row == null ? null : validateAnalysisArtifact(row);
  }

  return {
    async save(value) {
      const artifact = validateAnalysisArtifact(value);
      await adapter.put(artifact);
      return artifact;
    },

    async saveManyAtomic(values) {
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error('Invalid analysis import.');
      }
      if (typeof adapter.putManyAtomic !== 'function') {
        throw new Error('Atomic analysis import is unavailable.');
      }
      const artifacts = values.map(validateAnalysisArtifact);
      if (new Set(artifacts.map(({ id }) => id)).size !== artifacts.length) {
        throw new Error('Duplicate analysis import id.');
      }
      await adapter.putManyAtomic(artifacts);
      return artifacts;
    },

    async list() {
      const rows = await adapter.getAll();
      const items = [];
      const warnings = [];
      for (const row of rows || []) {
        try {
          items.push(validateAnalysisArtifact(row));
        } catch (error) {
          warnings.push(warningFor(row, error));
        }
      }
      items.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      return { items, warnings };
    },

    get,

    async rename(id, title, options) {
      const current = await get(id);
      if (!current) return null;
      const renamed = renameAnalysisArtifact(current, title, options);
      await adapter.put(renamed);
      return renamed;
    },

    async delete(id) {
      await adapter.delete(requireArtifactId(id));
      return true;
    },
  };
}

export function createIndexedDbAnalysisAdapter({
  openDatabase = openDB,
  onStatus = () => {},
} = {}) {
  let dbPromise = null;
  let activeDb = null;

  function emit(type, message) {
    try {
      onStatus({ type, fatal: false, message });
    } catch {
      // Storage lifecycle reporting must never interrupt persistence operations.
    }
  }

  function reset({ close = false } = {}) {
    if (close) {
      try { activeDb?.close(); } catch {}
    }
    activeDb = null;
    dbPromise = null;
  }

  function connect() {
    if (!dbPromise) {
      dbPromise = Promise.resolve(openDatabase(ANALYSIS_DB_NAME, ANALYSIS_DB_VERSION, {
        upgrade(db, _oldVersion, _newVersion, transaction) {
          const store = db.objectStoreNames.contains(ANALYSIS_STORE_NAME)
            ? transaction.objectStore(ANALYSIS_STORE_NAME)
            : db.createObjectStore(ANALYSIS_STORE_NAME, { keyPath: 'id' });
          if (!store.indexNames.contains(ANALYSIS_UPDATED_AT_INDEX)) {
            store.createIndex(ANALYSIS_UPDATED_AT_INDEX, 'updatedAt');
          }
        },
        blocked() {
          emit('blocked', 'Analysis storage upgrade is blocked by another open tab.');
        },
        blocking() {
          emit('blocking', 'Analysis storage closed so another tab can upgrade it.');
          reset({ close: true });
        },
        terminated() {
          emit('terminated', 'Analysis storage connection ended unexpectedly and will reopen when needed.');
          reset({ close: true });
        },
      }))
        .then((db) => {
          activeDb = db;
          return db;
        })
        .catch((error) => {
          reset();
          throw error;
        });
    }
    return dbPromise;
  }

  async function write(operation) {
    const db = await connect();
    const tx = db.transaction(ANALYSIS_STORE_NAME, 'readwrite');
    try {
      await operation(tx.store);
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch {}
      try { await tx.done; } catch {}
      throw error;
    }
  }

  return {
    ready: connect,

    async put(value) {
      await write((store) => store.put(value));
    },

    async putManyAtomic(values) {
      await write(async (store) => {
        for (const value of values) await store.add(value);
      });
    },

    async get(id) {
      const db = await connect();
      return (await db.get(ANALYSIS_STORE_NAME, id)) ?? null;
    },

    async getAll() {
      const db = await connect();
      return await db.getAll(ANALYSIS_STORE_NAME);
    },

    async delete(id) {
      await write((store) => store.delete(id));
    },

    close() {
      reset({ close: true });
    },
  };
}
