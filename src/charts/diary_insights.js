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

const cardStyle = 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;';
let insightsContext = 'live'; // 'live' | 'history' | 'community'

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

function renderTrend(container) {
  container.innerHTML = '';
  const header = document.createElement('div');
  header.textContent = 'Trend';
  header.style.font = '600 14px/1.3 "Inter", system-ui';
  header.style.color = '#0f172a';
  container.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.textContent = insightsContext === 'history'
    ? 'Avg safety score along saved routes'
    : insightsContext === 'community'
      ? 'Area demo visuals'
      : 'Avg safety score along the route';
  subtitle.style.font = '12px/1.3 "Inter", system-ui';
  subtitle.style.color = '#64748b';
  subtitle.style.marginBottom = '8px';
  container.appendChild(subtitle);

  const chart = document.createElement('div');
  chart.style.display = 'flex';
  chart.style.alignItems = 'flex-end';
  chart.style.gap = '8px';
  chart.style.height = '68px';
  const max = Math.max(...demoTrend);
  const trendLabels = ['Start', '0.5 km', '1.0 km', '1.5 km', 'End'];
  demoTrend.forEach((v, idx) => {
    const bar = document.createElement('div');
    bar.style.flex = '1';
    bar.style.borderRadius = '6px';
    bar.style.background = safetyColor(v);
    bar.style.border = '1px solid rgba(15,23,42,0.05)';
    bar.style.height = `${Math.max(24, (v / max) * 60)}px`;
    bar.title = `${trendLabels[idx]} · ${v.toFixed(1)}`;
    chart.appendChild(bar);
  });
  container.appendChild(chart);

  const labels = document.createElement('div');
  labels.style.display = 'flex';
  labels.style.justifyContent = 'space-between';
  labels.style.marginTop = '6px';
  labels.style.font = '12px/1.2 "Inter", system-ui';
  labels.style.color = '#475569';
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
  header.style.font = '600 13px/1.3 "Inter", system-ui';
  header.style.color = '#0f172a';
  container.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Demo feedback counts';
  subtitle.style.font = '12px/1.3 "Inter", system-ui';
  subtitle.style.color = '#64748b';
  subtitle.style.marginBottom = '8px';
  container.appendChild(subtitle);

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.flexWrap = 'wrap';
  controls.style.gap = '6px';
  controls.style.marginBottom = '8px';
  controls.style.alignItems = 'center';

  const scopes = [
    { value: 'route', label: 'This route' },
    { value: 'area', label: 'Nearby area' },
    { value: 'city', label: 'Citywide' },
  ];
  scopes.forEach((scope) => {
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
  barsWrap.style.display = 'flex';
  barsWrap.style.flexDirection = 'column';
  barsWrap.style.gap = '8px';
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
    const dataset = (DEMO_TAGS[insightsState.scope] && DEMO_TAGS[insightsState.scope][insightsState.window]) || [];
    barsWrap.innerHTML = '';
    const max = Math.max(...dataset.map((t) => t.value), 1);
    dataset.forEach((tag) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      const label = document.createElement('div');
      label.textContent = tag.label;
      label.style.flex = '1';
      label.style.font = '13px/1.3 "Inter", system-ui';
      label.style.color = '#0f172a';
      const barWrap = document.createElement('div');
      barWrap.style.flex = '2';
      barWrap.style.background = '#eef2ff';
      barWrap.style.border = '1px solid #e2e8f0';
      barWrap.style.borderRadius = '999px';
      barWrap.style.height = '12px';
      barWrap.style.overflow = 'hidden';
      const bar = document.createElement('div');
      bar.style.height = '100%';
      bar.style.width = `${Math.max(12, (tag.value / max) * 100)}%`;
      bar.style.background = '#60a5fa';
      barWrap.appendChild(bar);
      const value = document.createElement('div');
      value.textContent = tag.value;
      value.style.font = '12px/1.2 "Inter", system-ui';
      value.style.color = '#0f172a';
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
  header.textContent = '7×24 Heatmap';
  header.style.font = '600 13px/1.3 "Inter", system-ui';
  header.style.color = '#0f172a';
  container.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Demo intensity (higher Tue–Fri evenings)';
  subtitle.style.font = '12px/1.3 "Inter", system-ui';
  subtitle.style.color = '#64748b';
  subtitle.style.marginBottom = '8px';
  container.appendChild(subtitle);

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `84px repeat(${heatmapWindows.length}, 1fr)`;
  grid.style.gap = '8px';
  grid.style.alignItems = 'center';
  grid.style.border = '1px solid #e2e8f0';
  grid.style.borderRadius = '12px';
  grid.style.padding = '10px';
  grid.style.background = '#f8fafc';
  grid.style.maxWidth = '100%';
  grid.style.overflowX = 'auto';

  const empty = document.createElement('div');
  grid.appendChild(empty);
  heatmapWindows.forEach((w) => {
    const cell = document.createElement('div');
    cell.textContent = w;
    cell.style.font = '11px/1.3 "Inter", system-ui';
    cell.style.color = '#475569';
    cell.style.textAlign = 'center';
    cell.style.padding = '2px 0';
    grid.appendChild(cell);
  });

  heatmapDays.forEach((day, rowIdx) => {
    const label = document.createElement('div');
    label.textContent = day;
    label.style.font = '12px/1.3 "Inter", system-ui';
    label.style.color = '#0f172a';
    label.style.padding = '2px 0';
    grid.appendChild(label);
    heatmapValues[rowIdx].forEach((val) => {
      const cell = document.createElement('div');
      cell.style.height = '22px';
      cell.style.borderRadius = '6px';
      cell.style.background = barColor(val);
      cell.title = `${day} · ${val.toFixed(2)}`;
      grid.appendChild(cell);
    });
  });

  container.appendChild(grid);
}

export function renderInsightsSections(trendEl, tagsEl, heatEl, opts = {}) {
  if (opts?.context) {
    insightsContext = opts.context === 'history' ? 'history' : opts.context === 'community' ? 'community' : 'live';
  }
  if (trendEl) renderTrend(trendEl);
  if (tagsEl) renderTags(tagsEl);
  if (heatEl) renderHeatmap(heatEl);
}

export function createDiaryInsightsController(root) {
  if (!root || typeof document === 'undefined') return null;
  let built = false;
  let collapsed = true;
  let contentEl = null;
  let toggleBtn = null;
  let trendEl = null;
  let tagsEl = null;
  let heatEl = null;

  root.style.position = 'fixed';
  root.style.right = '12px';
  root.style.top = '12px';
  root.style.width = '360px';
  root.style.maxHeight = '88vh';
  root.style.overflow = 'hidden';
  root.style.zIndex = '18';
  root.style.font = '13px/1.4 "Inter", system-ui';
  root.style.display = 'none';

  function build() {
    if (built) return;
    root.innerHTML = '';
    const card = document.createElement('div');
    card.style.cssText = `${cardStyle} box-shadow:0 12px 28px rgba(15,23,42,0.16); background:#fff;`;

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.gap = '8px';
    const title = document.createElement('div');
    title.textContent = 'Insights';
    title.style.font = '600 14px/1.2 "Inter", system-ui';
    title.style.color = '#0f172a';
    const hint = document.createElement('div');
    hint.textContent = 'Demo visuals';
    hint.style.font = '12px/1.2 "Inter", system-ui';
    hint.style.color = '#64748b';
    const titleWrap = document.createElement('div');
    titleWrap.appendChild(title);
    titleWrap.appendChild(hint);
    toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = 'Insights ▸';
    toggleBtn.style.border = '1px solid #e2e8f0';
    toggleBtn.style.background = '#f8fafc';
    toggleBtn.style.borderRadius = '8px';
    toggleBtn.style.padding = '6px 10px';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.font = '12px/1.2 "Inter", system-ui';
    toggleBtn.addEventListener('click', () => setCollapsed(!collapsed));
    header.appendChild(titleWrap);
    header.appendChild(toggleBtn);
    card.appendChild(header);

    contentEl = document.createElement('div');
    contentEl.style.display = 'none';
    contentEl.style.flexDirection = 'column';
    contentEl.style.gap = '10px';
    contentEl.style.marginTop = '12px';

    trendEl = document.createElement('div');
    trendEl.style.cssText = cardStyle;
    tagsEl = document.createElement('div');
    tagsEl.style.cssText = cardStyle;
    heatEl = document.createElement('div');
    heatEl.style.cssText = cardStyle;

    contentEl.appendChild(trendEl);
    contentEl.appendChild(tagsEl);
    contentEl.appendChild(heatEl);
    card.appendChild(contentEl);

    root.appendChild(card);
    built = true;
  }

  function updateDemo() {
    if (!built) return;
    renderTrend(trendEl);
    renderTags(tagsEl);
    renderHeatmap(heatEl);
  }

  function setCollapsed(next) {
    collapsed = !!next;
    build();
    if (contentEl) {
      contentEl.style.display = collapsed ? 'none' : 'flex';
    }
    if (toggleBtn) {
      toggleBtn.textContent = collapsed ? 'Insights ▸' : 'Insights ▾';
    }
    if (!collapsed) {
      updateDemo();
    }
  }

  build();
  setCollapsed(true);

  return {
    show() {
      build();
      root.style.display = '';
    },
    hide() {
      root.style.display = 'none';
    },
    setCollapsed,
    updateDemo,
    setViewContext(mode) {
      insightsContext = mode === 'history' ? 'history' : mode === 'community' ? 'community' : 'live';
      if (!collapsed) {
        updateDemo();
      }
    },
  };
}
