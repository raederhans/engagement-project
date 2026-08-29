import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  KNOWN_ROUTE_CRASH_ACCESSIBILITY_EVIDENCE_SCHEMA,
  KNOWN_ROUTE_CRASH_ACCESSIBILITY_INPUT_SCHEMA,
  buildKnownRouteCrashAccessibilityEvidence,
  createKnownRouteSourceReceipt,
  loadKnownRouteCrashAccessibilityInput,
  serializeKnownRouteCrashAccessibilityEvidence,
  validateKnownRouteCrashAccessibilityEvidence,
  validateKnownRouteSourceReceipt,
  writeKnownRouteCrashAccessibilityEvidence,
} from '../lib/known_route_crash_accessibility_evidence.mjs';
import {
  main as cliMain,
  parseArguments,
} from '../build_known_route_crash_accessibility_evidence.mjs';

const ROUTE_IDENTITY = `sha256:${'1'.repeat(64)}`;
const CORRIDOR_IDENTITY = `sha256:${'2'.repeat(64)}`;
const PAYLOAD_SHA = Object.freeze({
  'raw-crash': `sha256:${'3'.repeat(64)}`,
  accessibility: `sha256:${'4'.repeat(64)}`,
  'hin-historical-planning': `sha256:${'5'.repeat(64)}`,
});
const CLOCKS = Object.freeze({
  source_as_of: '2026-08-01T00:00:00.000Z',
  retrieved_at: '2026-08-02T00:00:00.000Z',
  built_at: '2026-08-03T00:00:00.000Z',
  observed_at: '2026-08-04T00:00:00.000Z',
});
const COVERAGE = Object.freeze({
  status: 'complete',
  scope: 'bound-route-corridor',
  start: '2026-01-01T00:00:00.000Z',
  end_exclusive: '2026-08-01T00:00:00.000Z',
  verified: true,
});

test('published schema is closed and freezes aggregate-only authority boundaries', async () => {
  const schema = JSON.parse(await fs.readFile(new URL(
    '../data/known_route_crash_accessibility_evidence.schema.json',
    import.meta.url,
  )));
  assert.equal(schema.title, KNOWN_ROUTE_CRASH_ACCESSIBILITY_EVIDENCE_SCHEMA);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.authority.additionalProperties, false);
  assert.deepEqual(
    Object.values(schema.properties.authority.properties).map(({ const: value }) => value),
    [false, false, false, false],
  );
  assert.equal(schema.properties.privacy.properties.aggregate_only.const, true);
  assert.equal(schema.$defs.unavailableDimension.additionalProperties, false);
  assert.equal(Object.hasOwn(schema.$defs.unavailableDimension.properties, 'aggregate'), false);
  assert.equal(schema.$defs.zeroDimension.properties.aggregate.properties.count.const, 0);
});

test('healthy exact synthetic receipts admit zero only with complete verified exact coverage', () => {
  const evidence = buildEvidence();
  assert.equal(evidence.schema, KNOWN_ROUTE_CRASH_ACCESSIBILITY_EVIDENCE_SCHEMA);
  assert.equal(evidence.status, 'admitted-zero');
  assert.deepEqual(evidence.crash.aggregate, { count: 0 });
  assert.deepEqual(evidence.accessibility.aggregate, { count: 0 });
  assert.deepEqual(evidence.authority, {
    raw_crash: false, accessibility: false, routing: false, safety: false,
  });
  assert.equal(evidence.privacy.aggregate_only, true);
  assert.equal(validateKnownRouteCrashAccessibilityEvidence(evidence).semantic_identity, evidence.semantic_identity);
});

test('missing, duplicate, schema, hash, clock, coverage, and identity drift fail closed', () => {
  const raw = sourceReceipt('raw-crash');
  const accessibility = sourceReceipt('accessibility');
  assert.throws(
    () => buildEvidence({ receipts: [raw] }),
    /missing.*accessibility/i,
  );
  assert.throws(
    () => buildEvidence({ receipts: [raw, raw, accessibility] }),
    /duplicate/i,
  );

  const unknown = { ...structuredClone(raw), source_id: 'private-source-row-id' };
  assert.throws(() => validateKnownRouteSourceReceipt(unknown), /unknown or missing fields/i);

  const hashDrift = structuredClone(raw);
  hashDrift.sha256 = `sha256:${'9'.repeat(64)}`;
  assert.throws(() => validateKnownRouteSourceReceipt(hashDrift), /identity drifted/i);

  assert.throws(() => sourceReceipt('raw-crash', 'exact', {
    clocks: { ...CLOCKS, built_at: '2026-08-05T00:00:00.000Z' },
  }), /later than observed/i);
  assert.throws(() => sourceReceipt('raw-crash', 'exact', {
    coverage: { ...COVERAGE, verified: false },
  }), /schema validation|complete verified/i);

  assert.throws(() => buildKnownRouteCrashAccessibilityEvidence({
    schema: KNOWN_ROUTE_CRASH_ACCESSIBILITY_INPUT_SCHEMA,
    route_identity: `sha256:${'8'.repeat(64)}`,
    corridor_identity: CORRIDOR_IDENTITY,
    source_receipts: [raw, accessibility],
  }), /identity drifted/i);

  const evidence = structuredClone(buildEvidence());
  evidence.route_identity = `sha256:${'8'.repeat(64)}`;
  assert.throws(
    () => validateKnownRouteCrashAccessibilityEvidence(evidence),
    /binding drifted|identity drifted/i,
  );
});

test('unavailable is never zero and HIN remains partial historical planning context', () => {
  const unavailable = buildEvidence({
    receipts: [sourceReceipt('raw-crash', 'unavailable'), sourceReceipt('accessibility', 'unavailable')],
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.crash.status, 'unavailable');
  assert.equal(unavailable.accessibility.status, 'unavailable');
  assert.equal(Object.hasOwn(unavailable.crash, 'aggregate'), false);
  assert.equal(Object.hasOwn(unavailable.accessibility, 'aggregate'), false);
  assert.doesNotMatch(JSON.stringify(unavailable.crash), /"(?:aggregate|count|total|zero)"\s*:/i);

  const withHin = buildEvidence({
    receipts: [
      sourceReceipt('raw-crash', 'unavailable'),
      sourceReceipt('accessibility', 'unavailable'),
      sourceReceipt('hin-historical-planning', 'partial'),
    ],
  });
  assert.equal(withHin.status, 'partial');
  assert.equal(withHin.crash.status, 'partial');
  assert.equal(withHin.accessibility.status, 'unavailable');
  assert.equal(Object.hasOwn(withHin.crash, 'aggregate'), false);
  assert.match(withHin.crash.reason, /no raw crash aggregate/i);
  assert.equal(withHin.authority.raw_crash, false);
});

test('partial receipts cannot smuggle aggregates and admitted-zero cannot use generalized coverage', () => {
  const partial = structuredClone(sourceReceipt('raw-crash', 'partial'));
  partial.aggregate = { count: 0 };
  assert.throws(() => createKnownRouteSourceReceipt(partial), /unknown or missing fields|omit aggregate/i);

  assert.throws(() => sourceReceipt('accessibility', 'exact', {
    precision: { status: 'generalized', unit: 'street-block' },
  }), /schema validation|complete verified exact/i);

  const hostile = structuredClone(buildEvidence());
  hostile.crash.coverage.verified = false;
  assert.throws(
    () => validateKnownRouteCrashAccessibilityEvidence(hostile),
    /exact evidence boundary|status.*drifted/i,
  );
});

test('event rows, source record identifiers, coordinates, geometry, and addresses are rejected', () => {
  for (const [key, value] of [
    ['event_id', 'event-1'],
    ['source_id', 'row-1'],
    ['coordinates', [-75, 40]],
    ['geometry', { type: 'LineString' }],
    ['address', 'private'],
  ]) {
    const hostile = structuredClone(buildEvidence());
    hostile.crash[key] = value;
    assert.throws(
      () => validateKnownRouteCrashAccessibilityEvidence(hostile),
      /unknown or missing fields|aggregate-only privacy/i,
      key,
    );
  }
});

test('source ordering and semantic identity are stable across caller ordering', () => {
  const receipts = [
    sourceReceipt('hin-historical-planning', 'partial'),
    sourceReceipt('accessibility'),
    sourceReceipt('raw-crash'),
  ];
  const first = buildEvidence({ receipts });
  const second = buildEvidence({ receipts: [receipts[1], receipts[0], receipts[2]] });
  assert.deepEqual(first.source_receipts.map(({ role }) => role), [
    'raw-crash', 'accessibility', 'hin-historical-planning',
  ]);
  assert.equal(first.semantic_identity, second.semantic_identity);
  assert.equal(serializeKnownRouteCrashAccessibilityEvidence(first), serializeKnownRouteCrashAccessibilityEvidence(second));
});

test('exact input loader rejects file hash and closed-input drift', async (context) => {
  const workspace = await temporaryWorkspace(context);
  const inputPath = path.join(workspace, 'input.json');
  const input = inputFixture();
  const bytes = Buffer.from(`${JSON.stringify(input)}\n`);
  await fs.writeFile(inputPath, bytes);
  const expected = sha256(bytes);
  const loaded = await loadKnownRouteCrashAccessibilityInput(inputPath, expected);
  assert.equal(loaded.input_sha256, expected);
  assert.equal(loaded.evidence.status, 'admitted-zero');
  await assert.rejects(
    loadKnownRouteCrashAccessibilityInput(inputPath, `sha256:${'f'.repeat(64)}`),
    /SHA-256 mismatch/i,
  );
  await fs.writeFile(inputPath, JSON.stringify({ ...input, unexpected: true }));
  const drifted = await fs.readFile(inputPath);
  await assert.rejects(
    loadKnownRouteCrashAccessibilityInput(inputPath, sha256(drifted)),
    /unknown or missing fields/i,
  );
});

test('writer is atomic, byte-idempotent, no-overwrite, and preserves concurrent replacement', async (context) => {
  const workspace = await temporaryWorkspace(context);
  const evidence = buildEvidence();
  const first = await writeKnownRouteCrashAccessibilityEvidence('evidence.json', evidence, { workspace });
  assert.equal(first.status, 'published');
  const second = await writeKnownRouteCrashAccessibilityEvidence('evidence.json', evidence, { workspace });
  assert.equal(second.status, 'idempotent');

  const different = buildEvidence({ rawCount: 1 });
  await assert.rejects(
    writeKnownRouteCrashAccessibilityEvidence('evidence.json', different, { workspace }),
    /refusing overwrite/i,
  );

  const concurrentPath = path.join(workspace, 'concurrent.json');
  await assert.rejects(
    writeKnownRouteCrashAccessibilityEvidence('concurrent.json', evidence, {
      workspace,
      beforeLink: async () => fs.writeFile(concurrentPath, 'concurrent owner bytes\n', { flag: 'wx' }),
    }),
    /refusing overwrite/i,
  );
  assert.equal(await fs.readFile(concurrentPath, 'utf8'), 'concurrent owner bytes\n');
  assert.deepEqual((await fs.readdir(workspace)).filter((name) => name.endsWith('.tmp')), []);
});

test('cleanup failure is visible, including alongside a concurrent publication failure', async (context) => {
  const workspace = await temporaryWorkspace(context);
  const evidence = buildEvidence();
  const cleanupFailureFs = {
    ...fs,
    async rm() {
      throw new Error('synthetic cleanup failure');
    },
  };
  await assert.rejects(
    writeKnownRouteCrashAccessibilityEvidence('cleanup.json', evidence, {
      workspace,
      fileSystem: cleanupFailureFs,
    }),
    (error) => error instanceof AggregateError && /cleanup failed/i.test(error.message),
  );
  assert.equal(await fs.readFile(path.join(workspace, 'cleanup.json'), 'utf8'),
    serializeKnownRouteCrashAccessibilityEvidence(evidence));

  const target = path.join(workspace, 'both.json');
  await assert.rejects(
    writeKnownRouteCrashAccessibilityEvidence('both.json', evidence, {
      workspace,
      fileSystem: cleanupFailureFs,
      beforeLink: async () => fs.writeFile(target, 'concurrent bytes\n', { flag: 'wx' }),
    }),
    (error) => error instanceof AggregateError && error.errors.length === 2,
  );
  assert.equal(await fs.readFile(target, 'utf8'), 'concurrent bytes\n');
});

test('thin CLI parses strict options and reports an idempotent exact-input build', async (context) => {
  assert.deepEqual(parseArguments([
    '--input=in.json', '--expected-input-sha256', `sha256:${'a'.repeat(64)}`,
    '--output', 'out.json',
  ]), {
    inputPath: 'in.json',
    expectedInputSha256: `sha256:${'a'.repeat(64)}`,
    outputPath: 'out.json',
  });
  assert.throws(() => parseArguments(['--unknown', 'x']), /unknown option/i);

  const workspace = await temporaryWorkspace(context);
  const inputPath = path.join(workspace, 'input.json');
  const bytes = Buffer.from(`${JSON.stringify(inputFixture())}\n`);
  await fs.writeFile(inputPath, bytes);
  const output = [];
  const errors = [];
  const args = [
    '--input', inputPath,
    '--expected-input-sha256', sha256(bytes),
    '--output', 'result.json',
    '--workspace', workspace,
  ];
  const first = await cliMain(args, {
    stdout: { write: (value) => output.push(value) },
    stderr: { write: (value) => errors.push(value) },
  });
  const second = await cliMain(args, {
    stdout: { write: (value) => output.push(value) },
    stderr: { write: (value) => errors.push(value) },
  });
  assert.equal(first.status, 'published');
  assert.equal(second.status, 'idempotent');
  assert.equal(errors.length, 0);
});

function buildEvidence({ receipts, rawCount = 0, accessibilityCount = 0 } = {}) {
  return buildKnownRouteCrashAccessibilityEvidence({
    schema: KNOWN_ROUTE_CRASH_ACCESSIBILITY_INPUT_SCHEMA,
    route_identity: ROUTE_IDENTITY,
    corridor_identity: CORRIDOR_IDENTITY,
    source_receipts: receipts || [
      sourceReceipt('raw-crash', 'exact', { count: rawCount }),
      sourceReceipt('accessibility', 'exact', { count: accessibilityCount }),
    ],
  });
}

function inputFixture() {
  return {
    schema: KNOWN_ROUTE_CRASH_ACCESSIBILITY_INPUT_SCHEMA,
    route_identity: ROUTE_IDENTITY,
    corridor_identity: CORRIDOR_IDENTITY,
    source_receipts: [sourceReceipt('raw-crash'), sourceReceipt('accessibility')],
  };
}

function sourceReceipt(role, status = 'exact', overrides = {}) {
  const unavailable = status === 'unavailable';
  const partial = status === 'partial';
  const schema = role === 'hin-historical-planning'
    ? 'phl-hin-2025-receipt/v1'
    : role === 'raw-crash' ? 'official-raw-crash-receipt/v1' : 'official-accessibility-receipt/v1';
  const value = {
    schema,
    role,
    sha256: PAYLOAD_SHA[role],
    version: role === 'hin-historical-planning' ? '2025 historical network' : 'synthetic-v1',
    status,
    reason: role === 'hin-historical-planning'
      ? 'HIN is partial historical planning context only.'
      : unavailable ? `Official ${role} payload is unavailable.`
        : partial ? `Official ${role} coverage is partial.`
          : `Official ${role} payload has exact complete verified corridor coverage.`,
    route_identity: ROUTE_IDENTITY,
    corridor_identity: CORRIDOR_IDENTITY,
    clocks: unavailable
      ? { source_as_of: null, retrieved_at: null, built_at: null, observed_at: CLOCKS.observed_at }
      : role === 'hin-historical-planning'
        ? { ...CLOCKS, built_at: null }
        : { ...CLOCKS },
    coverage: unavailable
      ? {
        status: 'unavailable', scope: 'bound-route-corridor', start: null,
        end_exclusive: null, verified: false,
      }
      : partial
        ? { ...COVERAGE, status: 'partial', verified: false }
        : { ...COVERAGE },
    precision: unavailable
      ? { status: 'unavailable', unit: null }
      : partial
        ? { status: 'generalized', unit: role === 'hin-historical-planning' ? 'historical-network' : 'street-block' }
        : { status: 'exact', unit: 'bound-route-corridor' },
    ...(status === 'exact' ? { aggregate: { count: overrides.count ?? 0 } } : {}),
    ...structuredClone(overrides),
  };
  delete value.count;
  return createKnownRouteSourceReceipt(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function temporaryWorkspace(context) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'known-route-crash-accessibility-'));
  context.after(() => fs.rm(workspace, { recursive: true, force: true }));
  return workspace;
}
