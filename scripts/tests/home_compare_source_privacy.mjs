import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchHomeProfileEvidence, resolveHomePropertyAddress } from '../../src/home_compare/api.js';
import { validateHomeCompareSourceRegistry } from '../../src/home_compare/source_registry.js';
import registry from '../../public/data/home_compare_sources.v1.json' with { type: 'json' };

test('Home Compare registry remains a trusted bounded nine-source baseline', () => {
  assert.equal(registry.sources.length, 9);
  assert.deepEqual(validateHomeCompareSourceRegistry(structuredClone(registry)), registry);
  const hostile = structuredClone(registry); hostile.sources[0].canonical_url = 'https://example.invalid/hostile';
  assert.throws(() => validateHomeCompareSourceRegistry(hostile), /source/i);
});

test('private Home Compare address and evidence entry points reject before every request', async () => {
  let requests = 0;
  const request = async () => { requests += 1; throw new Error('request must not run'); };
  await assert.rejects(resolveHomePropertyAddress('100 TEST ST', { request }), /private address and buffer analysis is unavailable/i);
  await assert.rejects(fetchHomeProfileEvidence({ parcelId:'123456789', lngLat:[-75.16,39.95] }, { request }), /private address and buffer analysis is unavailable/i);
  assert.equal(requests, 0);
});
