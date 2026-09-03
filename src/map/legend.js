import { onLanguageChange, setTranslatedText, t } from '../i18n/index.js';
import { localizeOffenseCode } from '../i18n/crime_offenses.js';

/**
 * Reusable map legend control for choropleth layers (districts, tracts)
 */

let legendContainer = null;

onLanguageChange(() => {
  for (const label of legendContainer?.querySelectorAll?.('[data-i18n]') || []) {
    let params = {};
    try {
      params = JSON.parse(label.dataset?.i18nParams || '{}');
    } catch {
      params = {};
    }
    label.textContent = t(label.dataset.i18n, params);
  }
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
export function updateLegend({
  title,
  unit = '',
  breaks,
  colors,
  subtitle,
  subtitleKey,
  subtitleParams,
  items,
  swatchOpacity = 1,
}) {
  if (!legendContainer) {
    initLegend();
  }

  const categorical = items?.length;
  if ((!categorical && !colors?.length) || (!categorical && !breaks?.length)) {
    hideLegend();
    return;
  }

  const rows = renderHeader(title, subtitle, subtitleKey, subtitleParams);
  setTranslatedText(rows[0], title || 'map.legend');

  if (categorical) {
    if (rows[1] && !subtitleKey && subtitle) setTranslatedText(rows[1], subtitle);
    rows.push(...items.map(({ color, code }) => (
      renderRow(color, localizeOffenseCode(code), code, swatchOpacity)
    )));
    renderLegendRows(rows);
    return;
  }

  // First range: 0 to breaks[0]
  rows.push(renderRow(colors[0], `0 - ${breaks[0]}${unit}`, '', swatchOpacity));

  // Middle ranges: breaks[i] to breaks[i+1]
  for (let i = 0; i < breaks.length - 1; i++) {
    const colorIdx = Math.min(i + 1, colors.length - 1);
    rows.push(renderRow(colors[colorIdx], `${breaks[i]} - ${breaks[i + 1]}${unit}`, '', swatchOpacity));
  }

  // Last range: breaks[last] +
  const lastColorIdx = Math.min(breaks.length, colors.length - 1);
  rows.push(renderRow(colors[lastColorIdx], `${breaks[breaks.length - 1]}+ ${unit}`, '', swatchOpacity));

  renderLegendRows(rows);
}

export function updateLegendMessage({ title, message, params = {} }) {
  if (!legendContainer) initLegend();
  const rows = renderHeader(title);
  setTranslatedText(rows[0], title || 'map.legend');
  const status = renderText('div', 'map-legend__status', '');
  setTranslatedText(status, message, params);
  rows.push(status);
  renderLegendRows(rows);
}

function renderHeader(title, subtitle, subtitleKey, subtitleParams) {
  const rows = [renderText('div', 'map-legend__title', t(title || 'map.legend'))];
  if (!subtitle && !subtitleKey) return rows;
  const subtitleElement = renderText('div', 'map-legend__subtitle', subtitle || '');
  if (subtitleKey) setTranslatedText(subtitleElement, subtitleKey, subtitleParams);
  rows.push(subtitleElement);
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
function renderRow(color, label, offenseCode = '', opacity = 1) {
  const row = document.createElement('div');
  row.className = 'map-legend__row';
  const swatch = document.createElement('span');
  swatch.className = 'map-legend__swatch';
  swatch.style.backgroundColor = color;
  swatch.style.opacity = String(Math.max(0, Math.min(1, Number(opacity) || 0)));
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
