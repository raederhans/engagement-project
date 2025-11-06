/**
 * Minimal shared state placeholder for forthcoming controls and maps.
 */
import dayjs from 'dayjs';
import { expandGroupsToCodes } from '../utils/types.js';
import { fetchCoverage } from '../api/meta.js';

/**
 * @typedef {object} Store
 * @property {string|null} addressA
 * @property {string|null} addressB
 * @property {number} radius
 * @property {number} timeWindowMonths
 * @property {string[]} selectedGroups
 * @property {string[]} selectedTypes
 * @property {string} adminLevel
 * @property {any} mapBbox
 * @property {[number,number]|null} center3857
 * @property {() => {start:string,end:string}} getStartEnd
 * @property {() => {start:string,end:string,types:string[],center3857:[number,number]|null,radiusM:number}} getFilters
 * @property {(lng:number,lat:number) => void} setCenterFromLngLat
 */

export const store = /** @type {Store} */ ({
  addressA: null,
  addressB: null,
  radius: 400,
  timeWindowMonths: 6,
  startMonth: null,
  durationMonths: 6,
  selectedGroups: [],
  selectedTypes: [],
  selectedDrilldownCodes: [], // Child offense codes (overrides parent groups when set)
  adminLevel: 'districts',
  selectMode: 'idle',
  centerLonLat: null,
 per10k: false,
  mapBbox: null,
  center3857: null,
  coverageMin: null,
  coverageMax: null,
  // Query mode and selections
  queryMode: 'buffer', // 'buffer' | 'district' | 'tract'
  selectedDistrictCode: null,
  selectedTractGEOID: null,
  overlayTractsLines: false, // Show tract boundaries overlay in district mode
  didAutoAlignAdmin: false, // One-time auto-align flag for Tract mode → adminLevel 'tracts'
  // Choropleth classification
  classMethod: 'quantile',
  classBins: 5,
  classPalette: 'Blues',
  classOpacity: 0.75,
  classCustomBreaks: [],
  getStartEnd() {
    if (this.startMonth && this.durationMonths) {
      const startD = dayjs(`${this.startMonth}-01`).startOf('month');
      const endD = startD.add(this.durationMonths, 'month').endOf('month');
      return { start: startD.format('YYYY-MM-DD'), end: endD.format('YYYY-MM-DD') };
    }
    const end = dayjs().format('YYYY-MM-DD');
    const start = dayjs().subtract(this.timeWindowMonths || 6, 'month').format('YYYY-MM-DD');
    return { start, end };
  },
  getFilters() {
    const { start, end } = this.getStartEnd();
    const types = (this.selectedTypes && this.selectedTypes.length)
      ? this.selectedTypes.slice()
      : expandGroupsToCodes(this.selectedGroups || []);
    return {
      start,
      end,
      types,
      drilldownCodes: this.selectedDrilldownCodes || [],
      center3857: this.center3857,
      radiusM: this.radius,
      queryMode: this.queryMode,
      selectedDistrictCode: this.selectedDistrictCode,
      selectedTractGEOID: this.selectedTractGEOID,
    };
  },
  setCenterFromLngLat(lng, lat) {
    const R = 6378137;
    const x = R * (lng * Math.PI / 180);
    const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
    this.center3857 = [x, y];
    this.centerLonLat = [lng, lat];
  },
});

/**
 * Probe coverage and set default window to last 12 months ending at coverage max.
 */
export async function initCoverageAndDefaults() {
  try {
    const { min, max } = await fetchCoverage();
    store.coverageMin = min;
    store.coverageMax = max;
    if (!store.startMonth && max) {
      const maxDate = new Date(max);
      const endMonth = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
      const startMonth = new Date(endMonth.getFullYear(), endMonth.getMonth() - 12, 1);
      store.startMonth = `${startMonth.getFullYear()}-${String(startMonth.getMonth() + 1).padStart(2, '0')}`;
      store.durationMonths = 12;
    }
  } catch (e) {
    // leave defaults; fallback handled in README known issues
  }
}
