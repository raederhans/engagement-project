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
const heatmapDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const heatmapWindows = ['Morning', 'Midday', 'Afternoon', 'Evening', 'Late night'];
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
    title: 'Current route insights',
    hint: 'Local ratings for this route',
    intro: 'Patterns from ratings saved for the selected route on this device.',
    emptyTrend: 'No ratings saved for this route in this period.',
    emptyTags: 'No tags saved for this route in this period.',
  },
  history: {
    title: 'Your local patterns',
    hint: 'All ratings saved on this device',
    intro: 'Patterns across all of your locally saved route ratings.',
    emptyTrend: 'No local ratings saved in this period.',
    emptyTags: 'No local tags saved in this period.',
  },
  community: {
    title: 'Sample community patterns',
    hint: 'Illustrative sample data',
    intro: 'Read-only example patterns; these are not community submissions.',
    emptyTrend: 'No sample ratings are available.',
    emptyTags: 'No sample tags are available.',
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
  return { ...CONTEXT_COPY[mode] };
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
  header.textContent = 'Trend';
  header.style.cssText = 'font:600 14px/1.3 "Inter",system-ui;color:#0f172a';
  container.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.textContent = insightsContext.mode === 'history'
    ? 'Avg safety score along saved routes'
    : insightsContext.mode === 'community'
      ? 'Illustrative sample score pattern'
      : 'Avg safety score for the current route';
  subtitle.style.cssText = 'font:12px/1.3 "Inter",system-ui;color:#64748b;margin-bottom:8px';
  container.appendChild(subtitle);

  const trend = insightsContext.mode === 'community'
    ? demoTrend
    : deriveLocalDiaryInsights(entriesForWindow(insightsState.window)).trend;
  if (!trend.length) {
    const empty = document.createElement('div');
    empty.className = 'diary-muted-text';
    empty.textContent = describeDiaryInsightsContext(insightsContext).emptyTrend;
    container.appendChild(empty);
    return;
  }

  const chart = document.createElement('div');
  chart.style.cssText = 'display:flex;align-items:flex-end;gap:8px;height:68px';
  const max = Math.max(...trend, 1);
  const trendLabels = insightsContext.mode === 'community'
    ? ['Start', '0.5 km', '1.0 km', '1.5 km', 'End']
    : trend.map((_, index) => `#${index + 1}`);
  trend.forEach((v, idx) => {
    const bar = document.createElement('div');
    bar.style.cssText = 'flex:1;border-radius:6px;border:1px solid rgba(15,23,42,.05)';
    bar.style.background = safetyColor(v);
    bar.style.height = `${Math.max(24, (v / max) * 60)}px`;
    bar.title = `${trendLabels[idx]} · ${v.toFixed(1)}`;
    chart.appendChild(bar);
  });
  container.appendChild(chart);

  const labels = document.createElement('div');
  labels.style.cssText = 'display:flex;justify-content:space-between;margin-top:6px;font:12px/1.2 "Inter",system-ui;color:#475569';
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
  header.textContent = 'Top Tags';
  header.style.cssText = 'font:600 13px/1.3 "Inter",system-ui;color:#0f172a';
  container.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.textContent = insightsContext.mode === 'community'
    ? 'Illustrative sample feedback counts'
    : insightsContext.mode === 'history'
      ? 'All ratings saved on this device'
      : 'Ratings saved for this route on this device';
  subtitle.style.cssText = 'font:12px/1.3 "Inter",system-ui;color:#64748b;margin-bottom:8px';
  container.appendChild(subtitle);

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;align-items:center';

  const scopes = [
    { value: 'route', label: 'This route' },
    { value: 'area', label: 'Nearby area' },
    { value: 'city', label: 'Citywide' },
  ];
  scopes.forEach((scope) => {
    if (insightsContext.mode !== 'community') return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = scope.label;
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
  ['7d', '30d', '90d', 'all'].forEach((value) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent =
      value === '7d'
        ? 'Last week'
        : value === '30d'
          ? 'Last 30d'
          : value === '90d'
            ? 'Last 90d'
            : 'All time';
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
  barsWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  container.appendChild(barsWrap);

  const syncAll = () => {
    scopes.forEach((scope) => {
      if (scope.btn) {
        const active = insightsState.scope === scope.value;
        scope.btn.style.background = active ? '#0ea5e9' : '#fff';
        scope.btn.style.color = active ? '#fff' : '#0f172a';
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
      empty.textContent = describeDiaryInsightsContext(insightsContext).emptyTags;
      barsWrap.appendChild(empty);
      return;
    }
    const max = Math.max(...dataset.map((t) => t.value), 1);
    dataset.forEach((tag) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px';
      const label = document.createElement('div');
      label.textContent = tag.label;
      label.style.cssText = 'flex:1;font:13px/1.3 "Inter",system-ui;color:#0f172a';
      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'flex:2;background:#eef2ff;border:1px solid #e2e8f0;border-radius:999px;height:12px;overflow:hidden';
      const bar = document.createElement('div');
      bar.style.cssText = 'height:100%;background:#60a5fa';
      bar.style.width = `${Math.max(12, (tag.value / max) * 100)}%`;
      barWrap.appendChild(bar);
      const value = document.createElement('div');
      value.textContent = tag.value;
      value.style.cssText = 'font:12px/1.2 "Inter",system-ui;color:#0f172a';
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
  header.textContent = 'Weekday × time window';
  header.style.cssText = 'font:600 13px/1.3 "Inter",system-ui;color:#0f172a';
  container.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.textContent = insightsContext.mode === 'community'
    ? 'Sample intensity (higher Tue–Fri evenings)'
    : insightsContext.mode === 'history'
      ? 'When your ratings were saved on this device'
      : 'When ratings for this route were saved';
  subtitle.style.cssText = 'font:12px/1.3 "Inter",system-ui;color:#64748b;margin-bottom:8px';
  container.appendChild(subtitle);

  const grid = document.createElement('div');
  grid.style.cssText = `display:grid;grid-template-columns:84px repeat(${heatmapWindows.length},1fr);gap:8px;align-items:center;border:1px solid #e2e8f0;border-radius:12px;padding:10px;background:#f8fafc;max-width:100%;overflow-x:auto`;

  const empty = document.createElement('div');
  grid.appendChild(empty);
  heatmapWindows.forEach((w) => {
    const cell = document.createElement('div');
    cell.textContent = w;
    cell.style.cssText = 'font:11px/1.3 "Inter",system-ui;color:#475569;text-align:center;padding:2px 0';
    grid.appendChild(cell);
  });

  const values = insightsContext.mode === 'community'
    ? heatmapValues
    : deriveLocalDiaryInsights(entriesForWindow(insightsState.window)).heatmap;
  const maxValue = Math.max(...values.flat(), 1);
  heatmapDays.forEach((day, rowIdx) => {
    const label = document.createElement('div');
    label.textContent = day;
    label.style.cssText = 'font:12px/1.3 "Inter",system-ui;color:#0f172a;padding:2px 0';
    grid.appendChild(label);
    values[rowIdx].forEach((val) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'height:22px;border-radius:6px';
      cell.style.background = barColor(val / maxValue);
      cell.title = `${day} · ${val}`;
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
