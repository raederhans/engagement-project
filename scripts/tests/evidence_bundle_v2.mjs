#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createAnalysisRepository } from '../../src/analysis/analysis_repository.js';
import {
  canonicalSerialize,
  composeEvidenceBundle,
} from '../../src/analysis/evidence_bundle.js';
import {
  applyEvidenceBundleImport,
  previewEvidenceBundleImport,
} from '../../src/analysis/evidence_bundle_import.js';
import {
  buildEvidenceBundleV2Sections,
  composeEvidenceBundleV2,
  EVIDENCE_BUNDLE_PUBLIC_SCOPE,
  EVIDENCE_BUNDLE_V2_SCHEMA_VERSION,
  validateEvidenceBundleV2,
} from '../../src/analysis/evidence_bundle_v2.js';
import { createEvidenceBundleImportPreviewView } from '../../src/ui/evidence_bundle_import_preview.js';

const SOURCE_KEYS = new Set([
  'id', 'dataset', 'provider', 'canonicalUrl', 'status', 'coverage',
  'clocks', 'revisionPolicy', 'limitations',
]);
const SOURCE_STATUSES = new Set(['current', 'partial', 'stale', 'unavailable', 'unknown']);

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(new Set(Object.keys(value)), keys, `${label} exact keys`);
}

const sourceAdapter = Object.freeze({
  contractVersion: 'source-health-read-model/test-v1',
  validateSources(sources) {
    return sources.map((source) => {
      exactKeys(source, SOURCE_KEYS, 'source');
      exactKeys(source.coverage, new Set(['start', 'end']), 'source coverage');
      exactKeys(source.clocks, new Set(['sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt']), 'source clocks');
      assert.ok(SOURCE_STATUSES.has(source.status), 'source status');
      assert.match(source.coverage.start, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(source.coverage.end, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(source.coverage.start <= source.coverage.end, 'source coverage range');
      assert.ok(Array.isArray(source.limitations) && source.limitations.length > 0);
      return structuredClone(source);
    });
  },
  validateEvidenceAdmission({ sources, result: evidenceResult }) {
    if (sources.every((item) => item.status === 'unavailable')
      && evidenceResult.status !== 'unavailable') {
      throw new Error('unavailable sources cannot admit an available result');
    }
  },
  toArtifactProvenance(sources) {
    return {
      sources: sources.map((source) => source.id),
      coverage: {
        min: sources.map((source) => source.coverage.start).sort()[0],
        max: sources.map((source) => source.coverage.end).sort().at(-1),
      },
    };
  },
});

function source(overrides = {}) {
  return {
    id: 'philadelphia-reported-crime',
    dataset: 'incidents_part1_part2',
    provider: 'City of Philadelphia via CARTO',
    canonicalUrl: 'https://phl.carto.com/api/v2/sql',
    status: 'current',
    coverage: { start: '2006-01-01', end: '2026-07-30' },
    clocks: {
      sourceAsOf: '2026-07-30T00:00:00.000Z',
      retrievedAt: '2026-08-10T00:00:00.000Z',
      builtAt: null,
      observedAt: '2026-08-10T00:01:00.000Z',
    },
    revisionPolicy: 'Provider records may be revised after retrieval.',
    limitations: ['Historical reported records are not a complete measure of safety.'],
    ...overrides,
  };
}

function query(overrides = {}) {
  return {
    type: 'crime-analysis',
    timeRange: {
      start: '2025-08-01',
      endExclusive: '2026-08-01',
      timeZone: 'America/New_York',
    },
    offenseCodes: ['Thefts'],
    geography: { mode: 'district', districtCode: '01' },
    comparisonRequested: false,
    display: { adminLevel: 'districts', per10k: false },
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    status: 'available',
    comparison: {
      a: {
        point: 'A',
        status: 'available',
        total: 12,
        topOffenses: [{ offenseCode: 'Thefts', count: 8 }],
      },
    },
    ...overrides,
  };
}

function v2Input(overrides = {}) {
  const generatedAt = '2026-08-10T06:00:00.000Z';
  return {
    ...buildEvidenceBundleV2Sections({
      generatedAt,
      analysisGeneratedAt: '2026-08-10T05:30:00.000Z',
      query: query(),
      result: result(),
      sourceContractVersion: sourceAdapter.contractVersion,
      sourceReadModels: [source()],
      uncertainty: {
        status: 'partial',
        statements: ['Counts describe admitted aggregate records; no complete statistical interval is claimed.'],
      },
      limitations: [
        'This bundle is not real-time, predictive, a safety score, or a complete record.',
      ],
    }),
    ...overrides,
  };
}

function v1Source() {
  return {
    id: 'philadelphia-reported-crime',
    dataset: 'incidents_part1_part2',
    status: 'available',
    url: 'https://phl.carto.com/api/v2/sql',
    provider: 'City of Philadelphia via CARTO',
    vintage: '2026-07-30',
    asOf: '2026-07-30',
    retrievedAt: '2026-08-10T00:00:00.000Z',
    revisionPolicy: 'Provider records may be revised after retrieval.',
    coverage: { start: '2006-01-01', end: '2026-07-30', geography: 'Philadelphia' },
    snapshotIdentity: 'coverage:2006-01-01:2026-07-30',
  };
}

async function v1Bundle({ evidenceQuery = query(), evidenceSource = v1Source() } = {}) {
  return composeEvidenceBundle({
    schemaVersion: 'engagement-evidence-bundle/v1',
    generatedAt: '2026-08-10T00:00:00.000Z',
    query: evidenceQuery,
    result: result(),
    provenance: { sources: [evidenceSource] },
    limitations: ['Historical reported records are not a complete measure of safety.'],
    privacy: { mode: 'aggregate-only', excludedFields: ['raw incident rows', 'exact addresses'] },
  });
}

test('v2 writer round-trips canonical content and keeps source semantics behind the adapter', async () => {
  const bundle = await composeEvidenceBundleV2(v2Input(), { sourceAdapter });
  const read = await validateEvidenceBundleV2(JSON.parse(JSON.stringify(bundle)), { sourceAdapter });
  assert.equal(bundle.schemaVersion, EVIDENCE_BUNDLE_V2_SCHEMA_VERSION);
  assert.deepEqual(read, bundle);
  assert.equal(bundle.provenance.sources[0].status, 'current');
  assert.equal(bundle.checksums.algorithm, 'SHA-256');
  assert.match(bundle.checksums.content, /^[0-9a-f]{64}$/);
  assert.equal(bundle.snapshotIdentity, `sha256:${bundle.checksums.content}`);
  assert.equal(
    canonicalSerialize({ z: [2, { b: 1, a: 0 }], a: true }),
    canonicalSerialize({ a: true, z: [2, { a: 0, b: 1 }] }),
  );
});

test('v1 remains readable while v2 is the new writer contract', async () => {
  const legacy = await v1Bundle();
  const preview = await previewEvidenceBundleImport(JSON.stringify(legacy), {
    createId: () => 'import-v1',
    now: () => '2026-08-10T07:00:00.000Z',
  });
  assert.equal(preview.sourceMajor, 1);
  assert.equal(preview.recovery.status, 'ready');
  assert.equal(preview.recovery.artifactCount, 1);
  assert.equal(preview.summary.geographyMode, 'district');
});

test('v2 preview performs no write and explicit apply stores one artifact without a remote refresh', async () => {
  const rows = new Map();
  let atomicCalls = 0;
  const repository = createAnalysisRepository({
    adapter: {
      async put() { throw new Error('single put must not be used by import'); },
      async putManyAtomic(values) {
        atomicCalls += 1;
        for (const value of values) rows.set(value.id, structuredClone(value));
      },
      async get(id) { return rows.get(id) ?? null; },
      async getAll() { return [...rows.values()]; },
      async delete(id) { rows.delete(id); },
    },
  });
  const bundle = await composeEvidenceBundleV2(v2Input(), { sourceAdapter });
  const preview = await previewEvidenceBundleImport(JSON.stringify(bundle), {
    sourceAdapter,
    createId: () => 'import-v2',
    now: () => '2026-08-10T07:00:00.000Z',
  });
  assert.equal(rows.size, 0);
  assert.equal(atomicCalls, 0);
  assert.equal(preview.recovery.status, 'ready');
  const applied = await applyEvidenceBundleImport(preview, { repository });
  assert.deepEqual(applied, {
    status: 'applied', artifactCount: 1, artifactIds: ['import-v2'], remoteRefresh: false,
  });
  assert.equal(atomicCalls, 1);
  assert.equal(rows.get('import-v2').viewState.selectedDistrictCode, '01');
  assert.equal(rows.get('import-v2').resultSummary.generatedAt, '2026-08-10T05:30:00.000Z');
});

test('failed atomic apply rolls back and a failed preview never changes analysis storage', async () => {
  const rows = new Map([['existing', { preserved: true }]]);
  const repository = createAnalysisRepository({
    adapter: {
      async putManyAtomic(values) {
        const before = new Map(rows);
        try {
          rows.set(values[0].id, values[0]);
          throw new Error('simulated quota failure');
        } catch (error) {
          rows.clear();
          for (const [key, value] of before) rows.set(key, value);
          throw error;
        }
      },
    },
  });
  const bundle = await composeEvidenceBundleV2(v2Input(), { sourceAdapter });
  const preview = await previewEvidenceBundleImport(JSON.stringify(bundle), {
    sourceAdapter,
    createId: () => 'rolled-back',
    now: () => '2026-08-10T07:00:00.000Z',
  });
  await assert.rejects(applyEvidenceBundleImport(preview, { repository }), /quota/i);
  assert.deepEqual([...rows], [['existing', { preserved: true }]]);

  const tampered = structuredClone(bundle);
  tampered.result.comparison.a.total = 99;
  await assert.rejects(
    previewEvidenceBundleImport(JSON.stringify(tampered), { sourceAdapter }),
    /checksum mismatch/i,
  );
  const retimed = structuredClone(bundle);
  retimed.provenance.sources[0].clocks.retrievedAt = '2026-08-10T08:00:00.000Z';
  await assert.rejects(
    previewEvidenceBundleImport(JSON.stringify(retimed), { sourceAdapter }),
    /checksum mismatch/i,
  );
  assert.deepEqual([...rows], [['existing', { preserved: true }]]);
});

test('unknown versions, exact-key violations, size, scope, source, and time failures close before apply', async () => {
  const bundle = await composeEvidenceBundleV2(v2Input(), { sourceAdapter });
  await assert.rejects(
    previewEvidenceBundleImport('{"schemaVersion":"engagement-evidence-bundle/v3"}'),
    /unknown major version 3/i,
  );
  await assert.rejects(
    previewEvidenceBundleImport(JSON.stringify({ ...bundle, extra: true }), { sourceAdapter }),
    /extra.*not allowed|bundle\.extra/i,
  );
  await assert.rejects(
    previewEvidenceBundleImport(JSON.stringify(bundle), { sourceAdapter, maxBytes: 10 }),
    /size exceeds/i,
  );
  await assert.rejects(
    previewEvidenceBundleImport(JSON.stringify(bundle), {
      sourceAdapter,
      expectedScope: { ...EVIDENCE_BUNDLE_PUBLIC_SCOPE, geography: 'Elsewhere' },
    }),
    /scope conflict/i,
  );
  await assert.rejects(
    composeEvidenceBundleV2(v2Input({
      provenance: {
        sourceContractVersion: sourceAdapter.contractVersion,
        sources: [{ ...source(), extraStatus: 'invented' }],
      },
    }), { sourceAdapter }),
    /source contract|exact keys/i,
  );
  await assert.rejects(
    composeEvidenceBundleV2(v2Input({
      provenance: {
        sourceContractVersion: sourceAdapter.contractVersion,
        sources: [source({ status: 'unavailable' })],
      },
    }), { sourceAdapter }),
    /source\/result admission|unavailable sources/i,
  );
  await assert.rejects(
    composeEvidenceBundleV2(v2Input({ query: query({
      timeRange: {
        start: '2026-08-01', endExclusive: '2025-08-01', timeZone: 'America/New_York',
      },
    }) }), { sourceAdapter }),
    /time range/i,
  );
  const invalidLegacyWindow = await v1Bundle({ evidenceQuery: query({
    timeRange: {
      start: '2026-08-01', endExclusive: '2025-08-01', timeZone: 'America/New_York',
    },
  }) });
  await assert.rejects(
    previewEvidenceBundleImport(JSON.stringify(invalidLegacyWindow)),
    /invalid time range/i,
  );
  const invalidLegacyCoverage = await v1Bundle({ evidenceSource: v1Source() });
  invalidLegacyCoverage.provenance.sources[0].coverage = {
    start: '2026-08-01', end: '2025-08-01', geography: 'Philadelphia',
  };
  const rechecksummedLegacyCoverage = await composeEvidenceBundle({
    schemaVersion: invalidLegacyCoverage.schemaVersion,
    generatedAt: invalidLegacyCoverage.generatedAt,
    query: invalidLegacyCoverage.query,
    result: invalidLegacyCoverage.result,
    provenance: invalidLegacyCoverage.provenance,
    limitations: invalidLegacyCoverage.limitations,
    privacy: invalidLegacyCoverage.privacy,
  });
  await assert.rejects(
    previewEvidenceBundleImport(JSON.stringify(rechecksummedLegacyCoverage)),
    /coverage.*invalid time range/i,
  );
  await assert.rejects(
    composeEvidenceBundleV2(v2Input({ query: { ...query(), centerLonLat: [-75.1, 39.9] } }), { sourceAdapter }),
    /centerLonLat|prohibited sensitive field/i,
  );
});

test('privacy-excluded buffer selection previews truthfully but cannot be applied', async () => {
  const bundle = await composeEvidenceBundleV2(v2Input({ query: query({
    geography: { mode: 'buffer', radiusM: 400, exactSelection: 'omitted-for-privacy' },
  }) }), { sourceAdapter });
  const preview = await previewEvidenceBundleImport(JSON.stringify(bundle), { sourceAdapter });
  assert.deepEqual(preview.recovery, {
    status: 'not-recoverable',
    reason: 'exact-buffer-selection-was-excluded-for-privacy',
    artifactCount: 0,
  });
  await assert.rejects(applyEvidenceBundleImport(preview, { repository: {} }), /not recoverable/i);
  const exportedContent = structuredClone(bundle);
  delete exportedContent.privacy;
  assert.doesNotMatch(JSON.stringify(exportedContent), /1500 Market|centerLonLat|routeGeometry|gpsTrace/i);
});

class FakeElement extends EventTarget {
  constructor(tagName = '') {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.disabled = false;
    this.textContent = '';
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  focus() { globalThis.document.activeElement = this; }
}

function descendants(node) {
  return [node, ...node.children.flatMap(descendants)];
}

test('import preview view is text-first, keyboard-native, and independent from map runtime', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    activeElement: null,
    createElement: (tag) => new FakeElement(tag),
  };
  try {
    const mount = new FakeElement('main');
    let applied = null;
    const view = createEvidenceBundleImportPreviewView(mount, {
      copy: {
        heading: 'Import evidence bundle',
        description: 'Preview before applying public analysis state.',
        fileLabel: 'Bundle file',
        preview: 'Preview',
        apply: 'Apply',
        noFile: 'Choose a file.',
        ready: 'Ready to apply.',
        notRecoverable: 'This query cannot be reconstructed.',
        applied: 'Applied.',
        failed: 'Import failed',
        schemaLabel: 'Schema',
        geographyLabel: 'Geography',
        resultStatusLabel: 'Result status',
        sourceCountLabel: 'Sources',
        recoveryLabel: 'Recovery',
      },
      onPreview: async () => null,
      onApply: async (preview) => { applied = preview; },
    });
    const preview = {
      schemaVersion: EVIDENCE_BUNDLE_V2_SCHEMA_VERSION,
      summary: { geographyMode: 'district', resultStatus: 'available', sourceCount: 1 },
      recovery: { status: 'ready' },
    };
    view.setPreview(preview);
    const nodes = descendants(mount);
    const buttons = nodes.filter((node) => node.tagName === 'BUTTON');
    const input = nodes.find((node) => node.tagName === 'INPUT');
    const label = nodes.find((node) => node.tagName === 'LABEL');
    const status = nodes.find((node) => node.attributes.get('role') === 'status');
    assert.equal(buttons.length, 2);
    assert.ok(buttons.every((button) => button.type === 'button'));
    assert.equal(input.type, 'file');
    assert.equal(label.attributes.get('for'), input.id);
    assert.equal(status.attributes.get('aria-live'), 'polite');
    assert.equal(globalThis.document.activeElement, buttons[1], 'focus moves to explicit Apply action');
    buttons[1].dispatchEvent(new Event('click'));
    await Promise.resolve();
    assert.equal(applied, preview);
  } finally {
    globalThis.document = originalDocument;
  }
  const sourceText = await readFile(new URL('../../src/ui/evidence_bundle_import_preview.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sourceText, /(?:from|import\()\s*['"][^'"]*(?:maplibre|\/map\/)/i);
});
