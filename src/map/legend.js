/**
 * Reusable map legend control for choropleth layers (districts, tracts)
 */

let legendContainer = null;

/**
 * Initialize legend container (bottom-right corner)
 * @param {string} [containerId='legend'] - DOM element ID
 */
export function initLegend(containerId = 'legend') {
  legendContainer = document.getElementById(containerId);
  if (!legendContainer) {
    legendContainer = document.createElement('div');
    legendContainer.id = containerId;
    Object.assign(legendContainer.style, {
      position: 'fixed',
      bottom: '12px',
      right: '12px',
      zIndex: '10',
      background: 'rgba(255,255,255,0.95)',
      padding: '10px 12px',
      borderRadius: '6px',
      font: '12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      maxWidth: '200px',
      display: 'none', // Hidden by default
    });
    document.body.appendChild(legendContainer);
  }
}

/**
 * Update legend with new title, breaks, and colors
 * @param {{title:string,unit:string,breaks:number[],colors:string[]}} params
 */
export function updateLegend({ title, unit = '', breaks, colors, subtitle }) {
  if (!legendContainer) {
    initLegend();
  }

  if (!breaks || !colors || breaks.length === 0 || colors.length === 0) {
    hideLegend();
    return;
  }

  // Build legend HTML
  const rows = [];

  // Title row
  rows.push(`<div style="font-weight:600; margin-bottom:4px;">${title || 'Legend'}</div>`);
  if (subtitle) {
    rows.push(`<div style="font-size:11px; color:#6b7280; margin-bottom:6px;">${subtitle}</div>`);
  }

  // First range: 0 to breaks[0]
  rows.push(renderRow(colors[0], `0 - ${breaks[0]}${unit}`));

  // Middle ranges: breaks[i] to breaks[i+1]
  for (let i = 0; i < breaks.length - 1; i++) {
    const colorIdx = Math.min(i + 1, colors.length - 1);
    rows.push(renderRow(colors[colorIdx], `${breaks[i]} - ${breaks[i + 1]}${unit}`));
  }

  // Last range: breaks[last] +
  const lastColorIdx = Math.min(breaks.length, colors.length - 1);
  rows.push(renderRow(colors[lastColorIdx], `${breaks[breaks.length - 1]}+ ${unit}`));

  legendContainer.innerHTML = rows.join('');
  legendContainer.style.display = 'block';
}

/**
 * Render a single legend row (swatch + label)
 * @param {string} color - Hex color
 * @param {string} label - Text label
 * @returns {string} HTML string
 */
function renderRow(color, label) {
  return `
    <div class="legend-row" style="display:flex; align-items:center; margin-bottom:4px;">
      <div class="swatch" style="display:inline-block; width:16px; height:16px; margin-right:8px; background:${color}; border:1px solid #ccc; border-radius:2px;"></div>
      <span style="font-size:11px; color:#333;">${label}</span>
    </div>
  `;
}

/**
 * Hide legend (collapse)
 */
export function hideLegend() {
  if (legendContainer) {
    legendContainer.style.display = 'none';
  }
}

/**
 * Show legend (unhide)
 */
export function showLegend() {
  if (legendContainer) {
    legendContainer.style.display = 'block';
  }
}
