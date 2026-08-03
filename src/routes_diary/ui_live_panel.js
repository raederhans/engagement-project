import { createDiaryCard, createSectionTitle, createPill, createPrimaryButton, createSecondaryButton, createMutedCard } from './ui_common.js';
import '../i18n/diary_live.js';
import '../i18n/p1.js';
import { setTranslatedText, t } from '../i18n/index.js';

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
  setTranslatedText(summary, 'diary.selectRouteDetails');
  summary.style.marginTop = '10px';
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
  const altToggleLabel = document.createElement('span');
  setTranslatedText(altToggleLabel, 'diary.showAlternative');
  altToggleRow.appendChild(altToggleLabel);
  refs.altToggleEl = altToggle;
  actionsCard.appendChild(altToggleRow);

  const altSummary = createMutedCard();
  altSummary.style.marginTop = '8px';
  altSummary.style.fontSize = '12px';
  altSummary.style.color = '#334155';
  setTranslatedText(altSummary, 'diary.alternativeHint');
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
  rateWrap.className = 'diary-rate-action';
  rateWrap.style.marginTop = '10px';
  const rateBtn = createPrimaryButton(t('diary.rateRoute'));
  setTranslatedText(rateBtn, 'diary.rateRoute');
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
  setTranslatedText(hint, 'diary.roadGridHint');
  hint.className = 'diary-muted-text';
  hint.style.marginTop = '8px';
  hint.style.lineHeight = '1.4';
  actionsCard.appendChild(hint);

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
  simControls.style.display = 'flex';
  simControls.style.gap = '8px';
  simControls.style.marginTop = '10px';

  const playBtn = createSecondaryButton(t('diary.play'));
  setTranslatedText(playBtn, 'diary.play');
  playBtn.style.flex = '1';
  playBtn.addEventListener('click', () => handlers.onPlay?.());
  refs.playButtonEl = playBtn;
  simControls.appendChild(playBtn);

  const pauseBtn = createSecondaryButton(t('diary.pause'));
  setTranslatedText(pauseBtn, 'diary.pause');
  pauseBtn.style.flex = '1';
  pauseBtn.addEventListener('click', () => handlers.onPause?.());
  refs.pauseButtonEl = pauseBtn;
  simControls.appendChild(pauseBtn);

  const finishBtn = createSecondaryButton(t('diary.finishRate'));
  setTranslatedText(finishBtn, 'diary.finishRate');
  finishBtn.style.flex = '1';
  finishBtn.addEventListener('click', () => handlers.onFinish?.());
  refs.finishButtonEl = finishBtn;
  simControls.appendChild(finishBtn);

  simContent.appendChild(simControls);

  const playbackLabel = document.createElement('div');
  playbackLabel.className = 'diary-label';
  playbackLabel.style.marginTop = '12px';
  setTranslatedText(playbackLabel, 'diary.playbackSpeed');
  simContent.appendChild(playbackLabel);

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
  simContent.appendChild(playbackRow);
  simCard.appendChild(simContent);
  container.appendChild(simCard);

  // Filters
  const filterCard = createDiaryCard();
  const filtersTitle = createSectionTitle(t('diary.filters'));
  setTranslatedText(filtersTitle, 'diary.filters');
  filterCard.appendChild(filtersTitle);

  const periodLabel = document.createElement('div');
  periodLabel.className = 'diary-label';
  setTranslatedText(periodLabel, 'diary.demoPeriod');
  periodLabel.style.marginTop = '8px';
  filterCard.appendChild(periodLabel);

  const periodSelect = document.createElement('select');
  periodSelect.className = 'diary-select';
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
  timeLabel.className = 'diary-label';
  setTranslatedText(timeLabel, 'diary.timeOfDay');
  timeLabel.style.marginTop = '10px';
  filterCard.appendChild(timeLabel);

  const timeSelect = document.createElement('select');
  timeSelect.className = 'diary-select';
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
  setTranslatedText(historyBtn, 'diary.openRoutes');
  historyBtn.style.marginTop = '10px';
  historyBtn.style.width = '100%';
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
