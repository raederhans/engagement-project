import { onLanguageChange, setTranslatedAttribute, setTranslatedText, t } from '../i18n/index.js';
import { formatLocalizedDate } from '../i18n/date.js';

const HISTORY_CLASS = 'analysis-history__';

function snapshotLabel(artifact) {
  const generatedAt = artifact.resultSummary?.generatedAt;
  return generatedAt
    ? t('history.savedSnapshot', { date: formatLocalizedDate(generatedAt) })
    : t('history.noSnapshot');
}

function button(key, action, id, reportActionError) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = HISTORY_CLASS + 'action';
  setTranslatedText(element, key);
  element.addEventListener('click', () => {
    void Promise.resolve(action(id)).catch(reportActionError);
  });
  return element;
}

export function createAnalysisHistoryView(mount, actions) {
  mount.replaceChildren();
  mount.className = 'analysis-history';

  const heading = document.createElement('div');
  heading.className = HISTORY_CLASS + 'heading';
  setTranslatedText(heading, 'history.title');

  const saveRow = document.createElement('div');
  saveRow.className = HISTORY_CLASS + 'save';
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
  snapshot.className = HISTORY_CLASS + 'snapshot';
  snapshot.hidden = true;
  const status = document.createElement('div');
  status.className = HISTORY_CLASS + 'status';
  status.setAttribute('aria-live', 'polite');
  const warning = document.createElement('div');
  warning.className = HISTORY_CLASS + 'warning';
  const list = document.createElement('div');
  list.className = HISTORY_CLASS + 'list';
  mount.append(heading, saveRow, snapshot, status, warning, list);
  let lastRenderModel;
  let refreshSnapshotTranslation;
  let currentArtifactId;
  let renderedCards = new Map();

  const reportActionError = (error) => {
    status.dataset.tone = 'warning';
    if (error?.message) {
      status.removeAttribute('data-i18n');
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
    card.className = HISTORY_CLASS + 'item';
    card.dataset.artifactId = artifact.id;
    const title = document.createElement('div');
    title.className = HISTORY_CLASS + 'title';
    title.textContent = artifact.title;
    const meta = document.createElement('div');
    meta.className = HISTORY_CLASS + 'meta';
    setTranslatedText(meta, 'history.meta', {
      mode: artifact.viewState.queryMode,
      month: artifact.viewState.startMonth || t('history.current'),
      date: formatLocalizedDate(artifact.updatedAt),
    });
    const dataStatus = document.createElement('div');
    dataStatus.className = HISTORY_CLASS + 'data-status';
    setTranslatedText(dataStatus, artifact.dataStatus === 'provenance-mismatch'
      ? 'history.needsRefresh'
      : artifact.dataStatus === 'unknown'
        ? 'history.sourceUnknown'
        : 'history.sourcesCurrent');
    const controls = document.createElement('div');
    controls.className = HISTORY_CLASS + 'actions';
    const openButton = button('history.open', actions.onRestore, artifact.id, reportActionError);
    controls.append(
      openButton,
      button('history.share', actions.onShare, artifact.id, reportActionError),
      button('history.export', actions.onExport, artifact.id, reportActionError),
      button('history.rename', () => {
        const next = window.prompt(t('history.renamePrompt'), artifact.title);
        return next == null ? null : actions.onRename(artifact.id, next);
      }, artifact.id, reportActionError),
      button('history.delete', actions.onDelete, artifact.id, reportActionError),
    );
    card.append(title, meta, dataStatus, controls);
    card._open = openButton;
    renderedCards.set(artifact.id, card);
    return card;
  }

  function renderModel(model) {
    lastRenderModel = model;
    const { items, warnings, canSave, pending } = model;
    const warningCount = warnings?.length || 0;
    saveButton.disabled = pending || !canSave;
    titleInput.disabled = pending;
    if (warningCount) {
      setTranslatedText(warning, warningCount === 1 ? 'history.warningOne' : 'history.warningMany', {
        count: warningCount,
      });
    } else {
      warning.textContent = '';
    }
    renderedCards = new Map();
    list.replaceChildren(...items.map(renderItem));
    syncCurrentArtifact();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = HISTORY_CLASS + 'empty';
      setTranslatedText(empty, 'history.empty');
      list.appendChild(empty);
    }
  }

  onLanguageChange(() => {
    if (lastRenderModel) renderModel(lastRenderModel);
    refreshSnapshotTranslation?.();
  });

  function syncCurrentArtifact() {
    for (const [id, card] of renderedCards) {
      if (id === currentArtifactId) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    }
  }

  function showLocalizedSnapshot(translate) {
    snapshot.hidden = false;
    refreshSnapshotTranslation = translate;
    translate();
  }

  return Object.freeze({
    render: renderModel,
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
    setCurrentArtifact(id) {
      currentArtifactId = id || null;
      syncCurrentArtifact();
    },
    focusRestoreAction(id) {
      renderedCards.get(id)?._open.focus();
    },
    showStatus(message, tone = 'info') {
      status.dataset.tone = tone;
      status.textContent = message;
    },
    showSnapshot(artifact) {
      showLocalizedSnapshot(() => {
        setTranslatedText(snapshot, 'history.refreshing', { snapshot: snapshotLabel(artifact) });
      });
    },
    showSnapshotState(artifact, refreshStatus) {
      showLocalizedSnapshot(() => {
        let outcomeKey = 'history.failedOutcome';
        if (refreshStatus === 'cancelled') outcomeKey = 'history.cancelled';
        else if (refreshStatus === 'superseded') outcomeKey = 'history.superseded';
        setTranslatedText(snapshot, 'history.refreshState', {
          snapshot: snapshotLabel(artifact),
          outcome: t(outcomeKey),
          remainder: t(artifact.resultSummary ? 'history.snapshotShown' : 'history.noCachedComparison'),
        });
      });
    },
    clearSnapshot() {
      snapshot.hidden = true;
      snapshot.textContent = '';
      refreshSnapshotTranslation = null;
    },
  });
}
