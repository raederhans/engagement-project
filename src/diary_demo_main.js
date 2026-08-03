import { initMap } from './map/initMap.js';
import { initDiaryMode } from './routes_diary/index.js';
import { setViewMode } from './state/store.js';
import { initializeTranslations } from './i18n/index.js';
import { initLanguageSwitch } from './ui/language_switch.js';

async function main() {
  initializeTranslations();
  initLanguageSwitch();
  const map = initMap({ mode: 'diary' });
  setViewMode('diary', { silent: true });
  const mountInto = document.getElementById('diary-panel');
  if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) {
    map.once('load', () => initDiaryMode(map, { mountInto }));
  } else {
    await initDiaryMode(map, { mountInto });
  }
}

main().catch((err) => console.error('[Diary Demo] init failed', err));
