export const PUBLIC_ROUTE_SCENARIO_ADMISSION_MANIFEST_SCHEMA =
  'engagement-public-route-scenario-admission/v1';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const PUBLIC_ROUTE_SCENARIO_ADMISSION_MANIFEST = deepFreeze({
  schemaVersion: PUBLIC_ROUTE_SCENARIO_ADMISSION_MANIFEST_SCHEMA,
  canonicalSha256: 'sha256:c3f052c82ed0a568a20e869de69ef8acca46a19e030ce05326c501b7d1d4ea36',
  identity: {
    artifactSchema: 'engagement-public-route-scenarios/v1',
    artifactId: 'philadelphia-public-landmark-walking-alternatives-2026-09-01',
    generatedAt: '2026-09-01T00:00:00.000Z',
    scenarios: [
      {
        scenarioId: 'city-hall-to-art-museum-complete',
        origin: 'philadelphia-city-hall',
        destination: 'philadelphia-museum-of-art',
        candidates: [
          { candidateId: 'cityhall-artmuseum-fast', edgeIds: ['ch-am-f-01', 'ch-am-f-02', 'ch-am-f-03'] },
          { candidateId: 'cityhall-artmuseum-lower-exposure', edgeIds: ['ch-am-l-01', 'ch-am-l-02', 'ch-am-l-03'] },
          { candidateId: 'cityhall-artmuseum-balanced', edgeIds: ['ch-am-b-01', 'ch-am-b-02', 'ch-am-b-03'] },
          { candidateId: 'cityhall-artmuseum-accessibility', edgeIds: ['ch-am-a-01', 'ch-am-a-02', 'ch-am-a-03'] },
        ],
      },
      {
        scenarioId: 'independence-hall-to-reading-terminal-single',
        origin: 'independence-hall',
        destination: 'reading-terminal-market',
        candidates: [
          { candidateId: 'independence-reading-only', edgeIds: ['ih-rt-01', 'ih-rt-02'] },
        ],
      },
      {
        scenarioId: 'rittenhouse-square-to-30th-street-degraded',
        origin: 'rittenhouse-square',
        destination: '30th-street-station',
        candidates: [
          { candidateId: 'rittenhouse-30th-ordinary', edgeIds: ['rs-30-a-01', 'rs-30-a-02'] },
          { candidateId: 'rittenhouse-30th-withheld', edgeIds: ['rs-30-b-01', 'rs-30-b-02'] },
        ],
      },
    ],
  },
});

function fail(message) {
  throw new TypeError(`public route scenarios contract: ${message}`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function canonicalSha256(value) {
  if (!globalThis.crypto?.subtle) fail('SHA-256 admission is unavailable');
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function assertPublicRouteArtifactManifest(raw) {
  const manifest = PUBLIC_ROUTE_SCENARIO_ADMISSION_MANIFEST;
  const identity = {
    artifactSchema: raw.schemaVersion,
    artifactId: raw.artifactId,
    generatedAt: raw.generatedAt,
    scenarios: raw.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      origin: scenario.origin.landmarkId,
      destination: scenario.destination.landmarkId,
      candidates: scenario.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        edgeIds: candidate.edgeIds,
      })),
    })),
  };
  if (canonicalJson(identity) !== canonicalJson(manifest.identity)) {
    fail('artifact identity does not match the admission manifest');
  }
  if (await canonicalSha256(raw) !== manifest.canonicalSha256) {
    fail('artifact content digest does not match the admission manifest');
  }
}
