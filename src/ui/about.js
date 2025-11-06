/**
 * Collapsible "About" panel with smooth slide-down animation
 */

/**
 * Initialize the about panel with toggle button and collapsible content.
 * Panel sits at top of page, slides down when opened, Esc to close.
 */
export function initAboutPanel() {
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
  btn.setAttribute('aria-label', 'About this dashboard');
  btn.title = 'About this dashboard';
  btn.textContent = '?';

  // Create panel
  const panel = document.createElement('div');
  panel.id = 'about-panel';
  panel.className = 'about-panel';
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'about-title');

  // Panel content
  panel.innerHTML = `
    <div class="about-content">
      <h3 id="about-title" style="margin-top:0; font-size:16px; font-weight:600; color:#111;">Philadelphia Crime Dashboard</h3>

      <div style="margin-bottom:12px;">
        <strong style="color:#1f2937;">Purpose.</strong>
        <p style="margin:4px 0 0 0; color:#374151; font-size:13px; line-height:1.5;">
          Help renters and homebuyers quickly gauge recent incident patterns in neighborhoods of interest.
        </p>
      </div>

      <div style="margin-bottom:12px;">
        <strong style="color:#1f2937;">How to use.</strong>
        <p style="margin:4px 0 0 0; color:#374151; font-size:13px; line-height:1.5;">
          Choose <em>Query Mode</em> (Buffer, District, or Tract), select area or click map, set time window, then refine by offense groups or drilldown.
        </p>
      </div>

      <div style="margin-bottom:12px;">
        <strong style="color:#1f2937;">Data sources.</strong>
        <p style="margin:4px 0 0 0; color:#374151; font-size:13px; line-height:1.5;">
          Crime incidents (OpenDataPhilly CARTO API), Police Districts (City GeoJSON), Census Tracts (PASDA/TIGERweb), ACS for per-10k rates.
        </p>
      </div>

      <div style="margin-bottom:0;">
        <strong style="color:#1f2937;">Important notes.</strong>
        <p style="margin:4px 0 0 0; color:#374151; font-size:13px; line-height:1.5;">
          Locations are geocoded to 100-block level (not exact addresses). Reporting can lag by days or weeks. Use as one factor among many when evaluating neighborhoods.
        </p>
      </div>
    </div>
  `;

  // Assemble
  root.appendChild(btn);
  root.appendChild(panel);
  document.body.appendChild(root);

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
      position: fixed;
      top: 10px;
      right: 12px;
      width: 28px;
      height: 28px;
      border-radius: 999px;
      border: none;
      background: #111;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      z-index: 1200;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      transition: background 0.2s ease;
    }
    .about-toggle:hover {
      background: #333;
    }
    .about-toggle:focus {
      outline: 2px solid #3b82f6;
      outline-offset: 2px;
    }

    .about-panel {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      z-index: 1199;
      transform: translateY(-100%);
      transition: transform 0.25s ease;
    }
    .about-panel.about--open {
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
        top: 8px;
        right: 8px;
      }
    }
  `;
  document.head.appendChild(style);
}
