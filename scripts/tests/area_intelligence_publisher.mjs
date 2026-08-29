import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createAreaIntelligencePublicProjection,
  publishValidatedAreaIntelligenceProjection,
} from '../publish_area_intelligence_evaluation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const legacyPublicPath = 'public/data/area_intelligence_baseline.v1.json';
const publicPath = 'public/data/area_intelligence_baseline.v2.json';
const publisherLeaseName = '.area-intelligence-publisher.v2.lock';

test('publisher rolls back a failed install, writes once, and verifies an identical rerun idempotently', async (t) => {
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1-area-intelligence-publisher-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacyBytes = await seedTrackedV1(root);
  const context = syntheticP3Context();
  const projection = createAreaIntelligencePublicProjection(context);
  const destination = path.join(root, ...publicPath.split('/'));

  await assert.rejects(() => publishValidatedAreaIntelligenceProjection({
    repositoryRoot: root,
    projection,
    context,
    testHooks: { afterInstall: () => { throw new Error('synthetic install failure'); } },
  }), /synthetic install failure/);
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  assert.deepEqual((await listFiles(root)).filter((name) => /\.tmp-/.test(name)), []);
  assert.deepEqual(await fs.readFile(path.join(root, ...legacyPublicPath.split('/'))), legacyBytes);

  const first = await publishValidatedAreaIntelligenceProjection({ repositoryRoot: root, projection, context });
  assert.equal(first.status, 'published-local-serving-candidate');
  assert.equal(first.idempotent, false);
  assert.equal(first.files[0].path, publicPath);
  const firstBytes = await fs.readFile(destination);
  const second = await publishValidatedAreaIntelligenceProjection({ repositoryRoot: root, projection, context });
  assert.equal(second.status, 'verified-existing-public-projection');
  assert.equal(second.idempotent, true);
  assert.deepEqual(await fs.readFile(destination), firstBytes);
  assert.deepEqual(await fs.readFile(path.join(root, ...legacyPublicPath.split('/'))), legacyBytes);
  assert.deepEqual((await listFiles(root)).filter((name) => /\.tmp-/.test(name)), []);
});

test('temporary unlink failure rolls back only the link installed by this publication', async (t) => {
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1-area-intelligence-unlink-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacyBytes = await seedTrackedV1(root);
  const context = syntheticP3Context();
  const projection = createAreaIntelligencePublicProjection(context);
  const destination = path.join(root, ...publicPath.split('/'));

  await assert.rejects(() => publishValidatedAreaIntelligenceProjection({
    repositoryRoot: root,
    projection,
    context,
    testHooks: {
      unlinkTemporary() {
        throw new Error('synthetic temporary unlink failure');
      },
    },
  }), /synthetic temporary unlink failure/);
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(path.join(root, ...legacyPublicPath.split('/'))), legacyBytes);
  assert.deepEqual((await listFiles(root)).filter((name) => /\.tmp-/.test(name)), []);
});

test('committed projection returns a lease cleanup warning and exact rerun stays read-only', async (t) => {
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1-area-intelligence-lease-remains-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedTrackedV1(root);
  const leasePath = path.join(root, publisherLeaseName);
  const destination = path.join(root, ...publicPath.split('/'));
  const context = syntheticP3Context();
  const projection = createAreaIntelligencePublicProjection(context);

  const committed = await publishValidatedAreaIntelligenceProjection({
    repositoryRoot: root,
    projection,
    context,
    testHooks: {
      unlinkLease() {
        throw Object.assign(new Error('synthetic lease unlink failure'), { code: 'EIO' });
      },
    },
  });
  assert.equal(committed.status, 'committed-with-cleanup-warning');
  assert.equal(committed.publication_status, 'published-local-serving-candidate');
  assert.deepEqual(committed.cleanup_warning, {
    status: 'warning',
    reason: 'publisher-lease-release-failed',
  });
  assert.equal(committed.idempotent, false);
  const committedBytes = await fs.readFile(destination);
  const remainingLeaseBytes = await fs.readFile(leasePath);
  const remainingLeaseIdentity = await stableFileIdentity(leasePath);

  const verified = await publishValidatedAreaIntelligenceProjection({
    repositoryRoot: root,
    projection,
    context,
  });
  assert.equal(verified.status, 'verified-existing-public-projection');
  assert.equal(verified.idempotent, true);
  assert.deepEqual(verified.cleanup_warning, {
    status: 'warning',
    reason: 'publisher-lease-remains',
  });
  assert.doesNotMatch(JSON.stringify(verified), /pid|nonce|root_identity/);
  assert.deepEqual(await fs.readFile(destination), committedBytes);
  assert.deepEqual(await fs.readFile(leasePath), remainingLeaseBytes);
  assert.deepEqual(await stableFileIdentity(leasePath), remainingLeaseIdentity);
  assert.deepEqual((await listFiles(root)).filter((name) => /\.tmp-/.test(name)), []);
});

test('active, dead, malformed, and replaced lease bytes preserve exact-target read-only idempotence', async (t) => {
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1-area-intelligence-equal-leases-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedTrackedV1(root);
  const leasePath = path.join(root, publisherLeaseName);
  const destination = path.join(root, ...publicPath.split('/'));
  const context = syntheticP3Context();
  const projection = createAreaIntelligencePublicProjection(context);
  await publishValidatedAreaIntelligenceProjection({ repositoryRoot: root, projection, context });
  const destinationBytes = await fs.readFile(destination);
  const destinationIdentity = await stableFileIdentity(destination);

  for (const [label, leaseBytes] of await leaseVariants(root)) {
    await fs.writeFile(leasePath, leaseBytes, { flag: 'wx' });
    const leaseIdentity = await stableFileIdentity(leasePath);
    const result = await publishValidatedAreaIntelligenceProjection({ repositoryRoot: root, projection, context });
    assert.equal(result.status, 'verified-existing-public-projection', label);
    assert.equal(result.idempotent, true, label);
    assert.equal(result.cleanup_warning?.reason, 'publisher-lease-remains', label);
    assert.deepEqual(await fs.readFile(leasePath), leaseBytes, label);
    assert.deepEqual(await stableFileIdentity(leasePath), leaseIdentity, label);
    assert.deepEqual(await fs.readFile(destination), destinationBytes, label);
    assert.deepEqual(await stableFileIdentity(destination), destinationIdentity, label);
    await fs.unlink(leasePath);
  }
  assert.deepEqual((await listFiles(root)).filter((name) => /\.tmp-/.test(name)), []);
});

test('any existing lease with a missing target rejects writes and preserves the lock verbatim', async (t) => {
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1-area-intelligence-missing-leases-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedTrackedV1(root);
  const leasePath = path.join(root, publisherLeaseName);
  const destination = path.join(root, ...publicPath.split('/'));
  const context = syntheticP3Context();
  const projection = createAreaIntelligencePublicProjection(context);

  for (const [label, leaseBytes] of await leaseVariants(root)) {
    await fs.writeFile(leasePath, leaseBytes, { flag: 'wx' });
    const leaseIdentity = await stableFileIdentity(leasePath);
    await assert.rejects(() => publishValidatedAreaIntelligenceProjection({
      repositoryRoot: root, projection, context,
    }), /lease already exists/i, label);
    assert.deepEqual(await fs.readFile(leasePath), leaseBytes, label);
    assert.deepEqual(await stableFileIdentity(leasePath), leaseIdentity, label);
    await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
    assert.deepEqual((await listFiles(root)).filter((name) => /\.tmp-/.test(name)), []);
    await fs.unlink(leasePath);
  }
});

test('a concurrent publisher never removes the active writer lease', async (t) => {
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1-area-intelligence-concurrent-lease-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedTrackedV1(root);
  const leasePath = path.join(root, publisherLeaseName);
  const destination = path.join(root, ...publicPath.split('/'));
  const context = syntheticP3Context();
  const projection = createAreaIntelligencePublicProjection(context);
  let releaseWriter;
  let signalWriter;
  const writerEntered = new Promise((resolve) => { signalWriter = resolve; });
  const writerRelease = new Promise((resolve) => { releaseWriter = resolve; });
  const writer = publishValidatedAreaIntelligenceProjection({
    repositoryRoot: root,
    projection,
    context,
    testHooks: {
      async beforeTemporaryWrite() {
        signalWriter();
        await writerRelease;
      },
    },
  });
  await writerEntered;
  const activeLeaseBytes = await fs.readFile(leasePath);
  const activeLeaseIdentity = await stableFileIdentity(leasePath);
  try {
    await assert.rejects(() => publishValidatedAreaIntelligenceProjection({
      repositoryRoot: root, projection, context,
    }), /lease already exists/i);
    assert.deepEqual(await fs.readFile(leasePath), activeLeaseBytes);
    assert.deepEqual(await stableFileIdentity(leasePath), activeLeaseIdentity);
    await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  } finally {
    releaseWriter();
  }
  const result = await writer;
  assert.equal(result.status, 'published-local-serving-candidate');
  assert.equal(JSON.parse(await fs.readFile(destination, 'utf8')).forecast.status, 'unavailable');
  await assert.rejects(fs.stat(leasePath), { code: 'ENOENT' });
});

test('a non-lease target cleanup failure remains an AggregateError after projection commit', async (t) => {
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1-area-intelligence-target-cleanup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedTrackedV1(root);
  const destination = path.join(root, ...publicPath.split('/'));
  const context = syntheticP3Context();
  const projection = createAreaIntelligencePublicProjection(context);

  await assert.rejects(() => publishValidatedAreaIntelligenceProjection({
    repositoryRoot: root,
    projection,
    context,
    testHooks: {
      cleanupTemporary() {
        throw new Error('synthetic target cleanup failure');
      },
    },
  }), (error) => {
    assert(error instanceof AggregateError);
    assert.match(error.message, /target cleanup failed/i);
    return true;
  });
  assert.equal(JSON.parse(await fs.readFile(destination, 'utf8')).forecast.status, 'unavailable');
  await assert.rejects(fs.stat(path.join(root, publisherLeaseName)), { code: 'ENOENT' });
  assert.deepEqual((await listFiles(root)).filter((name) => /\.tmp-/.test(name)), []);
});

test('beforeTemporaryWrite parent junction race is rejected or blocked with no unexpected writes', async (t) => {
  await exerciseParentJunctionRace(t, 'beforeTemporaryWrite');
});

test('beforeLink parent junction race is rejected or blocked with identity-safe cleanup', async (t) => {
  await exerciseParentJunctionRace(t, 'beforeLink');
});

test('publication rejects a symlink or junction path before writing outside the repository root', async (t) => {
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1-area-intelligence-path-'));
  const external = await fs.mkdtemp(path.join(repoRoot, '.dfev1-area-intelligence-external-'));
  t.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(external, { recursive: true, force: true }),
  ]));
  await fs.mkdir(path.join(root, 'public'));
  try {
    await fs.symlink(external, path.join(root, 'public', 'data'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error?.code)) {
      t.skip(`insufficient permission to create path escape fixture: ${error.code}`);
      return;
    }
    throw error;
  }
  const context = syntheticP3Context();
  const projection = createAreaIntelligencePublicProjection(context);
  await assert.rejects(() => publishValidatedAreaIntelligenceProjection({
    repositoryRoot: root,
    projection,
    context,
  }), /symlink|junction|reparse|redirected/i);
  assert.deepEqual(await fs.readdir(external), []);
});

test('publisher refuses to overwrite different bytes and public output contains only the serving allowlist', async (t) => {
  const root = await fs.mkdtemp(path.join(repoRoot, '.dfev1-area-intelligence-no-overwrite-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const context = syntheticP3Context({ decision: 'local-candidate', intervalFailures: 0 });
  const projection = createAreaIntelligencePublicProjection(context);
  const destination = path.join(root, ...publicPath.split('/'));
  await assert.rejects(() => publishValidatedAreaIntelligenceProjection({
    repositoryRoot: root, projection, context,
  }), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.dirname(destination)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(root, publisherLeaseName)), { code: 'ENOENT' });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, 'owner bytes\n');

  await assert.rejects(() => publishValidatedAreaIntelligenceProjection({
    repositoryRoot: root, projection, context,
  }), /refuses to overwrite/);
  assert.equal(await fs.readFile(destination, 'utf8'), 'owner bytes\n');
  await assert.rejects(fs.stat(path.join(root, publisherLeaseName)), { code: 'ENOENT' });

  await fs.rm(destination);
  await publishValidatedAreaIntelligenceProjection({ repositoryRoot: root, projection, context });
  const serialized = await fs.readFile(destination, 'utf8');
  assert.equal(JSON.parse(serialized).forecast.status, 'unavailable');
  assert.doesNotMatch(serialized, /aggregate_primary|primary_by_fold|by_category|by_data_volume|residual-map|model-state|area_order|unit_id/i);
  assert.doesNotMatch(serialized, /42101\d{6}|-75\.\d+|40\.\d+/);
});

test('production publisher is wired to contextual P3 deep validators before projection', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'scripts/publish_area_intelligence_evaluation.mjs'), 'utf8');
  for (const call of [
    'validateAreaIntelligenceMartForEvaluation({',
    'validateAreaIntelligenceEvaluationCheckpoint(checkpoint, {',
    'validateModelEvaluationReport(report, {',
    'validateAreaIntelligenceEvaluationServingArtifact(evaluationServingArtifact, {',
    'validateAreaIntelligenceEvaluationManifest(manifest, {',
  ]) assert.match(source, new RegExp(escapeRegExp(call)));
  assert.doesNotMatch(source, /validateModelEvaluationReport\(report\);/);
});

test('producer context inherits the frozen protocol measure and rejects measure drift', async () => {
  const protocolBytes = await fs.readFile(path.join(
    repoRoot, 'scripts/data/area_intelligence_evaluation_protocol.v2.json',
  ));
  const frozenProtocol = JSON.parse(protocolBytes);
  const context = syntheticP3Context();
  assert.equal(frozenProtocol.target.measure, 'PPD reported incident count');
  assert.equal(context.protocol.target.measure, frozenProtocol.target.measure);
  assert.equal(
    createAreaIntelligencePublicProjection(context).historical_evidence.measure,
    frozenProtocol.target.measure,
  );

  const drifted = structuredClone(context);
  drifted.protocol.target.measure = 'PPD reported incidents';
  assert.throws(
    () => createAreaIntelligencePublicProjection(drifted),
    /historical evidence or method drifted/i,
  );
});

export function syntheticP3Context({ decision = 'no-promotion', intervalFailures = 2 } = {}) {
  const localCandidateModel = decision === 'local-candidate' ? 'negative-binomial-log-link-v1' : null;
  const authority = {
    local_evaluation: false,
    serving: false,
    product_promotion: false,
    scientific: false,
    causal: false,
    safety: false,
    deletion: false,
  };
  const privacy = {
    aggregate_only: true,
    event_level_data_included: false,
    coordinates_included: false,
    generalized_locations_included: false,
    raw_or_canonical_events_included: false,
    source_record_ids_included: false,
  };
  const protocolSha = 'a'.repeat(64);
  const martManifestIdentity = 'b'.repeat(64);
  const manifestIdentity = 'c'.repeat(64);
  const receiptIdentity = `sha256:${'d'.repeat(64)}`;
  const receiptSha = `sha256:${'e'.repeat(64)}`;
  const martArtifactIdentity = `sha256:${'f'.repeat(64)}`;
  const partBindingsIdentity = `sha256:${'1'.repeat(64)}`;
  const protocol = {
    schema: 'engagement-area-intelligence-evaluation-protocol/v2',
    exact_input_gate: { receipt_identity: receiptIdentity, receipt_sha256: receiptSha },
    target: {
      grain: 'spatial-unit-week',
      measure: 'PPD reported incident count',
      week_definition: 'UTC Monday 00:00 inclusive to next Monday exclusive',
      exclude_incomplete_source_week: true,
    },
    marts: { unit_types: ['tract', 'fixed-grid'] },
    spatial_holdout: { training_policy: 'Poisson and negative-binomial fits exclude held-out blocks' },
    admission: { ambiguous_or_unavailable: 'exclude-and-audit-never-force-assign' },
    promotion_gate: {
      eligible_models: ['poisson-log-link-v1', 'negative-binomial-log-link-v1'],
      acceptable_interval_coverage_inclusive: [0.85, 0.95],
    },
    authority,
    privacy,
    forbidden_claims: [
      'individual victim probability', 'absolute safety', 'safety score',
      'safest area', 'safest route', 'causal effect',
    ],
  };
  const martManifest = {
    schema: 'engagement-area-intelligence-feature-mart/v2',
    protocol: { sha256: protocolSha },
    exact_input: { receipt_identity: receiptIdentity, receipt_sha256: receiptSha },
    source_coverage: { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-29' },
    artifact_identity: martArtifactIdentity,
    part_bindings_identity: partBindingsIdentity,
  };
  const generatedAt = '2026-08-30T00:00:00.000Z';
  const report = {
    generated_at: generatedAt,
    protocol: { sha256: protocolSha },
    data: {
      source_vintage: `sha256:${'2'.repeat(64)}`,
      coverage: { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-29' },
      complete_week_end_exclusive: '2026-08-24',
    },
    promotion: {
      status: 'not-promoted', decision, selected_model: null,
      local_candidate_model: localCandidateModel, local_candidate_only: true,
    },
    metrics: {
      primary_by_fold_space_holdout: [
        { model: 'poisson-log-link-v1', prediction_interval_90_coverage: intervalFailures > 0 ? 0.8 : 0.9 },
        { model: 'negative-binomial-log-link-v1', prediction_interval_90_coverage: intervalFailures > 1 ? 0.8 : 0.9 },
      ],
    },
    authority: structuredClone(authority),
    privacy: structuredClone(privacy),
  };
  const manifest = {
    schema: 'engagement-area-intelligence-evaluation-run/v2',
    protocol_sha256: protocolSha,
    mart_manifest_sha256: martManifestIdentity,
    mart_artifact_identity: martArtifactIdentity,
    generated_at: generatedAt,
    promotion: structuredClone(report.promotion),
    authority: structuredClone(authority),
    privacy: structuredClone(privacy),
    lineage_seam: {
      protocol: { sha256: protocolSha },
      mart: {
        manifest_sha256: martManifestIdentity,
        artifact_identity: martArtifactIdentity,
        part_bindings_identity: partBindingsIdentity,
      },
      m1_receipt: { identity: receiptIdentity, sha256: receiptSha },
      outcome: { promotion_status: 'not-promoted', selected_model: null, availability: 'unavailable' },
    },
  };
  return {
    protocol,
    manifest,
    manifestIdentity,
    martManifest,
    martManifestIdentity,
    m1Receipt: {
      schema: 'engagement-phl-crime-warehouse-receipt/v3',
      identity: receiptIdentity,
      clocks: { source_as_of: '2026-08-29T00:00:00.000Z' },
      warehouse: { current_snapshot_id: report.data.source_vintage },
      coverage: { start: '2006-01-01', end_exclusive: '2026-08-29' },
    },
    m1ReceiptSha256: receiptSha,
    report,
    checkpoint: {
      numerical_gate: {
        primary_slices_passed: intervalFailures === 0,
        failed_primary_slice_count: intervalFailures,
      },
      protocol_sha256: protocolSha,
      mart_manifest_sha256: martManifestIdentity,
      mart_artifact_identity: martArtifactIdentity,
      receipt_sha256: receiptSha,
    },
  };
}

async function exerciseParentJunctionRace(t, hookName) {
  const root = await fs.mkdtemp(path.join(repoRoot, `.dfev1-area-intelligence-${hookName}-`));
  const external = await fs.mkdtemp(path.join(repoRoot, `.dfev1-area-intelligence-${hookName}-external-`));
  t.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(external, { recursive: true, force: true }),
  ]));
  const legacyBytes = await seedTrackedV1(root);
  const parent = path.join(root, 'public', 'data');
  const displaced = path.join(root, 'public', `data-displaced-${hookName}`);
  const destination = path.join(root, ...publicPath.split('/'));
  const context = syntheticP3Context();
  const projection = createAreaIntelligencePublicProjection(context);
  const race = { swapped: false, osBlocked: null, fixturePermission: null };
  const testHooks = {
    async [hookName]() {
      try {
        await fs.rename(parent, displaced);
      } catch (error) {
        if (['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) {
          race.osBlocked = error.code;
          return;
        }
        throw error;
      }
      try {
        await fs.symlink(external, parent, process.platform === 'win32' ? 'junction' : 'dir');
        race.swapped = true;
      } catch (error) {
        await fs.rename(displaced, parent);
        if (['EPERM', 'EACCES'].includes(error?.code)) race.fixturePermission = error.code;
        throw error;
      }
    },
  };

  let publication;
  let failure;
  try {
    publication = await publishValidatedAreaIntelligenceProjection({
      repositoryRoot: root,
      projection,
      context,
      testHooks,
    });
  } catch (error) {
    failure = error;
  } finally {
    if (race.swapped) {
      await fs.unlink(parent);
      await fs.rename(displaced, parent);
    }
  }

  if (race.fixturePermission) {
    t.skip(`insufficient permission to create runtime junction fixture: ${race.fixturePermission}`);
    return;
  }
  if (race.swapped) {
    t.diagnostic(`${hookName}: runtime junction replacement succeeded and publisher rejected directory drift`);
    assert(failure, `${hookName} directory drift must fail publication`);
    assert.match(failure.message, /directory handle\/path identity|reparse|symlink|junction|drifted/i);
    await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  } else {
    t.diagnostic(`${hookName}: held directory handle caused the OS to reject replacement with ${race.osBlocked}`);
    assert(race.osBlocked, `${hookName} replacement should either succeed or be rejected by the OS`);
    assert.ifError(failure);
    assert.equal(publication.status, 'published-local-serving-candidate');
    assert.equal(JSON.parse(await fs.readFile(destination, 'utf8')).forecast.status, 'unavailable');
  }
  assert.deepEqual(await fs.readdir(external), []);
  assert.deepEqual(await fs.readFile(path.join(root, ...legacyPublicPath.split('/'))), legacyBytes);
  await assert.rejects(fs.stat(path.join(root, publisherLeaseName)), { code: 'ENOENT' });
  assert.deepEqual((await listFiles(root)).filter((name) => /\.tmp-/.test(name)), []);
}

async function listFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, absolute));
    else result.push(path.relative(root, absolute).replaceAll('\\', '/'));
  }
  return result.sort();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function seedTrackedV1(root) {
  const bytes = await fs.readFile(path.join(repoRoot, ...legacyPublicPath.split('/')));
  const destination = path.join(root, ...legacyPublicPath.split('/'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  return bytes;
}

async function leaseVariants(root) {
  return [
    ['active lease', await leaseFixtureBytes(root, process.pid)],
    ['dead lease', await leaseFixtureBytes(root, 2_147_483_647)],
    ['malformed lease', Buffer.from('{}\n')],
    ['replaced lease', Buffer.from('replacement lease bytes must remain untouched\n')],
  ];
}

async function leaseFixtureBytes(root, pid) {
  const stat = await fs.lstat(root, { bigint: true });
  const payload = {
    schema: 'engagement-area-intelligence-publisher-lease/v1',
    pid,
    nonce: '00000000-0000-4000-8000-000000000001',
    created_at: '2026-08-30T00:00:00.000Z',
    root_identity: {
      dev: String(stat.dev),
      ino: String(stat.ino),
      realpath: await fs.realpath(root),
    },
  };
  return Buffer.from(`${JSON.stringify(payload)}\n`);
}

async function stableFileIdentity(filePath) {
  const stat = await fs.lstat(filePath, { bigint: true });
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}
