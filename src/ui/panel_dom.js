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
