import {
  createDiaryBackupPlan as createDefaultBackupPlan,
  serializeDiaryPrivateBackup as serializeDefaultBackup,
} from './diary_data_portability.js';
import { downloadTextFile as downloadDefaultTextFile } from '../utils/export_analysis.js';

const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

function freezeSnapshot(value = {}) {
  const warnings = (Array.isArray(value.warnings) ? value.warnings : [])
    .map((warning) => Object.freeze({ ...(warning && typeof warning === 'object' ? warning : {}) }));
  const inferredInvalidCount = warnings.filter(({ scope }) => scope === 'entry' || scope === 'draft').length;
  const invalidCount = Number.isSafeInteger(value.invalidCount) && value.invalidCount >= 0
    ? value.invalidCount
    : inferredInvalidCount;
  const omittedCount = Number.isSafeInteger(value.omittedCount) && value.omittedCount >= 0
    ? value.omittedCount
    : invalidCount;
  const storageStatus = value.storageStatus === 'unavailable'
    ? 'unavailable'
    : value.storageStatus === 'partial' || omittedCount > 0 || invalidCount > 0
      ? 'partial'
      : 'available';
  const snapshot = {
    entries: Object.freeze([...(Array.isArray(value.entries) ? value.entries : [])]),
    drafts: Object.freeze([...(Array.isArray(value.drafts) ? value.drafts : [])]),
    storageStatus,
    warnings: Object.freeze(warnings),
    omittedCount,
    invalidCount,
  };
  return Object.freeze(snapshot);
}

const EMPTY_SNAPSHOT = freezeSnapshot({
  storageStatus: 'unavailable',
  warnings: [{ scope: 'storage', code: 'storage-unavailable' }],
  omittedCount: 0,
  invalidCount: 0,
});

function localizeControllerError(error, fallbackKey, translate) {
  const message = error?.message || String(error || '');
  const knownKeys = {
    'Diary backup is not valid JSON.': 'diary.backupInvalidJson',
    'Unsupported Diary backup schema.': 'diary.backupUnsupported',
    'Invalid Diary entry in backup.': 'diary.backupInvalidEntry',
    'Local Diary storage is unavailable in this browser.': 'diary.localStorageUnavailable',
  };
  return knownKeys[message] ? translate(knownKeys[message]) : (message || translate(fallbackKey));
}

export function createDiaryLocalController({
  repository,
  lifecycle,
  isCurrent = () => true,
  onChange = () => {},
  onEntryDeleted = () => {},
  translate = (key) => key,
  createBackupPlan = createDefaultBackupPlan,
  serializeBackup = serializeDefaultBackup,
  downloadTextFile = downloadDefaultTextFile,
  now = () => new Date(),
  createImportToken,
  importPreviewTtlMs,
} = {}) {
  if (!lifecycle) throw new Error('Diary local controller requires a lifecycle.');

  let active = true;
  let importSession = null;
  let viewState = Object.freeze({
    snapshot: EMPTY_SNAPSHOT,
    storageWarning: null,
    importPreview: null,
    replaceConfirm: false,
    deleteConfirmId: null,
    dataStatus: null,
    busy: false,
    focusTarget: null,
  });
  const ownsSession = () => active && isCurrent();

  const publish = (patch, metadata = {}) => {
    if (!ownsSession()) return false;
    viewState = Object.freeze({ ...viewState, ...patch });
    if (!metadata.silent) onChange(viewState, metadata);
    return true;
  };

  const readRepositorySnapshot = async () => {
    if (repository?.snapshot) return repository.snapshot();
    if (repository?.list) {
      return { entries: await repository.list(), drafts: [], warnings: [] };
    }
    return lifecycle.snapshot();
  };

  const applySnapshot = (snapshot) => {
    const normalized = freezeSnapshot(snapshot);
    const storageWarning = normalized.invalidCount
      ? translate('diary.storageRowsSkipped', { count: normalized.invalidCount })
      : null;
    return publish({ snapshot: normalized, storageWarning }, { snapshotChanged: true });
  };

  const refresh = async () => {
    if (!ownsSession()) return { applied: false, reason: 'stale' };
    const snapshot = await readRepositorySnapshot();
    return applySnapshot(snapshot)
      ? { applied: true, snapshot: viewState.snapshot }
      : { applied: false, reason: 'stale' };
  };

  const clearImportState = (patch = {}, metadata = {}) => {
    importSession?.consume();
    importSession = null;
    return publish({ importPreview: null, replaceConfirm: false, ...patch }, metadata);
  };

  const currentImportSession = (previewToken) => {
    const session = importSession;
    if (!session) return null;
    const status = session.status(previewToken, now());
    if (status === 'current') return session;
    if (status === 'expired') {
      clearImportState({
        dataStatus: { key: 'diary.backupPreviewStale', tone: 'error' },
        focusTarget: 'data-status',
      });
    }
    return null;
  };

  return {
    async initialize() {
      try {
        return await refresh();
      } catch (error) {
        if (!ownsSession()) return { applied: false, reason: 'stale' };
        const storageWarning = localizeControllerError(error, 'diary.localStorageUnavailable', translate);
        publish({ snapshot: EMPTY_SNAPSHOT, storageWarning }, { snapshotChanged: true });
        return { applied: false, reason: 'unavailable', error };
      }
    },

    async refresh() {
      return refresh();
    },

    async loadDraft(routeId) {
      return lifecycle.loadDraft(routeId);
    },

    persistDraft(routeId, draft, options) {
      clearImportState({}, { silent: true });
      return lifecycle.persistDraft(routeId, draft, options);
    },

    async commitEntry(entry, routeId) {
      if (!ownsSession()) return { applied: false, reason: 'stale' };
      const result = await lifecycle.commitEntry(entry, routeId);
      if (!result?.applied || !ownsSession()) return result;
      const refreshed = await refresh();
      if (!refreshed.applied) return refreshed;
      clearImportState({}, { silent: true });
      return result;
    },

    async deleteEntry(itemOrId) {
      const id = typeof itemOrId === 'object' ? itemOrId?.id : itemOrId;
      if (!id || viewState.busy || !ownsSession()) return { applied: false, reason: 'stale' };
      const label = typeof itemOrId === 'object' && itemOrId?.label
        ? itemOrId.label
        : translate('diary.untitledRoute');
      publish({
        busy: true,
        dataStatus: { key: 'diary.routeDeleting', params: { label } },
        focusTarget: 'data-status',
      });
      try {
        const result = await lifecycle.deleteEntry(id);
        if (!result?.applied || !ownsSession()) return result;
        const refreshed = await refresh();
        if (!refreshed.applied) return refreshed;
        importSession?.consume();
        importSession = null;
        publish({
          importPreview: null,
          replaceConfirm: false,
          deleteConfirmId: null,
          dataStatus: { key: 'diary.routeDeleted', params: { label } },
          focusTarget: 'history-title',
        });
        onEntryDeleted(id);
        return result;
      } catch (error) {
        if (!ownsSession()) return { applied: false, reason: 'stale' };
        publish({
          dataStatus: {
            key: 'diary.routeDeleteFailed',
            params: { message: localizeControllerError(error, 'diary.localStorageUnavailable', translate) },
            tone: 'error',
          },
          focusTarget: 'data-status',
        });
        return { applied: false, reason: 'failed', error };
      } finally {
        if (ownsSession()) publish({ busy: false });
      }
    },

    async prepareImport(file) {
      if (!file || viewState.busy || !ownsSession()) return { applied: false, reason: 'unavailable' };
      publish({
        busy: true,
        dataStatus: { key: 'diary.backupPreparing' },
        focusTarget: 'data-status',
      });
      try {
        if (Number(file.size) > MAX_BACKUP_BYTES) throw new Error('Diary backup is too large.');
        const text = await file.text();
        if (!ownsSession()) return { applied: false, reason: 'stale' };
        const snapshot = await readRepositorySnapshot();
        if (!ownsSession()) return { applied: false, reason: 'stale' };
        const { createDiaryImportPreviewSession } = await import('./diary_import_preview_session.js');
        if (!ownsSession()) return { applied: false, reason: 'stale' };
        const merge = createBackupPlan(snapshot, text, { mode: 'merge' });
        const replace = createBackupPlan(snapshot, text, { mode: 'replace' });
        importSession = createDiaryImportPreviewSession({ merge, replace }, {
          ...(createImportToken ? { createToken: createImportToken } : {}),
          ...(importPreviewTtlMs == null ? {} : { ttlMs: importPreviewTtlMs }),
          now,
        });
        const { token: previewToken, expiresAt } = importSession;
        const importPreview = Object.freeze({
          fileName: file.name || '',
          migratedFrom: merge.source.migratedFrom,
          mergeSummary: merge.summary,
          replaceSummary: replace.summary,
          previewToken,
          expiresAt: new Date(expiresAt).toISOString(),
        });
        publish({
          importPreview,
          replaceConfirm: false,
          dataStatus: { key: 'diary.backupReady' },
          focusTarget: 'import-preview',
        });
        return { applied: true, preview: importPreview };
      } catch (error) {
        if (!ownsSession()) return { applied: false, reason: 'stale' };
        importSession?.consume();
        importSession = null;
        publish({
          importPreview: null,
          replaceConfirm: false,
          dataStatus: {
            key: 'diary.backupOperationFailed',
            params: { message: localizeControllerError(error, 'diary.importFailed', translate) },
            tone: 'error',
          },
          focusTarget: 'data-status',
        });
        return { applied: false, reason: 'failed', error };
      } finally {
        if (ownsSession()) publish({ busy: false });
      }
    },

    async applyImport(strategy, { previewToken = importSession?.token } = {}) {
      if (viewState.busy || !ownsSession()) return { applied: false, reason: 'unavailable' };
      const session = currentImportSession(previewToken);
      if (!session) return { applied: false, reason: 'invalid-or-expired-token' };
      const prepared = session.plans[strategy];
      if (!prepared) return { applied: false, reason: 'unavailable' };
      if (strategy === 'replace' && viewState.replaceConfirm !== true) {
        return { applied: false, reason: 'confirmation-required' };
      }
      session.consume();
      importSession = null;
      publish({
        busy: true,
        importPreview: null,
        replaceConfirm: false,
        dataStatus: { key: 'diary.backupImporting' },
        focusTarget: 'data-status',
      });
      try {
        const result = await lifecycle.applyImport(prepared, {
          strategy,
          confirmReplace: strategy === 'replace',
        });
        if (!result?.applied || !ownsSession()) return result;
        const refreshed = await refresh();
        if (!refreshed.applied) return refreshed;
        publish({
          importPreview: null,
          replaceConfirm: false,
          dataStatus: {
            key: strategy === 'replace' ? 'diary.backupReplaced' : 'diary.backupMerged',
            params: {
              entries: viewState.snapshot.entries.length,
              drafts: viewState.snapshot.drafts.length,
            },
          },
          focusTarget: 'data-status',
        });
        return result;
      } catch (error) {
        if (!ownsSession()) return { applied: false, reason: 'stale' };
        if (error?.code === 'DIARY_BACKUP_PREVIEW_STALE') {
          publish({
            importPreview: null,
            replaceConfirm: false,
            dataStatus: { key: 'diary.backupPreviewStale', tone: 'error' },
            focusTarget: 'data-status',
          });
        } else {
          publish({
            dataStatus: {
              key: 'diary.backupOperationFailed',
              params: { message: localizeControllerError(error, 'diary.importFailed', translate) },
              tone: 'error',
            },
            focusTarget: 'data-status',
          });
        }
        return { applied: false, reason: 'failed', error };
      } finally {
        if (ownsSession()) publish({ busy: false });
      }
    },

    async exportBackup() {
      if (viewState.busy || !ownsSession()) return { applied: false, reason: 'unavailable' };
      publish({
        busy: true,
        dataStatus: { key: 'diary.backupExporting' },
        focusTarget: 'data-status',
      });
      try {
        const refreshed = await refresh();
        if (!refreshed.applied) return refreshed;
        const backup = serializeBackup(viewState.snapshot);
        const timestamp = now();
        const isoDate = (timestamp instanceof Date ? timestamp : new Date(timestamp)).toISOString().slice(0, 10);
        downloadTextFile(
          `engagement-diary-private-${isoDate}.json`,
          `${JSON.stringify(backup, null, 2)}\n`,
          'application/json',
        );
        publish({ dataStatus: { key: 'diary.backupExported' }, focusTarget: 'data-status' });
        return { applied: true, backup };
      } catch (error) {
        if (!ownsSession()) return { applied: false, reason: 'stale' };
        publish({
          dataStatus: {
            key: 'diary.backupOperationFailed',
            params: { message: localizeControllerError(error, 'diary.localStorageUnavailable', translate) },
            tone: 'error',
          },
          focusTarget: 'data-status',
        });
        return { applied: false, reason: 'failed', error };
      } finally {
        if (ownsSession()) publish({ busy: false });
      }
    },

    clearImportPreview({ notify = false } = {}) {
      importSession?.consume();
      importSession = null;
      if (notify) return clearImportState();
      viewState = Object.freeze({ ...viewState, importPreview: null, replaceConfirm: false });
      return true;
    },

    requestReplace(previewToken = importSession?.token) {
      if (!currentImportSession(previewToken)) return false;
      return publish({ replaceConfirm: true, dataStatus: null, focusTarget: 'replace-confirm' });
    },

    cancelImport() {
      return clearImportState({
        dataStatus: { key: 'diary.backupCancelled' },
        focusTarget: 'choose-backup',
      });
    },

    requestDelete(id) {
      return publish({ deleteConfirmId: id, dataStatus: null, focusTarget: `delete-confirm:${id}` });
    },

    cancelDelete(id) {
      return publish({ deleteConfirmId: null, focusTarget: `delete-action:${id}` });
    },

    takeFocusTarget() {
      const focusTarget = viewState.focusTarget;
      viewState = Object.freeze({ ...viewState, focusTarget: null });
      return focusTarget;
    },

    localizeError(error, fallbackKey) {
      return localizeControllerError(error, fallbackKey, translate);
    },

    getViewState() {
      return viewState;
    },

    dispose() {
      if (!active) return;
      active = false;
      importSession?.consume();
      importSession = null;
      lifecycle.dispose();
    },
  };
}
