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

let chart;

/**
 * Render monthly line chart comparing city vs buffer series.
 * @param {HTMLCanvasElement|CanvasRenderingContext2D} ctx
 * @param {{m:string,n:number}[]} citySeries
 * @param {{m:string,n:number}[]} bufferSeries
 */
export function renderMonthly(ctx, citySeries, bufferSeries) {
  const labels = unifyLabels(citySeries, bufferSeries);
  const cityVals = valuesFor(labels, citySeries);
  const bufVals = valuesFor(labels, bufferSeries);

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Citywide', data: cityVals, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.2)', tension: 0.2 },
        { label: 'Buffer A', data: bufVals, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.2)', tension: 0.2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { ticks: { autoSkip: true } },
        y: { beginAtZero: true, grace: '5%' },
      },
    },
  });
}

