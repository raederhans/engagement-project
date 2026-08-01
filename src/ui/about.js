/**
 * Collapsible "About" panel with smooth slide-down animation
 */

/**
 * Initialize the about panel with toggle button and collapsible content.
 * Panel sits at top of page, slides down when opened, Esc to close.
 */
export function getAboutContent(mode = 'crime') {
  const content = mode === 'diary'
    ? {
        title: 'Route Safety Diary.',
        description: 'Record a route experience, review local history, and explore sample community patterns. Entries are saved only in this browser unless you export a backup.',
        howTo: 'Choose a route, simulate or finish the trip, then add a short rating. Sample community content is demo data, not shared user submissions.',
        notes: 'Diary ratings are personal observations and are not a measure of objective safety. Export a backup before clearing browser data.',
      }
    : {
        title: 'Crime Explorer.',
        description: 'Explore reported crime incidents by location, time window, offense groups, district, or census tract.',
        howTo: 'Choose Buffer, District, or Tract, select the area on the map, set the time window, then refine the included offense groups.',
        notes: 'Reported locations may be generalized and reporting can lag. Use these records as one source of context, not a complete measure of safety.',
      };
  return `
    <div class="about-content">
      <h3 id="about-title" style="margin-top:0; font-size:16px; font-weight:600; color:#111;">Philadelphia Engagement Explorer</h3>
      <div style="margin-bottom:12px;">
        <strong style="color:#1f2937;">${content.title}</strong>
        <p style="margin:4px 0 0 0; color:#374151; font-size:13px; line-height:1.5;">${content.description}</p>
      </div>
      <div style="margin-bottom:12px;">
        <strong style="color:#1f2937;">How to use.</strong>
        <p style="margin:4px 0 0 0; color:#374151; font-size:13px; line-height:1.5;">${content.howTo}</p>
      </div>
      <div style="margin-bottom:0;">
        <strong style="color:#1f2937;">Important notes.</strong>
        <p style="margin:4px 0 0 0; color:#374151; font-size:13px; line-height:1.5;">${content.notes}</p>
      </div>
      <p style="margin:12px 0 0;font-size:13px;">
        <a href="https://github.com/raederhans/engagement-project" target="_blank" rel="noopener noreferrer">View source and methodology on GitHub</a>
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
  btn.setAttribute('aria-label', 'Open help and data guidance');
  btn.setAttribute('title', 'Help and data guidance');
  btn.textContent = 'Help';

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
