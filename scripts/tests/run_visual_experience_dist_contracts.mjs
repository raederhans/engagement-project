import assert from 'node:assert/strict';
import test from 'node:test';

import { runVisualExperienceDist } from '../run_visual_experience_dist.mjs';

test('visual runner closes the owning PreviewServer after success', async () => {
  const calls = [];
  const code = await runVisualExperienceDist({ createPreview: async () => ({ close: async () => calls.push('preview.close') }), run: async () => { calls.push('run'); return 0; } });
  assert.equal(code, 0); assert.deepEqual(calls, ['run', 'preview.close']);
});

test('visual runner preserves primary and preview-close failures together', async () => {
  const primary = new Error('playwright failure'); const cleanup = new Error('preview close failure');
  await assert.rejects(runVisualExperienceDist({ createPreview: async () => ({ close: async () => { throw cleanup; } }), run: async () => { throw primary; } }), (error) => error instanceof AggregateError && error.primaryError === primary && error.cleanupErrors[0] === cleanup && error.errors[0] === primary);
});

test('visual runner reports an isolated preview-close failure', async () => {
  const cleanup = new Error('preview close failure');
  await assert.rejects(runVisualExperienceDist({ createPreview: async () => ({ close: async () => { throw cleanup; } }), run: async () => 0 }), (error) => error instanceof AggregateError && error.errors[0] === cleanup);
});

test('visual runner preserves a nonzero Playwright step and preview-close failure together', async () => {
  const cleanup = new Error('preview close failure');
  await assert.rejects(
    runVisualExperienceDist({
      createPreview: async () => ({ close: async () => { throw cleanup; } }),
      run: async () => 9,
    }),
    (error) => error instanceof AggregateError
      && error.primaryError?.code === 'VISUAL_PLAYWRIGHT_NONZERO'
      && error.primaryError?.command === process.execPath
      && error.primaryError?.step === 'playwright test --config=playwright.config.mjs'
      && error.primaryError?.exitCode === 9
      && error.cleanupErrors?.[0] === cleanup
      && error.errors?.[0] === error.primaryError,
  );
});
