import { createDiaryCard, createSectionTitle } from './ui_common.js';
import { setTranslatedAttribute, setTranslatedText, t } from '../i18n/index.js';
import { formatCalendarDate } from '../i18n/date.js';

export function refreshMyRoutesDates(root) {
  for (const element of root?.querySelectorAll?.('[data-diary-date]') || []) {
    element.textContent = formatCalendarDate(element.dataset.diaryDate, { includeYear: false }) || '';
  }
}

export function renderMyRoutesPanel(container, state = {}, handlers = {}) {
  container.innerHTML = '';
  const { period = '30d', mode = 'all', routes = [] } = state;

  const filters = document.createElement('div');
  filters.className = 'diary-route-filters';

  const periodSelect = document.createElement('select');
  periodSelect.className = 'diary-select';
  setTranslatedAttribute(periodSelect, 'diary.periodFilter', 'aria-label');
  ['30d', '7d', 'all'].forEach((value) => {
    const opt = document.createElement('option');
    opt.value = value;
    setTranslatedText(opt, value === '30d' ? 'diary.last30Days' : value === '7d' ? 'diary.last7Days' : 'diary.allTime');
    periodSelect.appendChild(opt);
  });
  periodSelect.value = period;
  periodSelect.addEventListener('change', () => handlers.onPeriodChange?.(periodSelect.value));
  filters.appendChild(periodSelect);

  const modeSelect = document.createElement('select');
  modeSelect.className = 'diary-select';
  setTranslatedAttribute(modeSelect, 'diary.modeFilter', 'aria-label');
  [
    { value: 'all', key: 'diary.allModes' },
    { value: 'walk', key: 'diary.walk' },
    { value: 'bike', key: 'diary.bike' },
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    setTranslatedText(option, opt.key);
    modeSelect.appendChild(option);
  });
  modeSelect.value = mode;
  modeSelect.addEventListener('change', () => handlers.onModeChange?.(modeSelect.value));
  filters.appendChild(modeSelect);
  container.appendChild(filters);

  const dataActions = document.createElement('div');
  dataActions.className = 'diary-data-actions';
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'diary-chip secondary';
  setTranslatedText(exportButton, 'diary.exportLocal');
  exportButton.disabled = routes.length === 0;
  exportButton.addEventListener('click', () => handlers.onExport?.());
  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'diary-chip secondary';
  setTranslatedText(importButton, 'diary.importBackup');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    if (file) handlers.onImport?.(file);
    fileInput.value = '';
  });
  dataActions.append(exportButton, importButton, fileInput);
  container.appendChild(dataActions);

  const historyCard = createDiaryCard();
  const historyTitle = createSectionTitle(t('diary.routeHistory'));
  setTranslatedText(historyTitle, 'diary.routeHistory');
  historyCard.appendChild(historyTitle);

  const list = document.createElement('div');
  list.className = 'diary-route-history-list';
  historyCard.appendChild(list);

  if (!routes.length) {
    const empty = document.createElement('div');
    empty.className = 'diary-muted-text';
    setTranslatedText(empty, 'diary.noLocalRatings');
    list.appendChild(empty);
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

  routes.forEach((item) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'diary-history-item';
    row.setAttribute('data-id', item.id);
    row.addEventListener('click', () => handlers.onSelect?.(item));
    const left = document.createElement('div');
    left.className = 'diary-history-item__details';
    const date = document.createElement('div');
    date.className = 'diary-history-item__date';
    date.dataset.diaryDate = item.createdAt;
    date.textContent = formatCalendarDate(item.createdAt, { includeYear: false }) || item.date;
    const label = document.createElement('div');
    label.className = 'diary-history-item__label';
    label.textContent = item.label;
    const modeLabel = document.createElement('div');
    modeLabel.className = 'diary-history-item__mode';
    setTranslatedText(modeLabel, item.mode === 'bike' ? 'diary.bikeWithIcon' : 'diary.walkWithIcon');
    left.appendChild(date);
    left.appendChild(label);
    left.appendChild(modeLabel);

    const right = document.createElement('div');
    right.appendChild(scoreBadge(item.score));

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  });

  container.appendChild(historyCard);
}
