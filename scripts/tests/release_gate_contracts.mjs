import assert from 'node:assert/strict';
import test from 'node:test';

import { createReleasePortAudit, formatReleaseFailure, RELEASE_STEPS, runCommand, runReleaseGate } from '../run_release_gate.mjs';

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

test('release port audit performs the same PID ownership check on Linux and fails closed when unsupported', async () => {
  let afterRun = false;
  const before = 'LISTEN 0 511 127.0.0.1:4178 0.0.0.0:* users:(("node",pid=101,fd=20))\n';
  const after = `${before}LISTEN 0 511 127.0.0.1:4189 0.0.0.0:* users:(("node",pid=202,fd=20))\n`;
  const audit = createReleasePortAudit({ ports: [4178, 4189], platform: 'linux', run: () => (afterRun ? after : before) });
  afterRun = true;
  await assert.rejects(audit.verify(), (error) => {
    assert.deepEqual(error.leaks, [{ port: 4189, pid: 202 }]);
    return true;
  });
  assert.throws(() => createReleasePortAudit({ ports: [4178], platform: 'darwin', run: () => '' }), /unavailable/);
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

test('release gate preserves a nonzero step and all cleanup failures', async () => {
  const cleanupA = new Error('listener remained'); const cleanupB = new Error('postcondition failed');
  const started = [];
  await assert.rejects(runReleaseGate({
    environment: { npm_execpath: 'npm-cli.js' },
    execute: async (_command, args) => { started.push(args.at(-1)); return 23; },
    taskOwnershipAudit: { async verify() { throw cleanupA; } },
    postcondition: async () => { throw cleanupB; },
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.primaryError.code, 'RELEASE_STEP_NONZERO');
    assert.deepEqual(error.primaryError.step, RELEASE_STEPS[0]);
    assert.equal(error.primaryError.exitCode, 23);
    assert.equal(error.primaryError.command, process.execPath);
    assert.deepEqual(error.primaryError.args, ['npm-cli.js', 'audit', '--audit-level=high']);
    assert.deepEqual(error.cleanupErrors, [cleanupA, cleanupB]);
    assert.deepEqual(error.errors, [error.primaryError, cleanupA, cleanupB]);
    return true;
  });
  assert.deepEqual(started, ['--audit-level=high'], 'a nonzero first step prevents N+1 from starting');
});

test('release failure formatter retains executable argv, step, exit code, and every cleanup error', () => {
  const primary = Object.assign(new Error('nonzero child'), { code: 'RELEASE_STEP_NONZERO', command: 'node', args: ['npm-cli.js', 'run', 'lint:js'], step: ['run', 'lint:js'], exitCode: 9 });
  const cleanupA = new Error('listener remained'); const cleanupB = new Error('postcondition failed');
  const aggregate = new AggregateError([primary, cleanupA, cleanupB], 'Release gate failed and postcondition failed.');
  const formatted = formatReleaseFailure(aggregate);
  assert.match(formatted, /command=node/);
  assert.match(formatted, /argv=\["npm-cli.js","run","lint:js"\]/);
  assert.match(formatted, /step=run lint:js/);
  assert.match(formatted, /exitCode=9/);
  assert.match(formatted, /listener remained/);
  assert.match(formatted, /postcondition failed/);
});

test('runCommand preserves child spawn and signal failures', async () => {
  await assert.rejects(runCommand('node', ['fixture'], {}, { spawnChild: () => ({ once(event, listener) { if (event === 'error') queueMicrotask(() => listener(new Error('spawn failure'))); } }) }), /spawn failure/);
  await assert.rejects(runCommand('node', ['fixture'], {}, { spawnChild: () => ({ once(event, listener) { if (event === 'exit') queueMicrotask(() => listener(null, 'SIGTERM')); } }) }), /SIGTERM/);
});
