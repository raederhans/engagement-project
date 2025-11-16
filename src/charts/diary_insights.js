const demoTrend = [3.1, 3.3, 3.2, 3.5, 3.7];
const demoTags = [
  { label: 'poor lighting', value: 12 },
  { label: 'low foot traffic', value: 8 },
  { label: 'cars too close', value: 6 },
];
const heatmapDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const heatmapWindows = ['Morning', 'Midday', 'Afternoon', 'Evening', 'Late', 'Overnight'];
const heatmapValues = [
  [0.15, 0.12, 0.1, 0.22, 0.18, 0.12],
  [0.14, 0.2, 0.25, 0.72, 0.68, 0.24],
  [0.12, 0.2, 0.3, 0.65, 0.62, 0.22],
  [0.12, 0.18, 0.26, 0.7, 0.66, 0.2],
  [0.12, 0.16, 0.24, 0.6, 0.55, 0.18],
  [0.1, 0.14, 0.2, 0.28, 0.24, 0.16],
  [0.08, 0.12, 0.18, 0.22, 0.18, 0.14],
];

const cardStyle = 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;';

function barColor(pct) {
  const clamped = Math.min(1, Math.max(0, pct));
  const lightness = 92 - clamped * 32;
  return `hsl(42, 95%, ${lightness}%)`;
}

function renderTrend(container) {
  container.innerHTML = '';
  const header = document.createElement('div');
  header.textContent = 'Trend';
  header.style.font = '600 13px/1.3 "Inter", system-ui';
  header.style.color = '#0f172a';
  container.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Avg safety score (demo)';
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
  demoTrend.forEach((v) => {
    const bar = document.createElement('div');
    bar.style.flex = '1';
    bar.style.borderRadius = '6px 6px 4px 4px';
    bar.style.background = 'linear-gradient(180deg, #0ea5e9, #0f172a)';
    bar.style.height = `${Math.max(24, (v / max) * 60)}px`;
    bar.title = v.toFixed(1);
    chart.appendChild(bar);
  });
  container.appendChild(chart);

  const labels = document.createElement('div');
  labels.style.display = 'flex';
  labels.style.justifyContent = 'space-between';
  labels.style.marginTop = '6px';
  labels.style.font = '12px/1.2 "Inter", system-ui';
  labels.style.color = '#475569';
  demoTrend.forEach((v, idx) => {
    const lbl = document.createElement('span');
    lbl.textContent = `P${idx + 1} · ${v.toFixed(1)}`;
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

  const max = Math.max(...demoTags.map((t) => t.value));
  demoTags.forEach((tag) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.marginBottom = '8px';
    const label = document.createElement('div');
    label.textContent = tag.label;
    label.style.flex = '1';
    label.style.font = '13px/1.3 "Inter", system-ui';
    label.style.color = '#0f172a';
    const barWrap = document.createElement('div');
    barWrap.style.flex = '2';
    barWrap.style.background = '#f8fafc';
    barWrap.style.border = '1px solid #e2e8f0';
    barWrap.style.borderRadius = '999px';
    barWrap.style.height = '10px';
    barWrap.style.overflow = 'hidden';
    const bar = document.createElement('div');
    bar.style.height = '100%';
    bar.style.width = `${Math.max(12, (tag.value / max) * 100)}%`;
    bar.style.background = 'linear-gradient(90deg, #22c55e, #0ea5e9)';
    barWrap.appendChild(bar);
    const value = document.createElement('div');
    value.textContent = tag.value;
    value.style.font = '12px/1.2 "Inter", system-ui';
    value.style.color = '#0f172a';
    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(value);
    container.appendChild(row);
  });
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
  grid.style.gridTemplateColumns = `80px repeat(${heatmapWindows.length}, 1fr)`;
  grid.style.gap = '4px';
  grid.style.alignItems = 'center';

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
      cell.style.height = '18px';
      cell.style.borderRadius = '6px';
      cell.style.background = barColor(val);
      cell.title = `${day} · ${val.toFixed(2)}`;
      grid.appendChild(cell);
    });
  });

  container.appendChild(grid);
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
    card.style.cssText = `${cardStyle} box-shadow:0 10px 24px rgba(15,23,42,0.18);`;

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
  };
}
