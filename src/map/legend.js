import { onLanguageChange, setTranslatedText, t } from '../i18n/index.js';
import { localizeOffenseCode } from '../i18n/crime_offenses.js';

/**
 * Reusable map legend control for choropleth layers (districts, tracts)
 */

let legendContainer = null;

onLanguageChange(() => {
  for (const label of legendContainer?.querySelectorAll?.('[data-offense-code]') || []) {
    label.textContent = localizeOffenseCode(label.dataset.offenseCode);
  }
});

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
export function updateLegend({ title, unit = '', breaks, colors, subtitle, items }) {
  if (!legendContainer) {
    initLegend();
  }

  const categorical = items?.length;
  if ((!categorical && !colors?.length) || (!categorical && !breaks?.length)) {
    hideLegend();
    return;
  }

  const rows = renderHeader(title, subtitle);

  if (categorical) {
    setTranslatedText(rows[0], title);
    setTranslatedText(rows[1], subtitle);
    rows.push(...items.map(({ color, code }) => renderRow(color, localizeOffenseCode(code), code)));
    renderLegendRows(rows);
    return;
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

  renderLegendRows(rows);
}

function renderHeader(title, subtitle) {
  const rows = [renderText('div', 'map-legend__title', title || t('map.legend'))];
  if (!subtitle) return rows;
  rows.push(renderText('div', 'map-legend__subtitle', subtitle));
  return rows;
}

function renderText(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function renderLegendRows(rows) {
  legendContainer.replaceChildren(...rows);
  legendContainer.hidden = false;
}

/**
 * Render a single legend row (swatch + label)
 * @param {string} color - Hex color
 * @param {string} label - Text label
 * @returns {HTMLElement} Legend row element
 */
function renderRow(color, label, offenseCode = '') {
  const row = document.createElement('div');
  row.className = 'map-legend__row';
  const swatch = document.createElement('span');
  swatch.className = 'map-legend__swatch';
  swatch.style.backgroundColor = color;
  swatch.setAttribute('aria-hidden', 'true');
  const labelElement = renderText('span', 'map-legend__label', label);
  if (offenseCode) labelElement.dataset.offenseCode = offenseCode;
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
