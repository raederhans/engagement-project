function safeText(value) {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = safeText(value).replaceAll('"', '""');
  return `"${text}"`;
}

const PUBLIC_FILTER_KEYS = new Set([
  'start', 'end', 'types', 'resolvedOffenseCodes', 'drilldownCodes', 'classPalette',
  'queryMode', 'selectedDistrictCode', 'selectedTractGEOID', 'adminLevel', 'per10k',
  'radiusM',
]);

function publicFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new Error('Analysis export is unavailable: filters are invalid.');
  }
  if (filters.queryMode === 'buffer') {
    throw new Error('Private buffer analysis is unavailable for export or sharing.');
  }
  if (filters.queryMode === 'district' && !/^\d{2}$/.test(filters.selectedDistrictCode || '')) {
    throw new Error('Analysis export is unavailable: district selection is missing.');
  }
  if (filters.queryMode === 'tract' && !/^\d{11}$/.test(filters.selectedTractGEOID || '')) {
    throw new Error('Analysis export is unavailable: tract selection is missing.');
  }
  if (!['district', 'tract'].includes(filters.queryMode)) {
    throw new Error('Analysis export is unavailable: public geography is missing.');
  }
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([key]) => PUBLIC_FILTER_KEYS.has(key))
      .map(([key, value]) => [key, structuredClone(value)]),
  );
}

function publicComparison(comparison, filters) {
  const clone = structuredClone(comparison || null);
  const publicLabel = filters.queryMode === 'district'
    ? `District ${filters.selectedDistrictCode}`
    : `Census tract ${filters.selectedTractGEOID}`;
  for (const [key, point] of Object.entries(clone || {})) {
    if (!point || typeof point !== 'object') continue;
    delete point.population;
    point.label = key === 'a' ? publicLabel : String(key).toUpperCase();
  }
  return clone;
}

export function buildAnalysisExport({ filters, comparison, generatedAt = new Date().toISOString() }) {
  const projectedFilters = publicFilters(filters);
  return {
    schemaVersion: 1,
    generatedAt,
    filters: projectedFilters,
    comparison: publicComparison(comparison, projectedFilters),
    notes: 'Crime incidents are reported records, not a complete measure of safety. Locations may be generalized.',
  };
}

export function isEvidenceBundleEnabled(env = import.meta.env) {
  return env?.VITE_FEATURE_EVIDENCE_BUNDLE === '1';
}

export function analysisExportToCsv(payload) {
  const lines = ['point,label,total,per10k,change30d'];
  for (const [key, point] of Object.entries(payload?.comparison || {})) {
    if (!point) continue;
    lines.push([
      key.toUpperCase(),
      csvCell(point.label || key.toUpperCase()),
      Number(point.total) || 0,
      Number.isFinite(point.per10k) ? point.per10k : '',
      Number.isFinite(point.delta30) ? point.delta30 : '',
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function downloadTextFile(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
