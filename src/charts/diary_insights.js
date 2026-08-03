import '../i18n/p1.js';
import { setTranslatedAttribute, setTranslatedText, t } from '../i18n/index.js';

const demoTrend = [3.1, 3.3, 3.2, 3.5, 3.7];

const DEMO_TAGS = {
  route: {
    '7d': [
      { label: 'poor lighting', value: 4 },
      { label: 'low foot traffic', value: 3 },
      { label: 'cars too close', value: 2 },
    ],
    '30d': [
      { label: 'poor lighting', value: 12 },
      { label: 'low foot traffic', value: 8 },
      { label: 'cars too close', value: 6 },
    ],
    '90d': [
      { label: 'poor lighting', value: 18 },
      { label: 'low foot traffic', value: 14 },
      { label: 'speeding cars', value: 7 },
    ],
    all: [
      { label: 'poor lighting', value: 32 },
      { label: 'low foot traffic', value: 24 },
      { label: 'cars too close', value: 18 },
    ],
  },
  area: {
    '7d': [
      { label: 'low foot traffic', value: 6 },
      { label: 'poor lighting', value: 5 },
      { label: 'construction blockage', value: 3 },
    ],
    '30d': [
      { label: 'low foot traffic', value: 14 },
      { label: 'poor lighting', value: 11 },
      { label: 'construction blockage', value: 9 },
    ],
    '90d': [
      { label: 'low foot traffic', value: 20 },
      { label: 'poor lighting', value: 18 },
      { label: 'speeding cars', value: 10 },
    ],
    all: [
      { label: 'low foot traffic', value: 32 },
      { label: 'poor lighting', value: 28 },
      { label: 'construction blockage', value: 16 },
    ],
  },
  city: {
    '7d': [
      { label: 'speeding cars', value: 10 },
      { label: 'cars too close', value: 8 },
      { label: 'poor lighting', value: 8 },
    ],
    '30d': [
      { label: 'speeding cars', value: 26 },
      { label: 'cars too close', value: 20 },
      { label: 'poor lighting', value: 18 },
    ],
    '90d': [
      { label: 'speeding cars', value: 48 },
      { label: 'cars too close', value: 38 },
      { label: 'poor lighting', value: 34 },
    ],
    all: [
      { label: 'speeding cars', value: 76 },
      { label: 'cars too close', value: 60 },
      { label: 'poor lighting', value: 46 },
    ],
  },
};

const insightsState = { scope: 'route', window: '30d' };
const heatmapDayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const heatmapWindowKeys = ['morning', 'midday', 'afternoon', 'evening', 'lateNight'];
const heatmapValues = [
  [0.15, 0.12, 0.2, 0.32, 0.22],
  [0.14, 0.2, 0.35, 0.62, 0.38],
  [0.12, 0.22, 0.38, 0.58, 0.32],
  [0.12, 0.18, 0.32, 0.6, 0.34],
  [0.12, 0.16, 0.28, 0.5, 0.28],
  [0.1, 0.14, 0.22, 0.32, 0.24],
  [0.08, 0.12, 0.2, 0.28, 0.2],
];

let insightsContext = { mode: 'live', routeId: null };
let localInsightEntries = [];

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

export function deriveLocalDiaryInsights(entries = []) {
  const normalized = entries
    .filter((entry) => Number.isFinite(Number(entry?.score)))
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
  return {
    trend: normalized.slice(-8).map((entry) => Number(entry.score)),
    tags: [...tagCounts.entries()]
      .map(([label, value]) => ({ label: label.replaceAll('_', ' '), value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    heatmap,
  };
}

export function setDiaryInsightEntries(entries = []) {
  localInsightEntries = Array.isArray(entries) ? structuredClone(entries) : [];
}

function barColor(pct) {
  const clamped = Math.min(1, Math.max(0, pct));
  const lightness = 90 - clamped * 36;
  return `hsl(210, 85%, ${lightness}%)`;
}

function safetyColor(value) {
  if (value >= 4.2) return '#10b981';
  if (value >= 3.5) return '#34d399';
  if (value >= 2.5) return '#fbbf24';
  return '#f87171';
}

function translatedTagLabel(label) {
  const normalized = String(label || '').trim().toLowerCase().replaceAll(' ', '_');
  const key = `tag.${normalized}`;
  const translated = t(key);
  return translated === key ? normalized.replaceAll('_', ' ') : translated;
}

function entriesForWindow(windowName) {
  const scopedEntries = selectDiaryInsightEntries(localInsightEntries, insightsContext);
  if (windowName === 'all') return scopedEntries;
  const days = windowName === '7d' ? 7 : windowName === '90d' ? 90 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return scopedEntries.filter((entry) => new Date(entry.createdAt).getTime() >= cutoff);
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

  const trend = insightsContext.mode === 'community'
    ? demoTrend
    : deriveLocalDiaryInsights(entriesForWindow(insightsState.window)).trend;
  if (!trend.length) {
    const empty = document.createElement('div');
    empty.className = 'diary-muted-text';
    setTranslatedText(empty, CONTEXT_COPY[insightsContext.mode].emptyTrend);
    container.appendChild(empty);
    return;
  }

  const chart = document.createElement('div');
  chart.className = 'diary-insights__trend-chart';
  const max = Math.max(...trend, 1);
  const trendLabels = insightsContext.mode === 'community'
    ? [t('diary.start'), '0.5 km', '1.0 km', '1.5 km', t('diary.end')]
    : trend.map((_, index) => `#${index + 1}`);
  trend.forEach((v, idx) => {
    const bar = document.createElement('div');
    bar.className = 'diary-insights__trend-bar';
    bar.style.background = safetyColor(v);
    bar.style.height = `${Math.max(24, (v / max) * 60)}px`;
    bar.title = `${trendLabels[idx]} · ${v.toFixed(1)}`;
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
    const dataset = insightsContext.mode === 'community'
      ? ((DEMO_TAGS[insightsState.scope] && DEMO_TAGS[insightsState.scope][insightsState.window]) || [])
      : deriveLocalDiaryInsights(entriesForWindow(insightsState.window)).tags;
    barsWrap.innerHTML = '';
    if (!dataset.length) {
      const empty = document.createElement('div');
      empty.className = 'diary-muted-text';
      setTranslatedText(empty, CONTEXT_COPY[insightsContext.mode].emptyTags);
      barsWrap.appendChild(empty);
      return;
    }
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
      value.textContent = tag.value;
      value.className = 'diary-insights__tag-value';
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

  const values = insightsContext.mode === 'community'
    ? heatmapValues
    : deriveLocalDiaryInsights(entriesForWindow(insightsState.window)).heatmap;
  const maxValue = Math.max(...values.flat(), 1);
  heatmapDayKeys.forEach((dayKey, rowIdx) => {
    const label = document.createElement('div');
    setTranslatedText(label, `diary.day.${dayKey}`);
    label.className = 'diary-insights__heatmap-day';
    grid.appendChild(label);
    values[rowIdx].forEach((val) => {
      const cell = document.createElement('div');
      cell.className = 'diary-insights__heatmap-cell';
      cell.style.background = barColor(val / maxValue);
      cell.title = `${t(`diary.day.${dayKey}`)} · ${val}`;
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
