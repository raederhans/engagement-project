import { Chart } from 'chart.js/auto';

let chart;

const PALETTES = Object.freeze({
  blue: ['#eff6ff', '#dbeafe', '#93c5fd', '#60a5fa', '#2563eb', '#1e3a8a'],
  teal: ['#f0fdfa', '#ccfbf1', '#99f6e4', '#2dd4bf', '#0f766e', '#134e4a'],
  contrast: ['#f8fafc', '#dbeafe', '#93c5fd', '#3b82f6', '#f97316', '#9a3412'],
});

function cleanMatrix(matrix) {
  return Array.from({ length: 7 }, (_, day) => (
    Array.from({ length: 24 }, (_, hour) => Number(matrix?.[day]?.[hour]) || 0)
  ));
}

function quantileThresholds(values, bins) {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return [];
  return Array.from({ length: bins - 1 }, (_, index) => {
    const position = Math.ceil(((index + 1) / bins) * sorted.length) - 1;
    return sorted[Math.max(0, position)];
  });
}

function equalThresholds(values, bins) {
  const max = Math.max(0, ...values);
  if (!max) return [];
  return Array.from({ length: bins - 1 }, (_, index) => (max * (index + 1)) / bins);
}

function colorIndexes(values, method, bins = 5) {
  const max = Math.max(0, ...values);
  const thresholds = method === 'quantile'
    ? quantileThresholds(values, bins)
    : method === 'equal'
      ? equalThresholds(values, bins)
      : [];
  return values.map((value) => {
    if (value <= 0 || max <= 0) return 0;
    if (method === 'continuous') return Math.min(bins, 1 + Math.floor((value / max) * (bins - 0.001)));
    return Math.min(bins, 1 + thresholds.filter((threshold) => value > threshold).length);
  });
}

const heatGridPlugin = {
  id: 'temporalHeatGrid',
  beforeDatasetsDraw(chartInstance, _args, options) {
    if (!options?.enabled) return;
    const dataset = chartInstance.data.datasets[0];
    const x = chartInstance.scales.x;
    const y = chartInstance.scales.y;
    const cellWidth = Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0));
    const cellHeight = Math.abs(y.getPixelForValue(1) - y.getPixelForValue(0));
    const { ctx } = chartInstance;
    ctx.save();
    for (const cell of dataset.data) {
      ctx.fillStyle = cell.color;
      ctx.fillRect(
        x.getPixelForValue(cell.x) - cellWidth / 2 + 1,
        y.getPixelForValue(cell.y) - cellHeight / 2 + 1,
        Math.max(1, cellWidth - 2),
        Math.max(1, cellHeight - 2),
      );
    }
    ctx.restore();
  },
};

function temporalInsight(matrix) {
  let peakDay = 0;
  let peakHour = 0;
  let peakCount = 0;
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      if (matrix[day][hour] > peakCount) {
        peakCount = matrix[day][hour];
        peakDay = day;
        peakHour = hour;
      }
    }
  }
  return { peakDay, peakHour, peakCount };
}

export function buildTemporalChartModel(inputMatrix, preferences = {}, copy = {}) {
  const matrix = cleanMatrix(inputMatrix);
  const view = preferences.view || 'heat';
  const colors = PALETTES[preferences.palette] || PALETTES.blue;
  const insight = temporalInsight(matrix);
  const weekdays = copy.weekdays || Array.from({ length: 7 }, (_, index) => String(index));

  if (view === 'weekday') {
    const data = matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
    return {
      type: 'bar',
      data: { labels: weekdays, datasets: [{ label: copy.weekdayTotal || '', data, backgroundColor: colors[4], borderRadius: 5 }] },
      options: barOptions(copy, preferences),
      insight,
    };
  }

  if (view === 'hour') {
    const data = Array.from({ length: 24 }, (_, hour) => matrix.reduce((sum, row) => sum + row[hour], 0));
    return {
      type: 'bar',
      data: { labels: Array.from({ length: 24 }, (_, hour) => copy.hourLabel?.(hour) || String(hour)), datasets: [{ label: copy.hourTotal || '', data, backgroundColor: colors[4], borderRadius: 4 }] },
      options: barOptions(copy, preferences),
      insight,
    };
  }

  const flat = matrix.flat();
  const indexes = colorIndexes(flat, preferences.classification || 'quantile');
  const data = [];
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const offset = day * 24 + hour;
      data.push({ x: hour, y: day, v: matrix[day][hour], color: colors[indexes[offset]] });
    }
  }
  return {
    type: 'scatter',
    data: { datasets: [{ label: copy.heatmap || '', data, pointRadius: 0, pointHoverRadius: 5 }] },
    plugins: [heatGridPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'xy' },
      plugins: {
        legend: { display: false },
        temporalHeatGrid: { enabled: true },
        tooltip: { callbacks: { label: (context) => copy.hourValue?.(context.raw.x, context.raw.v, weekdays[context.raw.y]) || `${context.raw.v}` } },
      },
      scales: {
        x: { type: 'linear', min: -0.5, max: 23.5, ticks: { stepSize: 3, callback: (value) => Number.isInteger(value) && value >= 0 ? (copy.hourShort?.(value) || String(value)) : '' }, grid: { display: false } },
        y: { type: 'linear', min: -0.5, max: 6.5, reverse: true, ticks: { stepSize: 1, callback: (value) => weekdays[value] || '' }, grid: { display: false } },
      },
    },
    insight,
  };
}

function barOptions(copy, preferences) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (context) => copy.countValue?.(context.raw) || `${context.raw}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } },
      y: { beginAtZero: true, title: { display: true, text: copy.countAxis || '' } },
    },
    elements: { bar: { borderSkipped: false } },
    layout: { padding: preferences.showLabels ? 4 : 0 },
  };
}

export function render7x24(ctx, matrix, copy = {}, preferences = {}) {
  const model = buildTemporalChartModel(matrix, preferences, copy);
  if (chart) chart.destroy();
  chart = new Chart(ctx, model);
  return model;
}

export function clearTemporalChart() {
  chart?.destroy();
  chart = null;
}
