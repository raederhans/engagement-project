import { messages } from './messages.js';

export { messages };

export const LANGUAGE_STORAGE_KEY = 'engagement-project.language';
export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'zh-CN']);

export function normalizeLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'zh' || normalized.startsWith('zh-') ? 'zh-CN' : 'en';
}

function interpolate(template, params = {}) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    Object.hasOwn(params, key) ? String(params[key]) : match
  ));
}

export function createI18nController({
  storage = null,
  navigatorLanguages = [],
} = {}) {
  let storedLanguage = null;
  try {
    storedLanguage = storage?.getItem?.(LANGUAGE_STORAGE_KEY) || null;
  } catch {
    storedLanguage = null;
  }
  let language = normalizeLanguage(storedLanguage || navigatorLanguages.find(Boolean));
  const listeners = new Set();

  const controller = {
    getLanguage: () => language,
    t(key, params) {
      const template = messages[language]?.[key] ?? messages.en[key] ?? key;
      return interpolate(template, params);
    },
    setLanguage(nextLanguage) {
      const next = normalizeLanguage(nextLanguage);
      if (next === language) return language;
      language = next;
      try {
        storage?.setItem?.(LANGUAGE_STORAGE_KEY, language);
      } catch {
        // The interface still switches when browser storage is unavailable.
      }
      for (const listener of listeners) listener(language);
      return language;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return Object.freeze(controller);
}

let activeDocument = null;
const languageListeners = new Set();

function publishLanguage(language) {
  if (activeDocument?.documentElement) activeDocument.documentElement.lang = language;
  applyTranslations(activeDocument);
  for (const listener of languageListeners) listener(language);
}

let appController = createI18nController();
let releaseControllerSubscription = appController.subscribe(publishLanguage);

function readParams(element) {
  if (!element?.dataset?.i18nParams) return {};
  try {
    return JSON.parse(element.dataset.i18nParams);
  } catch {
    return {};
  }
}

function boundElements(root, attribute) {
  if (!root) return [];
  const selector = `[${attribute}]`;
  const elements = [];
  if (root.matches?.(selector)) elements.push(root);
  for (const element of root.querySelectorAll?.(selector) || []) elements.push(element);
  return elements;
}

export function applyTranslations(root = activeDocument) {
  if (!root) return;
  for (const element of boundElements(root, 'data-i18n')) {
    element.textContent = t(element.getAttribute('data-i18n'), readParams(element));
  }
  const bindings = [
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-title', 'title'],
    ['data-i18n-content', 'content'],
  ];
  for (const [binding, attribute] of bindings) {
    for (const element of boundElements(root, binding)) {
      element.setAttribute(attribute, t(element.getAttribute(binding), readParams(element)));
    }
  }
}

export function initializeTranslations({
  documentRef = globalThis.document,
  storage = globalThis.localStorage,
  navigatorRef = globalThis.navigator,
} = {}) {
  activeDocument = documentRef || null;
  releaseControllerSubscription?.();
  appController = createI18nController({
    storage,
    navigatorLanguages: navigatorRef?.languages || [navigatorRef?.language].filter(Boolean),
  });
  releaseControllerSubscription = appController.subscribe(publishLanguage);
  if (activeDocument?.documentElement) activeDocument.documentElement.lang = appController.getLanguage();
  applyTranslations(activeDocument);
  return appController;
}

export function getLanguage() {
  return appController.getLanguage();
}

export function setLanguage(language) {
  return appController.setLanguage(language);
}

export function toggleLanguage() {
  return setLanguage(getLanguage() === 'zh-CN' ? 'en' : 'zh-CN');
}

export function t(key, params) {
  return appController.t(key, params);
}

export function onLanguageChange(listener) {
  if (typeof listener !== 'function') return () => {};
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

function writeParams(element, params) {
  if (!element?.dataset) return;
  if (params && Object.keys(params).length) element.dataset.i18nParams = JSON.stringify(params);
  else delete element.dataset.i18nParams;
}

export function setTranslatedText(element, key, params = {}) {
  if (!element) return element;
  element.setAttribute?.('data-i18n', key);
  writeParams(element, params);
  element.textContent = t(key, params);
  return element;
}

export function setTranslatedAttribute(element, key, attribute, params = {}) {
  if (!element) return element;
  const binding = `data-i18n-${attribute}`;
  element.setAttribute?.(binding, key);
  writeParams(element, params);
  element.setAttribute?.(attribute, t(key, params));
  return element;
}

export function translateHtml(key, params = {}) {
  return t(key, params);
}
