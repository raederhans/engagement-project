import {
  admitCrimeResponse,
  fetchByDistrict,
  fetchTopTypesByDistrict,
} from '../api/crime.js';
import { runTractSummary } from '../charts/index.js';
import { updateCompare } from '../compare/card.js';
import { t } from '../i18n/index.js';
import { districtNames } from '../utils/district_names.js';

function normalizeDistrictCode(value) {
  const code = String(value || '').padStart(2, '0');
  if (!/^\d{2}$/.test(code) || !districtNames.has(code)) {
    throw new Error('An admitted Philadelphia police district code is required.');
  }
  return code;
}

export function createDistrictSummaryFetchers({
  districtCode,
  fetchCounts = fetchByDistrict,
  fetchTop = fetchTopTypesByDistrict,
}) {
  const code = normalizeDistrictCode(districtCode);
  return {
    async fetchCountBuffer({ start, end, types, signal }) {
      const response = admitCrimeResponse('district', await fetchCounts({ start, end, types, signal }));
      const row = response.rows.find(
        (candidate) => String(candidate.dc_dist).padStart(2, '0') === code,
      );
      return row == null ? 0 : Number(row.n);
    },
    fetchTopTypesBuffer({ start, end, types, limit, signal }) {
      return fetchTop({ start, end, types, dc_dist: code, limit, signal });
    },
  };
}

export function runDistrictSummary({ selectedDistrictCode, ...filters }, options, updateCompareImpl = updateCompare) {
  const districtCode = normalizeDistrictCode(selectedDistrictCode);
  return updateCompareImpl({
    ...filters,
    center3857: [0, 0],
    centerB3857: null,
    addressA: t('crime.districtName', { code: districtCode }),
    addressB: null,
    radiusM: 1,
    queryMode: 'district',
    selectedDistrictCode: districtCode,
    adminLevel: 'districts',
    per10k: false,
  }, {
    ...options,
    fetchers: createDistrictSummaryFetchers({ districtCode }),
  });
}

export function runPublicAreaSummary(snapshot, options) {
  if (snapshot?.queryMode === 'district') return runDistrictSummary(snapshot, options);
  if (snapshot?.queryMode === 'tract') return runTractSummary(snapshot, options, updateCompare);
  throw new Error('A public district or tract analysis is required.');
}
