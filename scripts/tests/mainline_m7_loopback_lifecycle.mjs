import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { startLocalRouteCompanionService } from '../local_route_companion/service.mjs';

const servicePath = new URL('../local_route_companion/service.mjs', import.meta.url);
const cliPath = new URL('../local_route_companion/cli.mjs', import.meta.url);
const PRIVATE_SENTINEL = 'private-route-sentinel-92741';

test('service binds literal IPv4 loopback and rejects a non-loopback host configuration', async () => {
  const companion = { generate: async () => ({ status: 'unavailable' }) };
  const running = await startLocalRouteCompanionService({ port: 0, companion });
  try {
    const address = running.server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(address.family, 'IPv4');
    await assert.rejects(
      startLocalRouteCompanionService({ host: '0.0.0.0', port: 0, companion }),
      /must be 127\.0\.0\.1/,
    );
  } finally {
    await running.close();
  }
});

test('route uses a body-only private request and unavailable engine returns Known Route fallback without echo', async (t) => {
  const child = fork(servicePath, ['--host', '127.0.0.1', '--port', '0'], {
    silent: true,
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const [ready] = await once(child, 'message');
  const requestBody = JSON.stringify({
    schemaVersion: 'LocalRoutePrivateRequest/v1',
    requestId: PRIVATE_SENTINEL,
    mode: 'walk',
    origin: { longitude: -75.1652, latitude: 39.9526 },
    destination: { longitude: -75.1842, latitude: 39.9501 },
  });
  const observedPaths = [];
  const response = await postRoute(ready.port, requestBody, observedPaths);
  assert.equal(ready.host, '127.0.0.1');
  assert.deepEqual(observedPaths, ['/route']);
  assert.match(JSON.stringify(response), /known.route|paste|draw/i);
  assert.doesNotMatch(JSON.stringify(response), /-75\.1652|-75\.1842|39\.9526|39\.9501/);
  assert.equal(response.privacy.privacyEgressCount, null);
  assert.equal(response.privacy.egressObservationStatus, 'unverified');

  child.send({ type: 'shutdown' });
  const [exitCode] = await once(child, 'exit');
  assert.equal(exitCode, 0);
  assert.doesNotMatch(stdout, new RegExp(PRIVATE_SENTINEL));
  assert.doesNotMatch(stderr, new RegExp(PRIVATE_SENTINEL));
  assert.equal(await canConnect(ready.port), false);
});

test('CLI route accepts private input only from stdin and never places it in argv or URL', async () => {
  let receivedUrl;
  let receivedBody = '';
  const server = http.createServer((request, response) => {
    receivedUrl = request.url;
    request.setEncoding('utf8');
    request.on('data', (chunk) => { receivedBody += chunk; });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'unavailable', fallback: ['paste', 'draw'] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const child = spawn(process.execPath, [cliPath.pathname.slice(1), 'route', '--port', String(port)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let error = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { error += chunk; });
  const requestBody = JSON.stringify({ requestId: PRIVATE_SENTINEL });
  child.stdin.end(requestBody);
  const [exitCode] = await once(child, 'exit');
  await new Promise((resolve) => server.close(resolve));

  assert.equal(exitCode, 0, error);
  assert.equal(receivedUrl, '/route');
  assert.equal(receivedBody, requestBody);
  assert.doesNotMatch(child.spawnargs.join(' '), new RegExp(PRIVATE_SENTINEL));
  assert.match(output, /unavailable/);
});

test('route transport rejects an oversized body before invoking the companion', async () => {
  let generationCount = 0;
  const running = await startLocalRouteCompanionService({
    port: 0,
    maxBodyBytes: 32,
    companion: {
      generate: async () => {
        generationCount += 1;
        return { status: 'unavailable' };
      },
    },
  });
  try {
    const response = await rawRequest(running.port, JSON.stringify({ private: 'x'.repeat(64) }));
    assert.equal(response.statusCode, 413);
    assert.equal(generationCount, 0);
  } finally {
    await running.close();
  }
});

test('service requires the exact bound Host and rejects every non-empty Origin', async () => {
  let generationCount = 0;
  const running = await startLocalRouteCompanionService({
    port: 0,
    companion: {
      generate: async () => {
        generationCount += 1;
        return { status: 'unavailable' };
      },
    },
  });
  try {
    const body = JSON.stringify({ requestId: PRIVATE_SENTINEL });
    const wrongHost = await rawRequest(running.port, body, '/route', { host: 'localhost' });
    const origin = await rawRequest(running.port, body, '/route', {
      origin: 'http://127.0.0.1',
    });
    assert.equal(wrongHost.statusCode, 403);
    assert.equal(origin.statusCode, 403);
    assert.equal(generationCount, 0);

    const health = await getJson(running.port, '/health');
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.privacy_evidence, 'not_measured_by_health');
    assert.equal(health.body.adapter_trust, 'caller-injected-companion-unverified');
    assert.equal(Object.hasOwn(health.body, 'privacy_egress_count'), false);
  } finally {
    await running.close();
  }
});

test('generation deadline aborts a never-resolving job and close cancels active work', async () => {
  let deadlineSignal;
  const timedService = await startLocalRouteCompanionService({
    port: 0,
    generationTimeoutMs: 30,
    companion: {
      generate: async (_rawRequest, { signal }) => {
        deadlineSignal = signal;
        return new Promise(() => {});
      },
    },
  });
  try {
    const response = await jsonRequest(timedService.port, '{}');
    assert.equal(response.statusCode, 504);
    assert.equal(response.body.error, 'route_generation_timed_out');
    assert.equal(deadlineSignal.aborted, true);
  } finally {
    await timedService.close();
  }

  let startGeneration;
  const generationStarted = new Promise((resolve) => { startGeneration = resolve; });
  let closeSignal;
  const closingService = await startLocalRouteCompanionService({
    port: 0,
    generationTimeoutMs: 30_000,
    companion: {
      generate: async (_rawRequest, { signal }) => {
        closeSignal = signal;
        startGeneration();
        return new Promise(() => {});
      },
    },
  });
  const pending = jsonRequest(closingService.port, '{}').catch((error) => error);
  await generationStarted;
  await closingService.close();
  assert.equal(closeSignal.aborted, true);
  await pending;
  assert.equal(await canConnect(closingService.port), false);
});

test('route transport rejects query-bearing URLs before invoking the companion', async () => {
  let generationCount = 0;
  const running = await startLocalRouteCompanionService({
    port: 0,
    companion: {
      generate: async () => {
        generationCount += 1;
        return { status: 'unavailable' };
      },
    },
  });
  try {
    const response = await rawRequest(
      running.port,
      JSON.stringify({ requestId: PRIVATE_SENTINEL }),
      `/route?origin=${encodeURIComponent(PRIVATE_SENTINEL)}`,
    );
    assert.equal(response.statusCode, 404);
    assert.equal(generationCount, 0);
    const absoluteForm = await rawRequest(
      running.port,
      JSON.stringify({ requestId: PRIVATE_SENTINEL }),
      `http://attacker.invalid/route`,
    );
    assert.equal(absoluteForm.statusCode, 404);
    assert.equal(generationCount, 0);
  } finally {
    await running.close();
  }
});

test('service loads only a caller-selected local adapter module', async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'm7-local-adapter-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const adapterPath = join(temporaryRoot, 'adapter.mjs');
  await writeFile(adapterPath, `
    export default Object.freeze({
      identity: 'm7-test-local-adapter',
      transport: Object.freeze({ kind: 'in-process' }),
      async generate() { return Object.freeze({ status: 'unavailable' }); },
    });
  `, 'utf8');
  const running = await startLocalRouteCompanionService({
    port: 0,
    adapterModule: adapterPath,
  });
  try {
    const response = await postRoute(running.port, JSON.stringify({
      schemaVersion: 'LocalRoutePrivateRequest/v1',
      requestId: PRIVATE_SENTINEL,
      mode: 'walk',
      origin: { longitude: -75.1652, latitude: 39.9526 },
      destination: { longitude: -75.1842, latitude: 39.9501 },
    }), []);
    assert.equal(response.status, 'unavailable');
    assert.equal(running.adapterTrust, 'caller-trusted-local-module-unverified');
    assert.equal(response.engine.identity, 'm7-test-local-adapter');
    assert.equal(response.privacy.privacyEgressCount, null);
    assert.equal(response.privacy.egressObservationStatus, 'unverified');
  } finally {
    await running.close();
  }
  await assert.rejects(
    startLocalRouteCompanionService({ port: 0, adapterModule: 'https://example.invalid/a.mjs' }),
    /caller-trusted local absolute/,
  );
  await assert.rejects(
    startLocalRouteCompanionService({ port: 0, adapterModule: 'relative-adapter.mjs' }),
    /caller-trusted local absolute/,
  );
  await assert.rejects(
    startLocalRouteCompanionService({ port: 0, adapterModule: '\\\\server\\share\\adapter.mjs' }),
    /caller-trusted local absolute/,
  );
  await assert.rejects(
    startLocalRouteCompanionService({ port: 0, adapterModule: '\\\\?\\C:\\adapter.mjs' }),
    /caller-trusted local absolute/,
  );
});

function postRoute(port, body, observedPaths) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path: '/route', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      observedPaths.push(response.req.path);
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

function rawRequest(port, body, path = '/route', extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...extraHeaders,
      },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response));
    });
    request.on('error', reject);
    request.end(body);
  });
}

function jsonRequest(port, body, path = '/route') {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({
            statusCode: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({
            statusCode: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}
