import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchHomeProfileEvidence, resolveHomePropertyAddress } from '../../src/home_compare/api.js';
import { validateHomeCompareSourceRegistry } from '../../src/home_compare/source_registry.js';
import registry from '../../public/data/home_compare_sources.v1.json' with { type: 'json' };

test('Home Compare registry remains a trusted bounded nine-source baseline', () => {
  assert.equal(registry.sources.length, 9);
  for (const [index, source] of registry.sources.entries()) {
    const mutations = {
      canonical_url: 'https://example.invalid/hostile-source', dataset: `${source.dataset}-hostile-drift`,
      expected_fields: [...source.expected_fields, 'hostile_field'], selected_fields: source.selected_fields.slice(0, -1),
      ...(source.api_url ? { api_url: 'https://example.invalid/hostile-api', transport: source.transport === 'carto-sql' ? 'arcgis-feature-service' : 'carto-sql' } : {}),
    };
    for (const [field, hostileValue] of Object.entries(mutations)) {
      const hostile = structuredClone(registry); hostile.sources[index][field] = hostileValue;
      assert.throws(() => validateHomeCompareSourceRegistry(hostile), /source (?:identit|registr)/i, `${source.id} accepted hostile ${field}`);
    }
  }
});

test('private Home Compare address and evidence entry points reject before every request', async () => {
  let requests = 0;
  const request = async () => { requests += 1; throw new Error('request must not run'); };
  await assert.rejects(resolveHomePropertyAddress('100 TEST ST', { request }), /private address and buffer analysis is unavailable/i);
  await assert.rejects(fetchHomeProfileEvidence({ parcelId:'123456789', lngLat:[-75.16,39.95] }, { request }), /private address and buffer analysis is unavailable/i);
  assert.equal(requests, 0);
});
