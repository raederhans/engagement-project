import assert from 'node:assert/strict';
import test from 'node:test';

import { formatVisualFailure, runPlaywright, runVisualCli, runVisualExperienceDist } from '../run_visual_experience_dist.mjs';

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

test('visual runner turns an isolated nonzero result into a structured primary failure', async () => {
  await assert.rejects(runVisualExperienceDist({ createPreview: async () => ({ close: async () => {} }), run: async () => 9 }), (error) => error.code === 'VISUAL_PLAYWRIGHT_NONZERO' && error.exitCode === 9 && error.command === process.execPath && Array.isArray(error.args));
});

test('visual child spawn and signal failures retain command, argv, step, and signal', async () => {
  await assert.rejects(runPlaywright({ spawnChild: () => ({ once(event, listener) { if (event === 'error') queueMicrotask(() => listener(new Error('spawn failure'))); } }) }), (error) => error.code === 'VISUAL_PLAYWRIGHT_SPAWN' && error.command === process.execPath && Array.isArray(error.args) && error.step && /spawn failure/.test(error.message));
  await assert.rejects(runPlaywright({ spawnChild: () => ({ once(event, listener) { if (event === 'exit') queueMicrotask(() => listener(null, 'SIGTERM')); } }) }), (error) => error.code === 'VISUAL_PLAYWRIGHT_SIGNAL' && error.signal === 'SIGTERM' && error.command === process.execPath && Array.isArray(error.args));
});

test('visual CLI formatter preserves nonzero primary context and cleanup errors', () => {
  const primary = Object.assign(new Error('visual nonzero'), { code: 'VISUAL_PLAYWRIGHT_NONZERO', command: 'node', args: ['playwright-cli.js', 'test'], step: 'playwright test --config=playwright.config.mjs', exitCode: 9 });
  const cleanup = new Error('preview close failure');
  const formatted = formatVisualFailure(new AggregateError([primary, cleanup], 'Visual runner failed and preview cleanup failed.'));
  assert.match(formatted, /command=node/);
  assert.match(formatted, /argv=\["playwright-cli.js","test"\]/);
  assert.match(formatted, /step=playwright test --config=playwright.config.mjs/);
  assert.match(formatted, /exitCode=9/);
  assert.match(formatted, /preview close failure/);
});

test('visual CLI formats isolated spawn, signal, cleanup-only, and primary-plus-cleanup failures with an explicit exit mapping', async () => {
  const failures = [
    Object.assign(new Error('spawn'), { code: 'VISUAL_PLAYWRIGHT_SPAWN', command: 'node', args: ['playwright-cli.js', 'test'], step: 'playwright test --config=playwright.config.mjs' }),
    Object.assign(new Error('signal'), { code: 'VISUAL_PLAYWRIGHT_SIGNAL', command: 'node', args: ['playwright-cli.js', 'test'], step: 'playwright test --config=playwright.config.mjs', signal: 'SIGTERM' }),
    new AggregateError([new Error('cleanup-only')], 'Visual preview cleanup failed.'),
    new AggregateError([
      Object.assign(new Error('nonzero'), { code: 'VISUAL_PLAYWRIGHT_NONZERO', command: 'node', args: ['playwright-cli.js', 'test'], step: 'playwright test --config=playwright.config.mjs', exitCode: 9 }),
      new Error('preview cleanup one'), new Error('preview cleanup two'),
    ], 'Visual runner failed and preview cleanup failed.'),
  ];
  for (const failure of failures) {
    const written = [];
    const result = await runVisualCli({ runner: async () => { throw failure; }, write: (message) => written.push(message) });
    assert.equal(result.output, written[0]);
    if (failure.exitCode) assert.equal(result.exitCode, failure.exitCode);
    else assert.equal(result.exitCode, 1);
  }
  const aggregate = await runVisualCli({
    runner: () => runVisualExperienceDist({
      createPreview: async () => ({ close: async () => { throw new Error('preview cleanup one'); } }),
      run: async () => 9,
    }),
    write: () => {},
  });
  assert.equal(aggregate.exitCode, 9, 'aggregate preserves its primary child exit code');
  assert.match(aggregate.output, /argv=\[.*"test","--config=playwright\.config\.mjs"\]/);
  assert.match(aggregate.output, /step=playwright test --config=playwright.config.mjs/);
  assert.match(aggregate.output, /exitCode=9/);
  assert.match(aggregate.output, /preview cleanup one/);
});
