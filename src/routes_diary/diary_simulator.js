import { clearSimPoint, drawSimPoint } from '../map/routing_overlay.js';
import { buildSimulationCoordinates } from './route_simulator.js';
import { DIARY_SIM_POINT_SOURCE_ID } from './map_ids.js';

const DEFAULT_INTERVAL_MS = 400;

export function createDiarySimulator({
  intervalMs = DEFAULT_INTERVAL_MS,
  getRoute = () => null,
  getMap = () => null,
  getSession = () => null,
  isCurrent = () => true,
  getDocument = () => globalThis.document,
  getWindow = () => globalThis.window,
  buildCoordinates = buildSimulationCoordinates,
  drawPoint = drawSimPoint,
  clearPoint = clearSimPoint,
  persistState = () => {},
  onStateChange = () => {},
  onFinish = () => {},
  onPageHide = () => {},
  reportError = (error) => console.warn('[Diary] Unable to remove simulator lifecycle hook', error),
} = {}) {
  const state = {
    routeId: null,
    coords: [],
    idx: 0,
    timer: null,
    timerSession: null,
    active: false,
    paused: true,
    hasStarted: false,
    playedOnce: false,
  };
  const lifecycleCleanups = new Set();

  function snapshot() {
    return {
      routeId: state.routeId,
      idx: state.idx,
      coordCount: state.coords.length,
      active: state.active,
      paused: state.paused,
      hasStarted: state.hasStarted,
      playedOnce: state.playedOnce,
    };
  }

  function progressRatio() {
    if (state.coords.length <= 1) return 0;
    return Math.min(1, state.idx / (state.coords.length - 1));
  }

  function persist(playing) {
    persistState({
      playing: Boolean(playing),
      progress: progressRatio(),
      routeId: getRoute()?.properties?.route_id || null,
    });
  }

  function notify({ silent = false } = {}) {
    if (!silent) onStateChange(snapshot());
  }

  function clearTimer() {
    if (state.timer == null) return;
    if (state.timerSession?.clearInterval) {
      state.timerSession.clearInterval(state.timer);
    } else {
      globalThis.clearInterval(state.timer);
    }
    state.timer = null;
    state.timerSession = null;
  }

  function ownListener(target, type, listener) {
    if (!target?.addEventListener) return;
    const session = getSession();
    const cleanup = session?.listen
      ? session.listen(target, type, listener)
      : (() => {
          target.addEventListener(type, listener);
          return () => target.removeEventListener(type, listener);
        })();
    lifecycleCleanups.add(cleanup);
  }

  function clearLifecycleHooks() {
    for (const cleanup of lifecycleCleanups) {
      try { cleanup(); } catch (error) { reportError(error); }
    }
    lifecycleCleanups.clear();
  }

  function ensureLifecycleHooks() {
    if (lifecycleCleanups.size) return;
    const documentTarget = getDocument();
    const windowTarget = getWindow();
    ownListener(documentTarget, 'visibilitychange', () => {
      if (isCurrent() && documentTarget.hidden) pause();
    });
    const handlePageHide = () => {
      if (isCurrent()) onPageHide();
    };
    ownListener(windowTarget, 'pagehide', handlePageHide);
    ownListener(windowTarget, 'beforeunload', handlePageHide);
  }

  function ensureCoordinates(route) {
    const routeId = route?.properties?.route_id || null;
    if (!route?.geometry) {
      state.coords = [];
      state.routeId = routeId;
      return;
    }
    state.coords = buildCoordinates(route.geometry);
    state.idx = 0;
    state.routeId = routeId;
    state.active = false;
    state.paused = true;
    state.hasStarted = false;
    state.playedOnce = false;
  }

  function step() {
    if (!isCurrent() || !state.active || state.paused) return;
    state.idx += 1;
    if (state.idx >= state.coords.length) {
      finish({ openModal: true });
      return;
    }
    const map = getMap();
    if (map) drawPoint(map, DIARY_SIM_POINT_SOURCE_ID, state.coords[state.idx], { color: '#22d3ee', radius: 5 });
    persist(true);
  }

  function start() {
    const route = getRoute();
    const map = getMap();
    if (!route || !map || !isCurrent()) return false;
    if (!state.coords.length || state.routeId !== route.properties?.route_id) {
      ensureCoordinates(route);
    }
    if (!state.coords.length) return false;
    clearTimer();
    ensureLifecycleHooks();
    state.active = true;
    state.paused = false;
    state.hasStarted = true;
    state.playedOnce = true;
    drawPoint(map, DIARY_SIM_POINT_SOURCE_ID, state.coords[state.idx], { color: '#22d3ee', radius: 5 });
    const session = getSession();
    const guardedStep = () => {
      if (isCurrent()) step();
    };
    state.timerSession = session;
    state.timer = session?.setInterval
      ? session.setInterval(guardedStep, intervalMs)
      : globalThis.setInterval(guardedStep, intervalMs);
    notify();
    persist(true);
    return true;
  }

  function pause() {
    if (!state.hasStarted) return false;
    clearTimer();
    state.paused = true;
    state.active = false;
    notify();
    persist(false);
    return true;
  }

  function finish({ openModal = true } = {}) {
    if (!state.hasStarted) return false;
    pause();
    state.idx = 0;
    state.hasStarted = false;
    const map = getMap();
    if (map) clearPoint(map, DIARY_SIM_POINT_SOURCE_ID);
    notify();
    persist(false);
    if (openModal) onFinish();
    return true;
  }

  function teardown({ silent = false } = {}) {
    clearTimer();
    state.active = false;
    state.paused = true;
    state.hasStarted = false;
    state.playedOnce = false;
    state.coords = [];
    state.routeId = null;
    state.idx = 0;
    const map = getMap();
    if (map) clearPoint(map, DIARY_SIM_POINT_SOURCE_ID);
    clearLifecycleHooks();
    persistState({ playing: false, progress: 0, routeId: null });
    notify({ silent });
  }

  function hydrate(prefs = {}) {
    const route = getRoute();
    const matchesRoute = route && prefs.routeId === route.properties?.route_id;
    state.hasStarted = Boolean(matchesRoute && prefs.progress);
    state.playedOnce = state.hasStarted;
    state.active = false;
    state.paused = true;
    if (!state.hasStarted) state.idx = 0;
    notify();
  }

  return {
    start,
    pause,
    finish,
    teardown,
    hydrate,
    getState: snapshot,
  };
}
