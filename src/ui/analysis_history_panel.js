function button(label, action, id, reportActionError) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'analysis-history__action';
  element.textContent = label;
  element.addEventListener('click', () => {
    void Promise.resolve(action(id)).catch(reportActionError);
  });
  return element;
}

function snapshotLabel(artifact) {
  const generatedAt = artifact.resultSummary?.generatedAt;
  return generatedAt
    ? `Showing saved snapshot from ${new Date(generatedAt).toLocaleString()}.`
    : 'Saved settings have no cached comparison.';
}

export function createAnalysisHistoryView(mount, actions) {
  mount.replaceChildren();
  mount.className = 'analysis-history';

  const heading = document.createElement('div');
  heading.className = 'analysis-history__heading';
  heading.textContent = 'Recent analyses';

  const saveRow = document.createElement('div');
  saveRow.className = 'analysis-history__save';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.maxLength = 120;
  titleInput.placeholder = 'Analysis title (optional)';
  titleInput.setAttribute('aria-label', 'Analysis title');
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.textContent = 'Save analysis';
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
  let currentArtifactId = null;
  let renderedCards = new Map();

  const reportActionError = (error) => {
    status.dataset.tone = 'warning';
    status.textContent = error?.message || 'Analysis history action failed.';
  };
  saveButton.addEventListener('click', () => {
    void Promise.resolve(actions.onSave(titleInput.value)).catch(reportActionError);
  });

  function renderItem(artifact) {
    const card = document.createElement('article');
    card.className = 'analysis-history__item';
    card.dataset.artifactId = artifact.id;
    const title = document.createElement('div');
    title.className = 'analysis-history__title';
    title.textContent = artifact.title;
    const meta = document.createElement('div');
    meta.className = 'analysis-history__meta';
    meta.textContent = `${artifact.viewState.queryMode} · ${artifact.viewState.startMonth || 'current'} · ${new Date(artifact.updatedAt).toLocaleString()}`;
    const dataStatus = document.createElement('div');
    dataStatus.className = 'analysis-history__data-status';
    if (artifact.dataStatus === 'provenance-mismatch') dataStatus.textContent = 'Needs refresh';
    else if (artifact.dataStatus === 'unknown') dataStatus.textContent = 'Source status unknown';
    else dataStatus.textContent = 'Sources current';
    const controls = document.createElement('div');
    controls.className = 'analysis-history__actions';
    const openButton = button('Open', actions.onRestore, artifact.id, reportActionError);
    controls.append(
      openButton,
      button('Share', actions.onShare, artifact.id, reportActionError),
      button('Export', actions.onExport, artifact.id, reportActionError),
      button('Rename', () => {
        const next = window.prompt('Rename analysis', artifact.title);
        return next == null ? null : actions.onRename(artifact.id, next);
      }, artifact.id, reportActionError),
      button('Delete', actions.onDelete, artifact.id, reportActionError),
    );
    card.append(title, meta, dataStatus, controls);
    card._open = openButton;
    renderedCards.set(artifact.id, card);
    return card;
  }

  function syncCurrentArtifact() {
    for (const [id, card] of renderedCards) {
      if (id === currentArtifactId) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    }
  }

  return Object.freeze({
    render({ items, warnings, canSave, pending }) {
      saveButton.disabled = pending || !canSave;
      titleInput.disabled = pending;
      if (warnings?.length) {
        const itemLabel = warnings.length === 1 ? 'item' : 'items';
        warning.textContent = `${warnings.length} saved ${itemLabel} could not be read. Valid items remain available.`;
      } else {
        warning.textContent = '';
      }
      renderedCards = new Map();
      list.replaceChildren(...items.map(renderItem));
      syncCurrentArtifact();
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'analysis-history__empty';
        empty.textContent = 'No saved analyses in this browser yet.';
        list.appendChild(empty);
      }
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
      snapshot.hidden = false;
      snapshot.textContent = `${snapshotLabel(artifact)} Refreshing live data…`;
    },
    showSnapshotState(artifact, refreshStatus) {
      snapshot.hidden = false;
      let outcome = 'failed';
      if (refreshStatus === 'cancelled') outcome = 'was cancelled';
      else if (refreshStatus === 'superseded') outcome = 'was superseded';
      const remainder = artifact.resultSummary ? 'the saved snapshot is still shown.' : 'there is still no cached comparison.';
      snapshot.textContent = `${snapshotLabel(artifact)} Live refresh ${outcome}; ${remainder}`;
    },
    clearSnapshot() {
      snapshot.hidden = true;
      snapshot.textContent = '';
    },
  });
}
