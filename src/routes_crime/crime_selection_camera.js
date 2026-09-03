import { bufferBounds, fitBoundsWithPanel, geometryBounds } from '../map/camera_fit.js';
import { tractFeatureGEOID } from '../utils/geoids.js';

function unionBounds(...values) {
  const valid = values.filter(Boolean);
  if (valid.length === 0) return null;
  return [
    [Math.min(...valid.map((bounds) => bounds[0][0])), Math.min(...valid.map((bounds) => bounds[0][1]))],
    [Math.max(...valid.map((bounds) => bounds[1][0])), Math.max(...valid.map((bounds) => bounds[1][1]))],
  ];
}

function selectedFeature(snapshot, feature, districtData, tractData) {
  if (feature) return feature;
  if (snapshot.queryMode === 'district') {
    return districtData?.features?.find((candidate) => (
      String(candidate?.properties?.DIST_NUMC || '').padStart(2, '0')
        === String(snapshot.selectedDistrictCode || '').padStart(2, '0')
    ));
  }
  if (snapshot.queryMode === 'tract') {
    return tractData?.features?.find((candidate) => (
      tractFeatureGEOID(candidate) === snapshot.selectedTractGEOID
    ));
  }
  return null;
}

export async function runPublicCrimeCameraNavigation({
  map,
  snapshot,
  feature,
  runProgrammaticMapMove,
  fitBounds = fitBoundsWithPanel,
} = {}) {
  if (snapshot?.queryMode === 'buffer') return { status: 'idle', applied: false };
  const bounds = geometryBounds(feature);
  if (!bounds) return { status: 'idle', applied: false };
  const applied = await runProgrammaticMapMove(() => fitBounds(map, bounds));
  return { status: applied ? 'applied' : 'superseded', applied: Boolean(applied) };
}

export async function fitCrimeSelectionCamera({
  map,
  snapshot,
  feature,
  districtData,
  tractData,
  selectionKey,
  previousSelectionKey,
  runProgrammaticMapMove,
} = {}) {
  const bounds = snapshot.queryMode === 'buffer'
    ? unionBounds(
      bufferBounds(snapshot.centerLonLat, snapshot.radiusM, { scale: 1.75 }),
      bufferBounds(snapshot.centerBLonLat, snapshot.radiusM, { scale: 1.75 }),
    )
    : geometryBounds(selectedFeature(snapshot, feature, districtData, tractData));
  if (!bounds) return { applied: false, selectionKey: previousSelectionKey };
  const applied = await runProgrammaticMapMove(() => fitBoundsWithPanel(map, bounds));
  return { applied: Boolean(applied), selectionKey: applied ? selectionKey : null };
}
