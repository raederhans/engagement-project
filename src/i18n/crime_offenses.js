import { getLanguage } from './index.js';

let formatCatalogLabel = (code) => code;
const catalogListeners = new Set();

export function installCrimeOffenseCatalog(formatter) {
  if (typeof formatter !== 'function') return false;
  formatCatalogLabel = formatter;
  for (const listener of catalogListeners) listener();
  return true;
}

export function onCrimeOffenseCatalogChange(listener) {
  if (typeof listener !== 'function') return () => {};
  catalogListeners.add(listener);
  return () => catalogListeners.delete(listener);
}

/**
 * Translate a provider offense code for display without changing the code used
 * by filters, URLs, API requests, provenance, or exports.
 */
export function localizeOffenseCode(code, language = getLanguage()) {
  const normalized = String(code ?? '').trim();
  if (!normalized) return '';
  return String(formatCatalogLabel(normalized, language) || normalized);
}
