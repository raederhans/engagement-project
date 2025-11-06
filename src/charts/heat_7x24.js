import { Chart } from 'chart.js/auto';

let chart;

function valueToColor(v, max) {
  const t = Math.min(1, (v || 0) / (max || 1));
  const a = Math.floor(240 - 200 * t); // hue-ish scale
  const r = 240 - a; // simple blue -> cyan-ish
  const g = 240 - a * 0.5;
  const b = 255;
  const alpha = 0.2 + 0.8 * t;
  return `rgba(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)},${alpha.toFixed(2)})`;
}

/**
 * Render a 7x24 heatmap using a scatter chart of square points.
 * @param {HTMLCanvasElement|CanvasRenderingContext2D} ctx
 * @param {number[][]} matrix - 7 rows (0=Sun..6=Sat) x 24 cols
 */
export function render7x24(ctx, matrix) {
  const data = [];
  let vmax = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = Number(matrix?.[d]?.[h]) || 0;
      vmax = Math.max(vmax, v);
      data.push({ x: h, y: d, v });
    }
  }

  const dataset = {
    label: '7x24',
    data,
    pointRadius: 6,
    pointStyle: 'rectRounded',
    backgroundColor: (ctx) => valueToColor(ctx.raw.v, vmax),
    borderWidth: 0,
  };

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets: [dataset] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true, callbacks: { label: (ctx) => `hr ${ctx.raw.x}: ${ctx.raw.v}` } } },
      scales: {
        x: { type: 'linear', min: 0, max: 23, ticks: { stepSize: 3 } },
        y: { type: 'linear', min: 0, max: 6, ticks: { callback: (v) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][v] } },
      },
      elements: { point: { hoverRadius: 7 } },
    },
  });
}

