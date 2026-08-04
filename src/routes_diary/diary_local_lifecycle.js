import { createDiaryDraft } from './local_repository.js';

let latestDraftTimestamp = 0;

function requireRouteId(value) {
  const routeId = String(value ?? '').trim();
  if (!routeId) throw new Error('Diary draft requires a route id.');
  return routeId;
}

export function createDiaryLocalLifecycle({
  repository,
  isCurrent = () => true,
  now = () => new Date().toISOString(),
} = {}) {
  if (!repository) throw new Error('Diary local lifecycle requires a repository.');

  let active = true;
  const committingRoutes = new Set();
  let importing = false;

  const ownsSession = () => active && isCurrent();
  const observeDraftTimestamp = (value) => {
    const observed = Date.parse(value?.updatedAt);
    if (Number.isFinite(observed)) latestDraftTimestamp = Math.max(latestDraftTimestamp, observed);
  };
  const nextDraftTimestamp = () => {
    const requested = Date.parse(now());
    const next = Math.max(Number.isFinite(requested) ? requested : Date.now(), latestDraftTimestamp + 1);
    latestDraftTimestamp = next;
    return new Date(next).toISOString();
  };

  return {
    async loadDraft(routeId) {
      const key = requireRouteId(routeId);
      const draft = await repository.getDraft(key);
      observeDraftTimestamp(draft);
      return ownsSession()
        ? { applied: true, draft }
        : { applied: false, reason: 'stale', draft: null };
    },

    persistDraft(routeId, draft, { routeSourceVersion = 'demo-v1' } = {}) {
      const key = requireRouteId(routeId);
      if (!ownsSession()) return Promise.resolve({ applied: false, reason: 'stale' });
      if (importing || committingRoutes.has(key)) {
        return Promise.resolve({ applied: false, reason: 'pending' });
      }
      const value = createDiaryDraft({
        routeId: key,
        sourceVersion: String(routeSourceVersion || 'demo-v1'),
        updatedAt: nextDraftTimestamp(),
        step: draft?.step,
        rating: draft?.overallRating ?? draft?.rating,
        tags: Array.from(draft?.tags || []),
        notes: draft?.notes,
        overrides: normalizeDraftOverrides(draft?.overrides),
      });
      const normalizeWrite = (result, candidate) => (
        result && typeof result === 'object' && 'applied' in result
          ? result
          : { applied: true, draft: result || candidate }
      );
      return Promise.resolve(repository.saveDraft(value)).then((result) => {
        const write = normalizeWrite(result, value);
        observeDraftTimestamp(write.draft);
        if (!write.applied) return { applied: false, reason: write.reason || 'superseded' };
        return ownsSession()
          ? { applied: true, draft: write.draft }
          : { applied: false, reason: 'stale' };
      });
    },

    async commitEntry(entry, routeId) {
      const key = requireRouteId(routeId);
      if (!ownsSession()) return { applied: false, reason: 'stale' };
      if (importing || committingRoutes.has(key)) return { applied: false, reason: 'pending' };
      committingRoutes.add(key);
      try {
        const commit = repository.commitEntryAndDeleteDraft
          ? () => repository.commitEntryAndDeleteDraft(entry, key)
          : () => repository.commitEntry(entry, { draftRouteId: key });
        const saved = await commit();
        return ownsSession()
          ? { applied: true, entry: saved }
          : { applied: false, reason: 'stale' };
      } finally {
        committingRoutes.delete(key);
      }
    },

    async deleteEntry(id) {
      if (!ownsSession()) return { applied: false, reason: 'stale' };
      if (importing) return { applied: false, reason: 'pending' };
      const remove = repository.deleteEntry || repository.delete;
      if (!remove) throw new Error('Diary repository cannot delete entries.');
      await remove.call(repository, id);
      return ownsSession()
        ? { applied: true }
        : { applied: false, reason: 'stale' };
    },

    async snapshot() {
      if (!repository.snapshot) throw new Error('Diary repository cannot snapshot local data.');
      const snapshot = await repository.snapshot();
      for (const draft of snapshot?.drafts || []) observeDraftTimestamp(draft);
      return snapshot;
    },

    async applyImport(prepared, options) {
      if (!ownsSession()) return { applied: false, reason: 'stale' };
      if (importing) return { applied: false, reason: 'pending' };
      const strategy = options?.strategy || prepared?.mode || 'merge';
      if (strategy === 'replace' && options?.confirmReplace !== true) {
        throw new Error('Replacing Diary data requires explicit confirmation.');
      }
      if (!repository.applyBackup) throw new Error('Diary repository cannot atomically apply imported data.');
      importing = true;
      try {
        if (!ownsSession()) return { applied: false, reason: 'stale' };
        const result = await repository.applyBackup(prepared.backup, {
          strategy,
          expectedSnapshotToken: prepared.snapshotToken,
        });
        for (const draft of result.snapshot?.drafts || []) observeDraftTimestamp(draft);
        return ownsSession()
          ? { applied: true, plan: result.plan, snapshot: result.snapshot }
          : { applied: false, reason: 'stale' };
      } finally {
        importing = false;
      }
    },

    dispose() {
      active = false;
      importing = false;
      committingRoutes.clear();
    },
  };
}

function normalizeDraftOverrides(value) {
  if (value == null) return {};
  if (value instanceof Map || Array.isArray(value)) return Object.fromEntries(value);
  return value;
}
