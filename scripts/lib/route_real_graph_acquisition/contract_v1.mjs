import {
  boundedText,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
} from './safe_data.mjs';
import { strictJsonParse } from './strict_json_v1.mjs';

export const GEOFABRIK_ACQUISITION_MANIFEST_SCHEMA = 'route-real-graph-geofabrik-acquisition-manifest/v1';
export const GEOFABRIK_PROVIDER_PAGE = 'https://download.geofabrik.de/north-america/us/pennsylvania.html';
export const GEOFABRIK_REGION = 'north-america/us/pennsylvania';
export const GEOFABRIK_CANDIDATE_LIMITATIONS = Object.freeze([
  'This manifest identifies candidate discovery and bounded acquisition inputs only; it is not source authenticity, admission, Source Health current status, product materialization, or publication authority.',
  'HTTP headers and the provider MD5 sidecar are transport and corruption-detection evidence only; they do not prove business freshness, provenance, licence compliance, or reviewer identity.',
  'Pennsylvania coverage does not establish the Philadelphia boundary, buffer, or cross-New-Jersey routing completeness.',
]);

const DATED_URL_PATTERN = /^https:\/\/download\.geofabrik\.de\/north-america\/us\/pennsylvania-(\d{6})\.osm\.pbf$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export function parseGeofabrikAcquisitionManifest(jsonText) {
  if (arguments.length !== 1) {
    fail('manifest-arguments', 'manifest parsing accepts exactly one primitive JSON text input');
  }
  return admitGeofabrikAcquisitionManifest(jsonText);
}

export function admitGeofabrikAcquisitionManifest(jsonText) {
  if (arguments.length !== 1) {
    fail('manifest-arguments', 'manifest admission accepts exactly one primitive JSON text input');
  }
  return admitParsedGeofabrikAcquisitionManifest(strictJsonParse(jsonText));
}

function admitParsedGeofabrikAcquisitionManifest(value) {
  const manifest = exactDataObject(value, [
    'schema', 'manifestIdentity', 'dataClassification', 'source', 'references', 'policy', 'limitations',
  ], 'Geofabrik acquisition manifest');
  if (manifest.schema !== GEOFABRIK_ACQUISITION_MANIFEST_SCHEMA) {
    fail('manifest-schema', `manifest schema must equal ${GEOFABRIK_ACQUISITION_MANIFEST_SCHEMA}`);
  }
  if (manifest.dataClassification !== 'candidate-external') {
    fail('manifest-classification', 'manifest dataClassification must remain candidate-external');
  }

  const source = exactDataObject(manifest.source, [
    'provider', 'providerPage', 'region', 'format', 'datedUrl', 'sidecarMd5Url',
  ], 'manifest.source');
  if (source.provider !== 'Geofabrik GmbH') fail('provider', 'source.provider must identify Geofabrik GmbH');
  if (source.providerPage !== GEOFABRIK_PROVIDER_PAGE) fail('provider-page', 'source.providerPage must be the Pennsylvania provider page');
  if (source.region !== GEOFABRIK_REGION) fail('region', 'source.region must remain the Pennsylvania extract region');
  if (source.format !== 'osm.pbf') fail('source-format', 'source.format must equal osm.pbf');
  boundedText(source.datedUrl, 'source.datedUrl', { max: 2_048 });
  if (/latest/i.test(source.datedUrl)) fail('latest-forbidden', 'latest is forbidden as a reproducible candidate input');
  const datedMatch = source.datedUrl.match(DATED_URL_PATTERN);
  if (!datedMatch) fail('dated-url', 'source.datedUrl must be an exact dated Pennsylvania Geofabrik PBF URL');
  assertValidSnapshotDate(datedMatch[1]);
  if (source.sidecarMd5Url !== `${source.datedUrl}.md5`) {
    fail('sidecar-url', 'source.sidecarMd5Url must be the exact MD5 sidecar for source.datedUrl');
  }

  const references = exactDataObject(manifest.references, [
    'boundary', 'profile', 'tool',
  ], 'manifest.references');
  const referenceValues = Object.entries(references).map(([key, reference]) => (
    boundedText(reference, `manifest.references.${key}`, { max: 240, pattern: REFERENCE_PATTERN })
  ));
  if (new Set(referenceValues).size !== referenceValues.length) {
    fail('duplicate-reference', 'boundary, profile, and tool references must be distinct');
  }

  const policy = exactDataObject(manifest.policy, [
    'candidateOnly', 'latestAllowed', 'fallbackAllowed', 'fullPayloadPersistenceAllowed',
  ], 'manifest.policy');
  if (policy.candidateOnly !== true) fail('candidate-only', 'manifest policy must remain candidate-only');
  if (policy.latestAllowed !== false) fail('latest-forbidden', 'manifest policy must forbid latest inputs');
  if (policy.fallbackAllowed !== false) fail('fallback-forbidden', 'manifest policy must forbid fallback acquisition');
  if (policy.fullPayloadPersistenceAllowed !== false) {
    fail('payload-persistence-forbidden', 'this candidate manifest must forbid full payload persistence');
  }

  if (!Array.isArray(manifest.limitations) || manifest.limitations.length !== GEOFABRIK_CANDIDATE_LIMITATIONS.length) {
    fail('manifest-limitations', 'manifest limitations must equal the versioned candidate claim boundary');
  }
  for (let index = 0; index < GEOFABRIK_CANDIDATE_LIMITATIONS.length; index += 1) {
    if (manifest.limitations[index] !== GEOFABRIK_CANDIDATE_LIMITATIONS[index]) {
      fail('manifest-limitations', 'manifest limitations must equal the versioned candidate claim boundary');
    }
  }

  const expectedIdentity = contentIdentity({
    schema: manifest.schema,
    dataClassification: manifest.dataClassification,
    source,
    references,
    policy,
    limitations: manifest.limitations,
  });
  if (manifest.manifestIdentity !== expectedIdentity) {
    fail('manifest-identity-drift', 'manifestIdentity must equal the canonical SHA-256 identity of the versioned manifest projection');
  }

  return freezeData({ ...manifest, source, references, policy }, 'admitted Geofabrik acquisition manifest');
}

function assertValidSnapshotDate(value) {
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail('dated-url', 'source.datedUrl contains an invalid snapshot date');
  }
}
