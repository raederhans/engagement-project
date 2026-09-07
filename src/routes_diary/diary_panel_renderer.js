import { setTranslatedText } from '../i18n/index.js';

export function renderDiaryPanelFrame({
  panel,
  getMode,
  onSelectMode,
  ownHandler = (handler) => handler,
  documentRef = globalThis.document,
} = {}) {
  if (!panel || !documentRef?.createElement) return null;
  panel.replaceChildren();
  panel.classList.add('diary-panel-shell');

  const heading = documentRef.createElement('div');
  heading.className = 'diary-panel-heading';
  const title = documentRef.createElement('h3');
  setTranslatedText(title, 'diary.demoTitle');
  const subtitle = documentRef.createElement('div');
  subtitle.className = 'diary-panel-subtitle';
  setTranslatedText(subtitle, 'diary.demoSubtitle');
  heading.append(title, subtitle);
  panel.appendChild(heading);

  const switcher = documentRef.createElement('div');
  switcher.className = 'diary-view-switch';
  const pills = [
    ['diary.tab.live', 'live'],
    ['diary.tab.history', 'history'],
    ['diary.tab.community', 'community'],
  ].map(([key, mode]) => {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'diary-view-pill';
    setTranslatedText(button, key);
    button.addEventListener('click', ownHandler(() => onSelectMode?.(mode)));
    switcher.appendChild(button);
    return { button, mode };
  });
  panel.appendChild(switcher);

  const body = documentRef.createElement('div');
  body.className = 'diary-panel-body';
  panel.appendChild(body);

  const syncMode = () => {
    const currentMode = getMode?.();
    for (const { button, mode } of pills) {
      const selected = currentMode === mode;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  };

  return { body, syncMode };
}
