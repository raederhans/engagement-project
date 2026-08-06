import {
  expandGroupsToCodes,
  normalizeHighlightedOffenses,
  syncOffenseHighlightOptions,
} from '../utils/types.js';
import { fetchAvailableCodesForGroups } from '../api/crime.js';
import {
  clearCrimeAnalysisSelection,
  normalizeCoverageWindow,
  setAnalysisMode,
  setViewMode,
  onViewModeChange,
} from '../state/store.js';
import { publicUrl } from '../utils/public_url.js';
import { TRACT_CRIME_SNAPSHOT_ENABLED } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { createLatestGeocodeOwner } from '../api/geocoder.js';
import {
  CRIME_VIEW_QUERY_KEYS,
  encodeCrimeViewState,
} from '../state/crime_view_state.js';
import { getLastComparison } from '../compare/card.js';
import { analysisExportToCsv, buildAnalysisExport, downloadTextFile } from '../utils/export_analysis.js';
import {
  applyTranslations,
  onLanguageChange,
  setTranslatedAttribute,
  setTranslatedText,
  t,
} from '../i18n/index.js';
import {
  localizeOffenseCode,
  onCrimeOffenseCatalogChange,
} from '../i18n/crime_offenses.js';
import { createCrimeWorkbenchController } from './crime_workbench.js';

export {
  applyCrimeWorkspacePresentation,
  createCrimeAnalysisContext,
  deriveCrimeWorkspacePresentation,
} from './crime_workbench.js';

function debounce(fn, wait = 300) {
  let t;
  const debounced = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => {
    clearTimeout(t);
    t = null;
  };
  return debounced;
}

export function setComparisonFieldsVisible({ button, fields }, visible) {
  const expanded = Boolean(visible);
  if (fields) {
    fields.hidden = !expanded;
    fields.removeAttribute?.('aria-hidden');
  }
  if (button) {
    setTranslatedText(button, expanded ? 'crime.compareRemove' : 'crime.compareAdd');
    button.setAttribute('aria-expanded', String(expanded));
  }
  return expanded;
}

export function fitMultiSelectRows(select, maxRows = 6) {
  if (!select) return 0;
  const optionCount = Number(select.options?.length) || 0;
  const ceiling = Math.max(1, Number(maxRows) || 1);
  const rows = Math.max(1, Math.min(Math.floor(optionCount), Math.floor(ceiling)));
  select.size = rows;
  return rows;
}

export function localizeOffenseOptions(select) {
  for (const option of select?.options || []) {
    if (option.dataset?.i18n || !option.value) continue;
    option.textContent = localizeOffenseCode(option.value);
  }
  return select;
}

export function shouldShowCrimeClearSelection(state) {
  if (state?.queryMode === 'buffer') return Array.isArray(state.centerLonLat);
  if (state?.queryMode === 'district') return Boolean(state.selectedDistrictCode);
  if (state?.queryMode === 'tract') return Boolean(state.selectedTractGEOID);
  return false;
}

const BUFFER_RADIUS_PRESETS = new Set([200, 400, 800, 1200, 1600, 2400]);

export function describeRadiusControlState(value) {
  const parsed = Number(value);
  const radius = Number.isInteger(parsed) && parsed >= 100 && parsed <= 10_000 ? parsed : 400;
  const customVisible = !BUFFER_RADIUS_PRESETS.has(radius);
  return {
    selectValue: customVisible ? 'custom' : String(radius),
    customValue: String(radius),
    customVisible,
  };
}

/**
 * Wire the side panel controls to the store and notify on changes.
 * @param {import('../state/store.js').Store} store
 * @param {{ onChange: Function, getMapCenter: Function }} handlers
 */
export function initPanel(store, handlers) {
  const panelRoot = document.getElementById('sidepanel');
  if (!panelRoot) {
    return { diaryMount: null, analysisHistoryMount: null };
  }

  const sheetContent = panelRoot.querySelector(':scope > .sheet-content');
  const panelContentRoot = sheetContent || panelRoot;
  const sheetHandle = panelRoot.querySelector(':scope > .sheet-handle');
  sheetHandle?.remove();

  let crimeShell = panelContentRoot.querySelector('[data-panel-view="crime"]');
  if (!crimeShell) {
    crimeShell = document.createElement('div');
    crimeShell.dataset.panelView = 'crime';
    const fragment = document.createDocumentFragment();
    while (panelContentRoot.firstChild) {
      fragment.appendChild(panelContentRoot.firstChild);
    }
    crimeShell.appendChild(fragment);
    panelContentRoot.appendChild(crimeShell);
  }
  if (sheetHandle) panelRoot.prepend(sheetHandle);
  const analysisContext = crimeShell.querySelector('[data-analysis-context]');
  const taskFocusMount = crimeShell.querySelector('[data-task-focus]');
  const crimeSetup = crimeShell.querySelector('[data-crime-setup]');
  const resultsOverview = crimeShell.querySelector('[data-crime-results]');
  const analysisHistoryDisclosure = crimeShell.querySelector('[data-analysis-history-disclosure]');
  const chartsPanel = document.getElementById('charts');
  const resultsDrawer = document.getElementById('results-drawer');
  if (chartsPanel && resultsDrawer && !resultsDrawer.contains(chartsPanel)) resultsDrawer.appendChild(chartsPanel);
  else if (chartsPanel && !resultsDrawer && chartsPanel.parentElement !== crimeShell) crimeShell.appendChild(chartsPanel);

  const crimeWorkbench = createCrimeWorkbenchController({
    state: store,
    panelRoot,
    context: analysisContext,
    setup: crimeSetup,
    results: [resultsOverview, analysisHistoryDisclosure],
    editButton: crimeShell.querySelector('[data-analysis-context-edit]'),
    contextTitle: crimeShell.querySelector('[data-analysis-context-title]'),
    contextMeta: crimeShell.querySelector('[data-analysis-context-meta]'),
    editFocusTarget: document.getElementById('queryModeSel'),
    summaryPane: crimeShell.querySelector('[data-result-pane="summary"]'),
    resultDrawer: resultsDrawer,
    incidentPane: crimeShell.querySelector('[data-result-pane="incidents"]'),
    chartsPane: crimeShell.querySelector('[data-result-pane="charts"]'),
    paneButtons: [...crimeShell.querySelectorAll('[data-result-pane-target]')],
  });
  crimeShell.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-incident-results-edit]')) {
      crimeWorkbench.setEditing(true);
    }
  });

  let analysisHistoryMount = crimeShell.querySelector('[data-analysis-history-mount]');
  if (!analysisHistoryMount) {
    analysisHistoryMount = document.createElement('section');
    analysisHistoryMount.dataset.analysisHistoryMount = '';
    setTranslatedAttribute(analysisHistoryMount, 'history.label', 'aria-label');
    crimeShell.appendChild(analysisHistoryMount);
  }
  placeAnalysisHistoryAfterResults({ crimeShell, resultsDrawer, analysisHistoryMount });
  let analysisHistorySync = null;

  let diaryShell = panelContentRoot.querySelector('[data-panel-view="diary"]');
  if (!diaryShell) {
    diaryShell = document.createElement('div');
    diaryShell.dataset.panelView = 'diary';
    diaryShell.className = 'panel-view panel-view--diary';
    diaryShell.style.display = 'none';
    panelContentRoot.appendChild(diaryShell);
  } else {
    diaryShell.innerHTML = '';
  }

  const toggleMount = document.querySelector('[data-mode-switch-mount]') || panelRoot;
  let toggleRow = document.querySelector('[data-panel-view="mode-toggle"]');
  if (!toggleRow) {
    toggleRow = document.createElement('div');
    toggleRow.dataset.panelView = 'mode-toggle';
    toggleRow.className = 'mode-switch';
    toggleMount.appendChild(toggleRow);
  } else {
    toggleRow.innerHTML = '';
    if (toggleRow.parentElement !== toggleMount) toggleMount.appendChild(toggleRow);
  }

  const toggleGroup = document.createElement('div');
  toggleGroup.className = 'mode-switch__group';
  toggleRow.appendChild(toggleGroup);

  const crimeBtn = document.createElement('button');
  crimeBtn.type = 'button';
  setTranslatedText(crimeBtn, 'mode.crime');
  crimeBtn.className = 'mode-switch__button';
  toggleGroup.appendChild(crimeBtn);

  const diaryBtn = document.createElement('button');
  diaryBtn.type = 'button';
  setTranslatedText(diaryBtn, 'mode.diary');
  diaryBtn.className = 'mode-switch__button';
  diaryBtn.disabled = !store.diaryFeatureOn;
  setTranslatedAttribute(
    diaryBtn,
    store.diaryFeatureOn ? 'mode.diaryTitle' : 'mode.diaryDisabled',
    'title',
  );
  toggleGroup.appendChild(diaryBtn);

  diaryShell.innerHTML = `
    <div class="panel-view__title" data-i18n="diary.title">${t('diary.title')}</div>
    <div class="panel-placeholder panel-placeholder--route" data-i18n="diary.placeholderRoute">
      ${t('diary.placeholderRoute')}
    </div>
    <div class="panel-placeholder panel-placeholder--actions" data-i18n="diary.placeholderActions">
      ${t('diary.placeholderActions')}
    </div>
  `;
  applyTranslations(diaryShell);

  const updateModeButtons = (mode) => {
    const isDiary = mode === 'diary';
    crimeBtn.classList.toggle('is-active', !isDiary);
    diaryBtn.classList.toggle('is-active', isDiary);
    crimeBtn.setAttribute('aria-pressed', String(!isDiary));
    diaryBtn.setAttribute('aria-pressed', String(isDiary));
    crimeShell.style.display = isDiary ? 'none' : '';
    diaryShell.style.display = isDiary ? '' : 'none';
  };

  crimeBtn.addEventListener('click', () => {
    setViewMode('crime');
    writeModeToURL('crime');
  });

  diaryBtn.addEventListener('click', () => {
    if (!store.diaryFeatureOn) return;
    setViewMode('diary');
    writeModeToURL('diary');
  });

  onViewModeChange(updateModeButtons);
  updateModeButtons(store.viewMode || 'crime');

  const addrA = document.getElementById('addrA');
  const addrB = document.getElementById('addrB');
  const compareAreaBtn = document.getElementById('compareAreaBtn');
  const comparisonFields = document.getElementById('comparisonFields');
  const searchABtn = document.getElementById('searchABtn');
  const searchBBtn = document.getElementById('searchBBtn');
  const useCenterBtn = document.getElementById('useCenterBtn');
  const usePointBBtn = document.getElementById('usePointBBtn');
  const useMapHint = document.getElementById('useMapHint');
  const addressStatus = document.getElementById('addressStatus');
  const geocodeOwner = createLatestGeocodeOwner();
  const queryModeSel = document.getElementById('queryModeSel');
  const queryModeHelp = document.getElementById('queryModeHelp');
  const clearSelBtn = document.getElementById('clearSelBtn');
  const bufferSelectRow = document.getElementById('bufferSelectRow');
  const bufferRadiusRow = document.getElementById('bufferRadiusRow');
  const radiusSel = document.getElementById('radiusSel');
  const customRadiusRow = document.getElementById('customRadiusRow');
  const customRadiusInput = document.getElementById('customRadiusInput');
  const groupSel = document.getElementById('groupSel');
  const fineSel = document.getElementById('fineSel');
  const fineSelHint = document.getElementById('fineSelHint');
  const rateSel = document.getElementById('rateSel');
  const rateRow = document.getElementById('rateRow');
  const dataStatus = document.getElementById('dataStatus');
  const startMonth = document.getElementById('startMonth');
  const durationSel = document.getElementById('durationSel');
  const shareViewBtn = document.getElementById('shareViewBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const overlayTractsChk = document.getElementById('overlayTractsChk');
  const overlayLabel = overlayTractsChk ? overlayTractsChk.parentElement?.querySelector('span') : null;
  const dataDetails = document.querySelector('.data-details');
  const sourceScopeEl = document.createElement('div');
  sourceScopeEl.dataset.appSourceDetails = '';
  sourceScopeEl.className = 'data-details__meta';
  setTranslatedText(sourceScopeEl, 'app.connecting');
  dataDetails?.appendChild(sourceScopeEl);
  const hudEl = document.createElement('div');
  hudEl.id = 'statusHUD';
  hudEl.className = 'data-details__meta';
  dataDetails?.appendChild(hudEl);
  // Choropleth controls
  const classMethodSel = document.getElementById('classMethodSel');
  const classBinsRange = document.getElementById('classBinsRange');
  const classBinsVal = document.getElementById('classBinsVal');
  const classPaletteSel = document.getElementById('classPaletteSel');
  const classOpacityRange = document.getElementById('classOpacityRange');
  const classOpacityVal = document.getElementById('classOpacityVal');
  const classCustomRow = document.getElementById('classCustomRow');
  const classCustomInput = document.getElementById('classCustomInput');

  const onChange = debounce(() => {
    // Derive selected offense codes from groups (unless drilldown overrides)
    if (!store.selectedDrilldownCodes || store.selectedDrilldownCodes.length === 0) {
      store.selectedTypes = expandGroupsToCodes(store.selectedGroups || []);
    }
    writeCrimeStateToURL(store);
    handlers.onChange?.();
  }, 300);
  let drilldownRequestGeneration = 0;

  const syncOffenseHighlights = (codes = store.selectedDrilldownCodes) => {
    const normalized = syncOffenseHighlightOptions(fineSel, codes);
    store.selectedDrilldownCodes = normalized;
    setTranslatedText(fineSelHint, 'crime.drilldownHint', { count: normalized.length });
  };

  const syncComparisonControls = () => {
    const visible = store.queryMode === 'buffer' && Boolean(store.centerB3857 || store.centerBLonLat);
    setComparisonFieldsVisible({ button: compareAreaBtn, fields: comparisonFields }, visible);
  };
  compareAreaBtn?.addEventListener('click', () => {
    const show = comparisonFields?.hidden !== false;
    setComparisonFieldsVisible({ button: compareAreaBtn, fields: comparisonFields }, show);
    if (show) {
      addrB?.focus();
      return;
    }
    store.centerB3857 = null;
    store.centerBLonLat = null;
    store.addressB = '';
    if (addrB) addrB.value = '';
    if (store.selectTarget === 'B') store.selectMode = 'idle';
    onChange();
  });

  addrA?.addEventListener('input', () => geocodeOwner.cancel('A'));
  addrB?.addEventListener('input', () => geocodeOwner.cancel('B'));
  onViewModeChange((mode) => {
    if (mode !== 'crime') geocodeOwner.cancelAll();
  });

  function beginMapSelection(target) {
    if (store.selectMode !== 'point') {
      store.selectMode = 'point';
      store.selectTarget = target;
      if (target === 'A' && useCenterBtn) setTranslatedText(useCenterBtn, 'crime.cancel');
      if (target === 'B' && usePointBBtn) setTranslatedText(usePointBBtn, 'crime.cancel');
      useMapHint?.classList.remove('is-hidden');
      document.body.style.cursor = 'crosshair';
    } else {
      store.selectMode = 'idle';
      if (useCenterBtn) setTranslatedText(useCenterBtn, 'crime.pickOnMap');
      if (usePointBBtn) setTranslatedText(usePointBBtn, 'crime.pickOnMap');
      useMapHint?.classList.add('is-hidden');
      document.body.style.cursor = '';
    }
  }
  useCenterBtn?.addEventListener('click', () => beginMapSelection('A'));
  usePointBBtn?.addEventListener('click', () => beginMapSelection('B'));

  async function resolveAddress(target) {
    const input = target === 'B' ? addrB : addrA;
    const button = target === 'B' ? searchBBtn : searchABtn;
    if (!input) return;
    const draft = input.value.trim();
    button?.setAttribute('disabled', '');
    if (addressStatus) {
      addressStatus.classList.remove('is-hidden');
      addressStatus.dataset.tone = 'pending';
      setTranslatedText(addressStatus, 'crime.findingPoint', { target });
    }
    try {
      const owned = await geocodeOwner.resolve(target, draft, {
        shouldCommit: () => store.viewMode === 'crime' && input.value.trim() === draft,
      });
      if (!owned.applied) return;
      const { result } = owned;
      input.value = result.address;
      store.setComparisonPoint(target, ...result.lngLat, result.address);
      crimeWorkbench.sync();
      if (addressStatus) {
        addressStatus.dataset.tone = 'ready';
        setTranslatedText(addressStatus, 'crime.pointResolved', { target, address: result.address });
      }
      onChange.cancel();
      const moveCompleted = await handlers.onAddressResolved?.(target, result);
      if (moveCompleted === false) return;
      onChange();
    } catch (error) {
      if (addressStatus) {
        addressStatus.dataset.tone = 'error';
        addressStatus.removeAttribute('data-i18n');
        delete addressStatus.dataset.i18nParams;
        addressStatus.textContent = error?.message || String(error);
      }
    } finally {
      if (!geocodeOwner.isPending(target)) button?.removeAttribute('disabled');
    }
  }
  searchABtn?.addEventListener('click', () => void resolveAddress('A'));
  searchBBtn?.addEventListener('click', () => void resolveAddress('B'));
  addrA?.addEventListener('keydown', (event) => { if (event.key === 'Enter') void resolveAddress('A'); });
  addrB?.addEventListener('keydown', (event) => { if (event.key === 'Enter') void resolveAddress('B'); });

  function syncRadiusControls() {
    const state = describeRadiusControlState(store.radius);
    if (radiusSel) radiusSel.value = state.selectValue;
    if (customRadiusInput) customRadiusInput.value = state.customValue;
    if (customRadiusRow) customRadiusRow.hidden = !state.customVisible;
  }
  function applyRadius(value) {
    const radius = Number(value);
    if (!Number.isInteger(radius) || radius < 100 || radius > 10_000 || store.radius === radius) return;
    store.radius = radius;
    handlers.onRadiusInput?.(radius);
    onChange();
  }
  radiusSel?.addEventListener('change', () => {
    if (radiusSel.value === 'custom') {
      if (customRadiusRow) customRadiusRow.hidden = false;
      customRadiusInput?.focus();
      return;
    }
    applyRadius(radiusSel.value);
    syncRadiusControls();
  });
  customRadiusInput?.addEventListener('change', () => {
    if (customRadiusInput.reportValidity()) {
      applyRadius(customRadiusInput.value);
      syncRadiusControls();
    }
  });
  customRadiusInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && customRadiusInput.reportValidity()) {
      event.preventDefault();
      applyRadius(customRadiusInput.value);
      syncRadiusControls();
    }
  });

  async function populateDrilldown(values, { preserveSelection = false, notify = true } = {}) {
    const requestGeneration = ++drilldownRequestGeneration;
    let requestedCodes = preserveSelection
      ? normalizeHighlightedOffenses(store.selectedDrilldownCodes)
      : [];
    store.selectedGroups = values;
    if (!preserveSelection) store.selectedDrilldownCodes = [];

    // populate drilldown options (filtered by time window availability)
    if (fineSel) {
      const renderStatus = (key) => {
        if (preserveSelection) return;
        fineSel.innerHTML = `<option data-i18n="${key}" disabled>${t(key)}</option>`;
        fitMultiSelectRows(fineSel);
      };
      if (values.length === 0) {
        // No parent groups selected
        fineSel.innerHTML = `<option data-i18n="crime.selectGroupFirst" disabled>${t('crime.selectGroupFirst')}</option>`;
        fineSel.disabled = true;
        fitMultiSelectRows(fineSel);
        if (!preserveSelection) syncOffenseHighlights([]);
      } else {
        fineSel.disabled = false;
        renderStatus('crime.loadingCodes');

        try {
          const { start, end } = store.getStartEnd();
          const availableCodes = await fetchAvailableCodesForGroups({ start, end, groups: values });
          if (requestGeneration !== drilldownRequestGeneration) return;
          if (preserveSelection) requestedCodes = normalizeHighlightedOffenses(store.selectedDrilldownCodes);

          fineSel.innerHTML = '';
          const renderedCodes = preserveSelection
            ? [...new Set([...availableCodes, ...requestedCodes])]
            : availableCodes;
          if (renderedCodes.length === 0) {
            fineSel.innerHTML = `<option data-i18n="crime.noSubcodes" disabled>${t('crime.noSubcodes')}</option>`;
            syncOffenseHighlights([]);
          } else {
            for (const c of renderedCodes) {
              const opt = document.createElement('option');
              opt.value = c;
              opt.textContent = localizeOffenseCode(c);
              opt.selected = requestedCodes.includes(c);
              fineSel.appendChild(opt);
            }
            syncOffenseHighlights(store.selectedDrilldownCodes);
          }
          fitMultiSelectRows(fineSel);
        } catch (err) {
          if (requestGeneration !== drilldownRequestGeneration) return;
          console.warn('Failed to fetch available codes:', err);
          renderStatus('crime.codeLoadError');
        }
      }
    }
    if (notify) onChange();
  }

  const refreshDrilldownForWindow = () => populateDrilldown(
    store.selectedGroups || [],
    { preserveSelection: true, notify: false },
  );
  const refreshTimeWindow = () => {
    onChange();
    void refreshDrilldownForWindow();
  };

  groupSel?.addEventListener('change', () => {
    const values = Array.from(groupSel.selectedOptions).map((o) => o.value);
    void populateDrilldown(values);
  });

  fineSel?.addEventListener('change', () => {
    const codes = Array.from(fineSel.selectedOptions).map((o) => o.value);
    syncOffenseHighlights(codes); // Drilldown overrides parent groups
    onChange();
  });

  rateSel?.addEventListener('change', () => {
    store.per10k = rateSel.value === 'per10k';
    onChange();
  });

  overlayTractsChk?.addEventListener('change', () => {
    store.overlayTractsLines = overlayTractsChk.checked;
    handlers.onTractsOverlayToggle?.(store.overlayTractsLines);
    updateHUD();
  });

  // Choropleth controls wiring
  function syncClassUI() {
    if (classBinsVal) classBinsVal.textContent = String(store.classBins || 5);
    if (classOpacityVal) classOpacityVal.textContent = String((store.classOpacity || 0.75).toFixed(2));
    classCustomRow?.classList.toggle('is-hidden', store.classMethod !== 'custom');
  }
  classMethodSel?.addEventListener('change', () => {
    store.classMethod = classMethodSel.value;
    if (store.classMethod !== 'custom') store.classCustomBreaks = [];
    syncClassUI();
    onChange();
  });
  classBinsRange?.addEventListener('input', () => {
    store.classBins = Number(classBinsRange.value) || 5;
    syncClassUI();
  });
  classBinsRange?.addEventListener('change', () => { onChange(); });
  classPaletteSel?.addEventListener('change', () => { store.classPalette = classPaletteSel.value; onChange(); });
  classOpacityRange?.addEventListener('input', () => { store.classOpacity = Number(classOpacityRange.value) || 0.75; syncClassUI(); });
  classOpacityRange?.addEventListener('change', () => { onChange(); });
  classCustomInput?.addEventListener('change', () => {
    const parts = (classCustomInput.value || '').split(',').map(s => Number(s.trim())).filter((n) => Number.isFinite(n)).sort((a,b)=>a-b);
    store.classCustomBreaks = parts;
    onChange();
  });

  function applyModeUI() {
    const mode = store.queryMode || 'buffer';
    const isBuffer = mode === 'buffer';
    if (bufferSelectRow) bufferSelectRow.style.display = isBuffer ? '' : 'none';
    if (bufferRadiusRow) bufferRadiusRow.style.display = isBuffer ? '' : 'none';
    useMapHint?.classList.toggle('is-hidden', !(isBuffer && store.selectMode === 'point'));
    if (clearSelBtn) {
      clearSelBtn.classList.toggle('is-hidden', !shouldShowCrimeClearSelection(store));
      setTranslatedText(clearSelBtn, isBuffer ? 'crime.clearLocation' : 'crime.clearSelection');
    }
    if (rateRow) rateRow.style.display = mode === 'tract' ? 'flex' : 'none';
    if (rateSel) rateSel.disabled = mode !== 'tract';
    if (compareAreaBtn) compareAreaBtn.style.display = isBuffer ? '' : 'none';
    if (isBuffer) syncComparisonControls();
    else setComparisonFieldsVisible({ button: compareAreaBtn, fields: comparisonFields }, false);
    if (queryModeHelp) {
      setTranslatedText(queryModeHelp, `crime.modeHelp.${mode}`);
    }
  }

  // Mode selection
  queryModeSel?.addEventListener('change', () => {
    const mode = queryModeSel.value;
    setAnalysisMode(mode);
    if (mode !== 'buffer') store.selectMode = 'idle';
    crimeWorkbench.sync();
    applyModeUI();
    onChange();
    updateHUD();
  });

  // Clear selection
  clearSelBtn?.addEventListener('click', () => {
    clearCrimeAnalysisSelection(store);
    if (addressStatus) addressStatus.textContent = '';
    if (useCenterBtn) setTranslatedText(useCenterBtn, 'crime.pickOnMap');
    if (usePointBBtn) setTranslatedText(usePointBBtn, 'crime.pickOnMap');
    document.body.style.cursor = '';
    syncFromStore();
    onChange();
  });

  // Esc exits transient selection mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && store.selectMode === 'point') {
      store.selectMode = 'idle';
      if (useCenterBtn) setTranslatedText(useCenterBtn, 'crime.pickOnMap');
      if (usePointBBtn) setTranslatedText(usePointBBtn, 'crime.pickOnMap');
      useMapHint?.classList.add('is-hidden');
      document.body.style.cursor = '';
    }
  });

  // initialize defaults
  if (addrA) addrA.value = store.addressA || '';
  if (addrB) addrB.value = store.addressB || '';
  if (rateSel) rateSel.value = store.per10k ? 'per10k' : 'counts';
  if (queryModeSel) queryModeSel.value = store.queryMode || 'buffer';
  if (startMonth && store.startMonth) startMonth.value = store.startMonth;
  if (durationSel) durationSel.value = String(store.durationMonths || 6);
  if (overlayTractsChk) overlayTractsChk.checked = store.overlayTractsLines || false;
  // Clarify overlay label + tooltip
  if (overlayLabel) {
    setTranslatedText(overlayLabel, 'crime.tractBoundaries');
    setTranslatedAttribute(overlayLabel, 'crime.tractBoundariesTitle', 'title');
    setTranslatedAttribute(overlayTractsChk, 'crime.tractBoundariesTitle', 'title');
  }
  if (classMethodSel) classMethodSel.value = store.classMethod || 'quantile';
  if (classBinsRange) classBinsRange.value = String(store.classBins || 5);
  if (classPaletteSel) classPaletteSel.value = store.classPalette || 'Blues';
  if (classOpacityRange) classOpacityRange.value = String(store.classOpacity || 0.75);
  if (classCustomInput) classCustomInput.value = (store.classCustomBreaks || []).join(',');
  syncClassUI();

  // Initialize drilldown select (disabled until groups are selected)
  if (fineSel) {
    fineSel.innerHTML = `<option data-i18n="crime.selectGroupFirst" disabled>${t('crime.selectGroupFirst')}</option>`;
    fineSel.disabled = true;
    fitMultiSelectRows(fineSel);
  }
  syncOffenseHighlights();

  if (groupSel && store.selectedGroups?.length) {
    for (const option of groupSel.options) option.selected = store.selectedGroups.includes(option.value);
  }

  applyModeUI();

  // Init-time populate: if groups preselected, populate drilldown immediately
  if (groupSel) {
    const initGroups = Array.from(groupSel.selectedOptions).map(o => o.value);
    if (initGroups.length > 0) {
      void populateDrilldown(initGroups, { preserveSelection: true, notify: false });
    }
  }

  startMonth?.addEventListener('change', () => {
    store.startMonth = startMonth.value || null;
    normalizeCoverageWindow(store);
    syncFromStore();
    void refreshTimeWindow();
  });
  durationSel?.addEventListener('change', () => {
    store.durationMonths = Number(durationSel.value) || 6;
    normalizeCoverageWindow(store);
    syncFromStore();
    void refreshTimeWindow();
  });
  shareViewBtn?.addEventListener('click', async () => {
    writeCrimeStateToURL(store);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setTranslatedText(shareViewBtn, 'crime.copied');
      setTimeout(() => { setTranslatedText(shareViewBtn, 'crime.copyView'); }, 1500);
    } catch {
      setTranslatedText(shareViewBtn, 'crime.urlUpdated');
    }
  });

  function currentExport() {
    const filters = store.getFilters();
    if (store.coverageStatus !== 'ready') throw new Error(t('crime.exportNotReady'));
    return buildAnalysisExport({ filters, comparison: getLastComparison(filters) });
  }
  exportJsonBtn?.addEventListener('click', () => {
    try {
      downloadTextFile('engagement-analysis.json', `${JSON.stringify(currentExport(), null, 2)}\n`, 'application/json');
    } catch (error) {
      showExportError(error);
    }
  });
  exportCsvBtn?.addEventListener('click', () => {
    try {
      downloadTextFile('engagement-comparison.csv', analysisExportToCsv(currentExport()), 'text/csv;charset=utf-8');
    } catch (error) {
      showExportError(error);
    }
  });

  function showExportError(error) {
    if (!dataStatus) return;
    dataStatus.dataset.tone = 'error';
    dataStatus.removeAttribute('data-i18n');
    delete dataStatus.dataset.i18nParams;
    dataStatus.textContent = error?.message || t('crime.exportUnavailable');
  }

  // --- Status HUD helpers ---
  let __snapshotMeta = null; // cached in-session
  async function ensureSnapshotMeta() {
    if (__snapshotMeta !== null) return __snapshotMeta;
    if (!TRACT_CRIME_SNAPSHOT_ENABLED) {
      __snapshotMeta = undefined;
      return __snapshotMeta;
    }
    // Try to fetch local static JSON; ignore failures
    try {
      const snap = await fetchJson(publicUrl('data/tract_crime_counts_last12m.json'), { cacheTTL: 5 * 60_000, retries: 0, timeoutMs: 1500 });
      if (snap?.meta?.start && snap?.meta?.end) {
        __snapshotMeta = {
          start: snap.meta.start,
          end: snap.meta.end,
          generatedAt: snap.meta.generated_at || null,
          coverageDate: snap.meta.coverage_date || null,
        };
      } else {
        __snapshotMeta = undefined;
      }
    } catch {
      __snapshotMeta = undefined;
    }
    return __snapshotMeta;
  }

  function windowMatch(meta) {
    try {
      const { start, end } = store.getStartEnd();
      return !!(meta && meta.start === start && meta.end === end);
    } catch { return false; }
  }

  async function updateHUD() {
    if (!hudEl) return;
    const mode = store.queryMode || 'buffer';
    const admin = store.adminLevel || 'districts';
    const chartsKey = (mode === 'tract' && !!store.selectedTractGEOID)
      ? 'crime.online'
      : mode === 'buffer'
        ? (store.center3857 ? 'crime.online' : 'crime.idle')
        : 'crime.online';
    const meta = await ensureSnapshotMeta();
    const snapshotDate = meta?.coverageDate || meta?.generatedAt?.slice(0, 10) || t('crime.unavailable');
    const match = t(meta && windowMatch(meta) ? 'crime.snapshotMatch' : 'crime.snapshotMismatch');
    setTranslatedText(hudEl, 'crime.hud', {
      mode: t(`crime.area.${mode}`),
      geography: t(admin === 'tracts' ? 'crime.area.tract' : 'crime.area.district'),
      charts: t(chartsKey),
      snapshot: snapshotDate,
      match,
    });
  }

  function syncControlsFromStore() {
    if (queryModeSel) queryModeSel.value = store.queryMode || 'buffer';
    if (addrA) addrA.value = store.addressA || '';
    if (addrB) addrB.value = store.addressB || '';
    if (rateSel) rateSel.value = store.per10k ? 'per10k' : 'counts';
    if (startMonth) startMonth.value = store.startMonth || '';
    if (startMonth) {
      startMonth.min = store.coverageMin?.slice(0, 7) || '';
      startMonth.max = store.coverageMax ? recentStartMonth(store.durationMonths || 12, store.coverageMax) : '';
    }
    if (durationSel) durationSel.value = String(store.durationMonths || 12);
    syncRadiusControls();
    if (dataStatus) {
      const status = describeCoverageStatus(store);
      dataStatus.dataset.tone = status.tone;
      dataStatus.removeAttribute('data-i18n');
      delete dataStatus.dataset.i18nParams;
      dataStatus.textContent = status.text;
    }
    const exportReady = store.coverageStatus === 'ready';
    if (exportJsonBtn) exportJsonBtn.disabled = !exportReady;
    if (exportCsvBtn) exportCsvBtn.disabled = !exportReady;
    applyModeUI();
    crimeWorkbench.sync();
    void updateHUD();
  }

  function syncPreset() {
    onChange.cancel();
    syncControlsFromStore();
    return refreshDrilldownForWindow();
  }

  function syncFromStore() {
    syncControlsFromStore();
    writeCrimeStateToURL(store);
    analysisHistorySync?.();
  }

  syncFromStore();
  onLanguageChange(() => {
    syncFromStore();
    localizeOffenseOptions(fineSel);
    applyTranslations(panelRoot);
  });
  onCrimeOffenseCatalogChange(() => localizeOffenseOptions(fineSel));

  return {
    diaryMount: diaryShell,
    analysisHistoryMount,
    taskFocus: {
      mount: taskFocusMount,
      applyTaskFocusPresentation: crimeWorkbench.focus,
    },
    syncPreset,
    syncFromStore,
    setAnalysisHistorySync(callback) {
      analysisHistorySync = typeof callback === 'function' ? callback : null;
      analysisHistorySync?.();
    },
  };
}

export function placeAnalysisHistoryAfterResults({
  crimeShell,
  resultsDrawer,
  analysisHistoryMount,
} = {}) {
  if (!crimeShell || !analysisHistoryMount) return false;
  const historySurface = analysisHistoryMount.closest?.('[data-analysis-history-disclosure]')
    || analysisHistoryMount;
  if (!resultsDrawer || resultsDrawer.parentElement !== crimeShell) {
    crimeShell.appendChild(historySurface);
    return true;
  }
  crimeShell.insertBefore(historySurface, resultsDrawer.nextSibling || null);
  return true;
}

export function describeCoverageStatus(state) {
  if (state.coverageStatus === 'error') {
    return {
      tone: 'error',
      text: state.coverageError || t('crime.coverageUnavailable'),
    };
  }
  if (state.coverageStatus === 'ready') {
    return {
      tone: 'ready',
      text: t('crime.coverageReady', {
        min: state.coverageMin || t('crime.unknown'),
        max: state.coverageMax,
        notice: state.coverageNotice ? ` · ${state.coverageNotice}` : '',
      }),
    };
  }
  return { tone: 'loading', text: t('crime.coverageConnecting') };
}

function recentStartMonth(durationMonths, coverageMax) {
  const date = coverageMax ? new Date(coverageMax) : new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - (durationMonths - 1));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function readModeFromURL() {
  if (typeof window === 'undefined') return 'crime';
  const params = new URLSearchParams(window.location.search || '');
  return params.get('mode') === 'diary' ? 'diary' : 'crime';
}

export function writeModeToURL(mode) {
  if (typeof window === 'undefined' || typeof window.history === 'undefined') return;
  const params = new URLSearchParams(window.location.search || '');
  params.set('mode', mode === 'diary' ? 'diary' : 'crime');
  const query = params.toString();
  const newUrl = `${window.location.pathname}?${query}${window.location.hash || ''}`;
  window.history.replaceState({}, '', newUrl);
}

export function writeCrimeStateToURL(state) {
  if (typeof window === 'undefined' || typeof window.history === 'undefined') return;
  if (state?.viewMode !== 'crime') return;
  const current = new URLSearchParams(window.location.search || '');
  const crime = new URLSearchParams(encodeCrimeViewState(state));
  const mode = current.get('mode');
  for (const key of CRIME_VIEW_QUERY_KEYS) current.delete(key);
  for (const [key, value] of crime) current.set(key, value);
  if (mode) current.set('mode', mode);
  const query = current.toString();
  window.history.replaceState({}, '', `${window.location.pathname}?${query}${window.location.hash || ''}`);
}
