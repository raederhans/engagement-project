function safeText(value) {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = safeText(value).replaceAll('"', '""');
  return `"${text}"`;
}

export function buildAnalysisExport({ filters, comparison, generatedAt = new Date().toISOString() }) {
  const legacyComparison = structuredClone(comparison || null);
  for (const point of Object.values(legacyComparison || {})) {
    if (point && typeof point === 'object') delete point.population;
  }
  return {
    schemaVersion: 1,
    generatedAt,
    filters: structuredClone(filters || {}),
    comparison: legacyComparison,
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
