import { Chart } from 'chart.js/auto';

function unifyLabels(citySeries, bufferSeries) {
  const set = new Set();
  for (const r of citySeries || []) set.add(r.m);
  for (const r of bufferSeries || []) set.add(r.m);
  return Array.from(set).sort();
}

function valuesFor(labels, series) {
  const map = new Map((series || []).map((r) => [r.m, Number(r.n) || 0]));
  return labels.map((l) => map.get(l) ?? 0);
}

function indexValues(values) {
  const baseline = values.find((value) => value > 0) || 0;
  if (!baseline) return values.map(() => 0);
  return values.map((value) => Math.round((value / baseline) * 1000) / 10);
}

function percentChange(values, endIndex = values.length - 1) {
  const comparisonValues = values.slice(0, endIndex + 1);
  const first = comparisonValues.find((value) => value > 0);
  const last = comparisonValues.at(-1);
  if (!first || !Number.isFinite(last)) return null;
  return ((last - first) / first) * 100;
}

function localCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const PALETTES = Object.freeze({
  blue: ['#2563eb', '#0f766e'],
  teal: ['#0f766e', '#c2410c'],
  contrast: ['#1d4ed8', '#b91c1c'],
});

export function buildMonthlyChartModel(citySeries, bufferSeries, preferences = {}, copy = {}) {
  const labels = unifyLabels(citySeries, bufferSeries);
  const cityRaw = valuesFor(labels, citySeries);
  const areaRaw = valuesFor(labels, bufferSeries);
  const indexed = preferences.valueMode !== 'count';
  const currentMonth = preferences.currentMonth || localCurrentMonth();
  const excludesPartialMonth = labels.length > 1 && labels.at(-1) === currentMonth;
  const insightEndIndex = excludesPartialMonth ? labels.length - 2 : labels.length - 1;
  const colors = PALETTES[preferences.palette] || PALETTES.blue;
  const datasets = [
    {
      label: copy.citywide || '',
      data: indexed ? indexValues(cityRaw) : cityRaw,
      rawValues: cityRaw,
      borderColor: colors[0],
      backgroundColor: `${colors[0]}1f`,
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 5,
      tension: 0.25,
      yAxisID: indexed ? 'y' : 'yCity',
    },
  ];
  if (areaRaw.length && areaRaw.some((value) => value > 0)) {
    datasets.push({
      label: copy.selectedArea || '',
      data: indexed ? indexValues(areaRaw) : areaRaw,
      rawValues: areaRaw,
      borderColor: colors[1],
      backgroundColor: `${colors[1]}1f`,
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 5,
      tension: 0.25,
      yAxisID: indexed ? 'y' : 'yArea',
    });
  }

  const scales = indexed
    ? {
        x: { ticks: { autoSkip: true, maxRotation: 0 }, grid: { display: false } },
        y: { beginAtZero: false, grace: '8%', title: { display: true, text: copy.indexedAxis || '' } },
      }
    : {
        x: { ticks: { autoSkip: true, maxRotation: 0 }, grid: { display: false } },
        yCity: { beginAtZero: true, position: 'left', title: { display: true, text: copy.cityCountAxis || '' } },
        yArea: { beginAtZero: true, position: 'right', title: { display: datasets.length > 1, text: copy.areaCountAxis || '' }, grid: { drawOnChartArea: false } },
      };

  return {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            label(context) {
              const raw = context.dataset.rawValues?.[context.dataIndex] ?? context.raw;
              return copy.monthValue?.(context.dataset.label, raw, context.raw, indexed) || `${raw}`;
            },
          },
        },
      },
      scales,
    },
    insight: {
      cityChange: percentChange(cityRaw, insightEndIndex),
      areaChange: percentChange(areaRaw, insightEndIndex),
      hasArea: datasets.length > 1,
      excludesPartialMonth,
    },
  };
}

let chart;

/**
 * Render monthly line chart comparing city vs buffer series.
 * @param {HTMLCanvasElement|CanvasRenderingContext2D} ctx
 * @param {{m:string,n:number}[]} citySeries
 * @param {{m:string,n:number}[]} bufferSeries
 */
export function renderMonthly(ctx, citySeries, bufferSeries, copy = {}, preferences = {}) {
  const model = buildMonthlyChartModel(citySeries, bufferSeries, preferences, copy);
  if (chart) chart.destroy();
  chart = new Chart(ctx, model);
  return model;
}

export function clearMonthlyChart() {
  chart?.destroy();
  chart = null;
}

