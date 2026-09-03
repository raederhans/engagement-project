import { clearCrimeDistrictData, syncCrimeDistrictData } from '../charts/accessible_data.js';
import { renderDistrictChoropleth } from '../map/render_choropleth.js';

export function renderCrimeDistrictContext({
  map,
  snapshot,
  geojson,
  status,
  reconcileLayerVisibility,
  ensureInteractions,
  wireSelection,
  fitContext,
} = {}) {
  renderDistrictChoropleth(map, geojson, {
    status,
    start: snapshot.start,
    end: snapshot.end,
  });
  reconcileLayerVisibility(map, snapshot);
  ensureInteractions();
  wireSelection?.();
  if (status === 'ready') {
    syncCrimeDistrictData(geojson, { start: snapshot.start, end: snapshot.end });
  } else {
    clearCrimeDistrictData();
  }
  void fitContext(snapshot, geojson);
}
