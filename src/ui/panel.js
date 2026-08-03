import { expandGroupsToCodes, getCodesForGroups } from '../utils/types.js';
import { fetchAvailableCodesForGroups } from '../api/crime.js';
import { normalizeCoverageWindow, setAnalysisMode, setViewMode, onViewModeChange } from '../state/store.js';
import { publicUrl } from '../utils/public_url.js';
import { TRACT_CRIME_SNAPSHOT_ENABLED } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { createLatestGeocodeOwner } from '../api/geocoder.js';
import { CRIME_VIEW_QUERY_KEYS, encodeCrimeViewState } from '../state/crime_view_state.js';
import { getLastComparison } from '../compare/card.js';
import { analysisExportToCsv, buildAnalysisExport, downloadTextFile } from '../utils/export_analysis.js';
import {
  applyTranslations,
  onLanguageChange,
  setTranslatedAttribute,
  setTranslatedText,
  t,
} from '../i18n/index.js';

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
    fields.setAttribute('aria-hidden', String(!expanded));
  }
  if (button) {
    setTranslatedText(button, expanded ? 'crime.compareRemove' : 'crime.compareAdd');
    button.setAttribute('aria-expanded', String(expanded));
  }
  return expanded;
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

  const compareCard = document.getElementById('compare-card');
  const chartsPanel = document.getElementById('charts');
  const resultsDrawer = document.getElementById('results-drawer');
  if (compareCard && compareCard.parentElement !== crimeShell) crimeShell.appendChild(compareCard);
  if (chartsPanel && resultsDrawer && !resultsDrawer.contains(chartsPanel)) resultsDrawer.appendChild(chartsPanel);
  else if (chartsPanel && !resultsDrawer && chartsPanel.parentElement !== crimeShell) crimeShell.appendChild(chartsPanel);

  let analysisHistoryMount = crimeShell.querySelector('[data-analysis-history-mount]');
  if (!analysisHistoryMount) {
    analysisHistoryMount = document.createElement('section');
    analysisHistoryMount.dataset.analysisHistoryMount = '';
    setTranslatedAttribute(analysisHistoryMount, 'history.label', 'aria-label');
    if (compareCard) crimeShell.insertBefore(analysisHistoryMount, compareCard);
    else crimeShell.appendChild(analysisHistoryMount);
  }
  let analysisHistorySync = null;

  let diaryShell = panelContentRoot.querySelector('[data-panel-view="diary"]');
  if (!diaryShell) {
    diaryShell = document.createElement('div');
    diaryShell.dataset.panelView = 'diary';
    diaryShell.style.display = 'none';
    diaryShell.style.font = 'inherit';
    diaryShell.style.color = '#0f172a';
    diaryShell.style.padding = '4px 0 8px';
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
    <div data-i18n="diary.title" style="font:600 14px/1.2 system-ui;margin-bottom:8px;">${t('diary.title')}</div>
    <div data-i18n="diary.placeholderRoute" style="border:1px dashed #cbd5e1;border-radius:8px;padding:10px 12px;margin-bottom:10px;background:#f8fafc;color:#475569;font-size:12px;">
      ${t('diary.placeholderRoute')}
    </div>
    <div data-i18n="diary.placeholderActions" style="border:1px dashed #cbd5e1;border-radius:8px;padding:10px 12px;background:#fefce8;color:#854d0e;font-size:12px;">
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
  const groupSel = document.getElementById('groupSel');
  const fineSel = document.getElementById('fineSel');
  const rateSel = document.getElementById('rateSel');
  const rateRow = document.getElementById('rateRow');
  const dataStatus = document.getElementById('dataStatus');
  const startMonth = document.getElementById('startMonth');
  const durationSel = document.getElementById('durationSel');
  const preset6 = document.getElementById('preset6');
  const preset12 = document.getElementById('preset12');
  const shareViewBtn = document.getElementById('shareViewBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const overlayTractsChk = document.getElementById('overlayTractsChk');
  const overlayLabel = overlayTractsChk ? overlayTractsChk.parentElement?.querySelector('span') : null;
  const dataDetails = document.querySelector('.data-details');
  const hudEl = document.createElement('div');
  hudEl.id = 'statusHUD';
  hudEl.style.cssText = 'margin-top:4px; font-size:11px; color:#475569';
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
      if (useMapHint) useMapHint.style.display = 'block';
      document.body.style.cursor = 'crosshair';
    } else {
      store.selectMode = 'idle';
      if (useCenterBtn) setTranslatedText(useCenterBtn, 'crime.pickOnMap');
      if (usePointBBtn) setTranslatedText(usePointBBtn, 'crime.pickOnMap');
      if (useMapHint) useMapHint.style.display = 'none';
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
      addressStatus.style.display = 'block';
      addressStatus.style.color = '#475569';
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
      if (addressStatus) {
        addressStatus.style.color = '#065f46';
        setTranslatedText(addressStatus, 'crime.pointResolved', { target, address: result.address });
      }
      onChange.cancel();
      const moveCompleted = await handlers.onAddressResolved?.(target, result);
      if (moveCompleted === false) return;
      onChange();
    } catch (error) {
      if (addressStatus) {
        addressStatus.style.color = '#991b1b';
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

  const radiusImmediate = () => {
    store.radius = Number(radiusSel.value) || 400;
    handlers.onRadiusInput?.(store.radius);
    onChange();
  };
  radiusSel?.addEventListener('change', radiusImmediate);
  radiusSel?.addEventListener('input', radiusImmediate);

  async function populateDrilldown(values, { preserveSelection = false } = {}) {
    const requestedCodes = preserveSelection ? [...(store.selectedDrilldownCodes || [])] : [];
    store.selectedGroups = values;
    if (!preserveSelection) store.selectedDrilldownCodes = [];

    // populate drilldown options (filtered by time window availability)
    if (fineSel) {
      if (values.length === 0) {
        // No parent groups selected
        fineSel.innerHTML = `<option data-i18n="crime.selectGroupFirst" disabled>${t('crime.selectGroupFirst')}</option>`;
        fineSel.disabled = true;
      } else {
        fineSel.disabled = false;
        fineSel.innerHTML = `<option data-i18n="crime.loadingCodes" disabled>${t('crime.loadingCodes')}</option>`;

        try {
          const { start, end } = store.getStartEnd();
          const availableCodes = await fetchAvailableCodesForGroups({ start, end, groups: values });

          fineSel.innerHTML = '';
          if (availableCodes.length === 0) {
          fineSel.innerHTML = `<option data-i18n="crime.noSubcodes" disabled>${t('crime.noSubcodes')}</option>`;
          } else {
            for (const c of availableCodes) {
              const opt = document.createElement('option');
              opt.value = c;
              opt.textContent = c;
              opt.selected = requestedCodes.includes(c);
              fineSel.appendChild(opt);
            }
            if (preserveSelection) {
              store.selectedDrilldownCodes = requestedCodes.filter((code) => availableCodes.includes(code));
            }
          }
        } catch (err) {
          console.warn('Failed to fetch available codes:', err);
        fineSel.innerHTML = `<option data-i18n="crime.codeLoadError" disabled>${t('crime.codeLoadError')}</option>`;
        }
      }
    }
  }

  groupSel?.addEventListener('change', async () => {
    const values = Array.from(groupSel.selectedOptions).map((o) => o.value);
    // Dev-only console assertion
    const dev = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) || (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production');
    if (dev) {
      try { console.debug('drilldown groups→codes', values, expandGroupsToCodes(values)); } catch {}
    }
    await populateDrilldown(values);
    onChange();
  });

  fineSel?.addEventListener('change', () => {
    const codes = Array.from(fineSel.selectedOptions).map((o) => o.value);
    store.selectedDrilldownCodes = codes; // Drilldown overrides parent groups
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
    if (classCustomRow) classCustomRow.style.display = (store.classMethod === 'custom') ? '' : 'none';
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
    if (useMapHint) useMapHint.style.display = (isBuffer && store.selectMode === 'point') ? 'block' : 'none';
    if (clearSelBtn) clearSelBtn.style.display = isBuffer ? 'none' : '';
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
    applyModeUI();
    onChange();
    updateHUD();
  });

  // Clear selection
  clearSelBtn?.addEventListener('click', () => {
    store.selectedDistrictCode = null;
    store.selectedTractGEOID = null;
    applyModeUI();
    onChange();
  });

  // Esc exits transient selection mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && store.selectMode === 'point') {
      store.selectMode = 'idle';
      if (useCenterBtn) setTranslatedText(useCenterBtn, 'crime.pickOnMap');
      if (usePointBBtn) setTranslatedText(usePointBBtn, 'crime.pickOnMap');
      if (useMapHint) useMapHint.style.display = 'none';
      document.body.style.cursor = '';
    }
  });

  // initialize defaults
  if (radiusSel) radiusSel.value = String(store.radius || 400);
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
  }

  if (groupSel && store.selectedGroups?.length) {
    for (const option of groupSel.options) option.selected = store.selectedGroups.includes(option.value);
  }

  applyModeUI();

  // Init-time populate: if groups preselected, populate drilldown immediately
  if (groupSel) {
    const initGroups = Array.from(groupSel.selectedOptions).map(o => o.value);
    if (initGroups.length > 0) {
      populateDrilldown(initGroups, { preserveSelection: true }).then(() => onChange());
    }
  }

  startMonth?.addEventListener('change', () => {
    store.startMonth = startMonth.value || null;
    normalizeCoverageWindow(store);
    syncFromStore();
    onChange();
  });
  durationSel?.addEventListener('change', () => {
    store.durationMonths = Number(durationSel.value) || 6;
    normalizeCoverageWindow(store);
    syncFromStore();
    onChange();
  });
  preset6?.addEventListener('click', () => {
    applyRecentPreset(store, 6, { startMonthInput: startMonth, durationSelect: durationSel });
    onChange();
    void updateHUD();
  });
  preset12?.addEventListener('click', () => {
    applyRecentPreset(store, 12, { startMonthInput: startMonth, durationSelect: durationSel });
    onChange();
    void updateHUD();
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

  function syncFromStore() {
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
    if (dataStatus) {
      const status = describeCoverageStatus(store);
      dataStatus.dataset.tone = status.tone;
      dataStatus.removeAttribute('data-i18n');
      delete dataStatus.dataset.i18nParams;
      dataStatus.textContent = status.text;
      dataStatus.style.background = status.tone === 'error' ? '#fef2f2' : status.tone === 'ready' ? '#ecfdf5' : '#f1f5f9';
      dataStatus.style.color = status.tone === 'error' ? '#991b1b' : status.tone === 'ready' ? '#065f46' : '#475569';
    }
    const exportReady = store.coverageStatus === 'ready';
    if (exportJsonBtn) exportJsonBtn.disabled = !exportReady;
    if (exportCsvBtn) exportCsvBtn.disabled = !exportReady;
    applyModeUI();
    writeCrimeStateToURL(store);
    analysisHistorySync?.();
    void updateHUD();
  }

  syncFromStore();
  void updateHUD();
  onLanguageChange(() => {
    syncFromStore();
    applyTranslations(panelRoot);
  });

  return {
    diaryMount: diaryShell,
    analysisHistoryMount,
    syncFromStore,
    setAnalysisHistorySync(callback) {
      analysisHistorySync = typeof callback === 'function' ? callback : null;
      analysisHistorySync?.();
    },
  };
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

export function applyRecentPreset(state, durationMonths, {
  startMonthInput,
  durationSelect,
} = {}) {
  state.startMonth = recentStartMonth(durationMonths, state.coverageMax);
  state.durationMonths = durationMonths;
  if (startMonthInput) startMonthInput.value = state.startMonth;
  if (durationSelect) durationSelect.value = String(durationMonths);
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
