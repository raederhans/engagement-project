import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { publishAreaIntelligenceEvaluation } from '../publish_area_intelligence_evaluation.mjs';
import {
  validateAreaIntelligenceServingCandidate,
} from '../../src/area_intelligence/serving_contract.js';
import {
  buildAreaIntelligenceHtml,
  createAreaIntelligencePresentation,
} from '../../src/area_intelligence/view.js';
import { setLanguage } from '../../src/i18n/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicationPaths = [
  'reports/area-intelligence/model-evaluation-report.v1.json',
  'reports/area-intelligence/residual-map.v1.json',
  'reports/area-intelligence/bias-error-audit.v1.json',
  'reports/area-intelligence/data-lineage-summary.v1.json',
  'reports/area-intelligence/model-card.md',
  'public/data/area_intelligence_baseline.v1.json',
];

test('publisher verifies the exact handoff and rolls every destination back after a partial install failure', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  for (const relative of publicationPaths) {
    const destination = path.join(fixture.root, ...relative.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, `original:${relative}\n`);
  }

  await assert.rejects(() => publishAreaIntelligenceEvaluation({
    ...fixture.publishOptions,
    testHooks: {
      afterInstall({ installed }) {
        if (installed === 3) throw new Error('synthetic install failure');
      },
    },
  }), /synthetic install failure/);

  for (const relative of publicationPaths) {
    assert.equal(
      await fs.readFile(path.join(fixture.root, ...relative.split('/')), 'utf8'),
      `original:${relative}\n`,
      `${relative} must be restored byte-for-byte`,
    );
  }
  assert.deepEqual((await listFiles(fixture.root)).filter((name) => /\.(?:tmp|bak)-/.test(name)), []);

  const result = await publishAreaIntelligenceEvaluation(fixture.publishOptions);
  assert.equal(result.status, 'published-local-serving-candidate');
  assert.equal(result.promotion, 'not-promoted');
  const serving = JSON.parse(await fs.readFile(
    path.join(fixture.root, 'public/data/area_intelligence_baseline.v1.json'),
    'utf8',
  ));
  assert.equal(validateAreaIntelligenceServingCandidate(serving).forecast.status, 'unavailable');
  assert.equal(serving.forecast.reason, 'promotion-gate-not-passed');
  assert.equal(serving.lineage.mart.part_bindings_identity, fixture.identities.partBindings);
  assert.equal(serving.lineage.m1_receipt.identity, fixture.identities.receipt);
  assert.equal(serving.historical_evidence.source_as_of, '2026-08-28T00:00:00.000Z');
  assert.deepEqual((await listFiles(fixture.root)).filter((name) => /\.(?:tmp|bak)-/.test(name)), []);

  const missingClock = structuredClone(serving);
  delete missingClock.historical_evidence.source_as_of;
  assert.throws(() => validateAreaIntelligenceServingCandidate(missingClock), /source-as-of/);
  const unsafeReason = structuredClone(serving);
  unsafeReason.forecast.reason = 'missing-means-zero';
  assert.throws(() => validateAreaIntelligenceServingCandidate(unsafeReason), /reason is invalid or unsafe/);
  const privateField = structuredClone(serving);
  privateField.input_address = 'private fixture';
  assert.throws(() => validateAreaIntelligenceServingCandidate(privateField), /forbidden field/);

  setLanguage('zh-CN');
  const zhHtml = buildAreaIntelligenceHtml(createAreaIntelligencePresentation(serving));
  assert.match(zhHtml, /来源截至/);
  assert.match(zhHtml, /证据窗口/);
  assert.match(zhHtml, /不可用原因/);
  assert.match(zhHtml, /限制/);
  setLanguage('en');
});

test('publisher rejects tampered lineage, stale identity, legacy protocol, partial mart, and hostile artifact names before writes', async (t) => {
  const cases = [
    ['tampered M1 receipt bytes', {}, async (fixture) => fs.appendFile(fixture.publishOptions.m1ReceiptPath, ' ')],
    ['stale protocol bytes', {}, async (fixture) => fs.appendFile(fixture.publishOptions.protocolPath, ' ')],
    ['partial/tampered mart part', {}, async (fixture) => fs.appendFile(fixture.partPath, '{}\n')],
    ['old protocol', { protocolSchema: 'engagement-area-intelligence-evaluation-protocol/v1' }, async () => {}],
    ['old evaluation run', { evaluationSchema: 'engagement-area-intelligence-evaluation-run/v1' }, async () => {}],
    ['report coverage outside M1 receipt', {
      reportCoverage: { earliest_scope_start: '2007-01-01', latest_scope_end_exclusive: '2026-08-28' },
    }, async () => {}],
    ['raw serving source vintage outside report', { rawSourceVintage: digest(Buffer.from('other source')) }, async () => {}],
    ['raw serving coverage outside report', {
      rawCoverage: { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-27' },
    }, async () => {}],
    ['lineage seam mart part with extra field', { seamPartExtra: true }, async () => {}],
    ['lineage seam missing mart parts', {}, async (fixture) => {
      const manifest = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
      delete manifest.lineage_seam.mart.parts;
      await fs.writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }],
    ['hostile artifact path', {}, async (fixture) => {
      const manifest = JSON.parse(await fs.readFile(fixture.manifestPath, 'utf8'));
      manifest.artifacts[0].name = '../bias-error-audit.json';
      await fs.writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }],
  ];
  for (const [name, options, mutate] of cases) {
    await t.test(name, async (subtest) => {
      const fixture = await createFixture(options);
      subtest.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
      await mutate(fixture);
      await assert.rejects(() => publishAreaIntelligenceEvaluation(fixture.publishOptions));
      for (const relative of publicationPaths) {
        await assert.rejects(fs.stat(path.join(fixture.root, ...relative.split('/'))), { code: 'ENOENT' });
      }
      assert.deepEqual((await listFiles(fixture.root)).filter((file) => /\.(?:tmp|bak)-/.test(file)), []);
    });
  }
});

async function createFixture({
  protocolSchema = 'engagement-area-intelligence-evaluation-protocol/v2',
  evaluationSchema = 'engagement-area-intelligence-evaluation-run/v2',
  receiptCoverage = { start: '2006-01-01', end_exclusive: '2026-08-28' },
  reportCoverage = { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-28' },
  rawSourceVintage,
  rawCoverage,
  seamPartExtra = false,
} = {}) {
  const root = path.join(repoRoot, '.dfev1', `area-intelligence-publisher-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const evaluationRoot = path.join(root, 'input', 'evaluation');
  const martRoot = path.join(root, 'input');
  const protocolPath = path.join(root, 'protocol.json');
  const m1ReceiptPath = path.join(root, 'm1-receipt.json');
  await fs.mkdir(evaluationRoot, { recursive: true });

  const revision = digest(Buffer.from('source revision'));
  const receiptCore = {
    schema: 'engagement-phl-crime-warehouse-receipt/v3',
    source: { revision },
    coverage: receiptCoverage,
    clocks: { source_as_of: '2026-08-28T00:00:00.000Z' },
  };
  const receipt = { ...receiptCore, identity: identityOf(receiptCore) };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  await fs.writeFile(m1ReceiptPath, receiptBytes);

  const protocol = {
    schema: protocolSchema,
    schema_version: protocolSchema.endsWith('/v2') ? 2 : 1,
    frozen_at: '2026-08-28T17:43:21.213Z',
    frozen_before_model_performance: true,
    exact_input_gate: {
      receipt_schema: receipt.schema,
      receipt_identity: receipt.identity,
    },
  };
  const protocolBytes = Buffer.from(`${JSON.stringify(protocol, null, 2)}\n`);
  await fs.writeFile(protocolPath, protocolBytes);
  const protocolSha256 = sha256(protocolBytes);

  const partPath = path.join(martRoot, 'marts', 'tract', 'part-000.jsonl');
  await fs.mkdir(path.dirname(partPath), { recursive: true });
  const partBytes = Buffer.from('{"fixture":true}\n');
  await fs.writeFile(partPath, partBytes);
  const parts = [{
    path: 'marts/tract/part-000.jsonl',
    unit_type: 'tract',
    partition: 0,
    row_count: 1,
    bytes: partBytes.length,
    sha256: sha256(partBytes),
  }];
  const partBindings = identityOf(parts);
  const martCore = {
    schema: 'engagement-area-intelligence-feature-mart/v2',
    protocol: { schema: protocol.schema, sha256: protocolSha256, frozen_before_model_performance: true },
    exact_input: {
      receipt_schema: receipt.schema,
      receipt_identity: receipt.identity,
      receipt_sha256: digest(receiptBytes),
    },
    parts,
    part_bindings_identity: partBindings,
    row_count: 1,
    bytes: partBytes.length,
  };
  const martManifest = {
    ...martCore,
    artifact_identity: identityOf(martCore),
    generated_at: '2026-08-29T00:00:00.000Z',
  };
  const martManifestBytes = Buffer.from(`${JSON.stringify(martManifest, null, 2)}\n`);
  await fs.writeFile(path.join(martRoot, 'manifest.json'), martManifestBytes);

  const generatedAt = '2026-08-29T00:00:00.000Z';
  const promotion = { status: 'not-promoted', selected_model: null };
  const report = {
    schema: 'ModelEvaluationReport/v1',
    generated_at: generatedAt,
    protocol: { schema: protocol.schema, sha256: protocolSha256, frozen_before_model_performance: true },
    target: { forbidden_claims: forbiddenClaims() },
    data: {
      mart_artifact_identity: martManifest.artifact_identity,
      mart_manifest_sha256: sha256(martManifestBytes),
      source_vintage: revision,
      coverage: reportCoverage,
    },
    metrics: {
      primary_by_fold_space_holdout: [{
        model: 'seasonal-naive-52w', fold: 'fixture', mae: 1, poisson_deviance: 1,
        negative_binomial_deviance: 1, prediction_interval_90_coverage: 0.9,
        relative_mae_gain_vs_seasonal_naive: 0,
      }],
      by_category: [],
      by_data_volume: [],
    },
    promotion,
    limitations: ['Synthetic fixture only.', 'Reported incidents are incomplete and non-causal.'],
  };
  const rawServing = {
    schema: 'engagement-area-intelligence-serving/v1',
    generated_at: generatedAt,
    status: 'not-promoted',
    historical_evidence: {
      status: 'available', measure: 'PPD reported incidents', source_vintage: rawSourceVintage ?? revision,
      coverage: rawCoverage ?? report.data.coverage, limitations: ['Synthetic fixture only.'],
    },
    forecast: {
      status: 'unavailable', reason: 'model-did-not-exceed-predefined-seasonal-baseline', predictions: [],
    },
    evaluation: {
      promotion_status: 'not-promoted', selected_model: null,
      audit_model: 'negative-binomial-log-link-v1', protocol_sha256: protocolSha256,
    },
    forbidden_claims: forbiddenClaims(),
  };
  const artifacts = new Map([
    ['model-evaluation-report.json', `${JSON.stringify(report, null, 2)}\n`],
    ['residual-map.json', '{"schema":"fixture-residual","blocks":[]}\n'],
    ['bias-error-audit.json', '{"schema":"fixture-bias","status":"unavailable"}\n'],
    ['data-lineage-summary.json', '{"schema":"fixture-lineage"}\n'],
    ['model-card.md', '# Synthetic model card\n\nNot product evidence.\n'],
    ['serving-artifact.json', `${JSON.stringify(rawServing, null, 2)}\n`],
    ['model-state.json', '{"schema":"fixture-state"}\n'],
  ]);
  for (const [name, contents] of artifacts) await fs.writeFile(path.join(evaluationRoot, name), contents);
  const artifactRecords = [...artifacts].map(([name, contents]) => ({
    name,
    bytes: Buffer.byteLength(contents),
    sha256: sha256(Buffer.from(contents)),
  })).sort((left, right) => left.name.localeCompare(right.name));
  const manifest = {
    schema: evaluationSchema,
    protocol_sha256: protocolSha256,
    mart_manifest_sha256: sha256(martManifestBytes),
    mart_artifact_identity: martManifest.artifact_identity,
    lineage_seam: {
      schema: 'engagement-area-intelligence-lineage-seam/v1',
      protocol: { schema: protocol.schema, sha256: protocolSha256 },
      mart: {
        schema: martManifest.schema,
        manifest_sha256: sha256(martManifestBytes),
        artifact_identity: martManifest.artifact_identity,
        part_bindings_identity: partBindings,
        part_count: 1,
        row_count: 1,
        bytes: partBytes.length,
        parts: parts.map((part) => seamPartExtra ? { ...part, extra: true } : { ...part }),
      },
      m1_receipt: { schema: receipt.schema, identity: receipt.identity, sha256: digest(receiptBytes) },
      outcome: { promotion_status: 'not-promoted', selected_model: null, availability: 'unavailable' },
    },
    promotion,
    availability: 'unavailable',
    selected_audit_model: 'negative-binomial-log-link-v1',
    artifacts: artifactRecords,
    generated_at: generatedAt,
  };
  const manifestPath = path.join(evaluationRoot, 'manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    root,
    partPath,
    manifestPath,
    identities: { receipt: receipt.identity, partBindings },
    publishOptions: { repositoryRoot: root, evaluationRoot, protocolPath, martRoot, m1ReceiptPath },
  };
}

function forbiddenClaims() {
  return ['individual victim probability', 'absolute safety', 'safety score', 'safest area', 'safest route', 'causal effect'];
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function digest(value) {
  return `sha256:${sha256(value)}`;
}

function identityOf(value) {
  return digest(Buffer.from(stableSerialization(value)));
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
