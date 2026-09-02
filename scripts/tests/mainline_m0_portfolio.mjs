import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Portfolio v2 narrative exposes the evidence lab and preserves claim boundaries', async () => {
  const [english, chinese, portfolio, mutationPlan, index] = await Promise.all([
    read('README.md'),
    read('README.zh-CN.md'),
    read('docs/PORTFOLIO_V2.md'),
    read('docs/REMOTE_GOVERNANCE_MUTATION_PLAN.md'),
    read('index.html'),
  ]);
  for (const document of [english, chinese]) {
    assert.match(document, /Philadelphia Urban Evidence Lab/);
    assert.match(document, /3,586,620/);
    assert.match(document, /10\.81 GB/i);
    assert.match(document, /not-promoted|未晋级/);
    assert.match(document, /unavailable|不可用/);
    assert.doesNotMatch(document, /deploy-pages\.yml/);
  }
  assert.match(portfolio, /flowchart/);
  assert.match(portfolio, /ArtifactRegistry\/v1/);
  assert.match(portfolio, /Diary.*demo-only/is);
  assert.match(portfolio, /Known Route.*combined safety score/is);
  assert.match(mutationPlan, /This file is a plan, not evidence that\s+any mutation was executed\./i);
  assert.match(mutationPlan, /ruleset/i);
  assert.match(index, /Philadelphia Urban Evidence Lab/);
});

test('Portfolio public narrative does not claim R7 delivery or model promotion', async () => {
  const publicNarrative = `${await read('README.md')}\n${await read('README.zh-CN.md')}\n${await read('docs/PORTFOLIO_V2.md')}`;
  assert.doesNotMatch(publicNarrative, /R7[^\n]*(?:available|delivered|released|已发布|已交付)/i);
  assert.doesNotMatch(publicNarrative, /model[^\n]*(?:promoted to production|production promoted)/i);
});
