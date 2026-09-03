const CRIME_CONTROL_IDS = Object.freeze([
  'addrA',
  'addrB',
  'compareAreaBtn',
  'comparisonFields',
  'searchABtn',
  'searchBBtn',
  'useCenterBtn',
  'usePointBBtn',
  'useMapHint',
  'addressStatus',
  'queryModeSel',
  'queryModeHelp',
  'clearSelBtn',
  'bufferSelectRow',
  'bufferRadiusRow',
  'radiusSel',
  'customRadiusRow',
  'customRadiusInput',
  'groupSel',
  'fineSel',
  'fineSelHint',
  'rateSel',
  'rateRow',
  'dataStatus',
  'startMonth',
  'durationSel',
  'shareViewBtn',
  'exportJsonBtn',
  'exportCsvBtn',
  'overlayTractsChk',
  'classMethodSel',
  'classBinsRange',
  'classBinsVal',
  'classPaletteSel',
  'classOpacityRange',
  'classOpacityVal',
  'classCustomRow',
  'classCustomInput',
]);

export function collectCrimePanelDom(documentRef = globalThis.document) {
  const controls = {};
  for (const id of CRIME_CONTROL_IDS) {
    controls[id] = documentRef?.getElementById?.(id) || null;
  }
  controls.overlayLabel = controls.overlayTractsChk?.parentElement?.querySelector?.('span') || null;
  controls.dataDetails = documentRef?.querySelector?.('.data-details') || null;
  return controls;
}

export function ensureSharedSheetHandle({ panelRoot, panelContentRoot, documentRef = globalThis.document }) {
  const sheetHandle = panelRoot.querySelector(':scope > .sheet-handle');
  sheetHandle?.remove();

  let crimeShell = panelContentRoot.querySelector('[data-panel-view="crime"]');
  if (!crimeShell) {
    crimeShell = documentRef.createElement('div');
    crimeShell.dataset.panelView = 'crime';
    const fragment = documentRef.createDocumentFragment();
    while (panelContentRoot.firstChild) fragment.appendChild(panelContentRoot.firstChild);
    crimeShell.appendChild(fragment);
    panelContentRoot.appendChild(crimeShell);
  }

  if (sheetHandle) panelRoot.prepend(sheetHandle);
  return { crimeShell, sheetHandle };
}
