import { HOME_COMPARE_DIMENSIONS, HOME_COMPARE_EVIDENCE_KEYS } from './contract.js';
import { getHomeCompareCopy } from './view.js';

export function homeCompareResultsHtml(projection, { labels = [], locale = 'en' } = {}) {
  const copy = getHomeCompareCopy(locale);
  const sourceById = new Map(projection.sources.map((source) => [source.sourceId, source]));
  const profiles = projection.profiles.map((profile, index) => `
    <article class="home-compare__profile" data-home-profile="${index + 1}">
      <header>
        <p>${escapeHtml(copy.profile)} ${index + 1}</p>
        <h4>${escapeHtml(labels[index] || `${copy.profile} ${index + 1}`)}</h4>
        <span class="home-compare__badge" data-status="${profile.status}">${escapeHtml(statusLabel(profile.status, copy))}</span>
      </header>
      <div class="home-compare__metrics">
        ${HOME_COMPARE_EVIDENCE_KEYS.map((key) => metricHtml(key, profile.evidence[key], sourceById, copy, locale)).join('')}
      </div>
    </article>`).join('');
  const normalized = projection.sensitivity.normalizedWeights;
  const top = projection.sensitivity.topDimensions.map((key) => dimensionLabel(key, copy)).join(', ');
  const stable = projection.sensitivity.stableTopDimensions.length
    ? projection.sensitivity.stableTopDimensions.map((key) => dimensionLabel(key, copy)).join(', ')
    : copy.noStable;
  return `
    <h3 id="home-compare-results-title">${escapeHtml(copy.results)}</h3>
    <p class="home-compare__result-status">${escapeHtml(projection.status === 'available' ? copy.statusAvailable : copy.statusPartial)}</p>
    <div class="home-compare__boundary-grid">
      <article><h4>${escapeHtml(copy.forecastTitle)}</h4><p>${escapeHtml(copy.forecastBody)}</p></article>
      <article><h4>${escapeHtml(copy.commuteTitle)}</h4><p>${escapeHtml(copy.commuteBody)}</p></article>
    </div>
    <section class="home-compare__sensitivity">
      <h4>${escapeHtml(copy.sensitivity)}</h4>
      <p><strong>${escapeHtml(copy.topDimensions)}:</strong> ${escapeHtml(top)}</p>
      <p><strong>${escapeHtml(copy.stable)}:</strong> ${escapeHtml(stable)}</p>
      <ul>${HOME_COMPARE_DIMENSIONS.map((key) => `<li>${escapeHtml(dimensionLabel(key, copy))}: ${normalized[key]}%</li>`).join('')}</ul>
      <p>${escapeHtml(copy.noRanking)}</p>
    </section>
    <div class="home-compare__profile-grid">${profiles}</div>`;
}

function metricHtml(key, metric, sourceById, copy, locale) {
  const sources = metric.sourceIds.map((id) => sourceById.get(id)).filter(Boolean);
  const sourceLinks = sources.map((source) => `<a href="${escapeHtml(source.officialUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.source)}: ${escapeHtml(source.sourceId)}</a>`).join('<br>');
  return `
    <details class="home-compare__metric" data-evidence-status="${metric.status}">
      <summary><span>${escapeHtml(copy[key])}</span><strong>${escapeHtml(metricSummary(key, metric, locale, copy))}</strong></summary>
      <dl>
        <div><dt>${escapeHtml(copy.dataAsOf)}</dt><dd>${escapeHtml(formatDate(metric.dataAsOf, locale) || copy.unavailable)}</dd></div>
        <div><dt>${escapeHtml(copy.coverage)}</dt><dd>${escapeHtml(metric.coverage)}</dd></div>
        <div><dt>${escapeHtml(copy.precision)}</dt><dd>${escapeHtml(metric.precision)}</dd></div>
        <div><dt>${escapeHtml(copy.limitations)}</dt><dd>${escapeHtml(metric.limitations.join(' '))}</dd></div>
      </dl>
      <p>${sourceLinks}</p>
    </details>`;
}

function metricSummary(key, metric, locale, copy) {
  if (metric.status === 'unavailable') return copy.unavailable;
  const value = metric.value || {};
  if (key === 'property') {
    return [value.yearBuilt, value.bedrooms == null ? null : `${value.bedrooms} bd`, value.bathrooms == null ? null : `${value.bathrooms} ba`, money(value.marketValue, locale)].filter(Boolean).join(' · ') || copy.noValue;
  }
  if (key === 'assessments' || key === 'transfers' || key === 'reportedIncidents') return `${value.recordCount ?? 0} ${copy.records}`;
  if (key === 'serviceRequests') return `${value.recordCount ?? 0} ${copy.records} · ${value.openCount ?? 0} open`;
  if (key === 'liHistory') return `${(value.violations ?? 0) + (value.licenses ?? 0) + (value.investigations ?? 0)} ${copy.records}`;
  if (key === 'vacancy') return String(value.listingStatus || copy.noValue).replaceAll('-', ' ');
  if (key === 'hinContext') return `${value.nearbyNetworkFeatureCount ?? 0} ${copy.records}`;
  return metric.status === 'partial' ? copy.partial : copy.available;
}

function money(value, locale) {
  if (!Number.isFinite(value)) return null;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatDate(value, locale) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(timestamp);
}

function statusLabel(status, copy) {
  if (status === 'unavailable') return copy.unavailable;
  if (status === 'partial') return copy.partial;
  return copy.available;
}

function dimensionLabel(key, copy) {
  return copy[`dimension${key[0].toUpperCase()}${key.slice(1)}`] || key;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
