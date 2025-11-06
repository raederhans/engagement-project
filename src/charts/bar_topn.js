import { Chart } from 'chart.js/auto';

let chart;

/**
 * Render Top-N offense categories bar chart.
 * @param {HTMLCanvasElement|CanvasRenderingContext2D} ctx
 * @param {{text_general_code:string, n:number}[]} rows
 */
export function renderTopN(ctx, rows) {
  const labels = (rows || []).map((r) => r.text_general_code);
  const values = (rows || []).map((r) => Number(r.n) || 0);

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Top-N offense types', data: values, backgroundColor: '#60a5fa' },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true },
      },
    },
  });
}

