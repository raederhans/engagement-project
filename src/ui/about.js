/**
 * Collapsible "About" panel with smooth slide-down animation
 */
import { applyTranslations, setTranslatedAttribute, setTranslatedText, t } from '../i18n/index.js';

/**
 * Initialize the about panel with toggle button and collapsible content.
 * Panel sits at top of page, slides down when opened, Esc to close.
 */
export function getAboutContent(mode = 'crime') {
  const isDiary = mode === 'diary';
  const modeKey = isDiary ? 'diary' : 'crime';
  return `
    <div class="about-content">
      <h3 id="about-title" class="about-content__title" data-i18n="help.productTitle">${t('help.productTitle')}</h3>

      <div class="about-content__section">
        <strong class="about-content__heading" data-i18n="help.${modeKey}Title">${t(`help.${modeKey}Title`)}</strong>
        <p class="about-content__copy" data-i18n="help.${modeKey}Description">${t(`help.${modeKey}Description`)}</p>
      </div>

      <div class="about-content__section">
        <strong class="about-content__heading" data-i18n="help.howTo">${t('help.howTo')}</strong>
        <p class="about-content__copy" data-i18n="help.${modeKey}HowTo">${t(`help.${modeKey}HowTo`)}</p>
      </div>

      <div class="about-content__section about-content__section--last">
        <strong class="about-content__heading" data-i18n="help.important">${t('help.important')}</strong>
        <p class="about-content__copy" data-i18n="help.${modeKey}Notes">${t(`help.${modeKey}Notes`)}</p>
      </div>

      <p class="about-content__source">
        <a data-i18n="help.sourceLink" href="https://github.com/raederhans/engagement-project" target="_blank" rel="noopener noreferrer">${t('help.sourceLink')}</a>
      </p>
    </div>
  `;
}

export function resolveAboutMount(documentRef = globalThis.document) {
  return documentRef?.querySelector?.('[data-app-help]') || documentRef?.body || null;
}

export function initAboutPanel({ initialMode = 'crime' } = {}) {
  // Check if already initialized
  if (document.getElementById('about-panel')) {
    return;
  }

  // Create container
  const root = document.createElement('div');
  root.id = 'about-root';

  // Create toggle button
  const btn = document.createElement('button');
  btn.id = 'about-toggle';
  btn.className = 'about-toggle';
  btn.setAttribute('aria-expanded', 'false');
  setTranslatedAttribute(btn, 'help.openLabel', 'aria-label');
  setTranslatedAttribute(btn, 'help.title', 'title');
  setTranslatedText(btn, 'help.button');

  // Create panel
  const panel = document.createElement('div');
  panel.id = 'about-panel';
  panel.className = 'about-panel';
  btn.setAttribute('aria-controls', panel.id);
  panel.setAttribute('aria-hidden', 'true');
  panel.inert = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', 'about-title');

  // Panel content
  let currentMode = initialMode === 'diary' ? 'diary' : 'crime';
  panel.innerHTML = getAboutContent(currentMode);
  applyTranslations(panel);

  // Assemble
  root.appendChild(btn);
  root.appendChild(panel);
  resolveAboutMount(document)?.appendChild(root);

  const setOpen = (isOpen, { restoreFocus = false } = {}) => {
    panel.classList.toggle('about--open', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    panel.setAttribute('aria-hidden', String(!isOpen));
    panel.inert = !isOpen;
    if (restoreFocus) btn.focus();
  };

  // Toggle handler
  btn.addEventListener('click', () => {
    setOpen(!panel.classList.contains('about--open'));
  });

  // Esc to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('about--open')) {
      e.preventDefault();
      setOpen(false, { restoreFocus: true });
    }
  });

  return Object.freeze({
    setMode(mode) {
      currentMode = mode === 'diary' ? 'diary' : 'crime';
      panel.innerHTML = getAboutContent(currentMode);
      applyTranslations(panel);
    },
  });
}
