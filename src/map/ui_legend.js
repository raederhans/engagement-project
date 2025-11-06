/**
 * Render a simple legend into the target element.
 * @param {number[]} breaks - thresholds (ascending)
 * @param {string[]} colors - palette (k entries)
 * @param {string} [el='#legend']
 */
export function drawLegend(breaks, colors, el = '#legend') {
  const root = typeof el === 'string' ? document.querySelector(el) : el;
  if (!root) return;

  const labels = [];
  const k = colors.length;
  for (let i = 0; i < k; i++) {
    const from = i === 0 ? 0 : breaks[i - 1];
    const to = i < breaks.length ? breaks[i] : '∞';
    labels.push({ color: colors[i], text: `${from} – ${to}` });
  }

  root.innerHTML = labels
    .map((l) => `<div class="row"><span class="swatch" style="background:${l.color}"></span>${l.text}</div>`) 
    .join('');
}

