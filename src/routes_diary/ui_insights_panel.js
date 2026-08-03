import {
  describeDiaryInsightsContext,
  normalizeDiaryInsightsContext,
  renderInsightsSections,
  setDiaryInsightEntries,
} from '../charts/diary_insights.js';
import { createDiaryCard, createSectionTitle, createSecondaryButton } from './ui_common.js';

export function createDiaryInsightsHost(root, onExpandedChange) {
  if (!root || typeof document === 'undefined') return null;
  root.id ||= 'diary-insights-root';
  const contentId = `${root.id}-content`;
  let built = false;
  let collapsed = true;
  let contentEl = null;
  let toggleBtn = null;
  let trendEl = null;
  let tagsEl = null;
  let heatEl = null;
  let titleEl = null;
  let hintEl = null;
  let introEl = null;
  let context = normalizeDiaryInsightsContext('live');

  root.classList.add('diary-insights-root');
  root.style.display = 'none';

  function build() {
    if (built) return;
    root.innerHTML = '';
    const card = createDiaryCard('diary-insights-card');

    const header = document.createElement('div');
    header.className = 'diary-insights-header';
    const titleWrap = document.createElement('div');
    titleEl = createSectionTitle('Current route insights');
    hintEl = document.createElement('div');
    hintEl.className = 'diary-muted-text';
    titleWrap.append(titleEl, hintEl);

    toggleBtn = createSecondaryButton('Insights ▸');
    toggleBtn.classList.add('diary-insights-toggle');
    toggleBtn.setAttribute('aria-controls', contentId);
    toggleBtn.addEventListener('click', () => setCollapsed(!collapsed));

    header.append(titleWrap, toggleBtn);
    card.appendChild(header);

    contentEl = document.createElement('div');
    contentEl.id = contentId;
    contentEl.className = 'diary-insights-content';
    introEl = document.createElement('div');
    introEl.className = 'diary-muted-text';
    introEl.style.marginBottom = '4px';
    trendEl = document.createElement('div');
    trendEl.className = 'diary-card diary-insights-section';
    tagsEl = document.createElement('div');
    tagsEl.className = 'diary-card diary-insights-section';
    heatEl = document.createElement('div');
    heatEl.className = 'diary-card diary-insights-section';

    contentEl.append(introEl, trendEl, tagsEl, heatEl);
    card.appendChild(contentEl);

    root.appendChild(card);
    built = true;
    updateScopeCopy();
  }

  function updateScopeCopy() {
    const copy = describeDiaryInsightsContext(context);
    titleEl.textContent = copy.title;
    hintEl.textContent = copy.hint;
    introEl.textContent = copy.intro;
  }

  function updateContent() {
    if (!built || collapsed) return;
    renderInsightsSections(trendEl, tagsEl, heatEl, { context });
  }

  function setCollapsed(next) {
    collapsed = !!next;
    build();
    contentEl.hidden = collapsed;
    toggleBtn.textContent = collapsed ? 'Insights ▸' : 'Insights ▾';
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    if (!collapsed) updateContent();
    onExpandedChange?.(!collapsed);
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
    setViewContext(value) {
      context = normalizeDiaryInsightsContext(value);
      updateScopeCopy();
      updateContent();
    },
    refresh() {
      updateContent();
    },
    setEntries(entries) {
      setDiaryInsightEntries(entries);
      updateContent();
    },
  };
}
