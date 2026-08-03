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
      <h3 id="about-title" data-i18n="help.productTitle" style="margin-top:0; font-size:16px; font-weight:600; color:#111;">${t('help.productTitle')}</h3>

      <div style="margin-bottom:12px;">
        <strong data-i18n="help.${modeKey}Title" style="color:#1f2937;">${t(`help.${modeKey}Title`)}</strong>
        <p data-i18n="help.${modeKey}Description" style="margin:4px 0 0 0; color:#374151; font-size:13px; line-height:1.5;">${t(`help.${modeKey}Description`)}</p>
      </div>

      <div style="margin-bottom:12px;">
        <strong data-i18n="help.howTo" style="color:#1f2937;">${t('help.howTo')}</strong>
        <p data-i18n="help.${modeKey}HowTo" style="margin:4px 0 0 0; color:#374151; font-size:13px; line-height:1.5;">${t(`help.${modeKey}HowTo`)}</p>
      </div>

      <div style="margin-bottom:0;">
        <strong data-i18n="help.important" style="color:#1f2937;">${t('help.important')}</strong>
        <p data-i18n="help.${modeKey}Notes" style="margin:4px 0 0 0; color:#374151; font-size:13px; line-height:1.5;">${t(`help.${modeKey}Notes`)}</p>
      </div>

      <p style="margin:12px 0 0;font-size:13px;">
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
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'about-title');

  // Panel content
  let currentMode = initialMode === 'diary' ? 'diary' : 'crime';
  panel.innerHTML = getAboutContent(currentMode);
  applyTranslations(panel);

  // Assemble
  root.appendChild(btn);
  root.appendChild(panel);
  resolveAboutMount(document)?.appendChild(root);

  // Add styles
  injectStyles();

  // Toggle handler
  btn.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('about--open');
    btn.setAttribute('aria-expanded', String(isOpen));
    panel.setAttribute('aria-hidden', String(!isOpen));
  });

  // Esc to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('about--open')) {
      btn.click(); // Trigger toggle
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

/**
 * Inject CSS styles for about panel
 */
function injectStyles() {
  if (document.getElementById('about-panel-styles')) {
    return; // Already injected
  }

  const style = document.createElement('style');
  style.id = 'about-panel-styles';
  style.textContent = `
    .about-toggle {
      position: static;
      min-width: 64px;
      min-height: var(--control-target, 44px);
      padding: 0 14px;
      border-radius: 8px;
      border: 1px solid #d7dee8;
      background: #fff;
      color: #102033;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease;
    }
    .about-toggle:hover {
      background: #f6f8fb;
      border-color: #0b5cad;
    }
    .about-toggle:focus-visible {
      outline: 2px solid #0b5cad;
      outline-offset: 2px;
    }

    .about-panel {
      position: fixed;
      top: var(--app-bar-height, 60px);
      left: 0;
      right: 0;
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      z-index: 1199;
      transform: translateY(-100%);
      transition: transform 0.25s ease;
    }
    .about-panel[aria-hidden="true"] {
      display: none;
    }
    .about-panel.about--open {
      display: block;
      transform: translateY(0);
    }

    .about-content {
      max-width: 720px;
      margin: 0 auto;
      padding: 16px 20px;
    }

    @media (max-width: 768px) {
      .about-content {
        max-width: 100%;
        padding: 12px 16px;
      }
      .about-toggle {
        min-width: 52px;
        padding: 0 10px;
      }
    }
  `;
  document.head.appendChild(style);
}
