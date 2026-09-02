import {
  describeDiaryInsightsContext,
  normalizeDiaryInsightsContext,
} from '../charts/diary_insights_context.js';
import { createDiaryCard, createSectionTitle, createSecondaryButton } from './ui_common.js';
import { onLanguageChange, setTranslatedText, t } from '../i18n/index.js';

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
  let entries = [];
  let insightsModulePromise = null;
  let renderGeneration = 0;

  root.classList.add('diary-insights-root');
  root.style.display = 'none';

  function build() {
    if (built) return;
    root.innerHTML = '';
    const card = createDiaryCard('diary-insights-card');

    const header = document.createElement('div');
    header.className = 'diary-insights-header';
    const titleWrap = document.createElement('div');
    titleEl = createSectionTitle(t('diary.insights.live.title'));
    hintEl = document.createElement('div');
    hintEl.className = 'diary-muted-text';
    hintEl.hidden = true;
    titleWrap.append(titleEl, hintEl);

    toggleBtn = createSecondaryButton(t('diary.insightsCollapsed'));
    toggleBtn.classList.add('diary-insights-toggle');
    toggleBtn.setAttribute('aria-controls', contentId);
    toggleBtn.addEventListener('click', () => setCollapsed(!collapsed));

    header.append(titleWrap, toggleBtn);
    card.appendChild(header);

    contentEl = document.createElement('div');
    contentEl.id = contentId;
    contentEl.className = 'diary-insights-content';
    introEl = document.createElement('div');
    introEl.className = 'diary-muted-text diary-insights-intro';
    introEl.hidden = true;
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

  function loadInsightsModule() {
    if (!insightsModulePromise) {
      let ownedPromise;
      ownedPromise = import('../charts/diary_insights.js').catch((error) => {
        if (insightsModulePromise === ownedPromise) insightsModulePromise = null;
        throw error;
      });
      insightsModulePromise = ownedPromise;
    }
    return insightsModulePromise;
  }

  function updateContent() {
    if (!built || collapsed) return;
    const generation = ++renderGeneration;
    contentEl.setAttribute('aria-busy', 'true');
    void loadInsightsModule().then(({ renderInsightsSections, setDiaryInsightEntries }) => {
      if (generation !== renderGeneration || collapsed) return;
      setDiaryInsightEntries(entries);
      renderInsightsSections(trendEl, tagsEl, heatEl, { context });
      contentEl.setAttribute('aria-busy', 'false');
    }).catch(() => {
      if (generation !== renderGeneration || collapsed) return;
      setTranslatedText(trendEl, 'diary.insights.unavailable');
      tagsEl.textContent = '';
      heatEl.textContent = '';
      contentEl.setAttribute('aria-busy', 'false');
    });
  }

  function setCollapsed(next) {
    collapsed = !!next;
    build();
    contentEl.hidden = collapsed;
    setTranslatedText(toggleBtn, collapsed ? 'diary.insightsCollapsed' : 'diary.insightsExpanded');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    if (collapsed) {
      renderGeneration += 1;
      contentEl.setAttribute('aria-busy', 'false');
    } else updateContent();
    onExpandedChange?.(!collapsed);
  }

  build();
  setCollapsed(true);
  onLanguageChange(() => {
    updateScopeCopy();
    updateContent();
  });

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
    setEntries(nextEntries) {
      entries = nextEntries;
      updateContent();
    },
  };
}
