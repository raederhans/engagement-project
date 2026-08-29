import {
  applyTranslations, onLanguageChange, setLanguage, t,
} from '../i18n/index.js';
import '../i18n/area_intelligence.js';
import { validateAreaIntelligenceServingCandidate } from './serving_contract.js';

const ARTIFACT_URL = `${import.meta.env?.BASE_URL || '/'}data/area_intelligence_baseline.v2.json`;
const INVALID_REASONS = new Set(['missing-v2', 'legacy-not-current', 'invalid-v2']);
let artifactPromise;
let cachedPresentation = null;

export async function updateAreaIntelligence({
  language,
  shouldApply = () => true,
  fetchArtifact = defaultFetchArtifact,
  root = typeof document === 'undefined' ? null : document.getElementById('area-intelligence'),
} = {}) {
  if (!root) return { applied: false, status: 'absent' };
  if (language) setLanguage(language);
  renderAreaIntelligencePresentation({ status: 'loading' }, { root });
  try {
    const artifact = validateAreaIntelligenceServingCandidate(await fetchArtifact());
    if (!shouldApply()) return { applied: false, status: 'stale' };
    cachedPresentation = createAreaIntelligencePresentation(artifact);
    renderAreaIntelligencePresentation(cachedPresentation, { root });
    return { applied: true, status: cachedPresentation.status };
  } catch (error) {
    if (!shouldApply()) return { applied: false, status: 'stale' };
    const reason = classifyInvalidReason(error);
    cachedPresentation = { status: 'invalid', reason };
    renderAreaIntelligencePresentation(cachedPresentation, { root });
    return { applied: true, status: 'invalid', reason, error };
  }
}

export function createAreaIntelligencePresentation(artifact) {
  const validated = validateAreaIntelligenceServingCandidate(artifact);
  return {
    status: 'not-promoted',
    historical: validated.historical_evidence,
    decision: validated.evaluation.decision,
    intervalOutcome: validated.evaluation.interval_90_outcome,
    unavailable: validated.evaluation.why_unavailable,
  };
}

export function buildAreaIntelligenceHtml(presentation) {
  if (!presentation || presentation.status === 'loading') {
    return `<p class="area-intelligence__status" role="status">${escapeHtml(t('areaIntelligence.loading'))}</p>`;
  }
  if (presentation.status === 'invalid') return buildInvalidHtml(presentation.reason);
  return `<div class="area-intelligence__content">
    ${buildHistoricalHtml(presentation.historical)}
    ${buildUnavailableHtml(presentation)}
  </div>`;
}

function buildInvalidHtml(reason) {
  const normalizedReason = INVALID_REASONS.has(reason) ? reason : 'invalid-v2';
  const messageKey = {
    'missing-v2': 'areaIntelligence.missingV2',
    'legacy-not-current': 'areaIntelligence.legacyNotCurrent',
    'invalid-v2': 'areaIntelligence.invalidV2',
  }[normalizedReason];
  return `<section class="area-intelligence__unavailable" data-reason="${normalizedReason}" role="status">
    <p class="area-intelligence__kicker">${escapeHtml(t('areaIntelligence.unavailableKicker'))}</p>
    <h4>${escapeHtml(t('areaIntelligence.unavailableTitle'))}</h4>
    <p>${escapeHtml(t(messageKey))}</p>
  </section>`;
}

function buildHistoricalHtml(historical) {
  const { coverage } = historical;
  return `<section class="area-intelligence__history" aria-labelledby="area-intelligence-history-title">
    <p class="area-intelligence__kicker">${escapeHtml(t('areaIntelligence.historyKicker'))}</p>
    <h4 id="area-intelligence-history-title">${escapeHtml(t('areaIntelligence.historyTitle'))}</h4>
    <p class="area-intelligence__intro">${escapeHtml(t('areaIntelligence.historyTask'))}</p>
    <dl class="area-intelligence__evidence-grid">
      ${factHtml('areaIntelligence.measureLabel', 'areaIntelligence.measureValue')}
      ${factHtml('areaIntelligence.sourceAsOfLabel', null, historical.source_as_of)}
      ${factHtml('areaIntelligence.coverageLabel', 'areaIntelligence.coverageWindow', null, {
    start: coverage.earliest_scope_start,
    end: coverage.latest_scope_end_exclusive,
  })}
      ${factHtml('areaIntelligence.completeWeeksLabel', 'areaIntelligence.completeWeeksValue', null, {
    end: coverage.complete_week_end_exclusive,
  })}
      ${factHtml('areaIntelligence.geometryLabel', 'areaIntelligence.geometryValue')}
      ${factHtml('areaIntelligence.precisionLabel', 'areaIntelligence.precisionValue')}
    </dl>
    <div class="area-intelligence__method">
      <h5>${escapeHtml(t('areaIntelligence.methodTitle'))}</h5>
      <ul>
        <li>${escapeHtml(t('areaIntelligence.weekMethod'))}</li>
        <li>${escapeHtml(t('areaIntelligence.denominatorMethod'))}</li>
        <li>${escapeHtml(t('areaIntelligence.holdoutMethod'))}</li>
        <li>${escapeHtml(t('areaIntelligence.exclusionMethod'))}</li>
      </ul>
    </div>
    <p class="area-intelligence__boundary">${escapeHtml(t('areaIntelligence.aggregateBoundary'))}</p>
  </section>`;
}

function buildUnavailableHtml(presentation) {
  const reasonKey = presentation.decision === 'no-promotion'
    ? 'areaIntelligence.noPromotionReason'
    : 'areaIntelligence.localCandidateReason';
  const failedGateCount = presentation.intervalOutcome.failed_primary_slice_count;
  return `<aside class="area-intelligence__unavailable" aria-labelledby="area-intelligence-unavailable-title" data-reason="${escapeHtml(presentation.unavailable.code)}">
    <p class="area-intelligence__kicker">${escapeHtml(t('areaIntelligence.unavailableKicker'))}</p>
    <h4 id="area-intelligence-unavailable-title" role="status">${escapeHtml(t('areaIntelligence.unavailableTitle'))}</h4>
    <p>${escapeHtml(t(reasonKey))}</p>
    <dl class="area-intelligence__gate-facts">
      ${factHtml('areaIntelligence.intervalLabel', 'areaIntelligence.intervalUnavailable')}
      ${factHtml('areaIntelligence.failedGatesLabel', 'areaIntelligence.failedGatesValue', null, { count: failedGateCount })}
    </dl>
    <p>${escapeHtml(t('areaIntelligence.intervalMeaning'))}</p>
    <p class="area-intelligence__no-fallback">${escapeHtml(t('areaIntelligence.historicalOnly'))}</p>
  </aside>`;
}

function factHtml(labelKey, valueKey, value = null, params = {}) {
  const renderedValue = valueKey ? t(valueKey, params) : value;
  return `<div><dt>${escapeHtml(t(labelKey))}</dt><dd>${escapeHtml(renderedValue)}</dd></div>`;
}

export function renderAreaIntelligencePresentation(presentation, {
  root = typeof document === 'undefined' ? null : document.getElementById('area-intelligence'),
} = {}) {
  const content = root?.querySelector?.('[data-area-intelligence-content]');
  if (!content) return false;
  applyTranslations(root);
  content.innerHTML = buildAreaIntelligenceHtml(presentation);
  root.dataset.modelStatus = presentation?.status || 'loading';
  const reason = presentation?.status === 'invalid'
    ? classifyInvalidReason({ code: presentation.reason })
    : presentation?.unavailable?.code;
  if (reason) root.dataset.unavailableReason = reason;
  else delete root.dataset.unavailableReason;
  return true;
}

export function clearAreaIntelligence({
  root = typeof document === 'undefined' ? null : document.getElementById('area-intelligence'),
} = {}) {
  cachedPresentation = { status: 'loading' };
  return renderAreaIntelligencePresentation(cachedPresentation, { root });
}

async function defaultFetchArtifact() {
  artifactPromise ||= fetch(ARTIFACT_URL, { credentials: 'same-origin' }).then(async (response) => {
    if (!response.ok) {
      const error = new Error(`Area Intelligence v2 artifact request failed (${response.status}).`);
      error.code = response.status === 404 ? 'missing-v2' : 'invalid-v2';
      throw error;
    }
    try {
      return await response.json();
    } catch (cause) {
      const error = new Error('Area Intelligence v2 artifact is not valid JSON.', { cause });
      error.code = 'invalid-v2';
      throw error;
    }
  });
  return artifactPromise;
}

function classifyInvalidReason(error) {
  if (INVALID_REASONS.has(error?.code)) return error.code;
  if (/Legacy Area Intelligence artifacts are not current serving candidates/i.test(error?.message || '')) {
    return 'legacy-not-current';
  }
  return 'invalid-v2';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

onLanguageChange(() => {
  if (cachedPresentation) renderAreaIntelligencePresentation(cachedPresentation);
});
