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

  const rows = labels.map((label) => {
    const row = document.createElement('div');
    row.className = 'map-legend__row';
    const swatch = document.createElement('span');
    swatch.className = 'map-legend__swatch';
    swatch.style.backgroundColor = label.color;
    swatch.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'map-legend__label';
    text.textContent = label.text;
    row.append(swatch, text);
    return row;
  });
  root.replaceChildren(...rows);
}

