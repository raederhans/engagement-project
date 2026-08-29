import '../i18n/p1.js';
import { setTranslatedAttribute, setTranslatedText, t } from '../i18n/index.js';

const demoTrend = [3.1, 3.3, 3.2, 3.5, 3.7];

const DEMO_TAGS = {
  route: [
    { label: 'poor lighting', value: 12 },
    { label: 'low foot traffic', value: 8 },
    { label: 'cars too close', value: 6 },
  ],
  area: [
    { label: 'low foot traffic', value: 14 },
    { label: 'poor lighting', value: 11 },
    { label: 'construction blockage', value: 9 },
  ],
  city: [
    { label: 'speeding cars', value: 26 },
    { label: 'cars too close', value: 20 },
    { label: 'poor lighting', value: 18 },
  ],
};

const insightsState = { scope: 'route', window: '30d' };
const heatmapDayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const heatmapWindowKeys = ['morning', 'midday', 'afternoon', 'evening', 'lateNight'];
const heatmapValues = [
  [2, 1, 2, 3, 2],
  [1, 2, 3, 5, 3],
  [1, 2, 3, 5, 3],
  [1, 2, 3, 5, 3],
  [1, 2, 3, 4, 3],
  [1, 1, 2, 3, 2],
  [1, 1, 2, 3, 2],
];

let insightsContext = { mode: 'live', routeId: null };
let localInsightSnapshot = [];

const CONTEXT_COPY = {
  live: {
    title: 'diary.insights.live.title',
    hint: 'diary.insights.live.hint',
    intro: 'diary.insights.live.intro',
    emptyTrend: 'diary.insights.live.emptyTrend',
    emptyTags: 'diary.insights.live.emptyTags',
  },
  history: {
    title: 'diary.insights.history.title',
    hint: 'diary.insights.history.hint',
    intro: 'diary.insights.history.intro',
    emptyTrend: 'diary.insights.history.emptyTrend',
    emptyTags: 'diary.insights.history.emptyTags',
  },
  community: {
    title: 'diary.insights.community.title',
    hint: 'diary.insights.community.hint',
    intro: 'diary.insights.community.intro',
    emptyTrend: 'diary.insights.community.emptyTrend',
    emptyTags: 'diary.insights.community.emptyTags',
  },
};

export function normalizeDiaryInsightsContext(value) {
  const candidate = typeof value === 'string' ? { mode: value } : (value || {});
  const mode = candidate.mode === 'history'
    ? 'history'
    : candidate.mode === 'community'
      ? 'community'
      : 'live';
  const routeId = mode === 'live' && candidate.routeId != null && String(candidate.routeId).trim()
    ? String(candidate.routeId)
    : null;
  return { mode, routeId };
}

export function describeDiaryInsightsContext(value) {
  const { mode } = normalizeDiaryInsightsContext(value);
  return Object.fromEntries(Object.entries(CONTEXT_COPY[mode]).map(([name, key]) => [name, t(key)]));
}

export function selectDiaryInsightEntries(entries = [], value = insightsContext) {
  if (!Array.isArray(entries)) return [];
  const context = normalizeDiaryInsightsContext(value);
  if (context.mode === 'community') return [];
  if (context.mode === 'history') return entries.slice();
  if (!context.routeId) return [];
  return entries.filter((entry) => String(entry?.routeId ?? entry?.route_id ?? '') === context.routeId);
}

function normalizeDiaryInsightSnapshot(value) {
  const snapshot = Array.isArray(value) ? { entries: value } : value;
  const readable = snapshot && typeof snapshot === 'object' && Array.isArray(snapshot.entries);
  const warnings = readable && Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
  const inferredInvalidCount = warnings.filter(({ scope } = {}) => ['entry', 'draft'].includes(scope)).length;
  const invalidCount = Number.isSafeInteger(snapshot?.invalidCount) && snapshot.invalidCount >= 0
    ? snapshot.invalidCount
    : inferredInvalidCount;
  const omittedCount = Number.isSafeInteger(snapshot?.omittedCount) && snapshot.omittedCount >= 0
    ? snapshot.omittedCount
    : invalidCount;
  const storageStatus = !readable || snapshot.storageStatus === 'unavailable'
    ? 'unavailable'
    : snapshot.storageStatus === 'partial' || omittedCount > 0 || invalidCount > 0
      ? 'partial'
      : 'available';
  return { entries: readable ? snapshot.entries : [], storageStatus, warnings, omittedCount, invalidCount };
}

export function deriveLocalDiaryInsights(value = []) {
  const snapshot = normalizeDiaryInsightSnapshot(value);
  const sourceEntries = snapshot.entries;
  const normalized = sourceEntries
    .filter((entry) => Number.isFinite(Number(entry?.score))
      && Number.isFinite(new Date(entry?.createdAt).getTime()))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const tagCounts = new Map();
  const heatmap = Array.from({ length: 7 }, () => Array(5).fill(0));
  for (const entry of normalized) {
    for (const tag of entry.tags || []) tagCounts.set(String(tag), (tagCounts.get(String(tag)) || 0) + 1);
    const date = new Date(entry.createdAt);
    if (!Number.isNaN(date.getTime())) {
      const day = (date.getUTCDay() + 6) % 7;
      const hour = date.getUTCHours();
      const bucket = hour < 10 ? 0 : hour < 14 ? 1 : hour < 18 ? 2 : hour < 22 ? 3 : 4;
      heatmap[day][bucket] += 1;
    }
  }
  const locallyOmittedCount = sourceEntries.length - normalized.length;
  const omittedCount = snapshot.omittedCount + locallyOmittedCount;
  const invalidCount = snapshot.invalidCount + locallyOmittedCount;
  const status = snapshot.storageStatus === 'unavailable'
    ? 'unavailable'
    : snapshot.storageStatus === 'partial' || omittedCount > 0 || invalidCount > 0
      ? 'partial'
      : normalized.length
        ? 'available'
        : 'empty';
  return {
    status,
    omittedCount,
    invalidCount,
    trend: normalized.slice(-8).map((entry) => Number(entry.score)),
    tags: [...tagCounts.entries()]
      .map(([label, value]) => ({ label: label.replaceAll('_', ' '), value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    heatmap,
  };
}

export function setDiaryInsightEntries(value) {
  localInsightSnapshot = structuredClone(normalizeDiaryInsightSnapshot(value));
}

function neutralIntensityColor(pct) {
  const clamped = Math.min(1, Math.max(0, pct));
  const lightness = 90 - clamped * 36;
  return `hsl(210, 85%, ${lightness}%)`;
}

function translatedTagLabel(label) {
  const normalized = String(label || '').trim().toLowerCase().replaceAll(' ', '_');
  const key = `tag.${normalized}`;
  const translated = t(key);
  return translated === key ? normalized.replaceAll('_', ' ') : translated;
}

function entriesForWindow(windowName) {
  const snapshot = normalizeDiaryInsightSnapshot(localInsightSnapshot);
  if (snapshot.storageStatus === 'unavailable') return snapshot;
  const scopedEntries = selectDiaryInsightEntries(snapshot.entries, insightsContext);
  if (windowName === 'all') return { ...snapshot, entries: scopedEntries };
  const days = windowName === '7d' ? 7 : windowName === '90d' ? 90 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return { ...snapshot, entries: scopedEntries.filter((entry) => {
    const timestamp = new Date(entry?.createdAt).getTime();
    return !Number.isFinite(timestamp) || timestamp >= cutoff;
  }) };
}

function appendPartialNotice(container, insights) {
  if (insights?.status !== 'partial') return;
  const notice = document.createElement('div');
  notice.className = 'diary-muted-text diary-insights__status';
  setTranslatedText(notice, 'diary.insights.partial', { count: insights.omittedCount });
  container.appendChild(notice);
}

function appendNoDataState(container, insights, emptyKey) {
  if (insights?.status === 'partial') return appendPartialNotice(container, insights);
  const empty = document.createElement('div');
  empty.className = 'diary-muted-text';
  setTranslatedText(empty, insights?.status === 'unavailable'
    ? 'diary.insights.unavailable'
    : emptyKey);
  container.appendChild(empty);
}

function renderTrend(container) {
  container.innerHTML = '';
  const header = document.createElement('div');
  setTranslatedText(header, 'diary.trend');
  header.className = 'diary-insights__heading diary-insights__heading--primary';
  container.appendChild(header);

  const subtitle = document.createElement('div');
  setTranslatedText(subtitle, insightsContext.mode === 'history'
    ? 'diary.trendHistory'
    : insightsContext.mode === 'community'
      ? 'diary.trendCommunity'
      : 'diary.trendLive');
  subtitle.className = 'diary-insights__subtitle';
  container.appendChild(subtitle);

  const localInsights = insightsContext.mode === 'community'
    ? null
    : deriveLocalDiaryInsights(entriesForWindow(insightsState.window));
  const trend = localInsights ? localInsights.trend : demoTrend;
  if (!trend.length) {
    appendNoDataState(container, localInsights, CONTEXT_COPY[insightsContext.mode].emptyTrend);
    return;
  }
  appendPartialNotice(container, localInsights);

  const chart = document.createElement('div');
  chart.className = 'diary-insights__trend-chart';
  const max = Math.max(...trend, 1);
  const trendLabels = insightsContext.mode === 'community'
    ? [t('diary.start'), '0.5 km', '1.0 km', '1.5 km', t('diary.end')]
    : trend.map((_, index) => `#${index + 1}`);
  trend.forEach((v, idx) => {
    const bar = document.createElement('div');
    bar.className = 'diary-insights__trend-bar';
    bar.style.height = `${Math.max(24, (v / max) * 60)}px`;
    const valueLabel = insightsContext.mode === 'community'
      ? t('diary.insights.community.trendValue', {
        label: trendLabels[idx],
        score: v.toFixed(1),
      })
      : `${trendLabels[idx]} · ${v.toFixed(1)}`;
    bar.title = valueLabel;
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', valueLabel);
    chart.appendChild(bar);
  });
  container.appendChild(chart);

  const labels = document.createElement('div');
  labels.className = 'diary-insights__trend-labels';
  trendLabels.forEach((label) => {
    const lbl = document.createElement('span');
    lbl.textContent = label;
    labels.appendChild(lbl);
  });
  container.appendChild(labels);
}

function renderTags(container) {
  container.innerHTML = '';
  const header = document.createElement('div');
  setTranslatedText(header, 'diary.topTags');
  header.className = 'diary-insights__heading';
  container.appendChild(header);

  const subtitle = document.createElement('div');
  setTranslatedText(subtitle, `diary.insights.${insightsContext.mode}.tagsSubtitle`);
  subtitle.className = 'diary-insights__subtitle';
  container.appendChild(subtitle);

  const controls = document.createElement('div');
  controls.className = 'diary-insights__controls';

  const scopes = [
    { value: 'route', key: 'diary.scopeRoute' },
    { value: 'area', key: 'diary.scopeArea' },
    { value: 'city', key: 'diary.scopeCity' },
  ];
  scopes.forEach((scope) => {
    if (insightsContext.mode !== 'community') return;
    const btn = document.createElement('button');
    btn.type = 'button';
    setTranslatedText(btn, scope.key);
    btn.className = 'diary-pill-btn';
    const sync = () => {
      const active = insightsState.scope === scope.value;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    };
    btn.addEventListener('click', () => {
      insightsState.scope = scope.value;
      syncAll();
      renderBars();
    });
    scope.btn = btn;
    controls.appendChild(btn);
    sync();
  });

  if (insightsContext.mode !== 'community') {
    const windowSelect = document.createElement('select');
    windowSelect.className = 'diary-select';
    setTranslatedAttribute(windowSelect, 'diary.insightsWindow', 'aria-label');
    ['7d', '30d', '90d', 'all'].forEach((value) => {
      const opt = document.createElement('option');
      opt.value = value;
      setTranslatedText(opt,
        value === '7d'
          ? 'diary.lastWeek'
          : value === '30d'
            ? 'diary.last30d'
            : value === '90d'
              ? 'diary.last90d'
              : 'diary.allTime');
      windowSelect.appendChild(opt);
    });
    windowSelect.value = insightsState.window;
    windowSelect.addEventListener('change', () => {
      insightsState.window = windowSelect.value;
      renderBars();
    });
    controls.appendChild(windowSelect);
  }
  container.appendChild(controls);

  const barsWrap = document.createElement('div');
  barsWrap.className = 'diary-insights__tag-list';
  container.appendChild(barsWrap);

  const syncAll = () => {
    scopes.forEach((scope) => {
      if (scope.btn) {
        const active = insightsState.scope === scope.value;
        scope.btn.classList.toggle('is-active', active);
      }
    });
  };

  function renderBars() {
    const localInsights = insightsContext.mode === 'community'
      ? null
      : deriveLocalDiaryInsights(entriesForWindow(insightsState.window));
    const dataset = localInsights ? localInsights.tags : (DEMO_TAGS[insightsState.scope] || []);
    barsWrap.innerHTML = '';
    if (!dataset.length) {
      appendNoDataState(barsWrap, localInsights, CONTEXT_COPY[insightsContext.mode].emptyTags);
      return;
    }
    appendPartialNotice(barsWrap, localInsights);
    const max = Math.max(...dataset.map((t) => t.value), 1);
    dataset.forEach((tag) => {
      const row = document.createElement('div');
      row.className = 'diary-insights__tag-row';
      const label = document.createElement('div');
      label.textContent = translatedTagLabel(tag.label);
      label.className = 'diary-insights__tag-label';
      const barWrap = document.createElement('div');
      barWrap.className = 'diary-insights__tag-track';
      const bar = document.createElement('div');
      bar.className = 'diary-insights__tag-fill';
      bar.style.width = `${Math.max(12, (tag.value / max) * 100)}%`;
      barWrap.appendChild(bar);
      const value = document.createElement('div');
      value.className = 'diary-insights__tag-value';
      if (insightsContext.mode === 'community') {
        setTranslatedText(value, 'diary.insights.community.tagValue', { count: tag.value });
      } else {
        value.textContent = tag.value;
      }
      row.appendChild(label);
      row.appendChild(barWrap);
      row.appendChild(value);
      barsWrap.appendChild(row);
    });
  }

  renderBars();
}

function renderHeatmap(container) {
  container.innerHTML = '';
  const header = document.createElement('div');
  setTranslatedText(header, 'diary.weekdayTime');
  header.className = 'diary-insights__heading';
  container.appendChild(header);

  const subtitle = document.createElement('div');
  setTranslatedText(subtitle, `diary.insights.${insightsContext.mode}.heatmapSubtitle`);
  subtitle.className = 'diary-insights__subtitle';
  container.appendChild(subtitle);

  const grid = document.createElement('div');
  grid.className = 'diary-insights__heatmap';

  const empty = document.createElement('div');
  grid.appendChild(empty);
  heatmapWindowKeys.forEach((windowKey) => {
    const cell = document.createElement('div');
    setTranslatedText(cell, `diary.time.${windowKey}`);
    cell.className = 'diary-insights__heatmap-window';
    grid.appendChild(cell);
  });

  const localInsights = insightsContext.mode === 'community'
    ? null
    : deriveLocalDiaryInsights(entriesForWindow(insightsState.window));
  if (localInsights && !['available', 'partial'].includes(localInsights.status)) {
    const unavailable = document.createElement('div');
    unavailable.className = 'diary-muted-text';
    setTranslatedText(unavailable, localInsights.status === 'unavailable'
      ? 'diary.insights.unavailable'
      : CONTEXT_COPY[insightsContext.mode].emptyTrend);
    container.appendChild(unavailable);
    return;
  }
  if (localInsights?.status === 'partial' && !localInsights.trend.length) {
    appendPartialNotice(container, localInsights);
    return;
  }
  appendPartialNotice(container, localInsights);
  const values = localInsights ? localInsights.heatmap : heatmapValues;
  const maxValue = Math.max(...values.flat(), 1);
  heatmapDayKeys.forEach((dayKey, rowIdx) => {
    const label = document.createElement('div');
    setTranslatedText(label, `diary.day.${dayKey}`);
    label.className = 'diary-insights__heatmap-day';
    grid.appendChild(label);
    values[rowIdx].forEach((val, columnIdx) => {
      const cell = document.createElement('div');
      cell.className = 'diary-insights__heatmap-cell';
      cell.style.background = neutralIntensityColor(val / maxValue);
      const dayLabel = t(`diary.day.${dayKey}`);
      const valueLabel = insightsContext.mode === 'community'
        ? t('diary.insights.community.heatmapValue', {
          day: dayLabel,
          window: t(`diary.time.${heatmapWindowKeys[columnIdx]}`),
          value: val,
        })
        : `${dayLabel} · ${val}`;
      cell.title = valueLabel;
      cell.setAttribute('role', 'img');
      cell.setAttribute('aria-label', valueLabel);
      grid.appendChild(cell);
    });
  });

  container.appendChild(grid);
}

export function renderInsightsSections(trendEl, tagsEl, heatEl, opts = {}) {
  if (opts?.context) {
    insightsContext = normalizeDiaryInsightsContext(opts.context);
  }
  if (trendEl) renderTrend(trendEl);
  if (tagsEl) renderTags(tagsEl);
  if (heatEl) renderHeatmap(heatEl);
}
