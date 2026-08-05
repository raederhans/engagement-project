import { Chart } from 'chart.js/auto';

let chart;

const PALETTES = Object.freeze({
  blue: ['#2563eb', '#93c5fd'],
  teal: ['#0f766e', '#99f6e4'],
  contrast: ['#1d4ed8', '#f97316'],
});

const valueLabelsPlugin = {
  id: 'chartValueLabels',
  afterDatasetsDraw(chartInstance, _args, options) {
    if (!options?.enabled) return;
    const { ctx } = chartInstance;
    ctx.save();
    ctx.fillStyle = '#334155';
    ctx.font = '600 11px system-ui';
    ctx.textBaseline = 'middle';
    chartInstance.getDatasetMeta(0).data.forEach((element, index) => {
      const value = chartInstance.data.datasets[0].data[index];
      const suffix = chartInstance.data.datasets[0].valueKind === 'share' ? '%' : '';
      ctx.fillText(`${Number(value).toLocaleString()}${suffix}`, Math.min(element.x + 6, chartInstance.chartArea.right - 32), element.y);
    });
    ctx.restore();
  },
};

function wrapCategoryLabel(label) {
  if (label.length <= 20 || !label.includes(' ')) return label;
  const words = label.split(/\s+/).filter(Boolean);
  let splitAt = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const leftLength = words.slice(0, index).join(' ').length;
    const rightLength = words.slice(index).join(' ').length;
    const distance = Math.abs(leftLength - rightLength);
    if (distance < bestDistance) {
      bestDistance = distance;
      splitAt = index;
    }
  }
  return [words.slice(0, splitAt).join(' '), words.slice(splitAt).join(' ')];
}

export function buildTopNChartModel(rows, preferences = {}, copy = {}) {
  const categoryLimit = Math.max(1, Number(preferences.categoryLimit) || 8);
  const sorted = (rows || [])
    .map((row) => {
      const code = String(row.text_general_code || '');
      return {
        label: copy.offenseLabel?.(code) || code,
        value: Number(row.n) || 0,
      };
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const total = sorted.reduce((sum, row) => sum + row.value, 0);
  const visible = sorted.slice(0, categoryLimit);
  const mode = preferences.valueMode || 'count';
  const colors = PALETTES[preferences.palette] || PALETTES.blue;
  const shareValues = visible.map((row) => total ? Math.round((row.value / total) * 1000) / 10 : 0);
  const primaryValues = mode === 'share' ? shareValues : visible.map((row) => row.value);
  const datasets = [{
    label: copy.topOffenseTypes || '',
    data: primaryValues,
    rawValues: visible.map((row) => row.value),
    valueKind: mode === 'share' ? 'share' : 'count',
    backgroundColor: colors[0],
    borderRadius: 5,
    barThickness: 'flex',
    maxBarThickness: 28,
  }];
  if (mode === 'pareto') {
    let running = 0;
    datasets.push({
      type: 'line',
      label: copy.cumulativeShare || '',
      data: visible.map((row) => {
        running += row.value;
        return total ? Math.round((running / total) * 1000) / 10 : 0;
      }),
      borderColor: colors[1],
      backgroundColor: colors[1],
      pointRadius: 3,
      tension: 0.2,
      indexAxis: 'y',
      xAxisID: 'cumulative',
      yAxisID: 'y',
    });
  }

  return {
    type: 'bar',
    data: { labels: visible.map((row) => wrapCategoryLabel(row.label)), datasets },
    plugins: [valueLabelsPlugin],
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: true },
      layout: { padding: { right: preferences.showLabels ? 34 : 4 } },
      plugins: {
        legend: { display: mode === 'pareto', labels: { usePointStyle: true, boxWidth: 8 } },
        chartValueLabels: { enabled: Boolean(preferences.showLabels) && mode !== 'pareto' },
        tooltip: {
          callbacks: {
            label(context) {
              if (context.datasetIndex > 0) return copy.shareValue?.(context.raw) || `${context.raw}%`;
              const raw = context.dataset.rawValues?.[context.dataIndex] ?? context.raw;
              const share = total ? (raw / total) * 100 : 0;
              return copy.categoryValue?.(raw, share) || `${raw}`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          max: mode === 'share' ? 100 : undefined,
          title: { display: true, text: mode === 'share' ? (copy.shareAxis || '') : (copy.countAxis || '') },
          grid: { color: '#e2e8f0' },
        },
        y: { grid: { display: false } },
        ...(mode === 'pareto' ? {
          cumulative: { axis: 'x', position: 'top', min: 0, max: 100, title: { display: true, text: copy.cumulativeShare || '' }, grid: { drawOnChartArea: false } },
        } : {}),
      },
    },
    insight: {
      topLabel: visible[0]?.label || '',
      topCount: visible[0]?.value || 0,
      topShare: total && visible[0] ? (visible[0].value / total) * 100 : 0,
      visibleCount: visible.length,
    },
  };
}

/**
 * Render Top-N offense categories bar chart.
 * @param {HTMLCanvasElement|CanvasRenderingContext2D} ctx
 * @param {{text_general_code:string, n:number}[]} rows
 */
export function renderTopN(ctx, rows, copy = {}, preferences = {}) {
  const model = buildTopNChartModel(rows, preferences, copy);
  if (chart) chart.destroy();
  chart = new Chart(ctx, model);
  return model;
}

export function clearTopNChart() {
  chart?.destroy();
  chart = null;
}

