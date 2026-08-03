import { createDiaryCard, createSectionTitle } from './ui_common.js';
import { setTranslatedText, t } from '../i18n/index.js';

export function renderMyRoutesPanel(container, state = {}, handlers = {}) {
  container.innerHTML = '';
  const { period = '30d', mode = 'all', routes = [] } = state;

  const filters = document.createElement('div');
  filters.style.display = 'flex';
  filters.style.gap = '8px';
  filters.style.marginBottom = '10px';

  const periodSelect = document.createElement('select');
  periodSelect.className = 'diary-select';
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
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';
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
    left.style.display = 'flex';
    left.style.flexDirection = 'column';
    left.style.gap = '2px';
    const date = document.createElement('div');
    date.style.fontSize = '12px';
    date.style.color = '#6b7280';
    date.textContent = item.date;
    const label = document.createElement('div');
    label.style.fontSize = '13px';
    label.style.fontWeight = '600';
    label.style.color = '#0f172a';
    label.textContent = item.label;
    const modeLabel = document.createElement('div');
    modeLabel.style.fontSize = '12px';
    modeLabel.style.color = '#475569';
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
