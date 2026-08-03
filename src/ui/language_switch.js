import {
  getLanguage,
  onLanguageChange,
  setLanguage,
  setTranslatedAttribute,
  setTranslatedText,
} from '../i18n/index.js';

export function initLanguageSwitch({ documentRef = globalThis.document } = {}) {
  const mount = documentRef?.querySelector?.('[data-language-switch-mount]');
  if (!mount) return null;
  mount.replaceChildren();

  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'language-switch';

  const sync = () => {
    const isChinese = getLanguage() === 'zh-CN';
    button.setAttribute('aria-pressed', String(isChinese));
    setTranslatedText(button, 'language.switch');
    setTranslatedAttribute(button, 'language.switchTitle', 'aria-label');
    setTranslatedAttribute(button, 'language.switchTitle', 'title');
  };

  button.addEventListener('click', () => {
    setLanguage(getLanguage() === 'zh-CN' ? 'en' : 'zh-CN');
  });
  const unsubscribe = onLanguageChange(sync);
  mount.appendChild(button);
  sync();

  return Object.freeze({
    element: button,
    destroy() {
      unsubscribe();
      button.remove();
    },
  });
}
