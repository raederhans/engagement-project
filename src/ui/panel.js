import { expandGroupsToCodes, getCodesForGroups } from '../utils/types.js';
import { fetchAvailableCodesForGroups } from '../api/crime.js';

function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Wire the side panel controls to the store and notify on changes.
 * @param {import('../state/store.js').Store} store
 * @param {{ onChange: Function, getMapCenter: Function }} handlers
 */
export function initPanel(store, handlers) {
  const addrA = document.getElementById('addrA');
  const useCenterBtn = document.getElementById('useCenterBtn');
  const useMapHint = document.getElementById('useMapHint');
  const queryModeSel = document.getElementById('queryModeSel');
  const queryModeHelp = document.getElementById('queryModeHelp');
  const clearSelBtn = document.getElementById('clearSelBtn');
  const bufferSelectRow = document.getElementById('bufferSelectRow');
  const bufferRadiusRow = document.getElementById('bufferRadiusRow');
  const radiusSel = document.getElementById('radiusSel');
  const twSel = document.getElementById('twSel');
  const groupSel = document.getElementById('groupSel');
  const fineSel = document.getElementById('fineSel');
  const adminSel = document.getElementById('adminSel');
  const rateSel = document.getElementById('rateSel');
  const startMonth = document.getElementById('startMonth');
  const durationSel = document.getElementById('durationSel');
  const preset6 = document.getElementById('preset6');
  const preset12 = document.getElementById('preset12');
  const overlayTractsChk = document.getElementById('overlayTractsChk');
  const overlayLabel = overlayTractsChk ? overlayTractsChk.parentElement?.querySelector('span') : null;
  // Status HUD container (under header)
  const headerEl = document.querySelector('#sidepanel > div'); // first header div
  const hudEl = document.createElement('div');
  hudEl.id = 'statusHUD';
  hudEl.style.cssText = 'margin-top:4px; font-size:11px; color:#475569';
  if (headerEl && headerEl.nextSibling) headerEl.parentElement.insertBefore(hudEl, headerEl.nextSibling);
  else if (headerEl) headerEl.parentElement.appendChild(hudEl);
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
    handlers.onChange?.();
  }, 300);

  addrA?.addEventListener('input', () => {
    store.addressA = addrA.value;
    onChange();
  });

  useCenterBtn?.addEventListener('click', () => {
    if (store.selectMode !== 'point') {
      store.selectMode = 'point';
      useCenterBtn.textContent = 'Cancel';
      if (useMapHint) useMapHint.style.display = 'block';
      document.body.style.cursor = 'crosshair';
    } else {
      store.selectMode = 'idle';
      useCenterBtn.textContent = 'Select on map';
      if (useMapHint) useMapHint.style.display = 'none';
      document.body.style.cursor = '';
    }
  });

  const radiusImmediate = () => {
    store.radius = Number(radiusSel.value) || 400;
    handlers.onRadiusInput?.(store.radius);
    onChange();
  };
  radiusSel?.addEventListener('change', radiusImmediate);
  radiusSel?.addEventListener('input', radiusImmediate);

  twSel?.addEventListener('change', () => {
    store.timeWindowMonths = Number(twSel.value) || 6;
    onChange();
  });

  async function populateDrilldown(values) {
    store.selectedGroups = values;
    store.selectedDrilldownCodes = []; // Clear drilldown when parent groups change

    // populate drilldown options (filtered by time window availability)
    if (fineSel) {
      if (values.length === 0) {
        // No parent groups selected
        fineSel.innerHTML = '<option disabled>Select a group first</option>';
        fineSel.disabled = true;
      } else {
        fineSel.disabled = false;
        fineSel.innerHTML = '<option disabled>Loading...</option>';

        try {
          const { start, end } = store.getStartEnd();
          const availableCodes = await fetchAvailableCodesForGroups({ start, end, groups: values });

          fineSel.innerHTML = '';
          if (availableCodes.length === 0) {
            fineSel.innerHTML = '<option disabled>No sub-codes in this window</option>';
          } else {
            for (const c of availableCodes) {
              const opt = document.createElement('option');
              opt.value = c; opt.textContent = c; fineSel.appendChild(opt);
            }
          }
        } catch (err) {
          console.warn('Failed to fetch available codes:', err);
          fineSel.innerHTML = '<option disabled>Error loading codes</option>';
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

  adminSel?.addEventListener('change', () => {
    store.adminLevel = adminSel.value;
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
    if (queryModeHelp) {
      queryModeHelp.textContent = (
        mode === 'buffer'
          ? 'Buffer mode: click “Select on map”, then click map to set center.'
          : mode === 'district'
            ? 'District mode: click a police district on the map to select it.'
            : 'Tract mode: click a census tract to select it.'
      );
    }
  }

  // Mode selection
  queryModeSel?.addEventListener('change', () => {
    const old = store.queryMode;
    const mode = queryModeSel.value;
    store.queryMode = mode;
    if (mode === 'buffer') {
      // keep center/radius; clear polygon selections
      store.selectedDistrictCode = null;
      store.selectedTractGEOID = null;
    } else if (mode === 'district') {
      // clear buffer; clear tract selection
      store.center3857 = null; store.centerLonLat = null; store.selectMode = 'idle';
      store.selectedTractGEOID = null;
    } else if (mode === 'tract') {
      // clear buffer; clear district selection
      store.center3857 = null; store.centerLonLat = null; store.selectMode = 'idle';
      store.selectedDistrictCode = null;
      // One-time auto-align admin level to 'tracts'
      if (!store.didAutoAlignAdmin && store.adminLevel !== 'tracts') {
        store.adminLevel = 'tracts';
        if (adminSel) adminSel.value = 'tracts';
        store.didAutoAlignAdmin = true;
      }
    }
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
      if (useCenterBtn) useCenterBtn.textContent = 'Select on map';
      if (useMapHint) useMapHint.style.display = 'none';
      document.body.style.cursor = '';
    }
  });

  // initialize defaults
  if (radiusSel) radiusSel.value = String(store.radius || 400);
  if (twSel) twSel.value = String(store.timeWindowMonths || 6);
  if (adminSel) adminSel.value = String(store.adminLevel || 'districts');
  if (rateSel) rateSel.value = store.per10k ? 'per10k' : 'counts';
  if (queryModeSel) queryModeSel.value = store.queryMode || 'buffer';
  if (startMonth && store.startMonth) startMonth.value = store.startMonth;
  if (durationSel) durationSel.value = String(store.durationMonths || 6);
  if (overlayTractsChk) overlayTractsChk.checked = store.overlayTractsLines || false;
  // Clarify overlay label + tooltip
  if (overlayLabel) {
    overlayLabel.textContent = 'Show tract boundaries (outlines)';
    const tip = 'Outlines only. To see tract data (choropleth), set Admin Level = Tracts. Citywide crime fill appears when a last-12-months snapshot is present and the time window matches it.';
    overlayLabel.title = tip; overlayTractsChk.title = tip;
  }
  if (classMethodSel) classMethodSel.value = store.classMethod || 'quantile';
  if (classBinsRange) classBinsRange.value = String(store.classBins || 5);
  if (classPaletteSel) classPaletteSel.value = store.classPalette || 'Blues';
  if (classOpacityRange) classOpacityRange.value = String(store.classOpacity || 0.75);
  syncClassUI();

  // Initialize drilldown select (disabled until groups are selected)
  if (fineSel) {
    fineSel.innerHTML = '<option disabled>Select a group first</option>';
    fineSel.disabled = true;
  }

  applyModeUI();
  updateHUD();

  // Init-time populate: if groups preselected, populate drilldown immediately
  if (groupSel) {
    const initGroups = Array.from(groupSel.selectedOptions).map(o => o.value);
    if (initGroups.length > 0) {
      populateDrilldown(initGroups).then(() => onChange());
    }
  }

  startMonth?.addEventListener('change', () => { store.startMonth = startMonth.value || null; onChange(); });
  durationSel?.addEventListener('change', () => { store.durationMonths = Number(durationSel.value) || 6; onChange(); });
  preset6?.addEventListener('click', () => { const d = new Date(); const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; store.startMonth = ym; store.durationMonths = 6; onChange(); });
  preset12?.addEventListener('click', () => { const d = new Date(); const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; store.startMonth = ym; store.durationMonths = 12; onChange(); });

  // --- Status HUD helpers ---
  let __snapshotMeta = null; // cached in-session
  async function ensureSnapshotMeta() {
    if (__snapshotMeta !== null) return __snapshotMeta;
    // Try to fetch local static JSON; ignore failures
    try {
      const { fetchJson } = await import('../utils/http.js');
      const snap = await fetchJson('/src/data/tract_crime_counts_last12m.json', { cacheTTL: 5 * 60_000, retries: 0, timeoutMs: 1500 });
      if (snap?.meta?.start && snap?.meta?.end) {
        __snapshotMeta = { start: snap.meta.start, end: snap.meta.end };
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
    const charts = (mode === 'tract' && !!store.selectedTractGEOID) ? 'Online' : (mode === 'buffer' ? (store.center3857 ? 'Online' : 'Idle') : 'Online');
    const meta = await ensureSnapshotMeta();
    const snapPresent = meta ? 'Present' : 'Absent';
    const match = meta ? (windowMatch(meta) ? 'Yes' : 'No') : 'No';
    hudEl.textContent = `Mode: ${mode} | Admin: ${admin} | Charts: ${charts} | Snapshot: ${snapPresent} | Window match: ${match}`;
  }
}
