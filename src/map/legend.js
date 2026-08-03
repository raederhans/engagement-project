import { t } from '../i18n/index.js';

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
    legendContainer.className = 'map-legend';
    legendContainer.hidden = true;
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

  const rows = [];

  const titleElement = document.createElement('div');
  titleElement.className = 'map-legend__title';
  titleElement.textContent = title || t('map.legend');
  rows.push(titleElement);
  if (subtitle) {
    const subtitleElement = document.createElement('div');
    subtitleElement.className = 'map-legend__subtitle';
    subtitleElement.textContent = subtitle;
    rows.push(subtitleElement);
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

  legendContainer.replaceChildren(...rows);
  legendContainer.hidden = false;
}

/**
 * Render a single legend row (swatch + label)
 * @param {string} color - Hex color
 * @param {string} label - Text label
 * @returns {HTMLElement} Legend row element
 */
function renderRow(color, label) {
  const row = document.createElement('div');
  row.className = 'map-legend__row';
  const swatch = document.createElement('span');
  swatch.className = 'map-legend__swatch';
  swatch.style.backgroundColor = color;
  swatch.setAttribute('aria-hidden', 'true');
  const labelElement = document.createElement('span');
  labelElement.className = 'map-legend__label';
  labelElement.textContent = label;
  row.append(swatch, labelElement);
  return row;
}

/**
 * Hide legend (collapse)
 */
export function hideLegend() {
  if (legendContainer) {
    legendContainer.hidden = true;
  }
}

/**
 * Show legend (unhide)
 */
export function showLegend() {
  if (legendContainer) {
    legendContainer.hidden = false;
  }
}
