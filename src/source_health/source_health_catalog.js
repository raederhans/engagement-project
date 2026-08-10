const CITY_LICENSE = Object.freeze({
  label: 'City of Philadelphia License',
  url: 'https://www.phila.gov/terms-of-use/',
});

const CENSUS_REUSE = Object.freeze({
  label: 'U.S. Census Bureau public-use terms',
  url: 'https://www.census.gov/about/policies/citation.html',
});

const PROJECT_REPOSITORY = 'https://github.com/raederhans/engagement-project';

function source(definition) {
  return Object.freeze({
    ...definition,
    license: Object.freeze({ ...definition.license }),
    coverage: Object.freeze({ ...definition.coverage }),
    clocks: Object.freeze({
      sourceAsOf: null,
      retrievedAt: null,
      builtAt: null,
      observedAt: null,
    }),
    snapshot: Object.freeze({ version: null, identity: null }),
    limitations: Object.freeze([...definition.limitations]),
    officialHandoff: Object.freeze({ ...definition.officialHandoff }),
    status: 'unknown',
    statusReason: 'not-observed',
    recordCount: null,
    transport: Object.freeze({
      endpointUrl: null,
      lastModified: null,
      etag: null,
    }),
  });
}

/**
 * Supported upstream and bundled datasets. These records describe source
 * contracts, not a claim that a source is currently reachable or fresh.
 */
export const SOURCE_HEALTH_CATALOG = Object.freeze([
  source({
    id: 'philadelphia-reported-crime',
    dataset: 'Crime Incidents / incidents_part1_part2',
    provider: 'Philadelphia Police Department via OpenDataPhilly and CARTO',
    canonicalUrl: 'https://opendataphilly.org/datasets/crime-incidents/',
    license: CITY_LICENSE,
    coverage: {
      geography: 'Philadelphia',
      temporalStart: '2006-01-01',
      temporalEnd: null,
    },
    boundaryVintage: null,
    revisionPolicy: 'Published records may be corrected or reclassified after retrieval; no immutable upstream revision cursor is exposed.',
    limitations: [
      'Historical reported records are not a real-time alert, a complete account of harm, or a prediction of present or future danger.',
      'A source row is not guaranteed to represent one unique incident, and some records cannot be mapped.',
    ],
    officialHandoff: {
      label: 'OpenDataPhilly Crime Incidents',
      url: 'https://opendataphilly.org/datasets/crime-incidents/',
    },
  }),
  source({
    id: 'philadelphia-police-districts',
    dataset: 'Philadelphia Police District boundaries',
    provider: 'City of Philadelphia Police GIS',
    canonicalUrl: 'https://policegis.phila.gov/arcgis/rest/services/POLICE/Boundaries/MapServer/1',
    license: CITY_LICENSE,
    coverage: {
      geography: 'Philadelphia',
      temporalStart: null,
      temporalEnd: null,
    },
    boundaryVintage: null,
    revisionPolicy: 'The live service is preferred; a validated bundled geometry is used only after live admission fails.',
    limitations: [
      'The configured service does not expose an admitted boundary vintage in the application contract.',
      'Availability or transport metadata does not prove when district boundaries became effective.',
    ],
    officialHandoff: {
      label: 'City of Philadelphia Open Data',
      url: 'https://www.phila.gov/departments/office-of-innovation-and-technology/open-data/',
    },
  }),
  source({
    id: 'census-tract-boundaries',
    dataset: 'Census tract boundaries',
    provider: 'U.S. Census Bureau TIGERweb, with admitted public fallbacks',
    canonicalUrl: 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html',
    license: CENSUS_REUSE,
    coverage: {
      geography: 'Philadelphia County, Pennsylvania (state 42, county 101)',
      temporalStart: null,
      temporalEnd: null,
    },
    boundaryVintage: null,
    revisionPolicy: 'TIGERweb is tried first, followed by PASDA, Esri, and then a validated bundled fallback.',
    limitations: [
      'The runtime endpoint response is not admitted as a specific TIGER/Line vintage unless explicit vintage metadata is available.',
      'Boundaries provide geographic units and do not contain demographic or crime facts.',
    ],
    officialHandoff: {
      label: 'Census TIGER/Line files',
      url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html',
    },
  }),
  source({
    id: 'acs-tract-population',
    dataset: '2024 ACS 5-year Detailed Table B01003 tract population',
    provider: 'U.S. Census Bureau; Census Reporter may provide the live browser feed',
    canonicalUrl: 'https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release.html',
    license: CENSUS_REUSE,
    coverage: {
      geography: '408 census tracts in Philadelphia County, Pennsylvania',
      temporalStart: '2020-01-01',
      temporalEnd: '2024-12-31',
    },
    boundaryVintage: '2020 census tract geography',
    revisionPolicy: 'The app prefers an admitted online release and retains a reproducible bundled B01003 fallback.',
    limitations: [
      'ACS values are estimates; the population margin of error covers sampling uncertainty in the denominator only.',
      'The 2020–2024 estimate period is not the same as retrieval, build, or observation time.',
    ],
    officialHandoff: {
      label: '2024 ACS release',
      url: 'https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release.html',
    },
  }),
  source({
    id: 'tract-crime-snapshot',
    dataset: 'Derived tract crime snapshot',
    provider: 'Engagement Project build from Philadelphia Crime Incidents and bundled tract geometry',
    canonicalUrl: `${PROJECT_REPOSITORY}/blob/main/public/data/tract_crime_counts_last12m.json`,
    license: {
      label: 'Derived artifact; upstream data terms apply',
      url: 'https://opendataphilly.org/datasets/crime-incidents/',
    },
    coverage: {
      geography: '408 Philadelphia census tracts',
      temporalStart: null,
      temporalEnd: null,
    },
    boundaryVintage: null,
    revisionPolicy: 'A new validated file replaces the prior published snapshot; the file does not contain an upstream revision timeline.',
    limitations: [
      'This is a precomputed historical aggregate, not a live source or an official City publication.',
      'An unavailable snapshot is not an observed zero, and an older snapshot must not be presented as current danger.',
    ],
    officialHandoff: {
      label: 'Upstream Crime Incidents catalog',
      url: 'https://opendataphilly.org/datasets/crime-incidents/',
    },
  }),
  source({
    id: 'philadelphia-city-limits',
    dataset: 'Philadelphia City Limits',
    provider: 'City of Philadelphia',
    canonicalUrl: 'https://opendataphilly.org/datasets/city-limits/',
    license: CITY_LICENSE,
    coverage: {
      geography: 'Philadelphia municipal boundary',
      temporalStart: null,
      temporalEnd: null,
    },
    boundaryVintage: 'Catalog states layer updated 2012-07-22; runtime geometry has no admitted effective date',
    revisionPolicy: 'The provider updates the City Standard Boundary as needed.',
    limitations: [
      'The boundary is used only for conservative local coverage checks and generalized map context.',
      'A successful HTTP response does not establish a newer business-effective boundary date.',
    ],
    officialHandoff: {
      label: 'OpenDataPhilly City Limits',
      url: 'https://opendataphilly.org/datasets/city-limits/',
    },
  }),
  source({
    id: 'openstreetmap-basemap',
    dataset: 'OpenStreetMap raster basemap tiles',
    provider: 'OpenStreetMap contributors',
    canonicalUrl: 'https://www.openstreetmap.org/copyright',
    license: {
      label: 'Open Data Commons Open Database License (ODbL)',
      url: 'https://www.openstreetmap.org/copyright',
    },
    coverage: {
      geography: 'Map display area requested by the browser',
      temporalStart: null,
      temporalEnd: null,
    },
    boundaryVintage: null,
    revisionPolicy: 'Tiles are requested on demand; the application does not persist a source-wide revision identifier.',
    limitations: [
      'The basemap is visual context and is not used as a business-fact clock or a source of Crime counts.',
      'The Data Status surface remains usable when the map or tile service is unavailable.',
    ],
    officialHandoff: {
      label: 'OpenStreetMap copyright and attribution',
      url: 'https://www.openstreetmap.org/copyright',
    },
  }),
  source({
    id: 'diary-demo-routes',
    dataset: 'Diary demo routes and segments',
    provider: 'Engagement Project deterministic demo generator',
    canonicalUrl: `${PROJECT_REPOSITORY}/tree/main/data`,
    license: {
      label: 'Project-authored demo data under the repository MIT license',
      url: `${PROJECT_REPOSITORY}/blob/main/LICENSE`,
    },
    coverage: {
      geography: 'Illustrative Philadelphia-area routes',
      temporalStart: null,
      temporalEnd: null,
    },
    boundaryVintage: null,
    revisionPolicy: 'Demo files are regenerated intentionally from a fixed seed; they are not an observed community feed.',
    limitations: [
      'Illustrative sample ratings are not official, representative, complete, or a safety score.',
      'Private Diary entries remain device-local and are not represented as an upstream source here.',
    ],
    officialHandoff: {
      label: 'Project demo data directory',
      url: `${PROJECT_REPOSITORY}/tree/main/data`,
    },
  }),
]);
