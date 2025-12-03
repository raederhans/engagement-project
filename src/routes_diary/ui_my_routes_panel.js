import { createDiaryCard, createSectionTitle } from './ui_common.js';

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
    opt.textContent = value === '30d' ? 'Last 30 days' : value === '7d' ? 'Last 7 days' : 'All time';
    periodSelect.appendChild(opt);
  });
  periodSelect.value = period;
  periodSelect.addEventListener('change', () => handlers.onPeriodChange?.(periodSelect.value));
  filters.appendChild(periodSelect);

  const modeSelect = document.createElement('select');
  modeSelect.className = 'diary-select';
  [
    { value: 'all', label: 'All modes' },
    { value: 'walk', label: 'Walk' },
    { value: 'bike', label: 'Bike' },
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    modeSelect.appendChild(option);
  });
  modeSelect.value = mode;
  modeSelect.addEventListener('change', () => handlers.onModeChange?.(modeSelect.value));
  filters.appendChild(modeSelect);
  container.appendChild(filters);

  const historyCard = createDiaryCard();
  historyCard.appendChild(createSectionTitle('Route history'));

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';
  historyCard.appendChild(list);

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
    modeLabel.textContent = item.mode === 'bike' ? '🚲 Bike' : '🚶 Walk';
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
