/**
 * Central configuration constants for remote data sources.
 */
export const CARTO_SQL_BASE = "https://phl.carto.com/api/v2/sql";
export const PD_GEOJSON =
  "https://policegis.phila.gov/arcgis/rest/services/POLICE/Boundaries/MapServer/1/query?where=1=1&outFields=*&f=geojson";
export const TRACTS_GEOJSON =
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0/query?where=STATE_FIPS='42'%20AND%20COUNTY_FIPS='101'&outFields=FIPS,STATE_FIPS,COUNTY_FIPS,TRACT_FIPS,POPULATION_2020&f=geojson";
export const ACS_POP_TENURE_INCOME =
  "https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E,B25003_001E,B25003_003E,B19013_001E&for=tract:*&in=state:42%20county:101";
export const ACS_POVERTY =
  "https://api.census.gov/data/2023/acs/acs5/subject?get=NAME,S1701_C03_001E&for=tract:*&in=state:42%20county:101";

const DEFAULT_OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'osm-tiles', type: 'raster', source: 'osm' },
  ],
};

const maptilerKey = (import.meta?.env?.VITE_MAPTILER_API_KEY || '').trim();
const envCrimeStyle = (import.meta?.env?.VITE_MAP_STYLE_CRIME || '').trim();
const envDiaryStyle = (import.meta?.env?.VITE_MAP_STYLE_DIARY || '').trim();

const MAP_STYLE_PRESETS = {
  'maptiler-light': maptilerKey ? `https://api.maptiler.com/maps/streets-v2-light/style.json?key=${maptilerKey}` : null,
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

export function resolveMapStyle(mode = 'crime') {
  if (mode === 'diary' && MAP_STYLES.diaryLight) {
    return cloneStyle(MAP_STYLES.diaryLight);
  }
  return cloneStyle(MAP_STYLES.crimeDefault);
}
