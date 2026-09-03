import {
  admitCrimeResponse,
  fetchMonthlySeriesTract,
  fetchTopTypesTract,
} from '../api/crime.js';
import { fetchTractStatsCachedFirst } from '../api/acs.js';
import { fetchTractsCachedFirst } from '../api/boundaries.js';
import { t } from '../i18n/index.js';
import { getTractPolygonAndBboxByGEOID } from '../utils/tract_geom.js';

export async function resolveSelectedTractGeometry({
  selectedTractGEOID,
  signal,
  fetchTracts = fetchTractsCachedFirst,
}) {
  const tracts = await fetchTracts({ signal });
  const polygon = getTractPolygonAndBboxByGEOID(tracts, selectedTractGEOID, { decimals: 6 });
  if (!polygon) throw new Error(`Tract ${selectedTractGEOID} not found`);
  return polygon.geojsonPolygon4326;
}

export function createTractSummaryFetchers({
  tractGEOID,
  fetchMonthly = fetchMonthlySeriesTract,
  fetchTop = fetchTopTypesTract,
  fetchStats = fetchTractStatsCachedFirst,
}) {
  return {
    async fetchCountBuffer({ start, end, types, signal }) {
      const response = await fetchMonthly({ start, end, types, tractGEOID, signal });
      return admitCrimeResponse('monthly', response).rows.reduce(
        (sum, row) => sum + Number(row.n),
        0,
      );
    },
    fetchTopTypesBuffer({ start, end, types, limit, signal }) {
      return fetchTop({ start, end, types, tractGEOID, limit, signal });
    },
    async estimatePopInBuffer({ signal, onSourceResolved }) {
      const stats = await fetchStats({ signal, onSourceResolved });
      const row = stats.find((candidate) => candidate.geoid === tractGEOID);
      if (!row) throw new Error(`Population for tract ${tractGEOID} not found`);
      return { pop: Number(row.pop) || 0, tractsChecked: 1 };
    },
  };
}

export function runTractSummary({ selectedTractGEOID, ...filters }, options, updateCompareImpl) {
  if (!/^\d{11}$/.test(selectedTractGEOID || '')) {
    throw new Error('A valid 11-digit census tract GEOID is required.');
  }
  return updateCompareImpl({
    ...filters,
    center3857: [0, 0],
    centerB3857: null,
    addressA: `${t('crime.area.tract')} ${selectedTractGEOID}`,
    addressB: null,
    radiusM: 1,
    queryMode: 'tract',
    selectedTractGEOID,
    adminLevel: 'tracts',
  }, {
    ...options,
    fetchers: createTractSummaryFetchers({ tractGEOID: selectedTractGEOID }),
  });
}
