/**
 * Lightweight Help Center shell. The full guide is loaded only when opened.
 */
import { applyTranslations, setTranslatedAttribute, setTranslatedText } from '../i18n/index.js';

export function resolveAboutMount(documentRef = globalThis.document) {
  return documentRef?.querySelector?.('[data-app-help]') || documentRef?.body || null;
}

function focusableElements(panel) {
  return Array.from(panel.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

export function initAboutPanel({ initialMode = 'crime' } = {}) {
  if (document.getElementById('about-panel')) return;

  const root = document.createElement('div');
  root.id = 'about-root';

  const btn = document.createElement('button');
  btn.id = 'about-toggle';
  btn.className = 'about-toggle';
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  setTranslatedAttribute(btn, 'help.openLabel', 'aria-label');
  setTranslatedAttribute(btn, 'help.title', 'title');
  setTranslatedText(btn, 'help.button');

  const backdrop = document.createElement('div');
  backdrop.className = 'about-backdrop';
  backdrop.hidden = true;

  const panel = document.createElement('div');
  panel.id = 'about-panel';
  panel.className = 'about-panel';
  panel.tabIndex = -1;
  btn.setAttribute('aria-controls', panel.id);
  panel.setAttribute('aria-hidden', 'true');
  panel.inert = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'about-title');
  panel.setAttribute('aria-describedby', 'about-intro');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'about-close';
  setTranslatedAttribute(closeBtn, 'help.closeLabel', 'aria-label');
  const closeIcon = document.createElement('span');
  closeIcon.className = 'about-close__icon';
  closeIcon.setAttribute('aria-hidden', 'true');
  closeIcon.textContent = '×';
  const closeLabel = document.createElement('span');
  setTranslatedText(closeLabel, 'help.close');
  closeBtn.append(closeIcon, closeLabel);

  const contentHost = document.createElement('div');
  contentHost.className = 'about-content-host';
  const loading = document.createElement('p');
  loading.className = 'about-loading';
  loading.setAttribute('role', 'status');
  setTranslatedText(loading, 'help.loading');
  contentHost.appendChild(loading);
  panel.append(closeBtn, contentHost);
  applyTranslations(panel);

  root.appendChild(btn);
  resolveAboutMount(document)?.appendChild(root);
  document.body?.append(backdrop, panel);

  let currentMode = initialMode === 'diary' ? 'diary' : 'crime';
  let contentModule = null;
  let contentPromise = null;
  const renderContent = async () => {
    try {
      contentPromise ||= import('./help_content.js');
      contentModule ||= await contentPromise;
      contentHost.innerHTML = contentModule.getAboutContent(currentMode);
      contentHost.scrollTop = 0;
      applyTranslations(panel);
    } catch {
      contentPromise = null;
      contentHost.replaceChildren();
      const error = document.createElement('p');
      error.className = 'about-loading about-loading--error';
      error.setAttribute('role', 'alert');
      setTranslatedText(error, 'help.loadingError');
      contentHost.appendChild(error);
    }
  };

  const setOpen = (isOpen, { restoreFocus = false } = {}) => {
    panel.classList.toggle('about--open', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    panel.setAttribute('aria-hidden', String(!isOpen));
    panel.inert = !isOpen;
    backdrop.hidden = !isOpen;
    document.body?.classList?.toggle('about-is-open', isOpen);
    if (isOpen) {
      const focusClose = () => closeBtn.focus();
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusClose);
      else focusClose();
      void renderContent();
    } else if (restoreFocus) {
      btn.focus();
    }
  };

  btn.addEventListener('click', () => {
    setOpen(!panel.classList.contains('about--open'), { restoreFocus: true });
  });
  closeBtn.addEventListener('click', () => setOpen(false, { restoreFocus: true }));
  backdrop.addEventListener('click', () => setOpen(false, { restoreFocus: true }));

  document.addEventListener('keydown', (event) => {
    if (!panel.classList.contains('about--open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false, { restoreFocus: true });
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(panel);
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });

  return Object.freeze({
    setMode(mode) {
      currentMode = mode === 'diary' ? 'diary' : 'crime';
      if (contentModule) void renderContent();
    },
  });
}
