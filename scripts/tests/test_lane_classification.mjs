#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { RELEASE_STEPS } from '../run_release_gate.mjs';
import { TEST_LANES, TEST_LANE_NAMES } from '../test_lanes.mjs';
import { parseModuleDependencies } from './helpers/module_dependencies.mjs';

const testsDirectory = new URL('./', import.meta.url);
const packageUrl = new URL('../../package.json', import.meta.url);
const workflowUrl = new URL('../../.github/workflows/ci.yml', import.meta.url);

function collectScriptTestFiles(packageJson, rootScripts) {
  const visited = new Set();
  const files = new Set();
  const visit = (name) => {
    if (visited.has(name)) return;
    visited.add(name);
    const command = packageJson.scripts[name];
    assert.equal(typeof command, 'string', `missing npm script: ${name}`);
    for (const match of command.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) visit(match[1]);
    if (/\bnpm test\b/.test(command)) visit('test');
    for (const match of command.matchAll(/scripts\/tests\/([A-Za-z0-9_.-]+\.mjs)/g)) {
      files.add(match[1]);
    }
  };
  for (const rootScript of Array.isArray(rootScripts) ? rootScripts : [rootScripts]) visit(rootScript);
  return [...files].sort();
}

function collectReleaseTestFiles(packageJson, releaseSteps = RELEASE_STEPS) {
  const releaseScripts = releaseSteps
    .filter(([command]) => command === 'run')
    .map(([, script]) => script);
  const files = new Set(collectScriptTestFiles(packageJson, releaseScripts));
  if (releaseSteps.some(([command, script]) => (
    command === 'node' && script === 'scripts/run_visual_experience_dist.mjs'
  ))) {
    files.add('visual_experience.spec.mjs');
  }
  return [...files].sort();
}

function assertAutomaticReleaseGraph(packageJson, releaseSteps = RELEASE_STEPS) {
  const expected = [...TEST_LANES.default, ...TEST_LANES['release-only']].sort();
  assert.deepEqual(
    collectReleaseTestFiles(packageJson, releaseSteps),
    expected,
    'automatic release test graph must equal default plus release-only lanes',
  );
}

test('every root test module belongs to exactly one declared lane', async () => {
  assert.deepEqual(TEST_LANE_NAMES, [
    'default',
    'release-only',
    'extended/manual',
    'quarantined',
  ]);
  const actual = (await readdir(testsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => entry.name)
    .sort();
  const declared = Object.values(TEST_LANES).flat();
  assert.equal(new Set(declared).size, declared.length, 'a test module is assigned to multiple lanes');
  assert.deepEqual([...declared].sort(), actual);
});

test('default and release-only lanes are routed by their owning gates', async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.deepEqual(
    collectScriptTestFiles(packageJson, 'test'),
    [...TEST_LANES.default].sort(),
  );
  assertAutomaticReleaseGraph(packageJson);
});

test('release graph validation rejects a manual test hidden behind an existing alias', async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'));
  const compromised = structuredClone(packageJson);
  compromised.scripts['test:browser-smoke'] += ' && node --test scripts/tests/evidence_bundle_v2.mjs';
  assert.throws(
    () => assertAutomaticReleaseGraph(compromised),
    /automatic release test graph must equal default plus release-only lanes/,
  );
});

test('module dependency parser ignores import text in comments and strings', () => {
  const dependencies = parseModuleDependencies(`
    // import fake from './comment.js';
    /* const lazy = import('./block-comment.js'); */
    const text = "import('./string.js')";
    const template = \`export * from './template.js'\`;
    import actual from './actual.js';
    export { named } from './exported.js';
    void import('./lazy.js');
    void import(runtimeSpecifier);
  `, 'dependency-fixture.js');
  assert.deepEqual(dependencies.static, ['./actual.js', './exported.js']);
  assert.deepEqual(dependencies.dynamic, ['./lazy.js']);
});

test('CI runs one complete suite, a Windows build smoke, and one focused coverage repeat', async () => {
  const [packageJson, workflow] = await Promise.all([
    readFile(packageUrl, 'utf8').then(JSON.parse),
    readFile(workflowUrl, 'utf8'),
  ]);
  assert.equal(packageJson.scripts['ci:core'], 'npm run validate');
  assert.equal(
    packageJson.scripts['ci:windows-portability'],
    'npm run build:manifest',
  );
  assert.equal((workflow.match(/npm run ci:core/g) || []).length, 0);
  assert.equal((workflow.match(/npm run ci:release/g) || []).length, 1);
  assert.equal((workflow.match(/npm run ci:windows-portability/g) || []).length, 1);
  assert.equal((workflow.match(/npm run coverage:report/g) || []).length, 1);
  assert.equal(
    packageJson.scripts['coverage:report'],
    'node --test --experimental-test-coverage scripts/tests/architecture_ports.mjs scripts/tests/analysis_history_controller.mjs scripts/tests/crime_async_contracts.mjs',
  );
  assert.doesNotMatch(workflow, /core:[\s\S]*?release:\s*[\s\S]*?npm run (?:test|validate|ci:core)/);
});
