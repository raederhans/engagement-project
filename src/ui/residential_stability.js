import { t } from '../i18n/index.js';
import '../i18n/crime_safety.js';

function localizedMetric(prefix, value) {
  return t(`${prefix}.${value || 'insufficient'}`);
}

function signedPercent(value) {
  if (!Number.isFinite(value)) return null;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

export function buildResidentialStabilityHtml(model) {
  if (!model || model.monthsObserved < 6) {
    return `<p class="residential-stability__empty" data-i18n="residential.empty">${t('residential.empty')}</p>`;
  }
  const change = signedPercent(model.recentChangePct);
  const changeText = change == null ? '' : `<span>${t('residential.change', { value: change })}</span>`;
  const partial = model.partialMonthExcluded
    ? `<p class="residential-stability__partial" data-i18n="residential.partialExcluded">${t('residential.partialExcluded')}</p>`
    : '';
  return `
    <dl class="residential-stability__metrics">
      <div data-signal="trend" data-value="${model.trend}">
        <dt>${t('residential.trend')}</dt>
        <dd>${localizedMetric('residential.trend', model.trend)}</dd>
        ${changeText}
      </div>
      <div data-signal="volatility" data-value="${model.volatility}">
        <dt>${t('residential.volatility')}</dt>
        <dd>${localizedMetric('residential.volatility', model.volatility)}</dd>
      </div>
      <div data-signal="confidence" data-value="${model.confidence}">
        <dt>${t('residential.evidence')}</dt>
        <dd>${localizedMetric('residential.confidence', model.confidence)}</dd>
        <span>${t('residential.months', { count: model.monthsObserved, records: model.totalRecords })}</span>
      </div>
    </dl>
    ${partial}
    <details class="residential-stability__method">
      <summary>${t('residential.method')}</summary>
      <p>${t('residential.methodText')}</p>
    </details>`;
}

export function renderResidentialStability(model, {
  root = typeof document === 'undefined' ? null : document.getElementById('residential-stability'),
} = {}) {
  const content = root?.querySelector?.('[data-residential-stability-content]');
  if (!content) return false;
  content.innerHTML = buildResidentialStabilityHtml(model);
  root.dataset.confidence = model?.confidence || 'low';
  return true;
}
