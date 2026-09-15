import { createDiaryCard, createSectionTitle } from './ui_common.js';
import { setTranslatedAttribute, setTranslatedText, t } from '../i18n/index.js';
import { formatCalendarDate } from '../i18n/date.js';
import '../i18n/diary_workspace.js';

export function refreshMyRoutesDates(root) {
  for (const element of root?.querySelectorAll?.('[data-diary-date]') || []) {
    element.textContent = formatCalendarDate(element.dataset.diaryDate, { includeYear: true }) || '';
  }
}

export function renderMyRoutesPanel(container, state = {}, handlers = {}) {
  container.innerHTML = '';
  const {
    period = '30d',
    mode = 'all',
    routes = [],
    hasPrivateData = routes.length > 0,
    storageWarnings = [],
    importPreview = null,
    replaceConfirm = false,
    deleteConfirmId = null,
    dataStatus = '',
    busy = false,
    focusTarget = '',
    drafts = [],
    favorites = [],
    totalEntries = routes.length,
    storageStatus = 'available',
    query = '',
    timeOfDay = 'all',
  } = state;

  const create = createActionButton('diary.newEntry', 'diary-btn-primary diary-full-width-action');
  create.disabled = busy || storageStatus === 'unavailable';
  create.addEventListener('click', () => handlers.onCreate?.());
  container.appendChild(create);
  if (favorites.length) {
    const section = document.createElement('details');
    section.className = 'diary-favorites';
    const title = document.createElement('summary');
    setTranslatedText(title, 'diary.favorites', { count: favorites.length });
    section.appendChild(title);
    for (const item of favorites) {
      const repeat = document.createElement('button');
      repeat.type = 'button';
      repeat.className = 'diary-chip secondary';
      repeat.textContent = item.label;
      repeat.disabled = busy;
      setTranslatedAttribute(repeat, 'diary.favoriteRepeat', 'aria-label', { label: item.label });
      repeat.addEventListener('click', () => handlers.onRepeat?.(item));
      section.appendChild(repeat);
    }
    container.appendChild(section);
  }
  if (drafts.length) container.appendChild(createDraftList(drafts, handlers, busy));
  container.appendChild(createFilters({ period, mode, query, timeOfDay }, handlers, busy));
  const summary = document.createElement('p');
  summary.className = 'diary-journal-summary';
  summary.setAttribute('role', 'status');
  setTranslatedText(summary, storageStatus === 'unavailable' ? 'diary.localStorageUnavailable' : 'diary.filteredCount', { count: routes.length, total: totalEntries });
  container.appendChild(summary);
  if (routes.length && storageStatus !== 'unavailable') {
    const stats = document.createElement('p');
    setTranslatedText(stats, 'diary.tripSummary', { count: routes.length, score: (routes.reduce((sum, row) => sum + Number(row.score), 0) / routes.length).toFixed(1) });
    container.appendChild(stats);
  }
  const scope = document.createElement('p');
  scope.className = 'diary-muted-text';
  setTranslatedText(scope, 'diary.summaryScope');
  container.appendChild(scope);

  const historyCard = createDiaryCard('diary-history-card');
  const historyTitle = createSectionTitle(t('diary.routeHistory'));
  historyTitle.id = 'diary-route-history-title';
  historyTitle.tabIndex = -1;
  historyTitle.dataset.diaryFocusTarget = 'history-title';
  setTranslatedText(historyTitle, 'diary.routeHistory');
  historyCard.appendChild(historyTitle);

  const list = document.createElement('div');
  list.className = 'diary-route-history-list';
  historyCard.appendChild(list);

  if (!routes.length) {
    const empty = document.createElement('p');
    empty.className = 'diary-muted-text';
    setTranslatedText(empty, storageStatus === 'unavailable' ? 'diary.localStorageUnavailable' : totalEntries ? 'diary.filteredEmpty' : 'diary.recordFirst');
    list.appendChild(empty);
    const next = createActionButton(totalEntries ? 'diary.resetFilters' : 'diary.exploreDemo', 'diary-chip secondary');
    next.addEventListener('click', () => totalEntries ? handlers.onResetFilters?.() : handlers.onExploreDemo?.());
    list.appendChild(next);
  } else {
    list.setAttribute('role', 'list');
    list.setAttribute('aria-labelledby', historyTitle.id);
  }

  for (const item of routes) {
    list.appendChild(createHistoryItem(item, {
      confirming: String(deleteConfirmId || '') === String(item.id || ''),
      busy,
    }, handlers));
  }

  container.appendChild(historyCard);
  container.appendChild(createPrivateDataCard({
    hasPrivateData,
    storageWarnings,
    importPreview,
    replaceConfirm,
    dataStatus,
    busy,
  }, handlers));

  const requestedFocusTarget = focusTarget
    || (deleteConfirmId ? `delete-confirm:${deleteConfirmId}` : '')
    || (replaceConfirm ? 'replace-confirm' : '');
  if (requestedFocusTarget) {
    queueMicrotask(() => {
      container.querySelector?.(
        `[data-diary-focus-target="${cssEscape(requestedFocusTarget)}"]`,
      )?.focus?.();
    });
  }
}

function createFilters({ period, mode, query, timeOfDay }, handlers, busy) {
  const filters = document.createElement('div');
  filters.className = 'diary-route-filters';

  const periodSelect = document.createElement('select');
  periodSelect.className = 'diary-select';
  periodSelect.dataset.diaryFocusTarget = 'period-filter';
  periodSelect.disabled = busy;
  setTranslatedAttribute(periodSelect, 'diary.periodFilter', 'aria-label');
  ['30d', '7d', '90d', 'all'].forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    setTranslatedText(option, value === '30d' ? 'diary.last30Days' : value === '7d' ? 'diary.last7Days' : value === '90d' ? 'diary.last90d' : 'diary.allTime');
    periodSelect.appendChild(option);
  });
  periodSelect.value = period;
  periodSelect.addEventListener('change', () => handlers.onPeriodChange?.(periodSelect.value));
  filters.appendChild(periodSelect);

  const modeSelect = document.createElement('select');
  modeSelect.className = 'diary-select';
  modeSelect.dataset.diaryFocusTarget = 'mode-filter';
  modeSelect.disabled = busy;
  setTranslatedAttribute(modeSelect, 'diary.modeFilter', 'aria-label');
  [
    { value: 'all', key: 'diary.allModes' },
    { value: 'walk', key: 'diary.walk' },
    { value: 'bike', key: 'diary.bike' },
  ].forEach(({ value, key }) => {
    const option = document.createElement('option');
    option.value = value;
    setTranslatedText(option, key);
    modeSelect.appendChild(option);
  });
  modeSelect.value = mode;
  modeSelect.addEventListener('change', () => handlers.onModeChange?.(modeSelect.value));
  filters.appendChild(modeSelect);
  const time = document.createElement('select');
  time.className = 'diary-select';
  time.disabled = busy;
  time.dataset.diaryFocusTarget = 'time-filter';
  setTranslatedAttribute(time, 'diary.timeOfDay', 'aria-label');
  for (const [value, key] of [['all', 'diary.allHours'], ['day', 'diary.daytime'], ['evening', 'diary.evening'], ['night', 'diary.night']]) {
    const option = document.createElement('option');
    option.value = value;
    setTranslatedText(option, key);
    time.appendChild(option);
  }
  time.value = timeOfDay;
  time.addEventListener('change', () => handlers.onTimeChange?.(time.value));
  filters.appendChild(time);
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'diary-select';
  search.value = query || '';
  search.disabled = busy;
  search.dataset.diaryFocusTarget = 'search';
  setTranslatedAttribute(search, 'diary.searchHistory', 'aria-label');
  setTranslatedAttribute(search, 'diary.searchHistory', 'placeholder');
  search.addEventListener('change', () => handlers.onSearch?.(search.value));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); handlers.onSearch?.(search.value); }
  });
  filters.appendChild(search);
  const reset = createActionButton('diary.resetFilters', 'diary-chip secondary');
  reset.disabled = busy;
  reset.addEventListener('click', () => handlers.onResetFilters?.());
  filters.appendChild(reset);
  return filters;
}

function createDraftList(drafts, handlers, busy) {
  const section = document.createElement('section');
  section.className = 'diary-drafts';
  section.appendChild(createSectionTitle(t('diary.draftsTitle')));
  for (const draft of drafts) {
    const row = document.createElement('div');
    row.className = 'diary-draft-row';
    const label = document.createElement('strong');
    label.textContent = draft.label || draft.routeId;
    const resume = createActionButton('diary.resumeDraft', 'diary-chip secondary');
    resume.disabled = busy || draft.available === false;
    resume.addEventListener('click', () => handlers.onResumeDraft?.(draft));
    const discard = createActionButton('diary.discardDraft', 'diary-chip secondary');
    discard.disabled = busy;
    discard.addEventListener('click', () => {
      const confirm = createActionButton('diary.confirmDiscardDraft', 'diary-chip diary-danger-action');
      const cancel = createActionButton('diary.cancel', 'diary-chip secondary');
      const actions = document.createElement('div');
      actions.append(confirm, cancel);
      discard.hidden = true;
      row.appendChild(actions);
      confirm.addEventListener('click', () => handlers.onDiscardDraft?.(draft));
      cancel.addEventListener('click', () => { actions.remove(); discard.hidden = false; discard.focus(); });
      confirm.focus();
    });
    row.append(label, resume, discard);
    if (draft.available === false) {
      const hint = document.createElement('p');
      setTranslatedText(hint, 'diary.draftUnavailable');
      row.appendChild(hint);
    }
    section.appendChild(row);
  }
  return section;
}

function createPrivateDataCard(state, handlers) {
  const card = createDiaryCard('diary-private-data-card');
  card.setAttribute('aria-busy', String(Boolean(state.busy)));
  const title = createSectionTitle(t('diary.localDataTitle'));
  setTranslatedText(title, 'diary.localDataTitle');
  card.appendChild(title);

  const privacy = document.createElement('p');
  privacy.className = 'diary-private-data-note';
  setTranslatedText(privacy, 'diary.localDataPrivacy');
  card.appendChild(privacy);
  const location = document.createElement('p');
  location.className = 'diary-private-data-note';
  setTranslatedText(location, 'diary.browserStorage');
  card.appendChild(location);

  const actions = document.createElement('div');
  actions.className = 'diary-data-actions';

  const exportButton = createActionButton('diary.exportPrivateBackup', 'diary-chip secondary');
  exportButton.dataset.diaryFocusTarget = 'export-backup';
  exportButton.disabled = state.busy || !state.hasPrivateData;
  exportButton.addEventListener('click', () => handlers.onExport?.());

  const importButton = createActionButton('diary.chooseBackup', 'diary-chip secondary');
  importButton.dataset.diaryFocusTarget = 'choose-backup';
  importButton.disabled = state.busy;
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  fileInput.disabled = state.busy;
  setTranslatedAttribute(fileInput, 'diary.chooseBackup', 'aria-label');
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    if (file) handlers.onImport?.(file);
    fileInput.value = '';
  });
  actions.append(exportButton, importButton, fileInput);
  card.appendChild(actions);

  if (state.storageWarnings.length) {
    const warning = document.createElement('div');
    warning.className = 'diary-data-warning';
    warning.setAttribute('role', 'alert');
    const heading = document.createElement('strong');
    setTranslatedText(heading, 'diary.storageWarnings', { count: state.storageWarnings.length });
    const list = document.createElement('ul');
    for (const item of state.storageWarnings) {
      const row = document.createElement('li');
      row.textContent = warningText(item);
      list.appendChild(row);
    }
    warning.append(heading, list);
    card.appendChild(warning);
  }

  if (state.importPreview) {
    card.appendChild(createImportPreview(state.importPreview, state, handlers));
  }

  const status = document.createElement('div');
  status.className = 'diary-data-status';
  status.dataset.diaryFocusTarget = 'data-status';
  status.tabIndex = -1;
  status.setAttribute('role', state.dataStatus?.tone === 'error' ? 'alert' : 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  renderDataStatus(status, state.dataStatus);
  card.appendChild(status);
  return card;
}

function createImportPreview(preview, state, handlers) {
  const region = document.createElement('section');
  region.className = 'diary-import-preview';
  region.setAttribute('aria-labelledby', 'diary-import-preview-title');

  const title = document.createElement('h3');
  title.id = 'diary-import-preview-title';
  title.dataset.diaryFocusTarget = 'import-preview';
  title.tabIndex = -1;
  setTranslatedText(title, 'diary.importPreviewTitle');

  const file = document.createElement('p');
  file.className = 'diary-import-preview__file';
  setTranslatedText(file, 'diary.importPreviewFile', { fileName: preview.fileName || t('diary.unknownBackupFile') });
  region.append(title, file);

  if (preview.migratedFrom != null) {
    const migration = document.createElement('p');
    migration.className = 'diary-import-preview__migration';
    setTranslatedText(migration, 'diary.importPreviewMigrated', { version: preview.migratedFrom });
    region.appendChild(migration);
  }

  region.appendChild(createSummary('diary.importMergeSummary', preview.mergeSummary));
  region.appendChild(createSummary('diary.importReplaceSummary', preview.replaceSummary));

  if (state.replaceConfirm) {
    const confirm = document.createElement('div');
    confirm.className = 'diary-destructive-confirm';
    const warning = document.createElement('p');
    warning.id = 'diary-replace-confirm-warning';
    setTranslatedText(warning, 'diary.replaceConfirmWarning');
    const buttons = document.createElement('div');
    buttons.className = 'diary-inline-actions';
    const replace = createActionButton('diary.replaceConfirmAction', 'diary-chip diary-danger-action');
    replace.dataset.replaceConfirm = '';
    replace.dataset.diaryFocusTarget = 'replace-confirm';
    replace.setAttribute('aria-describedby', warning.id);
    replace.disabled = state.busy;
    replace.addEventListener('click', () => handlers.onImportReplaceConfirm?.());
    const cancel = createActionButton('diary.cancel', 'diary-chip secondary');
    cancel.setAttribute('aria-describedby', warning.id);
    cancel.disabled = state.busy;
    cancel.addEventListener('click', () => handlers.onImportCancel?.());
    buttons.append(replace, cancel);
    confirm.append(warning, buttons);
    region.appendChild(confirm);
  } else {
    const buttons = document.createElement('div');
    buttons.className = 'diary-inline-actions';
    const merge = createActionButton('diary.mergeBackup', 'diary-chip diary-btn-primary');
    merge.dataset.diaryFocusTarget = 'merge-backup';
    merge.disabled = state.busy;
    merge.addEventListener('click', () => handlers.onImportMerge?.());
    const replace = createActionButton('diary.replaceBackup', 'diary-chip diary-danger-action--quiet');
    replace.dataset.diaryFocusTarget = 'replace-intent';
    replace.disabled = state.busy;
    replace.addEventListener('click', () => handlers.onImportReplaceIntent?.());
    const cancel = createActionButton('diary.cancel', 'diary-chip secondary');
    cancel.dataset.diaryFocusTarget = 'import-cancel';
    cancel.disabled = state.busy;
    cancel.addEventListener('click', () => handlers.onImportCancel?.());
    buttons.append(merge, replace, cancel);
    region.appendChild(buttons);
  }
  return region;
}

function createSummary(key, summary = {}) {
  const block = document.createElement('div');
  block.className = 'diary-import-summary';
  const heading = document.createElement('strong');
  setTranslatedText(heading, key);
  const entries = document.createElement('p');
  setTranslatedText(entries, 'diary.importEntriesSummary', summaryParams(summary, 'entries', 'entry'));
  const drafts = document.createElement('p');
  setTranslatedText(drafts, 'diary.importDraftsSummary', summaryParams(summary, 'drafts', 'draft'));
  block.append(heading, entries, drafts);
  return block;
}

function summaryParams(summary, plural, singular) {
  return {
    added: numeric(summary?.[`${plural}Added`]),
    updated: numeric(summary?.[`${plural}Updated`]),
    retained: numeric(summary?.[`${plural}Retained`]),
    unchanged: numeric(summary?.[`${plural}Unchanged`]),
    conflicts: numeric(summary?.[`${singular}Conflicts`]),
    removed: numeric(summary?.[`${plural}Removed`]),
  };
}

function createHistoryItem(item, { confirming, busy }, handlers) {
  const row = document.createElement('article');
  row.className = 'diary-history-item';
  row.setAttribute('role', 'listitem');
  row.setAttribute('data-id', item.id);

  const details = document.createElement('div');
  details.className = 'diary-history-item__details';
  const date = document.createElement('div');
  date.className = 'diary-history-item__date';
  date.dataset.diaryDate = item.occurredAt || item.createdAt;
  date.textContent = formatCalendarDate(item.occurredAt || item.createdAt, { includeYear: true }) || item.date || '';
  const label = document.createElement('div');
  label.className = 'diary-history-item__label';
  label.textContent = item.label;
  const modeLabel = document.createElement('div');
  modeLabel.className = 'diary-history-item__mode';
  setTranslatedText(modeLabel, item.mode === 'bike' ? 'diary.bikeWithIcon' : 'diary.walkWithIcon');
  details.append(date, label, modeLabel);

  const summary = document.createElement('div');
  summary.className = 'diary-history-item__summary';
  summary.appendChild(scoreBadge(Number(item.score) || 0));

  const actions = document.createElement('div');
  actions.className = 'diary-history-item__actions';
  if (confirming) {
    const prompt = document.createElement('p');
    prompt.className = 'diary-delete-confirm__prompt';
    prompt.id = 'diary-delete-confirm-prompt';
    setTranslatedText(prompt, 'diary.deleteConfirmPrompt', { label: item.label || t('diary.untitledRoute') });
    const confirm = createActionButton('diary.deleteConfirmAction', 'diary-chip diary-danger-action');
    confirm.dataset.deleteConfirm = item.id;
    confirm.dataset.diaryFocusTarget = `delete-confirm:${item.id}`;
    confirm.setAttribute('aria-describedby', prompt.id);
    confirm.disabled = busy;
    confirm.addEventListener('click', () => handlers.onDeleteConfirm?.(item));
    const cancel = createActionButton('diary.cancel', 'diary-chip secondary');
    cancel.setAttribute('aria-describedby', prompt.id);
    cancel.disabled = busy;
    cancel.addEventListener('click', () => handlers.onDeleteCancel?.(item));
    actions.classList.add('is-confirming');
    actions.append(prompt, confirm, cancel);
  } else {
    const open = createActionButton('diary.openRoute', 'diary-chip diary-btn-primary');
    open.dataset.diaryFocusTarget = `open-route:${item.id}`;
    setTranslatedAttribute(open, 'diary.openRouteLabel', 'aria-label', { label: item.label || t('diary.untitledRoute') });
    open.disabled = busy;
    open.disabled ||= !item.routeGeometry;
    open.addEventListener('click', () => handlers.onOpen?.(item));
    const remove = createActionButton('diary.deleteRoute', 'diary-chip diary-danger-action--quiet');
    remove.dataset.diaryFocusTarget = `delete-action:${item.id}`;
    setTranslatedAttribute(remove, 'diary.deleteRouteLabel', 'aria-label', { label: item.label || t('diary.untitledRoute') });
    remove.disabled = busy;
    remove.addEventListener('click', () => handlers.onDeleteIntent?.(item));
    actions.append(open, remove);
  }

  row.append(details, summary, actions);
  const detail = document.createElement('details');
  detail.className = 'diary-entry-detail';
  const heading = document.createElement('summary');
  setTranslatedText(heading, 'diary.entryDetails');
  const notes = document.createElement('p');
  notes.textContent = item.notes || t('diary.noNotes');
  const tags = document.createElement('p');
  tags.textContent = (item.tags || []).map((tag) => {
    const key = `tag.${tag}`;
    return t(key) === key ? tag : t(key);
  }).join(' · ');
  const edit = createActionButton('diary.editEntry', 'diary-chip secondary');
  edit.addEventListener('click', () => handlers.onEdit?.(item));
  const repeat = createActionButton('diary.repeatEntry', 'diary-chip secondary');
  repeat.addEventListener('click', () => handlers.onRepeat?.(item));
  edit.disabled = repeat.disabled = Boolean(confirming || busy);
  const favorite = createActionButton(item.favorite ? 'diary.unfavorite' : 'diary.favorite', 'diary-chip secondary');
  favorite.setAttribute('aria-pressed', String(Boolean(item.favorite)));
  favorite.disabled = Boolean(confirming || busy);
  favorite.addEventListener('click', () => handlers.onFavorite?.(item));
  detail.append(heading, notes, tags, edit, repeat, favorite);
  row.appendChild(detail);
  return row;
}

function scoreBadge(score) {
  const pill = document.createElement('div');
  pill.className = 'diary-score-pill';
  pill.textContent = score.toFixed(1);
  if (score > 4) pill.classList.add('is-good');
  else if (score >= 2.5) pill.classList.add('is-mid');
  else pill.classList.add('is-bad');
  return pill;
}

function createActionButton(key, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  setTranslatedText(button, key);
  return button;
}

function renderDataStatus(element, status) {
  if (status && typeof status === 'object' && status.key) {
    element.classList.toggle('is-error', status.tone === 'error');
    setTranslatedText(element, status.key, status.params || {});
    return;
  }
  element.textContent = String(status || '');
}

function warningText(value) {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object') return value.message || value.reason || JSON.stringify(value);
  return String(value || t('diary.storageWarningUnknown'));
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}
