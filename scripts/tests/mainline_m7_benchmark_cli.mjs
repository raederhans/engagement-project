import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const commandPath = new URL('../local_route_companion/run-m7-public-benchmark.mjs', import.meta.url);

test('benchmark command is preflight-only and never imports caller-selected runtime modules', async () => {
  const result = await run(['--engine-module=attacker.mjs']);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /custom runtime modules are not admitted/);
  assert.equal(result.stdout, '');
});

test('benchmark command emits an honest unavailable preflight receipt', async () => {
  const result = await run(['--run-id=m7-cli-preflight-test']);
  assert.equal(result.exitCode, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'unavailable');
  assert.equal(receipt.reasonCodes[0], 'engine-unavailable');
  assert.match(receipt.privacy.measurement, /no-runtime-executed/);
});

test('benchmark output cannot escape the fixed local output directory', async () => {
  const result = await run(['--output=../outside.json']);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /fixed local benchmark output directory/);
});

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(commandPath), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    once(child, 'exit').then(([exitCode]) => resolve({ exitCode, stdout, stderr }), reject);
  });
}
