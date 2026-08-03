import { onLanguageChange, setTranslatedAttribute, setTranslatedText, t } from '../i18n/index.js';

function button(key, action, id, reportActionError) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'analysis-history__action';
  setTranslatedText(element, key);
  element.addEventListener('click', () => {
    void Promise.resolve(action(id)).catch(reportActionError);
  });
  return element;
}

function snapshotLabel(artifact) {
  const generatedAt = artifact.resultSummary?.generatedAt;
  return generatedAt
    ? t('history.savedSnapshot', { date: new Date(generatedAt).toLocaleString() })
    : t('history.noSnapshot');
}

export function createAnalysisHistoryView(mount, actions) {
  mount.replaceChildren();
  mount.className = 'analysis-history';

  const heading = document.createElement('div');
  heading.className = 'analysis-history__heading';
  setTranslatedText(heading, 'history.title');

  const saveRow = document.createElement('div');
  saveRow.className = 'analysis-history__save';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.maxLength = 120;
  setTranslatedAttribute(titleInput, 'history.titlePlaceholder', 'placeholder');
  setTranslatedAttribute(titleInput, 'history.titleAria', 'aria-label');
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  setTranslatedText(saveButton, 'history.save');
  saveRow.append(titleInput, saveButton);

  const snapshot = document.createElement('div');
  snapshot.className = 'analysis-history__snapshot';
  snapshot.hidden = true;
  const status = document.createElement('div');
  status.className = 'analysis-history__status';
  status.setAttribute('aria-live', 'polite');
  const warning = document.createElement('div');
  warning.className = 'analysis-history__warning';
  const list = document.createElement('div');
  list.className = 'analysis-history__list';
  mount.append(heading, saveRow, snapshot, status, warning, list);
  let lastRenderModel = null;
  let refreshSnapshotTranslation = null;

  const reportActionError = (error) => {
    status.dataset.tone = 'warning';
    if (error?.message) {
      status.removeAttribute?.('data-i18n');
      status.textContent = error.message;
    } else {
      setTranslatedText(status, 'history.failed');
    }
  };
  saveButton.addEventListener('click', () => {
    void Promise.resolve(actions.onSave(titleInput.value)).catch(reportActionError);
  });

  function renderItem(artifact) {
    const card = document.createElement('article');
    card.className = 'analysis-history__item';
    const title = document.createElement('div');
    title.className = 'analysis-history__title';
    title.textContent = artifact.title;
    const meta = document.createElement('div');
    meta.className = 'analysis-history__meta';
    setTranslatedText(meta, 'history.meta', {
      mode: artifact.viewState.queryMode,
      month: artifact.viewState.startMonth || t('history.current'),
      date: new Date(artifact.updatedAt).toLocaleString(),
    });
    const dataStatus = document.createElement('div');
    dataStatus.className = 'analysis-history__data-status';
    if (artifact.dataStatus === 'provenance-mismatch') setTranslatedText(dataStatus, 'history.needsRefresh');
    else if (artifact.dataStatus === 'unknown') setTranslatedText(dataStatus, 'history.sourceUnknown');
    else setTranslatedText(dataStatus, 'history.sourcesCurrent');
    const controls = document.createElement('div');
    controls.className = 'analysis-history__actions';
    controls.append(
      button('history.open', actions.onRestore, artifact.id, reportActionError),
      button('history.share', actions.onShare, artifact.id, reportActionError),
      button('history.export', actions.onExport, artifact.id, reportActionError),
      button('history.rename', () => {
        const next = window.prompt(t('history.renamePrompt'), artifact.title);
        return next == null ? null : actions.onRename(artifact.id, next);
      }, artifact.id, reportActionError),
      button('history.delete', actions.onDelete, artifact.id, reportActionError),
    );
    card.append(title, meta, dataStatus, controls);
    return card;
  }

  function renderModel({ items, warnings, canSave, pending }) {
    saveButton.disabled = pending || !canSave;
    titleInput.disabled = pending;
    if (warnings?.length) {
      setTranslatedText(warning, warnings.length === 1 ? 'history.warningOne' : 'history.warningMany', {
        count: warnings.length,
      });
    } else {
      warning.textContent = '';
    }
    list.replaceChildren(...items.map(renderItem));
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'analysis-history__empty';
      setTranslatedText(empty, 'history.empty');
      list.appendChild(empty);
    }
  }

  onLanguageChange(() => {
    if (lastRenderModel) renderModel(lastRenderModel);
    refreshSnapshotTranslation?.();
  });

  return Object.freeze({
    render(model) {
      lastRenderModel = model;
      renderModel(model);
    },
    renderEligibility({ canSave, pending }) {
      saveButton.disabled = pending || !canSave;
      titleInput.disabled = pending;
    },
    setPending(pending) {
      saveButton.disabled = pending;
      titleInput.disabled = pending;
    },
    clearDraft() {
      titleInput.value = '';
    },
    showStatus(message, tone = 'info') {
      status.dataset.tone = tone;
      status.textContent = message;
    },
    showSnapshot(artifact) {
      snapshot.hidden = false;
      refreshSnapshotTranslation = () => {
        setTranslatedText(snapshot, 'history.refreshing', { snapshot: snapshotLabel(artifact) });
      };
      refreshSnapshotTranslation();
    },
    showSnapshotState(artifact, refreshStatus) {
      snapshot.hidden = false;
      refreshSnapshotTranslation = () => {
        let localizedOutcome = t('history.failedOutcome');
        if (refreshStatus === 'cancelled') localizedOutcome = t('history.cancelled');
        else if (refreshStatus === 'superseded') localizedOutcome = t('history.superseded');
        const localizedRemainder = artifact.resultSummary ? t('history.snapshotShown') : t('history.noCachedComparison');
        setTranslatedText(snapshot, 'history.refreshState', {
          snapshot: snapshotLabel(artifact),
          outcome: localizedOutcome,
          remainder: localizedRemainder,
        });
      };
      refreshSnapshotTranslation();
    },
    clearSnapshot() {
      snapshot.hidden = true;
      snapshot.textContent = '';
      refreshSnapshotTranslation = null;
    },
  });
}
