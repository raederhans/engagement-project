import { initMap } from './map/initMap.js';
import { initDiaryMode } from './routes_diary/index.js';
import { setViewMode } from './state/store.js';

async function main() {
  const map = initMap();
  setViewMode('diary', { silent: true });
  const mountInto = document.getElementById('diary-panel');
  if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) {
    map.once('load', () => initDiaryMode(map, { mountInto }));
  } else {
    await initDiaryMode(map, { mountInto });
  }
}

main().catch((err) => console.error('[Diary Demo] init failed', err));
