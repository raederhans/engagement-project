export const QUERY_PRESETS = Object.freeze({
  'latest-6-months': Object.freeze({ durationMonths: 6 }),
  'latest-24-months': Object.freeze({ durationMonths: 24 }),
});

function defaultCanonicalSnapshot(state) {
  return structuredClone(state || {});
}

function canonicalSnapshot(state, normalizeCanonical = defaultCanonicalSnapshot) {
  return normalizeCanonical(state || {});
}

function canonicalKey(state, serializeCanonical = JSON.stringify) {
  return serializeCanonical(state);
}

function recentStartMonth(durationMonths, coverageMax) {
  const month = String(coverageMax || '').slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - (durationMonths - 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function coverageBasis(coverage) {
  return {
    status: coverage?.status || null,
    min: String(coverage?.min || '').slice(0, 7) || null,
    max: String(coverage?.max || '').slice(0, 7) || null,
  };
}

export function createQueryPresetPreview({
  presetId,
  currentState,
  coverage,
  normalizeCanonical,
  serializeCanonical,
} = {}) {
  const preset = QUERY_PRESETS[presetId];
  const basis = coverageBasis(coverage);
  const coverageMin = basis.min || '';
  const coverageMax = basis.max || '';
  if (!preset || coverage?.status !== 'ready') return { status: 'unavailable' };
  const startMonth = recentStartMonth(preset.durationMonths, coverageMax);
  if (!startMonth || (coverageMin && startMonth < coverageMin)) return { status: 'unavailable' };

  const before = canonicalSnapshot(currentState, normalizeCanonical);
  const patch = {
    startMonth,
    durationMonths: preset.durationMonths,
  };
  const after = canonicalSnapshot({ ...before, ...patch }, normalizeCanonical);
  const changes = Object.keys(patch)
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }));
  return {
    status: changes.length ? 'preview' : 'unchanged',
    presetId,
    before,
    after,
    patch,
    beforeKey: canonicalKey(before, serializeCanonical),
    afterKey: canonicalKey(after, serializeCanonical),
    coverageBasis: basis,
    changes,
  };
}

export function createQueryPresetController({
  readCanonical,
  readCoverage,
  replaceCanonical,
  syncControls,
  writeCanonicalUrl,
  clearCurrentArtifact,
  requestSingleCrimeRefresh,
} = {}) {
  let preview = null;
  let pending = false;
  let undoToken = null;

  async function commitCanonical(next, status) {
    pending = true;
    let failedPort = 'replace';
    try {
      replaceCanonical?.(next);
      failedPort = 'sync';
      await syncControls?.();
      failedPort = 'url';
      writeCanonicalUrl?.();
      failedPort = 'clear';
      clearCurrentArtifact?.();
      failedPort = 'refresh';
      return { status, refresh: await requestSingleCrimeRefresh?.() };
    } catch (error) {
      return {
        status: 'incomplete',
        intendedStatus: status,
        failedPort,
        error: String(error?.message || error),
      };
    } finally {
      pending = false;
    }
  }

  function previewPreset(presetId) {
    preview = createQueryPresetPreview({
      presetId,
      currentState: readCanonical?.(),
      coverage: readCoverage?.(),
    });
    return preview;
  }

  function cancelPreview() {
    if (pending) return { status: 'pending' };
    preview = null;
    return { status: 'cancelled' };
  }

  async function confirmPreview() {
    if (pending) return { status: 'pending' };
    if (preview?.status === 'unchanged') {
      preview = null;
      return { status: 'unchanged' };
    }
    if (preview?.status !== 'preview') return { status: 'unavailable' };
    const currentKey = canonicalKey(canonicalSnapshot(readCanonical?.()));
    const currentBasis = coverageBasis(readCoverage?.());
    if (currentKey !== preview.beforeKey
      || canonicalKey(currentBasis) !== canonicalKey(preview.coverageBasis)) {
      preview = null;
      return { status: 'stale' };
    }
    const transaction = preview;
    preview = null;
    undoToken = {
      before: transaction.before,
      afterKey: transaction.afterKey,
    };
    return commitCanonical(transaction.after, 'applied');
  }

  async function undo() {
    if (pending) return { status: 'pending' };
    if (!undoToken) return { status: 'unavailable' };
    const currentKey = canonicalKey(canonicalSnapshot(readCanonical?.()));
    if (currentKey !== undoToken.afterKey) {
      undoToken = null;
      return { status: 'stale' };
    }
    const transaction = undoToken;
    undoToken = null;
    return commitCanonical(transaction.before, 'undone');
  }

  return {
    previewPreset,
    cancelPreview,
    confirmPreview,
    undo,
    canUndo: () => Boolean(undoToken),
    getPreview: () => preview,
  };
}

export function initCrimeQueryPreset({
  mount,
  documentRef = globalThis.document,
  translate = (key) => key,
  subscribeLanguageChange = () => () => {},
  state = {},
  normalize = defaultCanonicalSnapshot,
  readCanonical = () => normalize(state),
  readCoverage = () => ({
    status: state.coverageStatus,
    min: state.coverageMin,
    max: state.coverageMax,
  }),
  replace = () => {},
  sync = () => {},
  url = () => {},
  clear = () => {},
  refresh = async () => ({ applied: false, status: 'unavailable' }),
} = {}) {
  const dialog = mount?.querySelector?.('[data-query-preset-dialog]');
  const status = mount?.querySelector?.('[data-query-preset-status]');
  const changes = mount?.querySelector?.('[data-query-preset-changes]');
  const cancelButton = mount?.querySelector?.('[data-query-preset-cancel]');
  const confirmButton = mount?.querySelector?.('[data-query-preset-confirm]');
  const undoButton = mount?.querySelector?.('[data-query-preset-undo]');
  const controller = createQueryPresetController({
    readCanonical,
    readCoverage,
    replaceCanonical: replace,
    syncControls: sync,
    writeCanonicalUrl: url,
    clearCurrentArtifact: clear,
    requestSingleCrimeRefresh: refresh,
  });
  const listeners = [];
  let view = { status: 'idle', preview: null };

  const listen = (element, type, listener) => {
    element?.addEventListener?.(type, listener);
    listeners.push([element, type, listener]);
  };

  const renderChanges = (preview) => {
    const items = preview?.changes?.map((change) => {
      const item = documentRef?.createElement?.('li');
      if (!item) return null;
      item.textContent = translate(`preset.change.${change.field}`, {
        before: change.before ?? translate('preset.unknown'),
        after: change.after ?? translate('preset.unknown'),
      });
      return item;
    }).filter(Boolean) || [];
    changes?.replaceChildren?.(...items);
  };

  const render = () => {
    renderChanges(view.preview);
    const transactionPending = view.status === 'pending';
    if (confirmButton) confirmButton.disabled = view.status !== 'preview';
    if (cancelButton) cancelButton.disabled = transactionPending;
    if (undoButton) {
      undoButton.hidden = !controller.canUndo();
      undoButton.disabled = transactionPending;
    }
    let statusKey = `preset.${view.status}`;
    if (view.status === 'preview') statusKey = 'preset.previewReady';
    else if (view.status === 'undo_stale') statusKey = 'preset.undoStale';
    else if (view.status === 'incomplete') statusKey = 'preset.appliedIncomplete';
    else if ((view.status === 'applied' || view.status === 'undone')
      && view.refresh?.status !== 'live') statusKey = 'preset.appliedIncomplete';
    else if (view.status === 'idle') statusKey = null;
    if (statusKey && status) status.textContent = translate(statusKey);
    else if (status) status.textContent = '';
  };

  const openPreset = (presetId) => {
    const preview = controller.previewPreset(presetId);
    view = {
      status: preview.status,
      preview: preview.status === 'preview' ? preview : null,
    };
    render();
    if (!dialog?.open) dialog?.showModal?.();
    return preview;
  };

  const cancelPreview = () => {
    const result = controller.cancelPreview();
    if (result.status === 'pending') return result;
    view = { status: 'idle', preview: null };
    dialog?.close?.();
    return result;
  };

  const confirmPreview = async () => {
    view = { ...view, status: 'pending' };
    render();
    const result = await controller.confirmPreview();
    view = result.status === 'applied'
      ? { ...view, status: 'applied', refresh: result.refresh }
      : { status: result.status, preview: null };
    render();
    return result;
  };

  const undo = async () => {
    view = { ...view, status: 'pending' };
    render();
    const result = await controller.undo();
    view = result.status === 'undone'
      ? { status: 'undone', preview: null, refresh: result.refresh }
      : { status: result.status === 'stale' ? 'undo_stale' : result.status, preview: null };
    render();
    return result;
  };

  listen(cancelButton, 'click', cancelPreview);
  listen(confirmButton, 'click', () => void confirmPreview());
  listen(undoButton, 'click', () => void undo());
  listen(dialog, 'cancel', (event) => {
    if (view.status === 'pending') event?.preventDefault?.();
    else controller.cancelPreview();
  });
  const releaseLanguage = subscribeLanguageChange(render);
  render();

  return {
    openPreset,
    cancelPreview,
    confirmPreview,
    undo,
    getPreview: controller.getPreview,
    canUndo: controller.canUndo,
    dispose() {
      releaseLanguage();
      for (const [element, type, listener] of listeners) {
        element?.removeEventListener?.(type, listener);
      }
    },
  };
}
