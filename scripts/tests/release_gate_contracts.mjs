import assert from 'node:assert/strict';
import test from 'node:test';

import { createReleasePortAudit, RELEASE_STEPS, runCommand, runReleaseGate } from '../run_release_gate.mjs';

test('release gate stops after the first nonzero child and always checks its postcondition', async () => {
  const started = []; let postconditions = 0; let audits = 0;
  const code = await runReleaseGate({ environment: { npm_execpath: 'npm-cli.js' }, execute: async (_command, args) => { started.push(args.at(-1)); return started.length === 4 ? 9 : 0; }, taskOwnershipAudit: { async verify() { audits += 1; } }, postcondition: async () => { postconditions += 1; } });
  assert.equal(code, 9); assert.equal(started.length, 4); assert.equal(postconditions, 1);
  assert.equal(audits, 1);
  assert.equal(started.includes(RELEASE_STEPS[4][1]), false, 'N+1 must not start');
});

test('release gate runs postcondition after a spawned-child error or signal rejection', async () => {
  for (const failure of [new Error('spawn failure'), new Error('stopped by signal SIGTERM')]) {
    let postconditions = 0;
    await assert.rejects(runReleaseGate({ environment: { npm_execpath: 'npm-cli.js' }, execute: async () => { throw failure; }, taskOwnershipAudit: { async verify() {} }, postcondition: async () => { postconditions += 1; } }), (error) => error === failure);
    assert.equal(postconditions, 1);
  }
});

test('release port audit ignores pre-existing listeners but fails closed on a newly owned listener', async () => {
  let afterRun = false;
  const before = '  TCP    127.0.0.1:4178     0.0.0.0:0              LISTENING       101\n';
  const after = '  TCP    127.0.0.1:4178     0.0.0.0:0              LISTENING       101\n  TCP    127.0.0.1:4189     0.0.0.0:0              LISTENING       202\n';
  const audit = createReleasePortAudit({ ports: [4178, 4189], platform: 'win32', run: () => (afterRun ? after : before) });
  afterRun = true;
  await assert.rejects(audit.verify(), (error) => {
    assert.deepEqual(error.leaks, [{ port: 4189, pid: 202 }]);
    return true;
  });
});

test('release gate reports both a primary execution failure and an ownership-audit failure', async () => {
  const primary = new Error('child failed'); const cleanup = new Error('listener remained');
  await assert.rejects(runReleaseGate({
    environment: { npm_execpath: 'npm-cli.js' },
    execute: async () => { throw primary; },
    taskOwnershipAudit: { async verify() { throw cleanup; } },
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, cleanup]);
    assert.equal(error.primaryError, primary);
    assert.deepEqual(error.cleanupErrors, [cleanup]);
    return true;
  });
});

test('runCommand preserves child spawn and signal failures', async () => {
  await assert.rejects(runCommand('node', ['fixture'], {}, { spawnChild: () => ({ once(event, listener) { if (event === 'error') queueMicrotask(() => listener(new Error('spawn failure'))); } }) }), /spawn failure/);
  await assert.rejects(runCommand('node', ['fixture'], {}, { spawnChild: () => ({ once(event, listener) { if (event === 'exit') queueMicrotask(() => listener(null, 'SIGTERM')); } }) }), /SIGTERM/);
});
