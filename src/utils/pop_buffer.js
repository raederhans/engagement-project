import { fetchTractsCachedFirst } from "../api/boundaries.js";
import { fetchTractStatsCachedFirst } from "../api/acs.js";
import { tractFeatureGEOID } from "./geoids.js";
import * as turf from "@turf/turf";

function toLonLat([x, y]) {
  const R = 6378137;
  const d = 180 / Math.PI;
  const lon = (x / R) * d;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * d;
  return [lon, lat];
}

/**
 * Approximate population within a circular buffer using centroid-in-polygon test.
 * @param {{center3857:[number,number], radiusM:number}} params
 * @returns {Promise<{pop:number, tractsChecked:number}>}
 */
export async function estimatePopInBuffer({
  center3857,
  radiusM,
  signal,
  onSourceResolved,
  fetchTracts = fetchTractsCachedFirst,
  fetchStats = fetchTractStatsCachedFirst,
}) {
  signal?.throwIfAborted();
  const center4326 = toLonLat(center3857);
  const circle = turf.circle(center4326, radiusM, { units: "meters", steps: 64 });
  const [tracts, stats] = await Promise.all([
    fetchTracts({ signal, onSourceResolved }),
    fetchStats({ signal, onSourceResolved }),
  ]);
  signal?.throwIfAborted();
  const populationByGeoid = new Map(
    stats.map((row) => [row.geoid, Number(row.pop) || 0]),
  );
  let pop = 0;
  let checked = 0;
  for (const ft of tracts.features || []) {
    const c = turf.centroid(ft).geometry.coordinates;
    if (turf.booleanPointInPolygon(c, circle)) {
      pop += populationByGeoid.get(tractFeatureGEOID(ft)) || 0;
      checked++;
    }
  }
  return { pop, tractsChecked: checked };
}

