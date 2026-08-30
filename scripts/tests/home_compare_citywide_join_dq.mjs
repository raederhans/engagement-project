import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildHomeCompareCitywideSourceLifecycle } from '../lib/home_compare_citywide_source_lifecycle.mjs';
import {
  buildHomeCompareCitywideJoinDq,
  HOME_COMPARE_CITYWIDE_JOIN_DQ_SCHEMA,
  loadHomeCompareCitywideJoinDqInput,
  validateHomeCompareCitywideJoinDq,
  writeHomeCompareCitywideJoinDq,
} from '../lib/home_compare_citywide_join_dq.mjs';

const registryText = await fs.readFile(new URL('../../public/data/home_compare_sources.v1.json', import.meta.url));
const registry = JSON.parse(registryText);
const GENERATED_AT = '2026-08-30T04:00:00.000Z';

test('strict schema fixes stable nine-dimension aggregate-only ordering', () => {
  const ledger = buildFixtureLedger();
  assert.equal(ledger.schema, HOME_COMPARE_CITYWIDE_JOIN_DQ_SCHEMA);
  assert.deepEqual(ledger.dimensions.map(({ dimension }) => dimension), [
    'geocoder_address_resolution', 'property_current_assessment', 'assessment_history',
    'transfers', 'requests_311', 'li_property_history', 'vacancy',
    'reported_incidents', 'hin_road_context',
  ]);
  assert.equal(new Set(ledger.dimensions.map(({ identity }) => identity)).size, 9);
  assert.deepEqual(validateHomeCompareCitywideJoinDq(ledger), ledger);
  const unknown = structuredClone(ledger);
  unknown.extra = true;
  assert.throws(() => validateHomeCompareCitywideJoinDq(unknown), /unknown or missing fields/i);
});

test('identity binds lifecycle identity, exact file SHA, bytes, and each source receipt independently', () => {
  const first = fixtureInput();
  const second = fixtureInput({ m1Identity: identityOf('different-synthetic-m1-receipt') });
  const firstLedger = buildHomeCompareCitywideJoinDq(first);
  const secondLedger = buildHomeCompareCitywideJoinDq(second);
  assert.notEqual(first.lifecycle.identity, second.lifecycle.identity);
  assert.notEqual(firstLedger.identity, secondLedger.identity);
  assert.notEqual(
    dimension(firstLedger, 'reported_incidents').required_source_receipt_identities[0],
    dimension(secondLedger, 'reported_incidents').required_source_receipt_identities[0],
  );
  assert.notEqual(buildHomeCompareCitywideJoinDq({ ...first, sha256: identityOf('different-file') }).identity, firstLedger.identity);
});

test('missing, partial, and unavailable receipts fail closed without rows, values, totals, or zero claims', () => {
  const ledger = buildFixtureLedger();
  for (const item of ledger.dimensions) {
    assert.equal(item.row_availability, 'unavailable');
    assert.equal(item.value_availability, 'unavailable');
    assert.equal(item.total, null);
    assert.equal(item.available_zero, false);
  }
  assert.equal(dimension(ledger, 'geocoder_address_resolution').source_readiness, 'unavailable');
  assert.equal(dimension(ledger, 'geocoder_address_resolution').join_status, 'unavailable');
  assert.equal(dimension(ledger, 'property_current_assessment').source_readiness, 'partial');
  assert.equal(dimension(ledger, 'reported_incidents').source_readiness, 'exact-receipt-ready');
  const hostile = structuredClone(ledger);
  hostile.dimensions[1].total = 0;
  assert.throws(() => validateHomeCompareCitywideJoinDq(hostile), /identity drifted|conflates/i);
  const missingReceipt = fixtureInput();
  missingReceipt.lifecycle.receipts.pop();
  assert.throws(() => buildHomeCompareCitywideJoinDq(missingReceipt), /schema validation failed|complete ordered nine-source/i);
});

test('PPD only reuses exact M1 receipt readiness and HIN legacy partial cannot become safety evidence', () => {
  const ledger = buildFixtureLedger();
  const ppd = dimension(ledger, 'reported_incidents');
  const hin = dimension(ledger, 'hin_road_context');
  assert.equal(ppd.source_readiness, 'exact-receipt-ready');
  assert.match(ppd.reason, /no event payload, private address join key, coverage, or parcel authority/i);
  assert.equal(hin.source_readiness, 'partial');
  assert.match(hin.reason, /no raw crash, current safety, private join, or routing authority/i);
});

test('deep privacy and decision field scan rejects address, source rows, scores, winners, and routing', () => {
  const ledger = buildFixtureLedger();
  for (const [key, value] of [['address', 'x'], ['source_id', 'x'], ['score', 1], ['winner', true], ['routing', true], ['travel_time', 5]]) {
    const hostile = structuredClone(ledger);
    hostile.dimensions[0][key] = value;
    assert.throws(() => validateHomeCompareCitywideJoinDq(hostile), /unknown or missing fields|forbidden/i);
  }
  const serialized = JSON.stringify(ledger);
  assert.doesNotMatch(serialized, /"(?:address|normalized_address|coordinates|parcel_id|source_id|score|winner|routing|travel_time)"\s*:/i);
});

test('loader requires strict lifecycle identity and exact bytes before admitting input', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'home-compare-join-dq-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = fixtureInput();
  const lifecyclePath = path.join(directory, 'synthetic.lifecycle.json');
  const content = Buffer.from(`${JSON.stringify(input.lifecycle)}\n`);
  await fs.writeFile(lifecyclePath, content);
  const loaded = await loadHomeCompareCitywideJoinDqInput({
    lifecyclePath, expectedLifecycleIdentity: input.lifecycle.identity, expectedLifecycleSha256: sha256(content),
  });
  assert.equal(loaded.bytes, content.length);
  await fs.appendFile(lifecyclePath, ' ');
  await assert.rejects(loadHomeCompareCitywideJoinDqInput({
    lifecyclePath, expectedLifecycleIdentity: input.lifecycle.identity, expectedLifecycleSha256: sha256(content),
  }), /exact file SHA/i);
  await assert.rejects(loadHomeCompareCitywideJoinDqInput({
    lifecyclePath, expectedLifecycleIdentity: identityOf('drift'), expectedLifecycleSha256: sha256(await fs.readFile(lifecyclePath)),
  }), /expected lifecycle identity/i);
});

test('writer is task-owned, atomic, idempotent, and refuses differing output', async (context) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'home-compare-join-dq-output-'));
  context.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const ledger = buildFixtureLedger();
  const output = '.dfev1/home-compare-p5/join-dq.json';
  const first = await writeHomeCompareCitywideJoinDq(output, ledger, { workspace });
  const second = await writeHomeCompareCitywideJoinDq(output, ledger, { workspace });
  assert.equal(first.status, 'published');
  assert.equal(second.status, 'idempotent');
  assert.deepEqual(
    await fs.readdir(path.dirname(first.outputPath)),
    ['join-dq.json'],
    'successful publication leaves no staging residue',
  );
  await assert.rejects(writeHomeCompareCitywideJoinDq(output, buildHomeCompareCitywideJoinDq(fixtureInput({ m1Identity: identityOf('changed') })), { workspace }), /refusing overwrite/i);
  await assert.rejects(writeHomeCompareCitywideJoinDq('outside.json', ledger, { workspace }), /task-owned \.dfev1/i);
});

test('join DQ writer rejects concurrent replacement and surfaces staging cleanup failure', async (context) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'home-compare-join-dq-race-'));
  context.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const firstLedger = buildFixtureLedger();
  const secondLedger = buildHomeCompareCitywideJoinDq(fixtureInput({
    m1Identity: identityOf('changed-concurrent-m1'),
  }));
  const raceOutput = '.dfev1/home-compare-p5/race.json';
  const outcomes = await Promise.allSettled([
    writeHomeCompareCitywideJoinDq(raceOutput, firstLedger, { workspace }),
    writeHomeCompareCitywideJoinDq(raceOutput, secondLedger, { workspace }),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(({ status }) => status === 'rejected').length, 1);
  assert.match(outcomes.find(({ status }) => status === 'rejected').reason.message, /refusing overwrite/i);
  assert.deepEqual(
    await fs.readdir(path.join(workspace, '.dfev1/home-compare-p5')),
    ['race.json'],
  );

  const fileSystem = {
    ...fs,
    async rm(target, options) {
      if (String(target).endsWith('.tmp')) throw new Error('synthetic join DQ cleanup failure');
      return fs.rm(target, options);
    },
  };
  await assert.rejects(
    writeHomeCompareCitywideJoinDq(
      '.dfev1/home-compare-p5/cleanup.json',
      firstLedger,
      { workspace, fileSystem },
    ),
    /join DQ cleanup failure/i,
  );
  assert.ok(
    (await fs.readdir(path.join(workspace, '.dfev1/home-compare-p5')))
      .some((name) => name.endsWith('.tmp')),
  );
});

function buildFixtureLedger() { return buildHomeCompareCitywideJoinDq(fixtureInput()); }

function fixtureInput({ m1Identity = identityOf('synthetic-m1-receipt') } = {}) {
  const lifecycle = buildHomeCompareCitywideSourceLifecycle({
    registry: { value: structuredClone(registry), sha256: sha256(registryText), bytes: registryText.length },
    observation: { value: observationManifest(), sha256: identityOf('synthetic-observation-file'), bytes: 1000 },
    m1Admission: m1Admission(m1Identity), hinAdmission: hinAdmission(),
  });
  const bytes = Buffer.from(`${JSON.stringify(lifecycle)}\n`);
  return { lifecycle, sha256: sha256(bytes), bytes: bytes.length };
}

function observationManifest() {
  const observations = registry.sources.map((source, index) => ({
    sourceId: source.id, status: 'partial', dataset: source.dataset, transport: source.transport, retrievedAt: GENERATED_AT,
    sourceAsOf: ['citygeo-address-locator', 'opa-assessment-history'].includes(source.id) ? null : '2026-08-29T00:00:00.000Z',
    revision: source.id === 'vision-zero-hin-2025' ? `arcgis-last-edit:${Date.parse('2025-12-10T17:29:32.369Z')}` : null,
    rowCount: source.id === 'citygeo-address-locator' ? null : source.id === 'philadelphia-reported-crime' ? 20 : source.id === 'vision-zero-hin-2025' ? 2 : 10 + index,
    schemaFields: [...source.expected_fields].sort(), missingFields: [], dq: ['source-owned-revision-unavailable'],
  }));
  const value = {
    schema: 'engagement-home-compare-source-smoke/v1', generatedAt: GENERATED_AT, status: 'partial', semanticIdentity: '', observations,
    routing: structuredClone(registry.routing), privacy: structuredClone(registry.privacy),
    limitations: [
      'This is bounded live source/schema evidence, not a complete download, source-owned immutable revision, accuracy guarantee, or product authority.',
      'No address, coordinate, parcel, owner, transaction party, case/document identifier, or source record row is retained.',
    ],
  };
  value.semanticIdentity = identityOf({ schema: value.schema, status: value.status, observations: observations.map(({ retrievedAt: _clock, ...item }) => item), routing: value.routing, privacy: value.privacy });
  return value;
}

function m1Admission(identity) {
  const revision = identityOf('synthetic-m1-revision');
  return { receipt: {
    schema: 'engagement-phl-crime-warehouse-receipt/v3', identity, mode: 'official-local-candidate', serving_eligible: false,
    source: { source_table: 'incidents_part1_part2', revision }, warehouse: { current_snapshot_id: revision }, coverage: {}, counts: { canonical_rows: 20 },
    clocks: { source_as_of: '2026-08-29T00:00:00.000Z', retrieved_at: '2026-08-29T01:00:00.000Z', built_at: '2026-08-29T02:00:00.000Z', observed_at: '2026-08-29T03:00:00.000Z' },
    data_quality: {}, artifacts: { canonical: { sha256: identityOf('synthetic-m1-canonical'), bytes: 200 }, current_source_manifest: { sha256: identityOf('synthetic-m1-manifest') } }, authority: { serving_authority: false, integration_authority: false },
  }, receipt_artifact: { sha256: identityOf('synthetic-m1-file'), bytes: 200 } };
}

function hinAdmission() {
  const snapshot = identityOf('synthetic-hin-snapshot');
  return { receipt: {
    schema: 'phl-hin-2025-receipt-v1', source: { layerName: 'high_injury_network_2025', layerUrl: registry.sources[8].api_url, sourceAsOf: '2025-12-10T17:29:32.369Z', fields: [] },
    artifact: { identity: snapshot, bytes: 200, featureCount: 2, retrievedAt: '2026-08-10T10:29:36.678Z', builtAt: null, buildClockStatus: 'not-recorded-in-legacy-snapshot' }, review: { status: 'legacy-admitted', reviewedAt: null, reviewedBy: null, note: 'Synthetic fixture.' },
  }, snapshot_artifact: { sha256: snapshot, bytes: 200 }, receipt_artifact: { sha256: identityOf('synthetic-hin-file'), bytes: 200 } };
}

function dimension(ledger, name) { return ledger.dimensions.find(({ dimension: value }) => value === name); }
function sha256(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function identityOf(value) { return sha256(Buffer.from(stableStringify(value))); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
