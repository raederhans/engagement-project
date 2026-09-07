import { onLanguageChange, setTranslatedAttribute, setTranslatedText } from '../i18n/index.js';

export const INFORMATION_LEVEL_KEY = 'engagement-project.information-level';

export function initInformationLevel({ documentRef = globalThis.document, storage } = {}) {
  const button = documentRef?.querySelector?.('[data-information-toggle]');
  if (!button) return null;
  // Storage can be unavailable in private or restricted browsing.
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  let level = 'compact';
  try { if (storage?.getItem(INFORMATION_LEVEL_KEY) === 'detailed') level = 'detailed'; } catch {}
  const sync = () => {
    const detailed = level === 'detailed';
    documentRef.documentElement.dataset.information = level;
    button.setAttribute('aria-pressed', String(detailed));
    setTranslatedText(button, detailed ? 'information.detailed' : 'information.compact');
    const hint = detailed ? 'information.showLess' : 'information.showMore';
    setTranslatedAttribute(button, hint, 'title');
    setTranslatedAttribute(button, hint, 'aria-label');
  };
  const toggle = () => {
    level = level === 'compact' ? 'detailed' : 'compact';
    try { storage?.setItem(INFORMATION_LEVEL_KEY, level); } catch {}
    sync();
  };
  button.addEventListener('click', toggle);
  const unsubscribe = onLanguageChange(sync);
  sync();
  return {
    getLevel: () => level,
    destroy() { button.removeEventListener('click', toggle); unsubscribe(); },
  };
}
