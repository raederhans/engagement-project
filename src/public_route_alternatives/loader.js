import { publicUrl } from '../utils/public_url.js';
import { admitPublicRouteScenarioArtifact } from './model.js';

const ARTIFACT_PATH = 'data/route_alternatives_public_scenarios.v1.json';

export function createPublicRouteAlternativesLoader({
  dialog,
  host,
  opener,
  fetchImpl = globalThis.fetch,
}) {
  if (!dialog || !host || !opener || typeof fetchImpl !== 'function') {
    throw new TypeError('public route alternatives loader requires dialog, host, opener and fetch');
  }
  let ui = null;
  let loadPromise = null;

  const load = async () => {
    const response = await fetchImpl(publicUrl(ARTIFACT_PATH), {
      headers: { Accept: 'application/json' },
    });
    if (!response?.ok) throw new Error(`Public route artifact request failed (${response?.status})`);
    const artifact = admitPublicRouteScenarioArtifact(await response.json());
    const { createPublicRouteAlternativesUi } = await import('./ui.js');
    ui = createPublicRouteAlternativesUi({ dialog, host, opener, artifact });
    return ui;
  };

  return Object.freeze({
    async open() {
      if (!ui) {
        if (!loadPromise) loadPromise = load().catch((error) => {
          loadPromise = null;
          throw error;
        });
        await loadPromise;
      }
      ui.open();
    },
    getStatus: () => (ui ? 'ready' : loadPromise ? 'loading' : 'idle'),
  });
}
