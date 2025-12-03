import { renderInsightsSections } from '../charts/diary_insights.js';
import { createDiaryCard, createSectionTitle, createSecondaryButton } from './ui_common.js';

export function createDiaryInsightsHost(root) {
  if (!root || typeof document === 'undefined') return null;
  let built = false;
  let collapsed = true;
  let contentEl = null;
  let toggleBtn = null;
  let trendEl = null;
  let tagsEl = null;
  let heatEl = null;
  let context = 'live';

  root.classList.add('diary-insights-root');
  root.style.display = 'none';

  function build() {
    if (built) return;
    root.innerHTML = '';
    const card = createDiaryCard('diary-insights-card');

    const header = document.createElement('div');
    header.className = 'diary-insights-header';
    const titleWrap = document.createElement('div');
    const title = createSectionTitle('Insights');
    const hint = document.createElement('div');
    hint.className = 'diary-muted-text';
    hint.textContent = 'Demo visuals';
    titleWrap.appendChild(title);
    titleWrap.appendChild(hint);

    toggleBtn = createSecondaryButton('Insights ▸');
    toggleBtn.classList.add('diary-insights-toggle');
    toggleBtn.addEventListener('click', () => setCollapsed(!collapsed));

    header.appendChild(titleWrap);
    header.appendChild(toggleBtn);
    card.appendChild(header);

    contentEl = document.createElement('div');
    contentEl.className = 'diary-insights-content';
    const intro = document.createElement('div');
    intro.className = 'diary-muted-text';
    intro.style.marginBottom = '4px';
    intro.textContent = 'How this route compares over time and across nearby segments.';
    contentEl.appendChild(intro);

    trendEl = document.createElement('div');
    trendEl.className = 'diary-card diary-insights-section';
    tagsEl = document.createElement('div');
    tagsEl.className = 'diary-card diary-insights-section';
    heatEl = document.createElement('div');
    heatEl.className = 'diary-card diary-insights-section';

    contentEl.appendChild(trendEl);
    contentEl.appendChild(tagsEl);
    contentEl.appendChild(heatEl);
    card.appendChild(contentEl);

    root.appendChild(card);
    built = true;
  }

  function updateContent() {
    if (!built || collapsed) return;
    renderInsightsSections(trendEl, tagsEl, heatEl, { context });
  }

  function setCollapsed(next) {
    collapsed = !!next;
    build();
    if (contentEl) {
      contentEl.style.display = collapsed ? 'none' : 'flex';
    }
    if (toggleBtn) {
      toggleBtn.textContent = collapsed ? 'Insights ▸' : 'Insights ▾';
    }
    if (!collapsed) {
      updateContent();
    }
  }

  build();
  setCollapsed(true);

  return {
    show() {
      build();
      root.style.display = '';
    },
    hide() {
      root.style.display = 'none';
    },
    setCollapsed,
    setViewContext(mode) {
      context = mode === 'history' ? 'history' : mode === 'community' ? 'community' : 'live';
      updateContent();
    },
    refresh() {
      updateContent();
    },
  };
}
