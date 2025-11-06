import { refreshPoints } from './points.js';

function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Wire map move events to refresh clustered points with simple error backoff and toast.
 * deps: { getFilters: () => ({start,end,types}) }
 * @param {import('maplibre-gl').Map} map
 * @param {{getFilters:Function}} deps
 */
export function wirePoints(map, deps) {
  const backoffs = [2000, 4000, 8000];
  let backoffIdx = 0;

  function showToast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      Object.assign(el.style, {
        position: 'fixed', right: '12px', bottom: '12px', zIndex: 40,
        background: 'rgba(17,24,39,0.9)', color: '#fff', padding: '8px 10px', borderRadius: '6px', fontSize: '12px'
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 2500);
  }

  const run = async () => {
    try {
      await refreshPoints(map, deps.getFilters());
      backoffIdx = 0; // reset after success
    } catch (e) {
      showToast('Points refresh failed; retrying shortly.');
      const delay = backoffs[Math.min(backoffIdx, backoffs.length - 1)];
      backoffIdx++;
      setTimeout(() => {
        run();
      }, delay);
    }
  };

  const onMoveEnd = debounce(run, 300);

  map.on('load', run);
  map.on('moveend', onMoveEnd);

  if (!window.__dashboard) window.__dashboard = {};
  window.__dashboard.refreshPoints = () => run();
}

