import {
  createRouteCorridorFilterKey,
  createRouteCorridorRequestOwner,
} from './route_corridor_request_owner.js';

/**
 * Adapts the main-owned canonical Crime snapshot to the isolated corridor
 * request owner. It never mutates or persists canonical query or route state.
 */
export function createRouteCorridorCrimeCoordinator({
  readSnapshot,
  requestOwner = createRouteCorridorRequestOwner(),
  active = true,
} = {}) {
  if (typeof readSnapshot !== 'function') {
    throw new Error('Route corridor Crime coordinator requires a canonical snapshot reader.');
  }
  requestOwner.setActive(Boolean(active));
  return {
    async request({ routeInput, bufferM, signal } = {}) {
      const snapshot = readSnapshot();
      const selectedRange = {
        start: calendarDate(snapshot?.start),
        end: calendarDate(snapshot?.end),
      };
      const types = [...(snapshot?.types || [])];
      const drilldownCodes = [...(snapshot?.drilldownCodes || [])];
      const identity = canonicalIdentity({ selectedRange, types, drilldownCodes });
      const result = await requestOwner.request({
        routeInput,
        bufferM,
        selectedRange,
        types,
        drilldownCodes,
        signal,
      });
      if (result?.status === 'superseded') return result;
      try {
        const current = readSnapshot();
        const currentIdentity = canonicalIdentity({
          selectedRange: {
            start: calendarDate(current?.start),
            end: calendarDate(current?.end),
          },
          types: [...(current?.types || [])],
          drilldownCodes: [...(current?.drilldownCodes || [])],
        });
        if (currentIdentity === identity) return result;
      } catch {}
      requestOwner.clear();
      return supersededResult();
    },
    clear() {
      requestOwner.clear();
    },
    setActive(next) {
      requestOwner.setActive(Boolean(next));
    },
  };
}

/**
 * One facade is created per Crime controller after its first lazy import.
 * Concurrent first calls therefore share one request owner and its generation.
 */
export function createRouteCorridorModuleFacade({
  createCoordinator = createRouteCorridorCrimeCoordinator,
} = {}) {
  let coordinator = null;
  let snapshotReader = null;
  return {
    request(readSnapshot, active, options) {
      if (coordinator && snapshotReader === readSnapshot) coordinator.setActive(active);
      else {
        coordinator?.clear();
        snapshotReader = readSnapshot;
        coordinator = createCoordinator({ readSnapshot, active });
      }
      return coordinator.request(options);
    },
    clear() {
      coordinator?.clear();
    },
    setActive(next) {
      coordinator?.setActive(Boolean(next));
    },
  };
}

const routeCorridorModule = createRouteCorridorModuleFacade();
export const request = (...args) => routeCorridorModule.request(...args);
export const clear = () => routeCorridorModule.clear();

function calendarDate(value) {
  const match = typeof value === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(value) : null;
  if (!match) throw new Error('Canonical Crime snapshot has an invalid historic date range.');
  return match[0];
}

function canonicalIdentity({ selectedRange, types, drilldownCodes }) {
  return JSON.stringify({
    ...selectedRange,
    filterKey: createRouteCorridorFilterKey({ types, drilldownCodes }),
  });
}

function supersededResult() {
  return {
    status: 'superseded',
    matches: [],
    unmapped: [],
    excluded: {
      duplicateStableIdentity: 0,
      outsideCorridor: 0,
      outsideSelectedRange: 0,
    },
  };
}
