import { clearCrimePoints, refreshPoints } from './points.js';

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
  let active = true;
  let generation = 0;

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
    if (!active) return;
    const requestGeneration = ++generation;
    try {
      await refreshPoints(map, {
        ...deps.getFilters(),
        shouldApply: () => active && generation === requestGeneration,
      });
      if (!active || generation !== requestGeneration) return;
      backoffIdx = 0; // reset after success
    } catch (e) {
      if (!active || generation !== requestGeneration) return;
      showToast('Points refresh failed; retrying shortly.');
      const delay = backoffs[Math.min(backoffIdx, backoffs.length - 1)];
      backoffIdx++;
      setTimeout(() => {
        if (active) void run();
      }, delay);
    }
  };

  const onMoveEnd = debounce(run, 300);

  if (map.loaded?.() || map.isStyleLoaded?.()) {
    void run();
  } else {
    map.once('load', run);
  }
  map.on('moveend', onMoveEnd);

  if (!window.__dashboard) window.__dashboard = {};
  window.__dashboard.refreshPoints = () => run();

  return {
    refresh: run,
    clear() {
      generation += 1;
      clearCrimePoints(map);
    },
    setActive(next) {
      active = Boolean(next);
      generation += 1;
      if (!active) hideToast();
    },
    destroy() {
      active = false;
      generation += 1;
      map.off('load', run);
      map.off('moveend', onMoveEnd);
      hideToast();
    },
  };
}

function hideToast() {
  const toast = document.getElementById('toast');
  if (toast) toast.style.display = 'none';
}

