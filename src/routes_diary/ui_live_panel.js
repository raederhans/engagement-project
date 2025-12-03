import { createDiaryCard, createSectionTitle, createPill, createPrimaryButton, createSecondaryButton, createMutedCard } from './ui_common.js';

export function renderLiveRoutePanel(container, state = {}, handlers = {}) {
  container.innerHTML = '';
  const refs = {};

  // Route selector
  const routeCard = createDiaryCard();
  routeCard.appendChild(createSectionTitle('Choose a demo route'));

  const routeSelect = document.createElement('select');
  routeSelect.className = 'diary-select';
  routeSelect.addEventListener('change', (event) => {
    const routeId = event.target.value;
    if (routeId && handlers.onRouteSelect) {
      handlers.onRouteSelect(routeId);
    }
  });
  refs.routeSelectEl = routeSelect;
  routeCard.appendChild(routeSelect);

  const summary = createMutedCard();
  summary.id = 'diary-route-summary';
  summary.style.minHeight = '72px';
  summary.style.display = 'flex';
  summary.style.flexDirection = 'column';
  summary.style.gap = '4px';
  summary.textContent = 'Select a route to see safety details.';
  summary.style.marginTop = '10px';
  refs.summaryEl = summary;
  routeCard.appendChild(summary);
  container.appendChild(routeCard);

  // Comparison / alt route
  const actionsCard = createDiaryCard();
  const actionsHeader = document.createElement('div');
  actionsHeader.className = 'diary-section-header';
  actionsHeader.appendChild(createSectionTitle('Comparison'));
  actionsCard.appendChild(actionsHeader);

  const altToggleRow = document.createElement('label');
  altToggleRow.style.display = 'flex';
  altToggleRow.style.alignItems = 'center';
  altToggleRow.style.gap = '8px';
  altToggleRow.style.fontSize = '13px';
  altToggleRow.style.color = '#475569';
  const altToggle = document.createElement('input');
  altToggle.type = 'checkbox';
  altToggle.style.cursor = 'pointer';
  altToggle.addEventListener('change', () => {
    handlers.onToggleAlt?.(altToggle.checked);
  });
  altToggleRow.appendChild(altToggle);
  altToggleRow.appendChild(document.createTextNode('Show alternative route'));
  refs.altToggleEl = altToggle;
  actionsCard.appendChild(altToggleRow);

  const altSummary = createMutedCard();
  altSummary.style.marginTop = '8px';
  altSummary.style.fontSize = '12px';
  altSummary.style.color = '#334155';
  altSummary.textContent = 'Toggle to compare a safety-focused alternative.';
  refs.altSummaryEl = altSummary;
  actionsCard.appendChild(altSummary);

  const notice = document.createElement('div');
  notice.style.marginTop = '8px';
  notice.style.borderRadius = '8px';
  notice.style.padding = '8px 10px';
  notice.style.fontSize = '12px';
  notice.style.display = 'none';
  notice.style.background = '#ecfdf5';
  notice.style.color = '#065f46';
  refs.panelNoticeEl = notice;
  actionsCard.appendChild(notice);

  const rateWrap = document.createElement('div');
  rateWrap.style.marginTop = '10px';
  const rateBtn = createPrimaryButton('Rate this route');
  rateBtn.style.width = '100%';
  rateBtn.style.padding = '12px 14px';
  rateBtn.style.fontSize = '14px';
  rateBtn.disabled = !state.canRate;
  rateBtn.style.opacity = state.canRate ? '1' : '0.7';
  rateBtn.addEventListener('click', () => {
    if (!rateBtn.disabled) {
      handlers.onRate?.();
    }
  });
  refs.rateButtonEl = rateBtn;
  rateWrap.appendChild(rateBtn);
  actionsCard.appendChild(rateWrap);

  const hint = document.createElement('div');
  hint.textContent = 'Zoom to levels 10–14 to see the gray road grid beneath the safety colors.';
  hint.className = 'diary-muted-text';
  hint.style.marginTop = '8px';
  hint.style.lineHeight = '1.4';
  actionsCard.appendChild(hint);

  container.appendChild(actionsCard);

  // Simulator
  const simCard = createDiaryCard();
  simCard.appendChild(createSectionTitle('Simulator'));
  const simHint = document.createElement('div');
  simHint.className = 'diary-muted-text';
  simHint.textContent = 'Play through this route step by step.';
  simCard.appendChild(simHint);

  const simControls = document.createElement('div');
  simControls.style.display = 'flex';
  simControls.style.gap = '8px';
  simControls.style.marginTop = '10px';

  const playBtn = createSecondaryButton('Play');
  playBtn.style.flex = '1';
  playBtn.addEventListener('click', () => handlers.onPlay?.());
  refs.playButtonEl = playBtn;
  simControls.appendChild(playBtn);

  const pauseBtn = createSecondaryButton('Pause');
  pauseBtn.style.flex = '1';
  pauseBtn.addEventListener('click', () => handlers.onPause?.());
  refs.pauseButtonEl = pauseBtn;
  simControls.appendChild(pauseBtn);

  const finishBtn = createSecondaryButton('Finish → Rate');
  finishBtn.style.flex = '1';
  finishBtn.addEventListener('click', () => handlers.onFinish?.());
  refs.finishButtonEl = finishBtn;
  simControls.appendChild(finishBtn);

  simCard.appendChild(simControls);

  const playbackLabel = document.createElement('div');
  playbackLabel.className = 'diary-label';
  playbackLabel.style.marginTop = '12px';
  playbackLabel.textContent = 'Playback speed';
  simCard.appendChild(playbackLabel);

  const playbackRow = document.createElement('div');
  playbackRow.style.display = 'flex';
  playbackRow.style.gap = '6px';
  const speeds = [0.5, 1, 2];
  refs.speedButtons = [];
  speeds.forEach((value) => {
    const btn = createPill(`${value}×`, { active: state.playbackSpeed === value });
    btn.dataset.speed = String(value);
    btn.style.flex = '1';
    btn.addEventListener('click', () => handlers.onSpeedChange?.(value));
    refs.speedButtons.push(btn);
    playbackRow.appendChild(btn);
  });
  simCard.appendChild(playbackRow);
  container.appendChild(simCard);

  // Filters
  const filterCard = createDiaryCard();
  filterCard.appendChild(createSectionTitle('Filters'));

  const periodLabel = document.createElement('div');
  periodLabel.className = 'diary-label';
  periodLabel.textContent = 'Demo period';
  periodLabel.style.marginTop = '8px';
  filterCard.appendChild(periodLabel);

  const periodSelect = document.createElement('select');
  periodSelect.className = 'diary-select';
  [
    { value: 'day', label: 'Single day' },
    { value: 'week', label: 'Last 7 days' },
    { value: 'month', label: 'Last 30 days' },
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    periodSelect.appendChild(option);
  });
  periodSelect.value = state.demoPeriod || 'day';
  periodSelect.addEventListener('change', () => handlers.onDemoPeriodChange?.(periodSelect.value));
  filterCard.appendChild(periodSelect);

  const timeLabel = document.createElement('div');
  timeLabel.className = 'diary-label';
  timeLabel.textContent = 'Time of day';
  timeLabel.style.marginTop = '10px';
  filterCard.appendChild(timeLabel);

  const timeSelect = document.createElement('select');
  timeSelect.className = 'diary-select';
  [
    { value: 'all', label: 'All hours' },
    { value: 'day', label: 'Daytime' },
    { value: 'evening', label: 'Evening' },
    { value: 'night', label: 'Night' },
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    timeSelect.appendChild(option);
  });
  timeSelect.value = state.timeFilter || 'all';
  timeSelect.addEventListener('change', () => handlers.onTimeFilterChange?.(timeSelect.value));
  filterCard.appendChild(timeSelect);

  const historyBtn = createPill('My routes and history (coming soon)', { active: false });
  historyBtn.style.marginTop = '10px';
  historyBtn.style.width = '100%';
  historyBtn.style.borderStyle = 'dashed';
  historyBtn.style.cursor = 'not-allowed';
  historyBtn.disabled = true;
  historyBtn.addEventListener('click', () => {
    console.info('[Diary] My routes and history is not available yet.');
  });
  filterCard.appendChild(historyBtn);

  container.appendChild(filterCard);

  // Apply initial values
  if (state.routes?.features?.length) {
    routeSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a route';
    routeSelect.appendChild(placeholder);
    state.routes.features.forEach((feature) => {
      const props = feature.properties || {};
      const opt = document.createElement('option');
      opt.value = props.route_id;
      opt.textContent = props.name || props.route_id;
      routeSelect.appendChild(opt);
    });
    if (state.selectedRouteId) {
      routeSelect.value = state.selectedRouteId;
    }
  }

  if (typeof state.altEnabled === 'boolean') {
    altToggle.checked = state.altEnabled;
  }

  return refs;
}
