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
