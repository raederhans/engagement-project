import '../styles/source-health.css';
import { getLanguage, onLanguageChange } from '../i18n/index.js';
import { createSourceHealthObservations } from './source_health_adapters.js';
import { SOURCE_HEALTH_CATALOG } from './source_health_catalog.js';
import { buildSourceHealthReadModel } from './source_health_read_model.js';
import { renderSourceHealthSurface } from './source_health_view.js';

export function initSourceHealthSurface({
  host,
  getRuntimeEvidence = () => ({}),
  now = () => new Date(),
} = {}) {
  let latestEvidence = getRuntimeEvidence();
  const render = () => {
    const observations = createSourceHealthObservations(latestEvidence, { now: now() });
    const model = buildSourceHealthReadModel({ catalog: SOURCE_HEALTH_CATALOG, observations });
    renderSourceHealthSurface({ host, model, language: getLanguage() });
    return model;
  };
  const unsubscribe = onLanguageChange(render);
  render();
  return Object.freeze({
    refresh(nextEvidence = getRuntimeEvidence()) {
      latestEvidence = nextEvidence;
      return render();
    },
    dispose: unsubscribe,
  });
}
