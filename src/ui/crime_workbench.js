import { t, setTranslatedText } from '../i18n/index.js';
import { crimeSelectionKey, hasActiveIncidentSelection } from '../state/crime_view_state.js';

export function deriveCrimeWorkspacePresentation(state, { editing = false } = {}) {
  const hasAnalysis = Boolean(crimeSelectionKey(state));
  if (!hasAnalysis) {
    return {
      stage: 'setup',
      hasAnalysis: false,
      showContext: false,
      showSetup: true,
      showResults: false,
    };
  }
  return {
    stage: editing ? 'edit' : 'results',
    hasAnalysis: true,
    showContext: true,
    showSetup: Boolean(editing),
    showResults: !editing,
  };
}

export function createCrimeAnalysisContext(state, { translate = t } = {}) {
  const mode = state?.queryMode || 'buffer';
  const duration = Number(state?.durationMonths) || 6;
  let title;
  let area;

  if (mode === 'district') {
    const code = String(state?.selectedDistrictCode || '').padStart(2, '0');
    title = translate('crime.analysisContext.district', { code });
    area = translate('crime.area.district');
  } else if (mode === 'tract') {
    const geoid = String(state?.selectedTractGEOID || '');
    title = translate('crime.analysisContext.tract', { geoid });
    area = translate('crime.area.tract');
  } else {
    const radius = Number(state?.radiusM ?? state?.radius) || 400;
    title = state?.addressA || translate('crime.analysisContext.mapPoint');
    area = translate('crime.analysisContext.buffer', {
      radius: radius.toLocaleString('en-US'),
    });
  }

  const window = state?.startMonth
    ? translate('crime.analysisContext.fixedWindow', {
      start: state.startMonth,
      count: duration,
    })
    : translate('crime.analysisContext.latestWindow', { count: duration });
  const evidence = translate('summary.reportedMetric');
  const comparison = mode === 'buffer' && Array.isArray(state?.centerBLonLat)
    ? translate('crime.analysisContext.comparedWith', {
      label: state?.addressB || translate('crime.analysisContext.comparisonPoint'),
    })
    : null;

  return {
    title,
    area,
    window,
    evidence,
    meta: [area, comparison, window, evidence].filter(Boolean).join(' · '),
  };
}

function setWorkspaceSurfaceVisible(surface, visible) {
  if (!surface) return;
  surface.hidden = !visible;
  surface.inert = !visible;
  surface.setAttribute('aria-hidden', String(!visible));
}

export function applyCrimeWorkspacePresentation({
  panelRoot,
  context,
  setup,
  results = [],
  presentation,
} = {}) {
  if (!presentation) return;
  if (panelRoot) panelRoot.dataset.crimeStage = presentation.stage;
  setWorkspaceSurfaceVisible(context, presentation.showContext);
  setWorkspaceSurfaceVisible(setup, presentation.showSetup);
  for (const result of results) setWorkspaceSurfaceVisible(result, presentation.showResults);
}

export function deriveCrimeResultPanePresentation(pane = 'summary', { incidentsAvailable = true } = {}) {
  let normalized = pane === 'incidents' || pane === 'charts' ? pane : 'summary';
  if (normalized === 'incidents' && !incidentsAvailable) normalized = 'summary';
  return {
    pane: normalized,
    showSummary: normalized === 'summary',
    showDrawer: normalized !== 'summary',
    showIncidents: normalized === 'incidents',
    showCharts: normalized === 'charts',
  };
}

function applyCrimeResultPanePresentation({
  panelRoot,
  summaryPane,
  resultDrawer,
  incidentPane,
  chartsPane,
  paneButtons = [],
  pane,
  resultsVisible,
  incidentsAvailable = true,
} = {}) {
  const presentation = deriveCrimeResultPanePresentation(pane, { incidentsAvailable });
  if (panelRoot) panelRoot.dataset.crimeResultPane = presentation.pane;
  setWorkspaceSurfaceVisible(summaryPane, resultsVisible && presentation.showSummary);
  setWorkspaceSurfaceVisible(resultDrawer, resultsVisible && presentation.showDrawer);
  setWorkspaceSurfaceVisible(incidentPane, resultsVisible && presentation.showIncidents);
  setWorkspaceSurfaceVisible(chartsPane, resultsVisible && presentation.showCharts);
  for (const button of paneButtons) {
    const target = button.dataset.resultPaneTarget;
    const incidentUnavailable = target === 'incidents' && !incidentsAvailable;
    if (target === 'incidents') {
      button.disabled = incidentUnavailable;
      button.setAttribute('aria-disabled', String(incidentUnavailable));
      if (incidentUnavailable) {
        button.setAttribute('title', t('crime.resultView.incidentsUnavailable'));
      } else {
        button.removeAttribute('title');
      }
    }
    button.setAttribute('aria-pressed', String(target === presentation.pane));
  }
  return presentation;
}

export function createCrimeWorkbenchController({
  state,
  panelRoot,
  context,
  setup,
  results = [],
  editButton,
  contextTitle,
  contextMeta,
  editFocusTarget,
  summaryPane,
  resultDrawer,
  incidentPane,
  chartsPane,
  paneButtons = [],
  documentRef = globalThis.document,
} = {}) {
  let editing = false;
  let resultPane = 'summary';
  let preferredResultPane = 'summary';
  let lastSelectionKey = null;

  const sync = () => {
    const selectionKey = crimeSelectionKey(state);
    if (selectionKey !== lastSelectionKey) {
      resultPane = preferredResultPane;
      lastSelectionKey = selectionKey;
    }
    let presentation = deriveCrimeWorkspacePresentation(state, { editing });
    if (!presentation.hasAnalysis && editing) {
      editing = false;
      presentation = deriveCrimeWorkspacePresentation(state);
    }

    const activeElement = documentRef?.activeElement;
    const shouldMoveFocus = !presentation.showSetup
      && Boolean(activeElement && setup?.contains?.(activeElement));

    applyCrimeWorkspacePresentation({ panelRoot, context, setup, results, presentation });
    resultPane = applyCrimeResultPanePresentation({
      panelRoot,
      summaryPane,
      resultDrawer,
      incidentPane,
      chartsPane,
      paneButtons,
      pane: resultPane,
      resultsVisible: presentation.showResults,
      incidentsAvailable: hasActiveIncidentSelection(state),
    }).pane;

    if (presentation.hasAnalysis) {
      const summary = createCrimeAnalysisContext(state);
      if (contextTitle) contextTitle.textContent = summary.title;
      if (contextMeta) contextMeta.textContent = summary.meta;
    }
    setTranslatedText(editButton, editing ? 'crime.doneEditing' : 'crime.editAnalysis');

    if (shouldMoveFocus) context?.focus?.({ preventScroll: true });
    return presentation;
  };

  const setEditing = (nextEditing, { focus = true } = {}) => {
    editing = Boolean(nextEditing) && Boolean(crimeSelectionKey(state));
    const presentation = sync();
    if (editing && focus) {
      globalThis.requestAnimationFrame?.(() => editFocusTarget?.focus?.({ preventScroll: true }));
    }
    return presentation;
  };

  const setResultPane = (nextPane) => {
    resultPane = nextPane;
    editing = false;
    return sync();
  };

  const focus = ({ preferredInitialPane }) => {
    preferredResultPane = preferredInitialPane;
    const nav = paneButtons[0].parentElement;
    nav.append(...paneButtons);
    nav.prepend(paneButtons.find((button) => button.dataset.resultPaneTarget === preferredResultPane));
  };

  editButton?.addEventListener?.('click', () => setEditing(!editing));
  for (const button of paneButtons) {
    button.addEventListener('click', () => setResultPane(button.dataset.resultPaneTarget));
  }

  return {
    sync,
    setEditing,
    focus,
    setResultPane,
  };
}
