function cleanText(value) {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  return text || null;
}

export function normalizeCrimeDataSources(sources = []) {
  if (!Array.isArray(sources)) return Object.freeze([]);
  return Object.freeze(sources.flatMap((source) => {
    const dataset = cleanText(source?.dataset);
    const provider = cleanText(source?.provider ?? source?.source);
    if (!dataset || !provider || !['live', 'fallback'].includes(source?.kind)) return [];
    const normalized = { dataset, kind: source.kind, provider };
    const asOf = cleanText(source.asOf);
    if (asOf) normalized.asOf = asOf;
    return [Object.freeze(normalized)];
  }));
}
