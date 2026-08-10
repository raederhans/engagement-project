import { fetchTractsCachedFirst } from "../api/boundaries.js";
import { fetchTractStatsCachedFirst } from "../api/acs.js";
import { tractFeatureGEOID } from "./geoids.js";
import { distanceMeters, geometryVertexCentroid } from './geo_circle.js';
import { createPopulationMetric, populationEstimate } from '../data/acs_population.js';

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
  const [tracts, stats] = await Promise.all([
    fetchTracts({ signal, onSourceResolved }),
    fetchStats({ signal, onSourceResolved }),
  ]);
  signal?.throwIfAborted();
  const populationByGeoid = new Map(stats.map((row) => [row.geoid, row.population ?? row.pop]));
  let pop = 0;
  let checked = 0;
  let missing = 0;
  let populationMetadata = null;
  for (const ft of tracts.features || []) {
    const tractCenter = geometryVertexCentroid(ft.geometry);
    if (tractCenter && distanceMeters(center4326, tractCenter) <= radiusM) {
      const population = populationByGeoid.get(tractFeatureGEOID(ft));
      const estimate = populationEstimate(population);
      if (estimate == null) missing += 1;
      else pop += estimate;
      if (!populationMetadata && population && typeof population === 'object') {
        populationMetadata = population;
      }
      checked++;
    }
  }
  const estimate = checked > 0 && missing === 0 ? pop : null;
  const population = createPopulationMetric({
    estimate,
    moe90: null,
    vintage: populationMetadata?.vintage ?? null,
    source: populationMetadata?.source ?? null,
    retrievedAt: populationMetadata?.retrievedAt ?? null,
    status: estimate == null ? 'unavailable' : 'available',
    method: 'centroid-in-buffer-whole-tract-sum',
    moe90Status: 'unavailable',
  });
  return { pop: estimate, tractsChecked: checked, population };
}
