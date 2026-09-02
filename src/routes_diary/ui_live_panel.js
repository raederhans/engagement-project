import { createDiaryCard, createSectionTitle, createPill, createPrimaryButton, createSecondaryButton, createMutedCard } from './ui_common.js';
import '../i18n/diary_live.js';
import '../i18n/p1.js';
import { setTranslatedAttribute, setTranslatedText, t } from '../i18n/index.js';

export function renderLiveRoutePanel(container, state = {}, handlers = {}) {
  container.innerHTML = '';
  const refs = {};

  // Route selector
  const routeCard = createDiaryCard();
  const routeTitle = createSectionTitle(t('diary.chooseRoute'));
  setTranslatedText(routeTitle, 'diary.chooseRoute');
  routeCard.appendChild(routeTitle);

  const routeSelect = document.createElement('select');
  routeSelect.className = 'diary-select';
  setTranslatedAttribute(routeSelect, 'diary.chooseRoute', 'aria-label');
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
  summary.classList.add('diary-route-summary');
  setTranslatedText(summary, 'diary.selectRouteDetails');
  refs.summaryEl = summary;
  routeCard.appendChild(summary);
  container.appendChild(routeCard);

  // Comparison / alt route
  const actionsCard = createDiaryCard();
  const actionsHeader = document.createElement('div');
  actionsHeader.className = 'diary-section-header';
  const comparisonTitle = createSectionTitle(t('diary.comparison'));
  setTranslatedText(comparisonTitle, 'diary.comparison');
  actionsHeader.appendChild(comparisonTitle);
  actionsCard.appendChild(actionsHeader);

  const altToggleRow = document.createElement('label');
  altToggleRow.className = 'diary-alt-toggle';
  const altToggle = document.createElement('input');
  altToggle.type = 'checkbox';
  altToggle.className = 'diary-alt-toggle__control';
  altToggle.addEventListener('change', () => {
    handlers.onToggleAlt?.(altToggle.checked);
  });
  altToggleRow.appendChild(altToggle);
  const altToggleLabel = document.createElement('span');
  setTranslatedText(altToggleLabel, 'diary.showAlternative');
  altToggleRow.appendChild(altToggleLabel);
  refs.altToggleEl = altToggle;
  actionsCard.appendChild(altToggleRow);

  const altSummary = createMutedCard();
  altSummary.classList.add('diary-alt-summary');
  setTranslatedText(altSummary, 'diary.alternativeHint');
  refs.altSummaryEl = altSummary;
  actionsCard.appendChild(altSummary);

  const notice = document.createElement('div');
  notice.className = 'diary-panel-notice is-success';
  refs.panelNoticeEl = notice;
  actionsCard.appendChild(notice);

  const rateWrap = document.createElement('div');
  rateWrap.className = 'diary-rate-action';
  const rateBtn = createPrimaryButton(t('diary.rateRoute'));
  rateBtn.classList.add('diary-rate-action__button');
  setTranslatedText(rateBtn, 'diary.rateRoute');
  rateBtn.disabled = !state.canRate;
  rateBtn.addEventListener('click', () => {
    if (!rateBtn.disabled) {
      handlers.onRate?.();
    }
  });
  refs.rateButtonEl = rateBtn;
  rateWrap.appendChild(rateBtn);
  actionsCard.appendChild(rateWrap);

  container.appendChild(actionsCard);

  // Simulator
  const simCard = document.createElement('details');
  simCard.className = 'diary-card diary-progressive-surface';
  simCard.open = false;
  const simSummary = document.createElement('summary');
  setTranslatedText(simSummary, 'diary.previewRoute');
  simCard.appendChild(simSummary);
  const simContent = document.createElement('div');
  simContent.className = 'diary-progressive-surface__content';
  const simHint = document.createElement('div');
  simHint.className = 'diary-muted-text';
  setTranslatedText(simHint, 'diary.simulatorHint');
  simContent.appendChild(simHint);

  const simControls = document.createElement('div');
  simControls.className = 'diary-sim-controls';

  const playBtn = createSecondaryButton(t('diary.play'));
  playBtn.classList.add('diary-flex-button');
  setTranslatedText(playBtn, 'diary.play');
  playBtn.addEventListener('click', () => handlers.onPlay?.());
  refs.playButtonEl = playBtn;
  simControls.appendChild(playBtn);

  const pauseBtn = createSecondaryButton(t('diary.pause'));
  pauseBtn.classList.add('diary-flex-button');
  setTranslatedText(pauseBtn, 'diary.pause');
  pauseBtn.addEventListener('click', () => handlers.onPause?.());
  refs.pauseButtonEl = pauseBtn;
  simControls.appendChild(pauseBtn);

  const finishBtn = createSecondaryButton(t('diary.finishRate'));
  finishBtn.classList.add('diary-flex-button');
  setTranslatedText(finishBtn, 'diary.finishRate');
  finishBtn.addEventListener('click', () => handlers.onFinish?.());
  refs.finishButtonEl = finishBtn;
  simControls.appendChild(finishBtn);

  simContent.appendChild(simControls);

  const playbackLabel = document.createElement('div');
  playbackLabel.className = 'diary-label diary-label--playback';
  setTranslatedText(playbackLabel, 'diary.playbackSpeed');
  simContent.appendChild(playbackLabel);

  const playbackRow = document.createElement('div');
  playbackRow.className = 'diary-playback-row';
  const speeds = [0.5, 1, 2];
  refs.speedButtons = [];
  speeds.forEach((value) => {
    const btn = createPill(`${value}×`, { active: state.playbackSpeed === value });
    btn.classList.add('diary-flex-button');
    btn.dataset.speed = String(value);
    btn.addEventListener('click', () => handlers.onSpeedChange?.(value));
    refs.speedButtons.push(btn);
    playbackRow.appendChild(btn);
  });
  simContent.appendChild(playbackRow);
  simCard.appendChild(simContent);
  container.appendChild(simCard);

  // Filters
  const filterCard = createDiaryCard();
  const filtersTitle = createSectionTitle(t('diary.filters'));
  setTranslatedText(filtersTitle, 'diary.filters');
  filterCard.appendChild(filtersTitle);

  const periodLabel = document.createElement('div');
  periodLabel.className = 'diary-label diary-label--period';
  setTranslatedText(periodLabel, 'diary.demoPeriod');
  filterCard.appendChild(periodLabel);

  const periodSelect = document.createElement('select');
  periodSelect.className = 'diary-select';
  setTranslatedAttribute(periodSelect, 'diary.demoPeriod', 'aria-label');
  [
    { value: 'day', key: 'diary.singleDay' },
    { value: 'week', key: 'diary.last7Days' },
    { value: 'month', key: 'diary.last30Days' },
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    setTranslatedText(option, opt.key);
    periodSelect.appendChild(option);
  });
  periodSelect.value = state.demoPeriod || 'day';
  periodSelect.addEventListener('change', () => handlers.onDemoPeriodChange?.(periodSelect.value));
  filterCard.appendChild(periodSelect);

  const timeLabel = document.createElement('div');
  timeLabel.className = 'diary-label diary-label--time';
  setTranslatedText(timeLabel, 'diary.timeOfDay');
  filterCard.appendChild(timeLabel);

  const timeSelect = document.createElement('select');
  timeSelect.className = 'diary-select';
  setTranslatedAttribute(timeSelect, 'diary.timeOfDay', 'aria-label');
  [
    { value: 'all', key: 'diary.allHours' },
    { value: 'day', key: 'diary.daytime' },
    { value: 'evening', key: 'diary.evening' },
    { value: 'night', key: 'diary.night' },
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    setTranslatedText(option, opt.key);
    timeSelect.appendChild(option);
  });
  timeSelect.value = state.timeFilter || 'all';
  timeSelect.addEventListener('change', () => handlers.onTimeFilterChange?.(timeSelect.value));
  filterCard.appendChild(timeSelect);

  const historyBtn = createPill(t('diary.openRoutes'), { active: false });
  historyBtn.classList.add('diary-full-width-action');
  setTranslatedText(historyBtn, 'diary.openRoutes');
  historyBtn.addEventListener('click', () => handlers.onOpenHistory?.());
  filterCard.appendChild(historyBtn);

  container.appendChild(filterCard);

  // Apply initial values
  if (state.routes?.features?.length) {
    routeSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    setTranslatedText(placeholder, 'diary.selectRoute');
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
