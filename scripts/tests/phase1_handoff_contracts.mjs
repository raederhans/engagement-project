import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { HOME_COMPARE_SCHEMA } from '../../src/home_compare/contract.js';
import { SOURCE_HEALTH_SCHEMA_VERSION, SOURCE_HEALTH_STATUSES } from '../../src/source_health/source_health_read_model.js';

const planUrl = new URL('../../docs/active/phase1-evidence-completion/plan.md', import.meta.url);
const packageUrl = new URL('../../package.json', import.meta.url);

test('Phase 1 handoff keeps existing source lifecycle contracts executable and binds the matrix to the standard graph', async () => {
  const [plan, packageText] = await Promise.all([readFile(planUrl, 'utf8'), readFile(packageUrl, 'utf8')]);
  const packageJson = JSON.parse(packageText);
  assert.equal(HOME_COMPARE_SCHEMA, 'engagement-home-neighborhood-compare/v1');
  assert.equal(SOURCE_HEALTH_SCHEMA_VERSION, 'engagement-source-health/v1');
  assert.deepEqual(SOURCE_HEALTH_STATUSES, ['current', 'partial', 'stale', 'unavailable', 'unknown']);
  assert.equal(packageJson.scripts['test:phase1-handoff'], 'node --test scripts/tests/phase1_handoff_contracts.mjs');
  assert.match(packageJson.scripts['test:data-contract'], /npm run test:phase1-handoff/);
  const normalizedPlan = plan.replace(/\s+/g, ' ');
  for (const phrase of [
    'new mechanical release/browser wiring coverage',
    'recorded and re-verified existing executable contracts',
    'M1 frozen warehouse', 'M2 mart/evaluation', 'M3 Home Compare', 'M4 Known Route', '1D integration/release',
    'sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt',
    'validated recoverable serialized multi-file transaction',
    'final 1D integration/release owner',
    'M0 lifecycle baseline → M1 frozen warehouse → M2 mart/evaluation',
  ]) assert.ok(normalizedPlan.includes(phrase), 'Phase 1 plan must retain ' + phrase);

  const matrix = new Map([
    ['M1 frozen warehouse', {
      owner: 'Owner: M1 frozen warehouse task',
      boundary: 'Forbidden/shared:',
      retention: 'Retention:',
      receipt: 'warehouse manifest/checkpoint/lineage receipt',
      nonAuthority: 'not serving, promotion, or authority evidence',
      gate: 'npm run test:data-pipeline',
    }],
    ['M2 mart/evaluation', {
      owner: 'Owner: M2 mart/evaluation task',
      boundary: 'Forbidden/shared:',
      retention: 'Retention:',
      receipt: 'M2 receipt binds the M1 receipt',
      nonAuthority: 'not a serving/promotion authority',
      gate: 'npm run test:area-intelligence-browser',
    }],
    ['M3 Home Compare', {
      owner: 'Owner: M3 Home Compare task',
      boundary: 'Forbidden/shared:',
      retention: 'Retention: M3 task owner',
      receipt: 'M3 producer receipt binds',
      nonAuthority: 'neither serving nor promotion/authority data',
      gate: 'npm run test:home-compare-browser',
    }],
    ['M4 Known Route', {
      owner: 'Owner: M4 Known Route task',
      boundary: 'Forbidden/shared:',
      retention: 'Retention: M4 task owner',
      receipt: 'M4 final receipt binds',
      nonAuthority: 'cannot be serving/promotion/routing authority',
      gate: 'npm run test:known-route-evidence-browser',
    }],
  ]);
  for (const [milestone, assertions] of matrix) {
    const row = plan.split('\n').find((line) => line.startsWith(`| **${milestone}** |`));
    assert.ok(row, `Phase 1 matrix must include a complete ${milestone} row`);
    for (const [kind, phrase] of Object.entries(assertions)) {
      assert.ok(row.includes(phrase), `${milestone} row must retain ${kind}: ${phrase}`);
    }
    assert.ok(row.includes('Exact-tip barrier:'), `${milestone} row must retain the exact-tip barrier`);
  }

  const m4Row = plan.split('\n').find((line) => line.startsWith('| **M4 Known Route** |'));
  assert.doesNotMatch(m4Row, /src\/known_route_evidence/);
  assert.match(m4Row, /src\/routes_crime\/known_route_\*\.js/);
  assert.match(m4Row, /scripts\/lib\/known_route_evidence_checkpoint\.mjs/);
  await Promise.all([
    'src/routes_crime/known_route_evidence_contract.js',
    'src/routes_crime/known_route_centerline.js',
    'src/routes_crime/known_route_contributions.js',
    'src/routes_crime/known_route_evidence_ui.js',
    'scripts/lib/known_route_evidence_checkpoint.mjs',
  ].map((file) => access(new URL(`../../${file}`, import.meta.url))));
  assert.match(normalizedPlan, /M3 and M4 preparation may run in parallel only when they share neither writable paths nor live outputs; M4 final publication and final receipt wait for the validated M3 receipt/);
});
