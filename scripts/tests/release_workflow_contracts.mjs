#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

const ciUrl = new URL('../../.github/workflows/ci.yml', import.meta.url);
const legacyPagesUrl = new URL('../../.github/workflows/deploy-pages.yml', import.meta.url);
const packageUrl = new URL('../../package.json', import.meta.url);
const auditRunnerUrl = new URL('../run_npm_audit.mjs', import.meta.url);
const releaseRunnerUrl = new URL('../run_release_gate.mjs', import.meta.url);

function jobBlock(workflow, name) {
  const start = new RegExp(`^  ${name}:\\r?$`, 'm').exec(workflow);
  if (!start) return '';
  const bodyStart = start.index + start[0].length;
  const next = /^  [A-Za-z0-9_-]+:\r?$/m.exec(workflow.slice(bodyStart));
  return workflow.slice(start.index, next ? bodyStart + next.index : workflow.length);
}

test('one workflow owns release gates and the legacy Pages push workflow is disabled', async () => {
  const workflow = await readFile(ciUrl, 'utf8');
  await assert.rejects(access(legacyPagesUrl), /ENOENT/);
  for (const job of ['core', 'release', 'coverage', 'deploy']) {
    assert.ok(jobBlock(workflow, job), `CI must define the ${job} job`);
  }
  assert.match(workflow, /^permissions:\r?\n  contents: read\r?$/m);
});

test('deploy is main-push-only and needs every same-run gate', async () => {
  const workflow = await readFile(ciUrl, 'utf8');
  const deploy = jobBlock(workflow, 'deploy');

  assert.match(deploy, /needs:\s*\[core, release, coverage\]/);
  assert.match(deploy, /github\.event_name == 'push'/);
  assert.match(deploy, /github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  assert.doesNotMatch(jobBlock(workflow, 'core'), /pages: write|id-token: write/);
  assert.doesNotMatch(jobBlock(workflow, 'release'), /pages: write|id-token: write/);
  assert.doesNotMatch(jobBlock(workflow, 'coverage'), /pages: write|id-token: write/);
});

test('release uploads one SHA-named Pages candidate and deploy consumes that exact artifact', async () => {
  const workflow = await readFile(ciUrl, 'utf8');
  const release = jobBlock(workflow, 'release');
  const deploy = jobBlock(workflow, 'deploy');

  assert.match(release, /npm run ci:release/);
  assert.match(release, /actions\/upload-pages-artifact@[0-9a-f]{40}/);
  assert.match(release, /name:\s*github-pages-\$\{\{ github\.sha \}\}/);
  assert.match(release, /retention-days:\s*1/);
  assert.doesNotMatch(deploy, /npm (?:ci|run build|run validate)|vite build/);
  assert.match(deploy, /artifact_name:\s*github-pages-\$\{\{ github\.sha \}\}/);
  assert.match(deploy, /Verify candidate is still main tip/);
  assert.match(deploy, /github\.sha/);
});

test('diagnostic and coverage artifacts retain evidence without weakening gates', async () => {
  const workflow = await readFile(ciUrl, 'utf8');
  const artifactUses = [...workflow.matchAll(/actions\/upload-artifact@([0-9a-f]{40})/g)];
  assert.equal(artifactUses.length, 2);
  assert.deepEqual(
    artifactUses.map((match) => match[1]),
    Array(2).fill('043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'),
  );
  assert.equal((workflow.match(
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/g,
  ) || []).length, 2);
  assert.match(workflow, /browser-diagnostics-\$\{\{ github\.run_attempt \}\}[\s\S]*?retention-days:\s*7/);
  assert.match(workflow, /coverage-report-\$\{\{ github\.run_attempt \}\}[\s\S]*?retention-days:\s*14/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.doesNotMatch(workflow, /--update-snapshots|update-snapshots/);
});

test('PR checks may cancel stale runs while main releases and active Pages deploys are never cancelled', async () => {
  const workflow = await readFile(ciUrl, 'utf8');
  const deploy = jobBlock(workflow, 'deploy');
  const cancellationEntries = [...workflow.matchAll(/^\s*cancel-in-progress:\s*(.+)\r?$/gm)]
    .map((match) => match[1]);

  assert.match(
    workflow,
    /^concurrency:\r?\n  group: ci-\$\{\{ github\.ref \}\}\r?\n  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}\r?$/m,
  );
  assert.match(deploy, /concurrency:\r?\n      group: pages\r?\n      cancel-in-progress: false/);
  assert.deepEqual(cancellationEntries, [
    "${{ github.event_name == 'pull_request' }}",
    'false',
  ]);
  assert.doesNotMatch(deploy, /cancel-in-progress:\s*true/);
});

test('release audit strips inherited npm allow-scripts config before starting nested npm', async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.equal(packageJson.scripts['audit:dependencies'], 'node scripts/run_npm_audit.mjs');

  const { sanitizeNpmEnvironment } = await import(auditRunnerUrl);
  const sanitized = sanitizeNpmEnvironment({
    PATH: 'kept',
    npm_config_allow_scripts: 'native-package',
    NPM_CONFIG_ALLOW_SCRIPTS: 'another-source',
  });
  assert.deepEqual(sanitized, { PATH: 'kept' });
});

test('JavaScript lint targets only live source surfaces after Diary server removal', async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.equal(
    packageJson.scripts['lint:js'],
    'eslint src scripts ./*.js ./*.mjs --max-warnings=0',
  );
});

test('local release gate injects the same feature flags as GitHub release CI', async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.equal(packageJson.scripts['ci:release'], 'node scripts/run_release_gate.mjs');

  const { createReleaseEnvironment } = await import(releaseRunnerUrl);
  assert.deepEqual(createReleaseEnvironment({
    PATH: 'kept',
    npm_config_allow_scripts: 'inherited-user-policy',
  }), {
    PATH: 'kept',
    VITE_FEATURE_DIARY: '1',
    VITE_TRACT_CRIME_SNAPSHOT: '1',
  });
});

test('release and CI mechanically require exactly one mapped invocation of each DFEV browser suite', async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'));
  const workflow = await readFile(ciUrl, 'utf8');
  const { RELEASE_STEPS } = await import(releaseRunnerUrl);
  const expectedLeafScripts = {
    'test:area-intelligence-browser': 'node scripts/tests/area_intelligence_browser.mjs',
    'test:home-compare-browser': 'node scripts/tests/home_compare_browser.mjs',
    'test:known-route-evidence-browser': 'node scripts/tests/known_route_evidence_browser.mjs',
  };
  assert.deepEqual(RELEASE_STEPS, [
    ['audit', '--audit-level=high'],
    ['run', 'lint:js'],
    ['run', 'lint:css'],
    ['run', 'ci:core'],
    ['run', 'test:browser-smoke'],
    ['run', 'test:acs-multitract-browser'],
    ['run', 'test:area-intelligence-browser'],
    ['run', 'test:home-compare-browser'],
    ['run', 'test:known-route-evidence-browser'],
    ['node', 'scripts/run_visual_experience_dist.mjs'],
  ]);
  for (const [script, command] of Object.entries(expectedLeafScripts)) {
    assert.equal(packageJson.scripts[script], command, `${script} must retain its exact browser file mapping`);
    assert.equal(
      Object.entries(packageJson.scripts)
        .filter(([name, value]) => name !== script && value.includes(command)).length,
      0,
      `${script} file may only be owned by its leaf package script`,
    );
    assert.equal(
      Object.entries(packageJson.scripts)
        .filter(([name, value]) => name !== script && npmRunReferences(value).includes(script)).length,
      0,
      `${script} may not be repeated by another package composite`,
    );
    assert.equal(RELEASE_STEPS.filter((step) => step[0] === 'run' && step[1] === script).length, 1);
  }
  const release = jobBlock(workflow, 'release');
  assert.match(release, /npx playwright install --with-deps chromium/);
  assert.equal((release.match(/npm run ci:release/g) || []).length, 1);
  assert.equal((workflow.match(/npm run ci:release/g) || []).length, 1, 'only the release job invokes the composite runner');
  for (const script of Object.keys(expectedLeafScripts)) {
    assert.equal((workflow.match(new RegExp(`npm run ${script}`, 'g')) || []).length, 0,
      `${script} must only flow through ci:release, never another workflow job`);
  }
  assert.deepEqual(
    Object.entries(packageJson.scripts)
      .filter(([name, value]) => name !== 'ci:release' && value.includes('scripts/run_release_gate.mjs')),
    [],
    'ci:release is the sole package entrypoint for the release runner',
  );
});

function npmRunReferences(command) {
  return [...String(command).matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((match) => match[1]);
}
