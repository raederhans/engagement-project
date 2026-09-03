/**
 * Central project and remote-data configuration.
 *
 * Public GitHub Pages builds must not embed private API keys. Official Census
 * URLs are therefore opt-in and should point at a credential-hiding proxy or
 * another managed endpoint. Census Reporter is the default keyless live source,
 * with the bundled ACS 2024 5-year snapshot retained only as a resilient fallback.
 */
const env = import.meta?.env || {};
const envValue = (name) => String(env[name] || '').trim();

export const PROJECT_REGION = Object.freeze({
  name: 'Philadelphia',
  stateFips: '42',
  countyFips: '101',
});

export const CRIME_DATASET_START = '2006-01-01';
// Showcase release snapshot: queries may still use the existing read-only API,
// but no Crime record after this boundary is admitted into the product.
export const CRIME_DATASET_COVERAGE_MAX = '2026-08-31';
export const CRIME_DATASET_END_EXCLUSIVE = '2026-09-01';
export const ACS_SNAPSHOT_YEAR = '2024';
export const ACS_SNAPSHOT_PERIOD = '2020-2024';
export const ACS_SUMMARY_FILE_URL =
  'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01003.dat';

export const CARTO_SQL_BASE = envValue('VITE_CARTO_SQL_BASE') || 'https://phl.carto.com/api/v2/sql';

export const PD_GEOJSON = envValue('VITE_POLICE_DISTRICTS_URL') ||
  'https://policegis.phila.gov/arcgis/rest/services/POLICE/Boundaries/MapServer/1/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson';
export const CITY_LIMITS_GEOJSON =
  'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/City_Limits/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson';

const tractWhere = encodeURIComponent(
  `STATE='${PROJECT_REGION.stateFips}' AND COUNTY='${PROJECT_REGION.countyFips}'`,
);
const tractFields = encodeURIComponent(
  'STATE,COUNTY,TRACT,GEOID,NAME,BASENAME,AREALAND,AREAWATER',
);

export const TIGER_TRACTS_GEOJSON =
  `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?where=${tractWhere}&outFields=${tractFields}&returnGeometry=true&outSR=4326&f=geojson`;
export const PASDA_TRACTS_GEOJSON =
  'https://mapservices.pasda.psu.edu/server/rest/services/pasda/CityPhilly/MapServer/28/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson';
export const TRACTS_GEOJSON = envValue('VITE_TRACTS_URL') ||
  `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0/query?where=STATE_FIPS%3D%27${PROJECT_REGION.stateFips}%27%20AND%20COUNTY_FIPS%3D%27${PROJECT_REGION.countyFips}%27&outFields=FIPS%2CSTATE_FIPS%2CCOUNTY_FIPS%2CTRACT_FIPS%2CPOPULATION_2020&returnGeometry=true&outSR=4326&f=geojson`;
export const TRACT_GEOJSON_ENDPOINTS = Object.freeze([
  TIGER_TRACTS_GEOJSON,
  PASDA_TRACTS_GEOJSON,
  TRACTS_GEOJSON,
]);

const acsPopulationUrl = envValue('VITE_ACS_POPULATION_URL');
const acsPovertyUrl = envValue('VITE_ACS_POVERTY_URL');
export const ACS_API_ENDPOINTS = acsPopulationUrl && acsPovertyUrl
  ? Object.freeze({ population: acsPopulationUrl, poverty: acsPovertyUrl })
  : null;

export const CENSUS_REPORTER_ACS_URL = envValue('VITE_CENSUS_REPORTER_ACS_URL') ||
  `https://api.censusreporter.org/1.0/data/show/latest?table_ids=B01003%2CB25003%2CB19013%2CB17001&geo_ids=140%7C05000US${PROJECT_REGION.stateFips}${PROJECT_REGION.countyFips}`;

export const DIARY_SEGMENTS_URL = typeof import.meta.env === 'undefined'
  ? ''
  : String(import.meta.env.VITE_DIARY_SEGMENTS_URL || '').trim();
export const DIARY_ROUTES_URL = typeof import.meta.env === 'undefined'
  ? ''
  : String(import.meta.env.VITE_DIARY_ROUTES_URL || '').trim();

export const TRACT_CRIME_SNAPSHOT_ENABLED = import.meta?.env?.VITE_TRACT_CRIME_SNAPSHOT === '1';

export function resolveDiaryNetworkDataEnabled(runtimeEnv = {}) {
  const value = runtimeEnv?.VITE_DIARY_NETWORK_DATA;
  return typeof value === 'string' && value.trim() === '1';
}

export const DIARY_NETWORK_DATA_ENABLED = resolveDiaryNetworkDataEnabled(env);

const DEFAULT_OSM_RASTER_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-saturation': -0.55,
        'raster-contrast': -0.08,
        'raster-brightness-min': 0.08,
        'raster-brightness-max': 0.94,
      },
    },
  ],
};

const maptilerKey = (import.meta?.env?.VITE_MAPTILER_API_KEY || '').trim();
const envCrimeStyle = (import.meta?.env?.VITE_MAP_STYLE_CRIME || '').trim();
const envDiaryStyle = (import.meta?.env?.VITE_MAP_STYLE_DIARY || '').trim();

const MAP_STYLE_PRESETS = {
  'maptiler-light': maptilerKey ? `https://api.maptiler.com/maps/positron/style.json?key=${maptilerKey}` : null,
  'positron': 'https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json',
};

const crimeStyle =
  envCrimeStyle && envCrimeStyle !== 'default'
    ? MAP_STYLE_PRESETS[envCrimeStyle] || envCrimeStyle
    : DEFAULT_OSM_RASTER_STYLE;

function resolveDiaryLightStyle() {
  if (!envDiaryStyle) {
    return MAP_STYLE_PRESETS['maptiler-light'];
  }
  if (envDiaryStyle === 'default') {
    return null;
  }
  const preset = MAP_STYLE_PRESETS[envDiaryStyle];
  if (preset) return preset;
  if (envDiaryStyle.startsWith('http')) return envDiaryStyle;
  return null;
}

export const MAP_STYLES = {
  crimeDefault: crimeStyle,
  diaryLight: resolveDiaryLightStyle(),
};

function cloneStyle(style) {
  if (!style) return style;
  if (typeof style === 'string') return style;
  return JSON.parse(JSON.stringify(style));
}

export const HAS_DIARY_LIGHT_STYLE = !!MAP_STYLES.diaryLight;

export function resolveMapStyle(mode = 'crime') {
  if (mode === 'diary' && MAP_STYLES.diaryLight) {
    return cloneStyle(MAP_STYLES.diaryLight);
  }
  return cloneStyle(MAP_STYLES.crimeDefault);
}
