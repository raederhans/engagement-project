import { CRIME_STATE_ACTIONS } from '../state/crime_state_port.js';

/**
 * Owns only Crime map selection event dispatch. Rendering, camera movement,
 * refresh, and result presentation remain caller-owned callbacks.
 */
export function createCrimeMapSelectionCoordinator({
  map,
  state,
  statePort,
  isActive,
  readTractId,
  translate,
  onTractSelected = () => {},
  onDistrictSelected = () => {},
  onPointSelected = () => {},
  onPointSelectionEnded = () => {},
} = {}) {
  let tractSelectionWired = false;
  let districtSelectionWired = false;

  function wireTractSelection() {
    if (tractSelectionWired || !map.getLayer('tracts-fill')) return false;
    tractSelectionWired = true;
    map.on('click', 'tracts-fill', (event) => {
      const feature = event.features?.[0];
      const geoid = readTractId(feature);
      if (!isActive() || state.queryMode !== 'tract' || !geoid) return;
      statePort.mutate(CRIME_STATE_ACTIONS.SELECT_TRACT, { geoid });
      onTractSelected({ event, feature, geoid });
    });
    return true;
  }

  function wireDistrictSelection() {
    if (districtSelectionWired || !map.getLayer('districts-fill')) return false;
    districtSelectionWired = true;
    map.on('click', 'districts-fill', (event) => {
      const feature = event.features?.[0];
      const rawCode = String(feature?.properties?.DIST_NUMC || '').trim();
      const code = /^\d{1,2}$/.test(rawCode) && Number(rawCode) > 0
        ? rawCode.padStart(2, '0')
        : '';
      const opensFromContext = state.queryMode === 'buffer'
        && !state.centerLonLat
        && state.selectMode !== 'point';
      if (!isActive() || (!opensFromContext && state.queryMode !== 'district') || !code) return;
      if (opensFromContext) statePort.mutate(CRIME_STATE_ACTIONS.SET_MODE, { mode: 'district' });
      statePort.mutate(CRIME_STATE_ACTIONS.SELECT_DISTRICT, { code });
      onDistrictSelected({ event, feature, code });
    });
    return true;
  }

  map.on('click', (event) => {
    if (!isActive() || state.queryMode !== 'buffer' || state.selectMode !== 'point') return;
    const target = state.selectTarget === 'B' ? 'B' : 'A';
    statePort.mutate(CRIME_STATE_ACTIONS.SELECT_POINT, {
      target,
      lng: event.lngLat.lng,
      lat: event.lngLat.lat,
      label: translate('crime.mapPoint', { target }),
    });
    onPointSelected({ event, target });
    statePort.mutate(CRIME_STATE_ACTIONS.END_MAP_SELECTION);
    onPointSelectionEnded({ event, target });
  });

  return Object.freeze({
    wireTractSelection,
    wireDistrictSelection,
  });
}
