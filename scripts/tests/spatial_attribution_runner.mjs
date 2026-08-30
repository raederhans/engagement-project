import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArguments, main } from '../build_spatial_attribution_evidence.mjs';
import { partitionForSourceId } from '../lib/crime_event_source.mjs';
import { SPATIAL_ATTRIBUTION_METHOD_CONFIGS } from '../lib/spatial_attribution_methods.mjs';
import {
  runSpatialAttributionEvidence,
  SPATIAL_ATTRIBUTION_BUNDLE_SCHEMA,
} from '../lib/spatial_attribution_runner.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const protocolTemplate = JSON.parse(await fs.readFile(
  path.join(repoRoot, 'scripts/data/spatial_attribution_protocol.v2.json'),
  'utf8',
));

test('single validated stream publishes a deterministic aggregate-only bundle', async (t) => {
  const fixture = await createFixture(t);
  const firstRuntime = fixture.runtime();
  const first = await runSpatialAttributionEvidence(fixture.options('run-a'), firstRuntime);

  assert.equal(firstRuntime.calls.mart, 1);
  assert.equal(firstRuntime.calls.warehouse, 1);
  assert.equal(firstRuntime.calls.callback, 3);
  assert.equal(first.manifest.schema, SPATIAL_ATTRIBUTION_BUNDLE_SCHEMA);
  assert.deepEqual(first.manifest.authority, {
    serving: false,
    forecast: false,
    promotion: false,
    scientific: false,
    causal: false,
    safety: false,
  });
  assert.deepEqual((await fs.readdir(first.outputRoot)).sort(), [
    'denominator-audit.json',
    'manifest.json',
    'method-comparison.json',
    'report.json',
  ]);
  const comparison = await readJson(path.join(first.outputRoot, 'method-comparison.json'));
  for (const method of comparison.methods.filter(({ method }) => ['fractional', 'area-kernel'].includes(method))) {
    assert.equal(method.availability, 'unavailable');
    assert.equal(method.unavailable_reason, 'uncertainty-footprint-artifact-unavailable');
    assert.equal(method.weighted_mass, null);
  }
  const serializedArtifacts = (await Promise.all([
    'denominator-audit.json', 'method-comparison.json', 'report.json', 'manifest.json',
  ].map((name) => fs.readFile(path.join(first.outputRoot, name), 'utf8')))).join('\n');
  for (const forbiddenKey of [
    'canonical_event', 'source_record_id', 'source_ids', 'location_block', 'coordinates', 'raw_dimensions',
  ]) {
    assert.doesNotMatch(serializedArtifacts, new RegExp(`"${forbiddenKey}"\\s*:`));
  }

  const secondRuntime = fixture.runtime();
  const second = await runSpatialAttributionEvidence(fixture.options('run-b'), secondRuntime);
  for (const name of ['denominator-audit.json', 'method-comparison.json', 'report.json', 'manifest.json']) {
    assert.deepEqual(
      await fs.readFile(path.join(first.outputRoot, name)),
      await fs.readFile(path.join(second.outputRoot, name)),
      name,
    );
  }
  await assert.rejects(
    runSpatialAttributionEvidence(fixture.options('run-a'), fixture.runtime()),
    /already exists/,
  );
});

test('late receipt drift and all exact identity drift fail before publication', async (t) => {
  const fixture = await createFixture(t);

  const late = fixture.runtime({ lateFailure: new Error('late receipt drift') });
  await assert.rejects(runSpatialAttributionEvidence(fixture.options('late'), late), /late receipt drift/);
  assert.equal(late.calls.callback, 3, 'tentative callbacks happened before the late global failure');
  assert.equal(await exists(path.join(fixture.root, 'late')), false);
  assert.deepEqual(
    (await fs.readdir(fixture.root)).filter((name) => name.includes('spatial-attribution-staging')),
    [],
  );

  await t.test('protocol method identity drift', async () => {
    const protocol = structuredClone(fixture.protocol);
    protocol.methods[0].method_identity = digest('wrong-method');
    const protocolPath = path.join(fixture.root, 'method-drift.json');
    await fs.writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
    await assert.rejects(
      runSpatialAttributionEvidence({ ...fixture.options('method-drift'), protocolPath }, fixture.runtime()),
      /method identity drifted/,
    );
  });

  for (const [name, mutate] of [
    ['grid cell size drift', (protocol) => { protocol.methods[1].cell_size_m = 1000; }],
    ['ACS threshold drift', (protocol) => {
      protocol.strata.acs_population_bands.low.upper_exclusive = 3000;
    }],
    ['source join key drift', (protocol) => {
      protocol.strata.source_dimension_join.key[1] = 'canonical.source_record_id';
    }],
  ]) {
    await t.test(name, async () => {
      const protocol = structuredClone(fixture.protocol);
      mutate(protocol);
      const protocolPath = path.join(fixture.root, `${name.replaceAll(' ', '-')}.json`);
      await fs.writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
      const runtime = fixture.runtime();
      await assert.rejects(
        runSpatialAttributionEvidence({ ...fixture.options(name), protocolPath }, runtime),
        /protocol .* (identity drifted|vocabulary is invalid)/i,
      );
      assert.equal(runtime.calls.mart, 0);
      assert.equal(runtime.calls.warehouse, 0);
    });
  }

  await t.test('M2 identity drift', async () => {
    const runtime = fixture.runtime();
    runtime.validateMart = async () => {
      runtime.calls.mart += 1;
      const gate = fixture.martGate();
      gate.martInventory.part_bindings_identity = digest('wrong-m2-parts');
      return gate;
    };
    await assert.rejects(
      runSpatialAttributionEvidence(fixture.options('m2-drift'), runtime),
      /M2 mart drifted/,
    );
  });

  await t.test('M1 receipt identity drift', async () => {
    const runtime = fixture.runtime({ receiptIdentity: digest('wrong-m1-receipt') });
    await assert.rejects(
      runSpatialAttributionEvidence(fixture.options('m1-drift'), runtime),
      /M1 receipt drifted/,
    );
    assert.equal(await exists(path.join(fixture.root, 'm1-drift')), false);
  });
});

test('nonzero canonical exclusions are audited but never sent to method accumulation', async (t) => {
  const fixture = await createFixture(t, { withExclusions: true });
  const runtime = fixture.runtime();
  const result = await runSpatialAttributionEvidence(fixture.options('nonzero'), runtime);
  assert.equal(runtime.calls.callback, 5);
  assert.equal(result.manifest.exact_input.m2.admission.non_active, 1);
  assert.equal(result.manifest.exact_input.m2.admission.unknown_category, 1);
  const audit = await readJson(path.join(result.outputRoot, 'denominator-audit.json'));
  const comparison = await readJson(path.join(result.outputRoot, 'method-comparison.json'));
  const report = await readJson(path.join(result.outputRoot, 'report.json'));
  assert.equal(audit.canonical_denominator.total, 5);
  assert.equal(audit.analysis_eligible_denominator.total, 3);
  assert.deepEqual(audit.analysis_eligible_denominator.exclusions, {
    non_active: 1,
    invalid_event_time: 0,
    unknown_category: 1,
  });
  assert.equal(comparison.input_rows, 3);
  assert.equal(report.canonical_denominator.total, 5);
  assert.equal(report.analysis_eligible_denominator.total, 3);
});

test('CLI requires exactly five explicit paths and emits structured JSON', async () => {
  assert.deepEqual(parseArguments([
    '--warehouse-root=w', '--mart-root', 'm', '--output-root=o',
    '--protocol', 'p', '--evaluation-protocol=e',
  ]), {
    warehouseRoot: 'w',
    martRoot: 'm',
    outputRoot: 'o',
    protocolPath: 'p',
    evaluationProtocolPath: 'e',
  });
  assert.throws(() => parseArguments(['--wat=x']), /Unknown/);
  assert.throws(() => parseArguments([
    '--warehouse-root=w', '--warehouse-root=x', '--mart-root=m', '--output-root=o',
    '--protocol=p', '--evaluation-protocol=e',
  ]), /Duplicate/);
  assert.throws(() => parseArguments(['--warehouse-root=w']), /Missing required/);

  let stdout = '';
  let stderr = '';
  await main([
    '--warehouse-root=w', '--mart-root=m', '--output-root=o',
    '--protocol=p', '--evaluation-protocol=e',
  ], {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    run: async () => ({
      outputRoot: 'o',
      manifest: { bundle_identity: digest('bundle') },
    }),
  });
  assert.deepEqual(JSON.parse(stdout), {
    status: 'complete', output_root: 'o', bundle_identity: digest('bundle'),
  });
  assert.equal(stderr, '');

  stdout = '';
  await main(['--unknown=x'], {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    rethrow: false,
  });
  assert.equal(stdout, '');
  assert.deepEqual(JSON.parse(stderr), {
    status: 'error',
    error: {
      code: 'SPATIAL_ATTRIBUTION_INVALID_ARGUMENT',
      message: 'Unknown spatial attribution option: --unknown',
    },
  });

  stderr = '';
  await main([
    '--warehouse-root=w', '--mart-root=m', '--output-root=o',
    '--protocol=p', '--evaluation-protocol=e',
  ], {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    run: async () => {
      throw new Error('Canonical cartodb:123 coordinate rejected at source_record_id');
    },
    rethrow: false,
  });
  assert.deepEqual(JSON.parse(stderr), {
    status: 'error',
    error: {
      code: 'SPATIAL_ATTRIBUTION_BUILD_FAILED',
      message: 'Spatial attribution evidence build failed.',
    },
  });
  assert.doesNotMatch(stderr, /cartodb:123|coordinate|source_record_id/i);
});

async function createFixture(t, { withExclusions = false } = {}) {
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1/spatial-runner-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const rows = canonicalRows(withExclusions);
  const protocol = fixtureProtocol(rows.length, admission(withExclusions));
  const protocolPath = path.join(root, 'protocol.json');
  await fs.writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  const evaluationProtocolPath = path.join(root, 'evaluation-protocol.json');
  await fs.writeFile(evaluationProtocolPath, '{}\n');
  return {
    root,
    rows,
    protocol,
    protocolPath,
    evaluationProtocolPath,
    options(name) {
      return {
        warehouseRoot: path.join(root, 'warehouse-input'),
        martRoot: path.join(root, 'mart-input'),
        outputRoot: path.join(root, name),
        protocolPath,
        evaluationProtocolPath,
      };
    },
    martGate: () => martGate(protocol),
    runtime(overrides = {}) {
      const calls = { mart: 0, warehouse: 0, callback: 0 };
      return {
        calls,
        workspaceRoot: repoRoot,
        randomId: () => 'fixture-id',
        validateMart: async () => {
          calls.mart += 1;
          return martGate(protocol);
        },
        consumeWarehouse: async (_root, { accumulateCanonicalEvent }) => {
          calls.warehouse += 1;
          for (const payload of rows) {
            calls.callback += 1;
            accumulateCanonicalEvent(payload);
          }
          if (overrides.lateFailure) throw overrides.lateFailure;
          return admittedReceipt(protocol, overrides.receiptIdentity);
        },
      };
    },
  };
}

function fixtureProtocol(canonicalRows, admissionValue) {
  const value = structuredClone(protocolTemplate);
  value.exact_input_gate.m1 = {
    receipt_schema: 'engagement-phl-crime-warehouse-receipt/v3',
    receipt_identity: digest('m1-receipt'),
    receipt_sha256: digest('m1-receipt-bytes'),
    warehouse_schema: 'engagement-phl-crime-event-warehouse/v1',
    warehouse_current_snapshot_id: digest('m1-current-snapshot'),
    canonical: {
      partition_count: 2,
      row_count: canonicalRows,
      bytes: canonicalRows * 100,
      sha256: digest('m1-canonical'),
    },
  };
  value.exact_input_gate.m2 = {
    evaluation_protocol: {
      schema: 'engagement-area-intelligence-evaluation-protocol/v2',
      sha256: digest('evaluation-protocol'),
    },
    mart_schema: 'engagement-area-intelligence-feature-mart/v2',
    manifest_sha256: digest('m2-manifest'),
    artifact_identity: digest('m2-artifact'),
    part_bindings_identity: digest('m2-parts'),
    part_count: 2,
    row_count: 6,
    bytes: 600,
    admission: structuredClone(admissionValue),
  };
  value.methods = SPATIAL_ATTRIBUTION_METHOD_CONFIGS.map((config, index) => ({
    ...value.methods[index],
    id: config.method,
    version: config.method_version,
    method_identity: config.method_identity,
    config_identity: config.config_identity,
  }));
  return value;
}

function martGate(protocol) {
  const manifestBytes = protocol.exact_input_gate.m2.manifest_sha256.slice('sha256:'.length);
  const evaluationBytes = protocol.exact_input_gate.m2.evaluation_protocol.sha256.slice('sha256:'.length);
  return {
    protocol: { schema: 'engagement-area-intelligence-evaluation-protocol/v2' },
    protocolIdentity: evaluationBytes,
    martManifestIdentity: manifestBytes,
    martManifest: {
      schema: 'engagement-area-intelligence-feature-mart/v2',
      artifact_identity: digest('m2-artifact'),
      admission: structuredClone(protocol.exact_input_gate.m2.admission),
      artifact_policy: { event_level_data_included: false },
    },
    martInventory: {
      part_bindings_identity: digest('m2-parts'),
      parts: [{ path: 'marts/tract/part-000.jsonl' }, { path: 'marts/fixed-grid/part-000.jsonl' }],
      row_count: 6,
      bytes: 600,
    },
  };
}

function admittedReceipt(protocol, receiptIdentity = undefined) {
  const m1 = protocol.exact_input_gate.m1;
  return {
    bytes: 123,
    sha256: m1.receipt_sha256,
    receipt: {
      schema: m1.receipt_schema,
      identity: receiptIdentity || m1.receipt_identity,
      warehouse: {
        schema: m1.warehouse_schema,
        current_snapshot_id: m1.warehouse_current_snapshot_id,
      },
      counts: { canonical_rows: m1.canonical.row_count },
      artifacts: { canonical: structuredClone(m1.canonical) },
    },
  };
}

function admission(withExclusions = false) {
  return {
    canonical_rows_seen: withExclusions ? 5 : 3,
    tract: { admitted: 1, ambiguous_excluded: 1, unmapped_excluded: 1 },
    'fixed-grid': { admitted: 2, unavailable_excluded: 1 },
    unknown_category: withExclusions ? 1 : 0,
    invalid_event_time: 0,
    non_active: withExclusions ? 1 : 0,
  };
}

function canonicalRows(withExclusions = false) {
  const snapshotId = digest('snapshot');
  const rows = [
    payload(1, snapshotId, mappedTract('42101000101'), mappedGrid('epsg3857-500m:-1:1')),
    payload(2, snapshotId, ambiguousTract(), mappedGrid('epsg3857-500m:-2:1')),
    payload(3, snapshotId, unmappedTract(), unavailableGrid()),
  ];
  if (withExclusions) {
    rows.push(
      payload(4, snapshotId, mappedTract('42101000101'), mappedGrid('epsg3857-500m:-1:1'), {
        lifecycle: 'removal-candidate',
      }),
      payload(5, snapshotId, mappedTract('42101000101'), mappedGrid('epsg3857-500m:-1:1'), {
        categoryStatus: 'unknown',
        themeId: null,
      }),
    );
  }
  return rows.sort((left, right) => {
    const leftId = Number(left.canonical_event.source_ids.cartodb_id);
    const rightId = Number(right.canonical_event.source_ids.cartodb_id);
    return partitionForSourceId(leftId, 2) - partitionForSourceId(rightId, 2) || leftId - rightId;
  });
}

function payload(id, snapshotId, tract, grid, {
  lifecycle = 'active',
  categoryStatus = 'mapped',
  themeId = 'person',
} = {}) {
  return {
    canonical_event: {
      source_record_id: `cartodb:${id}`,
      source_ids: { cartodb_id: String(id) },
      event_at: '2024-01-01T12:00:00.000Z',
      lifecycle: { state: lifecycle },
      normalized_category: { status: categoryStatus, theme_id: themeId },
      spatial: { tract, grid },
      acs: {
        status: 'available',
        valueStatus: 'available',
        temporalAlignment: 'within-acs-period',
        modelInputEligible: true,
        estimate: { value: 2000 },
      },
      lineage: { source_snapshot_id: snapshotId },
    },
    raw_dimensions: {
      source_snapshot_id: snapshotId,
      dc_dist: '01',
      psa: '1',
      location_block_available: false,
    },
  };
}

function mappedTract(geoid) {
  return { status: 'mapped', geoid, candidates: [geoid], reason: null };
}

function ambiguousTract() {
  return {
    status: 'ambiguous', geoid: null, candidates: ['42101000101', '42101000102'],
    reason: 'point-on-or-across-tract-boundary',
  };
}

function unmappedTract() {
  return {
    status: 'unmapped', geoid: null, candidates: [],
    reason: 'point-outside-admitted-tract-geometries',
  };
}

function mappedGrid(gridId) {
  return {
    status: 'mapped', scheme: 'epsg3857-square-grid-v1', projectedCellSizeM: 500,
    gridId, reason: null,
  };
}

function unavailableGrid() {
  return {
    status: 'unavailable', scheme: 'epsg3857-square-grid-v1', projectedCellSizeM: 500,
    gridId: null, reason: 'coordinate-missing',
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function exists(target) {
  return fs.access(target).then(() => true, () => false);
}
