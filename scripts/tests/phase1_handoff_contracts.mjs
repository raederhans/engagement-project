import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
});
