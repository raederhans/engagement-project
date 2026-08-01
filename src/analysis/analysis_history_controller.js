import {
  canSaveAnalysis,
  createAnalysisArtifact,
  deriveAnalysisDataStatus,
} from './analysis_artifact.js';
import {
  createAnalysisRepository,
  createIndexedDbAnalysisAdapter,
} from './analysis_repository.js';
import { getLastComparisonSnapshot, renderSavedComparison } from '../compare/card.js';
import {
  CRIME_VIEW_QUERY_KEYS,
  encodeCrimeViewState,
  replaceCrimeViewState,
} from '../state/crime_view_state.js';
import { setAnalysisMode, setViewMode } from '../state/store.js';
import { downloadTextFile } from '../utils/export_analysis.js';
import { createAnalysisHistoryView } from '../ui/analysis_history_panel.js';

const PRIVATE_SHARE_KEYS = ['artifact', 'artifactId', 'title', 'result'];
const ANALYSIS_SOURCES = [
  'crime-carto',
  'police-districts-api-first',
  'census-tracts-api-first',
  'acs-api-first',
];

function defaultTitle(state) {
  let mode = 'Buffer';
  if (state.queryMode === 'tract') mode = 'Tract';
  else if (state.queryMode === 'district') mode = 'District';
  return `${mode} analysis · ${state.startMonth || 'current window'}`;
}

function resultSummaryFor(snapshot) {
  if (!snapshot?.generatedAt || !snapshot?.comparison) return null;
  return {
    generatedAt: snapshot.generatedAt,
    comparison: snapshot.comparison,
  };
}

function provenanceFor(state, currentCrimeProvenance = {}) {
  const provenance = {
    coverage: {
      min: state.coverageMin || null,
      max: state.coverageMax || null,
    },
    sources: ANALYSIS_SOURCES,
  };
  if (state.adminLevel === 'tracts' && currentCrimeProvenance?.tractSnapshot) {
    provenance.tractSnapshot = structuredClone(currentCrimeProvenance.tractSnapshot);
  }
  return provenance;
}

export function buildAnalysisShareUrl(artifact, currentHref) {
  const url = new URL(currentHref);
  const viewParams = new URLSearchParams(encodeCrimeViewState(artifact?.viewState || {}));
  for (const key of CRIME_VIEW_QUERY_KEYS) url.searchParams.delete(key);
  for (const key of PRIVATE_SHARE_KEYS) url.searchParams.delete(key);
  for (const [key, value] of viewParams) url.searchParams.set(key, value);
  url.searchParams.set('mode', 'crime');
  return url.href;
}

export function createAnalysisHistoryController({
  store,
  repository,
  view,
  createArtifact = createAnalysisArtifact,
  getComparisonSnapshot = getLastComparisonSnapshot,
  renderSavedComparison: renderComparison = renderSavedComparison,
  replaceViewState = replaceCrimeViewState,
  setAnalysisMode: applyAnalysisMode = setAnalysisMode,
  setViewMode: applyViewMode = setViewMode,
  syncControls = () => {},
  syncCanonicalUrl = () => {},
  scheduleCrime,
  cancelCrimeTransition = () => false,
  getCurrentCrimeProvenance = () => ({}),
  copyText = (value) => navigator.clipboard.writeText(value),
  downloadArtifact = (artifact) => downloadTextFile(
    `engagement-analysis-${artifact.id}.json`,
    `${JSON.stringify(artifact, null, 2)}\n`,
    'application/json',
  ),
  confirmDelete = (artifact) => window.confirm(`Delete “${artifact.title}”?`),
  currentHref = () => window.location.href,
} = {}) {
  if (!store || !repository || !view) throw new Error('Analysis history requires store, repository, and view.');
  let pendingAction = false;
  let restoreGeneration = 0;
  let currentRestoreArtifact = null;
  let cachedList = { items: [], warnings: [] };

  const isCurrentRestore = (token) => token === restoreGeneration;

  function finishCurrentRestore(status) {
    if (!currentRestoreArtifact) return;
    const artifact = currentRestoreArtifact;
    currentRestoreArtifact = null;
    renderComparison(artifact.resultSummary);
    view.showSnapshotState?.(artifact, status);
  }

  function renderCachedList() {
    const currentProvenance = store.coverageStatus === 'ready'
      ? provenanceFor(store, getCurrentCrimeProvenance())
      : null;
    const items = cachedList.items.map((artifact) => ({
      ...artifact,
      dataStatus: deriveAnalysisDataStatus(artifact.provenance, currentProvenance),
    }));
    view.render({
      items,
      warnings: cachedList.warnings,
      canSave: canSaveAnalysis(store),
      pending: pendingAction,
    });
  }

  async function load() {
    try {
      const result = await repository.list();
      cachedList = { items: result.items, warnings: result.warnings };
      renderCachedList();
      return result;
    } catch (error) {
      view.render({ items: [], warnings: [{ id: null, message: error?.message || String(error) }], canSave: false, pending: false });
      view.showStatus('Local analysis history is unavailable in this browser.', 'warning');
      return { items: [], warnings: [{ id: null, message: error?.message || String(error) }] };
    }
  }

  async function runPending(action) {
    if (pendingAction) return { status: 'pending' };
    pendingAction = true;
    view.setPending(true);
    try {
      return await action();
    } finally {
      pendingAction = false;
      view.setPending(false);
    }
  }

  async function save(title = defaultTitle(store)) {
    if (!canSaveAnalysis(store)) {
      view.showStatus('Choose a valid geography and wait for live coverage before saving.', 'warning');
      return { status: 'ineligible' };
    }
    try {
      return await runPending(async () => {
        const filters = store.getFilters();
        const artifact = createArtifact({
          title,
          viewState: store,
          resultSummary: resultSummaryFor(getComparisonSnapshot(filters)),
          provenance: provenanceFor(store, getCurrentCrimeProvenance()),
        });
        await repository.save(artifact);
        view.clearDraft?.();
        await load();
        view.showStatus('Analysis saved in this browser.', 'success');
        return { status: 'saved', artifact };
      });
    } catch (error) {
      view.showStatus(`Analysis could not be saved locally: ${error?.message || error}`, 'warning');
      return { status: 'failed', error };
    }
  }

  async function restore(id) {
    const token = ++restoreGeneration;
    cancelCrimeTransition();
    finishCurrentRestore('superseded');
    let artifact;
    try {
      artifact = await repository.get(id);
    } catch (error) {
      if (!isCurrentRestore(token)) return { status: 'superseded' };
      view.showStatus(`Saved analysis could not be opened: ${error?.message || error}`, 'warning');
      return { status: 'failed', error };
    }
    if (!isCurrentRestore(token)) return { status: 'superseded' };
    if (!artifact) return { status: 'missing' };

    view.showSnapshot(artifact);
    renderComparison(artifact.resultSummary);
    currentRestoreArtifact = artifact;
    try {
      replaceViewState(store, artifact.viewState, { setMode: applyAnalysisMode });
      applyViewMode('crime', { silent: true });
      syncControls();
      syncCanonicalUrl();

      const refresh = await scheduleCrime('crime');
      if (!isCurrentRestore(token)) return { status: 'superseded' };
      if (refresh?.status === 'live') {
        view.clearSnapshot();
        renderCachedList();
      } else {
        const status = refresh?.status === 'superseded' ? 'superseded' : 'failed';
        renderComparison(artifact.resultSummary);
        view.showSnapshotState?.(artifact, status);
        view.showStatus('Saved settings are visible, but live data could not be refreshed.', 'warning');
      }
      return { status: refresh?.status || 'failed', artifact };
    } catch (error) {
      if (!isCurrentRestore(token) || currentRestoreArtifact !== artifact) return { status: 'superseded' };
      renderComparison(artifact.resultSummary);
      view.showSnapshotState?.(artifact, 'failed');
      view.showStatus(`Saved settings are visible, but live data could not be refreshed: ${error?.message || error}`, 'warning');
      return { status: 'failed', artifact, error };
    } finally {
      if (isCurrentRestore(token) && currentRestoreArtifact === artifact) currentRestoreArtifact = null;
    }
  }

  return Object.freeze({
    load,
    save,
    restore,
    refreshFreshness({ live = false } = {}) {
      if (live) view.clearSnapshot();
      renderCachedList();
    },
    sync() {
      view.renderEligibility?.({ canSave: canSaveAnalysis(store), pending: pendingAction });
    },
    cancelPendingRestore() {
      restoreGeneration += 1;
      cancelCrimeTransition();
      finishCurrentRestore('cancelled');
    },
    async rename(id, title) {
      if (!String(title || '').trim()) return { status: 'cancelled' };
      const artifact = await repository.rename(id, title);
      await load();
      return artifact ? { status: 'renamed', artifact } : { status: 'missing' };
    },
    async delete(id) {
      const artifact = await repository.get(id);
      if (!artifact) return { status: 'missing' };
      if (!confirmDelete(artifact)) return { status: 'cancelled' };
      await repository.delete(id);
      await load();
      return { status: 'deleted' };
    },
    async export(id) {
      const artifact = await repository.get(id);
      if (!artifact) return { status: 'missing' };
      downloadArtifact(artifact);
      return { status: 'exported' };
    },
    async share(id) {
      const artifact = await repository.get(id);
      if (!artifact) return { status: 'missing' };
      const url = buildAnalysisShareUrl(artifact, currentHref());
      await copyText(url);
      view.showStatus('Share link copied. It contains settings only, not saved results.', 'success');
      return { status: 'copied', url };
    },
  });
}

export async function initAnalysisHistory({
  mount,
  store,
  syncControls,
  syncCanonicalUrl,
  scheduleCrime,
  cancelCrimeTransition,
  getCurrentCrimeProvenance,
} = {}) {
  if (!mount) return null;
  let view = null;
  const adapter = createIndexedDbAnalysisAdapter({
    onStatus(status) {
      view?.showStatus(status.message, 'warning');
    },
  });
  const repository = createAnalysisRepository({ adapter });
  let controller;
  view = createAnalysisHistoryView(mount, {
    onSave: (title) => controller.save(title),
    onRestore: (id) => controller.restore(id),
    onRename: (id, title) => controller.rename(id, title),
    onDelete: (id) => controller.delete(id),
    onExport: (id) => controller.export(id),
    onShare: (id) => controller.share(id),
  });
  controller = createAnalysisHistoryController({
    store,
    repository,
    view,
    syncControls,
    syncCanonicalUrl,
    scheduleCrime,
    cancelCrimeTransition,
    getCurrentCrimeProvenance,
  });
  await controller.load();
  return controller;
}
