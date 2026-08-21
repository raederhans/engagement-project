import { applyTranslations, onLanguageChange, t } from '../i18n/index.js';
import '../i18n/area_intelligence.js';
import { validateAreaIntelligenceServingArtifact } from './serving_contract.js';

const ARTIFACT_URL = `${import.meta.env?.BASE_URL || '/'}data/area_intelligence_baseline.v1.json`;
let artifactPromise;
let cachedPresentation = null;

export async function updateAreaIntelligence({
  queryMode,
  selectedTractGEOID,
  shouldApply = () => true,
  fetchArtifact = defaultFetchArtifact,
  root = typeof document === 'undefined' ? null : document.getElementById('area-intelligence'),
} = {}) {
  if (!root) return { applied: false, status: 'absent' };
  renderAreaIntelligencePresentation({ status: 'loading' }, { root });
  try {
    const artifact = validateAreaIntelligenceServingArtifact(await fetchArtifact());
    if (!shouldApply()) return { applied: false, status: 'stale' };
    cachedPresentation = createAreaIntelligencePresentation(artifact, { queryMode, selectedTractGEOID });
    renderAreaIntelligencePresentation(cachedPresentation, { root });
    return { applied: true, status: cachedPresentation.status };
  } catch (error) {
    if (!shouldApply()) return { applied: false, status: 'stale' };
    cachedPresentation = { status: 'invalid', error };
    renderAreaIntelligencePresentation(cachedPresentation, { root });
    return { applied: true, status: 'invalid', error };
  }
}

export function createAreaIntelligencePresentation(artifact, { queryMode, selectedTractGEOID } = {}) {
  const validated = validateAreaIntelligenceServingArtifact(artifact);
  if (validated.status === 'not-promoted') {
    return {
      status: 'not-promoted',
      historical: validated.historical_evidence,
      reason: validated.forecast.reason,
      generatedAt: validated.generated_at,
    };
  }
  const prediction = queryMode === 'tract'
    ? validated.forecast.predictions.find((entry) => entry.unit_id === selectedTractGEOID) || null
    : null;
  return {
    status: prediction ? 'promoted' : 'promoted-selection-unavailable',
    historical: validated.historical_evidence,
    prediction,
    modelVersion: validated.forecast.model_version,
    generatedAt: validated.generated_at,
  };
}

export function buildAreaIntelligenceHtml(presentation) {
  const historical = `<p class="area-intelligence__historical">${escapeHtml(t('areaIntelligence.historicalAvailable'))}</p>`;
  if (!presentation || presentation.status === 'loading') {
    return `${historical}<p class="area-intelligence__status" role="status">${escapeHtml(t('areaIntelligence.loading'))}</p>`;
  }
  if (presentation.status === 'invalid') {
    return `${historical}<p class="area-intelligence__status area-intelligence__status--unavailable" role="status">${escapeHtml(t('areaIntelligence.invalid'))}</p>`;
  }
  if (presentation.status === 'not-promoted') {
    return `${historical}
      <p class="area-intelligence__status area-intelligence__status--unavailable" role="status">${escapeHtml(t('areaIntelligence.notPromoted'))}</p>
      <p class="area-intelligence__limits">${escapeHtml(t('areaIntelligence.historicalOnly'))}</p>`;
  }
  if (presentation.status === 'promoted-selection-unavailable') {
    return `${historical}
      <p class="area-intelligence__status" role="status">${escapeHtml(t('areaIntelligence.selectTract'))}</p>
      <p class="area-intelligence__limits">${escapeHtml(t('areaIntelligence.uncertainty'))}</p>`;
  }
  const prediction = presentation.prediction;
  return `${historical}
    <dl class="area-intelligence__forecast">
      <div><dt>${escapeHtml(t('areaIntelligence.modeledCount'))}</dt><dd>${formatCount(prediction.predicted_reported_incident_count)}</dd></div>
      <div><dt>${escapeHtml(t('areaIntelligence.interval'))}</dt><dd>${formatCount(prediction.prediction_interval_90.lower)}–${formatCount(prediction.prediction_interval_90.upper)}</dd></div>
      <div><dt>${escapeHtml(t('areaIntelligence.targetWeek'))}</dt><dd>${escapeHtml(prediction.target_week_start)}</dd></div>
    </dl>
    <p class="area-intelligence__limits">${escapeHtml(t('areaIntelligence.trainedThrough', { date: prediction.trained_through }))}</p>
    <p class="area-intelligence__limits">${escapeHtml(t('areaIntelligence.uncertainty'))}</p>`;
}

export function renderAreaIntelligencePresentation(presentation, {
  root = typeof document === 'undefined' ? null : document.getElementById('area-intelligence'),
} = {}) {
  const content = root?.querySelector?.('[data-area-intelligence-content]');
  if (!content) return false;
  applyTranslations(root);
  content.innerHTML = buildAreaIntelligenceHtml(presentation);
  root.dataset.modelStatus = presentation?.status || 'loading';
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
    if (!response.ok) throw new Error(`Area Intelligence artifact request failed (${response.status}).`);
    return response.json();
  });
  return artifactPromise;
}

function formatCount(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

onLanguageChange(() => {
  if (cachedPresentation) renderAreaIntelligencePresentation(cachedPresentation);
});
