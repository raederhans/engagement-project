import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HOME_COMPARE_SCHEMA } from '../../src/home_compare/contract.js';
import { SOURCE_HEALTH_SCHEMA_VERSION, SOURCE_HEALTH_STATUSES } from '../../src/source_health/source_health_read_model.js';

const root = new URL('../../', import.meta.url);
const rootPath = fileURLToPath(root);
const manifestUrl = new URL('../../docs/active/phase1-evidence-completion/handoff.manifest.json', import.meta.url);
const packageUrl = new URL('../../package.json', import.meta.url);

test('Phase 1 structured handoff manifest is versioned, executable, and acyclic', async () => {
  const [text, packageText] = await Promise.all([readFile(manifestUrl, 'utf8'), readFile(packageUrl, 'utf8')]);
  const manifest = JSON.parse(text);
  const packageJson = JSON.parse(packageText);
  assert.equal(manifest.schema, 'engagement-phase1-handoff/v1');
  assert.equal(HOME_COMPARE_SCHEMA, 'engagement-home-neighborhood-compare/v1');
  assert.equal(SOURCE_HEALTH_SCHEMA_VERSION, 'engagement-source-health/v1');
  assert.deepEqual(SOURCE_HEALTH_STATUSES, ['current', 'partial', 'stale', 'unavailable', 'unknown']);
  assert.equal(packageJson.scripts['test:phase1-handoff'], 'node --test scripts/tests/phase1_handoff_contracts.mjs');
  assert.match(packageJson.scripts['test:data-contract'], /npm run test:phase1-handoff/);
  assert.equal(manifest.controlSurfaceOwner, '1D integration/release owner');
  await Promise.all(manifest.controlSurfaces.map((file) => access(new URL(`../../${file}`, import.meta.url))));

  const expectedIds = ['M1', 'M2', 'M3', 'M4', '1D'];
  assert.deepEqual(manifest.phases.map((phase) => phase.id), expectedIds);
  assert.equal(new Set(manifest.phases.map((phase) => phase.owner)).size, expectedIds.length);
  for (const phase of manifest.phases) {
    assert.ok(phase.writable.length && phase.forbidden && phase.ignoredOutputRoots && phase.retention.duration);
    assert.ok(phase.retention.decisionOwner && phase.retention.deletePrerequisites.length);
    assert.deepEqual(phase.gates, ['exact-tip', 'topology', 'status', 'overlap']);
    assert.ok(phase.receipt.schema.endsWith('/v1'));
    assert.ok(phase.receipt.requiredFields.length >= 4);
    await access(new URL(`../../${phase.receipt.validator}`, import.meta.url));
    for (const script of phase.mandatoryScripts) assert.ok(packageJson.scripts[script], `${phase.id} maps ${script}`);
    for (const pattern of phase.writable) await assertPatternExists(pattern);
  }
  for (let index = 0; index < manifest.phases.length; index += 1) {
    for (const later of manifest.phases.slice(index + 1)) {
      assert.equal(patternOverlap(manifest.phases[index].writable, later.writable), false,
        `${manifest.phases[index].id}/${later.id} writable patterns must not overlap`);
    }
  }
  assert.equal(manifest.phases.find((phase) => phase.id === 'M4').upstreamReceiptBindings.includes('M3'), false);
  assert.deepEqual(manifest.edges, [['M0', 'M1'], ['M1', 'M2'], ['M2', 'M3'], ['M2', 'M4'], ['M3', '1D'], ['M4', '1D']]);
  assertAcyclic(manifest.edges);
});

async function assertPatternExists(pattern) {
  const wildcard = pattern.indexOf('*');
  if (wildcard === -1) return access(new URL(`../../${pattern}`, import.meta.url));
  const directory = pattern.slice(0, pattern.lastIndexOf('/', wildcard));
  const expression = pattern.slice(pattern.lastIndexOf('/', wildcard) + 1).replaceAll('.', '\\.').replaceAll('*', '.*');
  const entries = await readdir(path.join(rootPath, directory));
  assert.ok(entries.some((entry) => new RegExp(`^${expression}$`).test(entry)), `${pattern} must match a current path`);
}

function patternOverlap(first, second) {
  return first.some((a) => second.some((b) => a === b || a.replace('/**', '/') === b.replace('/**', '/')));
}

function assertAcyclic(edges) {
  const nodes = new Set(edges.flat());
  const visiting = new Set();
  const complete = new Set();
  const visit = (node) => {
    assert.equal(visiting.has(node), false, `handoff DAG cycles at ${node}`);
    if (complete.has(node)) return;
    visiting.add(node);
    for (const [, target] of edges.filter(([source]) => source === node)) visit(target);
    visiting.delete(node); complete.add(node);
  };
  for (const node of nodes) visit(node);
}
