import dayjs from 'dayjs';
import { expandGroupsToCodes, normalizeHighlightedOffenses } from '../utils/types.js';
import { CRIME_RADIUS_POLICY } from './crime_radius_policy.js';

export function createCrimeQueryState() {
  return {
    addressA: null,
    addressB: null,
    radius: CRIME_RADIUS_POLICY.defaultValue,
    timeWindowMonths: 6,
    startMonth: null,
    durationMonths: 6,
    selectedGroups: [],
    selectedTypes: [],
    selectedDrilldownCodes: [],
    adminLevel: 'districts',
    selectMode: 'idle',
    centerLonLat: null,
    centerBLonLat: null,
    centerB3857: null,
    selectTarget: 'A',
    per10k: false,
    mapBbox: null,
    center3857: null,
    coverageMin: null,
    coverageMax: null,
    coverageStatus: 'idle',
    coverageError: null,
    coverageNotice: null,
    queryMode: 'buffer',
    selectedDistrictCode: null,
    selectedTractGEOID: null,
    overlayTractsLines: false,
    didAutoAlignAdmin: false,
    classMethod: 'quantile',
    classBins: 5,
    classPalette: 'Blues',
    classOpacity: 0.75,
    classCustomBreaks: [],
    getStartEnd() {
      if (this.startMonth && this.durationMonths) {
        const startD = dayjs(`${this.startMonth}-01`).startOf('month');
        const endD = startD.add(this.durationMonths, 'month').startOf('month');
        return { start: startD.format('YYYY-MM-DD'), end: endD.format('YYYY-MM-DD') };
      }
      throw new Error(this.coverageError || 'Crime coverage is unavailable; select a verified date range.');
    },
    getFilters() {
      const { start, end } = this.getStartEnd();
      const drilldownCodes = normalizeHighlightedOffenses(this.selectedDrilldownCodes);
      const resolvedOffenseCodes = drilldownCodes.length
        ? drilldownCodes
        : ((this.selectedTypes && this.selectedTypes.length)
          ? this.selectedTypes.slice()
          : expandGroupsToCodes(this.selectedGroups || []));
      return {
        start,
        end,
        types: resolvedOffenseCodes,
        resolvedOffenseCodes,
        drilldownCodes,
        classPalette: this.classPalette,
        center3857: this.center3857,
        centerB3857: this.centerB3857,
        radiusM: this.radius,
        queryMode: this.queryMode,
        selectedDistrictCode: this.selectedDistrictCode,
        selectedTractGEOID: this.selectedTractGEOID,
        adminLevel: this.adminLevel,
        per10k: this.per10k,
        addressA: this.addressA,
        addressB: this.addressB,
      };
    },
    setCenterFromLngLat(lng, lat) {
      this.setComparisonPoint('A', lng, lat);
    },
    setComparisonPoint(target, lng, lat, label) {
      const R = 6378137;
      const x = R * (lng * Math.PI / 180);
      const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
      if (String(target).toUpperCase() === 'B') {
        this.centerB3857 = [x, y];
        this.centerBLonLat = [lng, lat];
        if (label) this.addressB = label;
      } else {
        this.center3857 = [x, y];
        this.centerLonLat = [lng, lat];
        if (label) this.addressA = label;
      }
    },
  };
}

export function setCrimeAnalysisMode(state, mode) {
  const normalized = ['buffer', 'district', 'tract'].includes(mode) ? mode : 'buffer';
  state.queryMode = normalized;
  state.adminLevel = normalized === 'tract' ? 'tracts' : 'districts';
  if (normalized !== 'tract') state.per10k = false;
  if (normalized !== 'district') state.selectedDistrictCode = null;
  if (normalized !== 'tract') state.selectedTractGEOID = null;
  return normalized;
}

export function clearCrimeSelection(state) {
  state.selectedDistrictCode = null;
  state.selectedTractGEOID = null;
  if (state.queryMode === 'buffer') {
    state.center3857 = null;
    state.centerLonLat = null;
    state.centerB3857 = null;
    state.centerBLonLat = null;
    state.addressA = '';
    state.addressB = '';
  }
  state.selectMode = 'idle';
  state.selectTarget = 'A';
  return state;
}

function normalizeCoverageDate(value, label) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(text);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const invalidTimestamp = text.includes('T') && Number.isNaN(Date.parse(text));
  if (!match
    || invalidTimestamp
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) {
    throw new Error(`Crime coverage is unavailable: invalid ${label} date ${value}.`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function applyCrimeCoverage(state, { min, max }) {
  if (!max) throw new Error('Crime coverage is unavailable: maximum date is missing.');
  const normalizedMax = normalizeCoverageDate(max, 'maximum');
  const normalizedMin = min ? normalizeCoverageDate(min, 'minimum') : null;
  const maxDate = dayjs(normalizedMax);
  const endMonth = maxDate.add(1, 'month').startOf('month');
  state.coverageMin = normalizedMin;
  state.coverageMax = normalizedMax;
  state.coverageStatus = 'ready';
  state.coverageError = null;
  state.coverageNotice = null;
  if (!state.startMonth) state.durationMonths = 12;
  normalizeCrimeCoverageWindow(state);
  return state.getStartEnd?.() ?? {
    start: `${state.startMonth}-01`,
    end: endMonth.format('YYYY-MM-DD'),
  };
}

export function normalizeCrimeCoverageWindow(state) {
  if (state.coverageStatus !== 'ready' || !state.coverageMax) return false;
  const duration = Number(state.durationMonths) || 12;
  const coverageEnd = dayjs(state.coverageMax).add(1, 'month').startOf('month');
  const coverageStart = state.coverageMin ? dayjs(state.coverageMin).startOf('month') : null;
  const selectedStart = state.startMonth ? dayjs(`${state.startMonth}-01`).startOf('month') : null;
  const selectedEnd = selectedStart?.isValid()
    ? selectedStart.add(duration, 'month').startOf('month')
    : null;
  const outsideCoverage = !selectedStart?.isValid()
    || !selectedEnd?.isValid()
    || selectedEnd.isAfter(coverageEnd)
    || (coverageStart?.isValid() && selectedStart.isBefore(coverageStart));
  if (!outsideCoverage) {
    state.coverageNotice = null;
    return false;
  }
  const latestStart = coverageEnd.subtract(duration, 'month');
  if (coverageStart?.isValid() && latestStart.isBefore(coverageStart)) {
    throw new Error(`Crime coverage is shorter than the selected ${duration}-month duration.`);
  }
  state.startMonth = latestStart.format('YYYY-MM');
  state.coverageNotice = `The requested date range was outside live coverage and was reset to the latest ${duration} months.`;
  return true;
}

export function applyCrimeCoverageFailure(state, error) {
  state.coverageStatus = 'error';
  state.coverageNotice = null;
  state.coverageError = `Crime coverage is unavailable: ${error?.message || error || 'unknown error'}`;
  return state.coverageError;
}
