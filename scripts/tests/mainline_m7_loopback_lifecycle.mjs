import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { requestAuthenticatedRoute } from '../local_route_companion/cli.mjs';
import { startLocalRouteCompanionService } from '../local_route_companion/service.mjs';
import {
  LOCAL_ROUTE_AUTH_CHALLENGE_SCHEMA_VERSION,
  LOCAL_ROUTE_SESSION_SECRET_ENV,
  createChallengeNonce,
  createRouteAuthorization,
  createSessionSecret,
  encodeSessionSecret,
  verifyServerProof,
} from '../local_route_companion/session_auth.mjs';

const servicePath = new URL('../local_route_companion/service.mjs', import.meta.url);
const cliPath = new URL('../local_route_companion/cli.mjs', import.meta.url);
const powershellPath = new URL('../local_route_companion/start-local-route-companion.ps1', import.meta.url);
const PRIVATE_SENTINEL = 'private-route-sentinel-92741';

test('service binds literal IPv4 loopback and rejects a non-loopback host configuration', async () => {
  const companion = { generate: async () => ({ status: 'unavailable' }) };
  const sessionSecret = createSessionSecret();
  const running = await startLocalRouteCompanionService({ port: 0, companion, sessionSecret });
  try {
    const address = running.server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(address.family, 'IPv4');
    await assert.rejects(
      startLocalRouteCompanionService({
        host: '0.0.0.0', port: 0, companion, sessionSecret,
      }),
      /must be 127\.0\.0\.1/,
    );
    await assert.rejects(
      startLocalRouteCompanionService({ port: 0, companion }),
      /session secret must contain 32 bytes/,
    );
  } finally {
    await running.close();
    sessionSecret.fill(0);
  }
});

test('route uses a body-only private request and unavailable engine returns Known Route fallback without echo', async (t) => {
  const sessionSecret = createSessionSecret();
  const encodedSecret = encodeSessionSecret(sessionSecret);
  const child = fork(servicePath, ['--host', '127.0.0.1', '--port', '0'], {
    silent: true,
    env: { ...process.env, [LOCAL_ROUTE_SESSION_SECRET_ENV]: encodedSecret },
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    sessionSecret.fill(0);
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
  const response = await requestAuthenticatedRoute({
    port: ready.port,
    body: requestBody,
    sessionSecret,
  });
  assert.equal(ready.host, '127.0.0.1');
  assert.equal(ready.routeAuthentication, 'one-time-hmac-sha256');
  assert.match(JSON.stringify(response), /known.route|paste|draw/i);
  assert.doesNotMatch(JSON.stringify(response), /-75\.1652|-75\.1842|39\.9526|39\.9501/);
  assert.equal(response.privacy.privacyEgressCount, null);
  assert.equal(response.privacy.egressObservationStatus, 'unverified');

  child.send({ type: 'shutdown' });
  const [exitCode] = await once(child, 'exit');
  assert.equal(exitCode, 0);
  assert.doesNotMatch(stdout, new RegExp(PRIVATE_SENTINEL));
  assert.doesNotMatch(stderr, new RegExp(PRIVATE_SENTINEL));
  assert.doesNotMatch(stdout, new RegExp(encodedSecret));
  assert.doesNotMatch(stderr, new RegExp(encodedSecret));
  assert.doesNotMatch(child.spawnargs.join(' '), new RegExp(encodedSecret));
  assert.doesNotMatch(JSON.stringify(ready), new RegExp(encodedSecret));
  assert.equal(await canConnect(ready.port), false);
});

test('authenticated service child closes its listener when the parent IPC disconnects', async (t) => {
  const sessionSecret = createSessionSecret();
  const child = fork(servicePath, ['--host', '127.0.0.1', '--port', '0'], {
    silent: true,
    env: {
      ...process.env,
      [LOCAL_ROUTE_SESSION_SECRET_ENV]: encodeSessionSecret(sessionSecret),
    },
  });
  child.stdout.resume();
  child.stderr.resume();
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    sessionSecret.fill(0);
  });
  const [ready] = await once(child, 'message');
  child.disconnect();
  const [exitCode] = await once(child, 'exit');
  assert.equal(exitCode, 0);
  assert.equal(await canConnect(ready.port), false);
});

test('CLI route accepts private input only from stdin and uses an authenticated child', async () => {
  const child = spawn(process.execPath, [cliPath.pathname.slice(1), 'route', '--port', '0'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let error = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { error += chunk; });
  const requestBody = JSON.stringify({
    schemaVersion: 'LocalRoutePrivateRequest/v1',
    requestId: PRIVATE_SENTINEL,
    mode: 'walk',
    origin: { longitude: -75.1652, latitude: 39.9526 },
    destination: { longitude: -75.1842, latitude: 39.9501 },
  });
  child.stdin.end(requestBody);
  const [exitCode] = await once(child, 'exit');

  assert.equal(exitCode, 0, error);
  assert.doesNotMatch(child.spawnargs.join(' '), new RegExp(PRIVATE_SENTINEL));
  assert.match(output, /unavailable/);
  assert.doesNotMatch(output, /-75\.1652|-75\.1842|39\.9526|39\.9501/);
  assert.doesNotMatch(error, new RegExp(PRIVATE_SENTINEL));
});

test('a forged loopback service sees only a coordinate-free challenge and never receives private OD', async () => {
  const observed = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      observed.push({
        url: request.url,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: request.headers,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        schemaVersion: 'mainline-m7-local-auth-proof/v1',
        serverProof: 'A'.repeat(43),
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const sessionSecret = createSessionSecret();
  const encodedSecret = encodeSessionSecret(sessionSecret);
  const requestBody = JSON.stringify({
    requestId: PRIVATE_SENTINEL,
    origin: { longitude: -75.1652, latitude: 39.9526 },
  });
  try {
    await assert.rejects(
      requestAuthenticatedRoute({ port, body: requestBody, sessionSecret }),
      /identity proof was rejected/,
    );
  } finally {
    sessionSecret.fill(0);
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(observed.length, 1);
  assert.equal(observed[0].url, '/auth/challenge');
  assert.doesNotMatch(observed[0].body, /private-route|-75\.1652|39\.9526/);
  assert.doesNotMatch(JSON.stringify(observed[0].headers), new RegExp(encodedSecret));
});

test('a prebound requested port makes the CLI fail without contacting the occupying listener', async () => {
  const observedBodies = [];
  const server = http.createServer((request, response) => {
    request.on('data', (chunk) => observedBodies.push(chunk));
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
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
  child.stdin.end(JSON.stringify({ requestId: PRIVATE_SENTINEL }));
  const [exitCode] = await once(child, 'exit');
  await new Promise((resolve) => server.close(resolve));

  assert.equal(exitCode, 1);
  assert.equal(observedBodies.length, 0);
  assert.doesNotMatch(output, new RegExp(PRIVATE_SENTINEL));
  assert.doesNotMatch(error, new RegExp(PRIVATE_SENTINEL));
});

test('route transport rejects an oversized body before invoking the companion', async () => {
  let generationCount = 0;
  const sessionSecret = createSessionSecret();
  const running = await startLocalRouteCompanionService({
    port: 0,
    maxBodyBytes: 32,
    sessionSecret,
    companion: {
      generate: async () => {
        generationCount += 1;
        return { status: 'unavailable' };
      },
    },
  });
  try {
    const response = await authenticatedJsonRequest(
      running.port,
      sessionSecret,
      JSON.stringify({ private: 'x'.repeat(64) }),
    );
    assert.equal(response.statusCode, 413);
    assert.equal(generationCount, 0);
  } finally {
    await running.close();
    sessionSecret.fill(0);
  }
});

test('service requires the exact bound Host and rejects every non-empty Origin', async () => {
  let generationCount = 0;
  const sessionSecret = createSessionSecret();
  const running = await startLocalRouteCompanionService({
    port: 0,
    sessionSecret,
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
    assert.equal(health.body.route_authentication, 'one-time-hmac-sha256');
    assert.equal(Object.hasOwn(health.body, 'privacy_egress_count'), false);
  } finally {
    await running.close();
    sessionSecret.fill(0);
  }
});

test('generation deadline aborts a never-resolving job and close cancels active work', async () => {
  let deadlineSignal;
  const timedSecret = createSessionSecret();
  const timedService = await startLocalRouteCompanionService({
    port: 0,
    generationTimeoutMs: 30,
    sessionSecret: timedSecret,
    companion: {
      generate: async (_rawRequest, { signal }) => {
        deadlineSignal = signal;
        return new Promise(() => {});
      },
    },
  });
  try {
    const response = await authenticatedJsonRequest(timedService.port, timedSecret, '{}');
    assert.equal(response.statusCode, 504);
    assert.equal(response.body.error, 'route_generation_timed_out');
    assert.equal(deadlineSignal.aborted, true);
  } finally {
    await timedService.close();
    timedSecret.fill(0);
  }

  let startGeneration;
  const generationStarted = new Promise((resolve) => { startGeneration = resolve; });
  let closeSignal;
  const closingSecret = createSessionSecret();
  const closingService = await startLocalRouteCompanionService({
    port: 0,
    generationTimeoutMs: 30_000,
    sessionSecret: closingSecret,
    companion: {
      generate: async (_rawRequest, { signal }) => {
        closeSignal = signal;
        startGeneration();
        return new Promise(() => {});
      },
    },
  });
  const pending = authenticatedJsonRequest(closingService.port, closingSecret, '{}')
    .catch((error) => error);
  await generationStarted;
  await closingService.close();
  closingSecret.fill(0);
  assert.equal(closeSignal.aborted, true);
  await pending;
  assert.equal(await canConnect(closingService.port), false);
});

test('route transport rejects query-bearing URLs before invoking the companion', async () => {
  let generationCount = 0;
  const sessionSecret = createSessionSecret();
  const running = await startLocalRouteCompanionService({
    port: 0,
    sessionSecret,
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
    sessionSecret.fill(0);
  }
});

test('missing, wrong, replayed, expired, and body-mismatched route proofs fail before generation', async () => {
  let generationCount = 0;
  const sessionSecret = createSessionSecret();
  const running = await startLocalRouteCompanionService({
    port: 0,
    authChallengeTtlMs: 20,
    sessionSecret,
    companion: {
      generate: async () => {
        generationCount += 1;
        return { status: 'unavailable' };
      },
    },
  });
  try {
    const missing = await jsonRequest(running.port, '{}');
    assert.equal(missing.statusCode, 403);

    const wrong = await createAuthenticatedRequest(running.port, sessionSecret, '{}');
    const wrongProof = await jsonRequest(running.port, '{}', '/route', {
      ...wrong.headers,
      'x-local-route-proof': 'A'.repeat(43),
    });
    assert.equal(wrongProof.statusCode, 403);
    const replay = await jsonRequest(running.port, '{}', '/route', wrong.headers);
    assert.equal(replay.statusCode, 403);
    const reissued = await jsonRequest(
      running.port,
      JSON.stringify({
        schemaVersion: LOCAL_ROUTE_AUTH_CHALLENGE_SCHEMA_VERSION,
        nonce: wrong.nonce,
      }),
      '/auth/challenge',
    );
    assert.equal(reissued.statusCode, 400);

    const mismatched = await createAuthenticatedRequest(running.port, sessionSecret, '{"value":1}');
    const bodyMismatch = await jsonRequest(
      running.port,
      '{"value":2}',
      '/route',
      mismatched.headers,
    );
    assert.equal(bodyMismatch.statusCode, 403);

    const expired = await createAuthenticatedRequest(running.port, sessionSecret, '{}');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const expiredResponse = await jsonRequest(running.port, '{}', '/route', expired.headers);
    assert.equal(expiredResponse.statusCode, 403);
    assert.equal(generationCount, 0);
  } finally {
    await running.close();
    sessionSecret.fill(0);
  }
});

test('expired authentication challenges release bounded session capacity', async () => {
  const sessionSecret = createSessionSecret();
  const running = await startLocalRouteCompanionService({
    port: 0,
    authChallengeTtlMs: 1,
    sessionSecret,
    companion: { generate: async () => ({ status: 'unavailable' }) },
  });
  try {
    for (let index = 0; index < 4_097; index += 1) {
      const response = await jsonRequest(
        running.port,
        JSON.stringify({
          schemaVersion: LOCAL_ROUTE_AUTH_CHALLENGE_SCHEMA_VERSION,
          nonce: createChallengeNonce(),
        }),
        '/auth/challenge',
      );
      assert.equal(response.statusCode, 200, `challenge ${index + 1} was not admitted`);
    }
  } finally {
    await running.close();
    sessionSecret.fill(0);
  }
});

test('all external adapter module aliases are rejected without dynamic filesystem import', async () => {
  const sessionSecret = createSessionSecret();
  await assert.rejects(
    startLocalRouteCompanionService({
      port: 0,
      sessionSecret,
      adapterModule: 'C:\\untrusted\\adapter.mjs',
    }),
    /External adapter modules are disabled/,
  );

  for (const [entry, args, environment] of [
    [cliPath, ['serve', '--adapter-module', 'C:\\untrusted\\adapter.mjs'], process.env],
    [servicePath, ['--adapter-module', 'C:\\untrusted\\adapter.mjs'], {
      ...process.env,
      [LOCAL_ROUTE_SESSION_SECRET_ENV]: encodeSessionSecret(sessionSecret),
    }],
  ]) {
    const child = spawn(process.execPath, [entry.pathname.slice(1), ...args], {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const [exitCode] = await once(child, 'exit');
    assert.equal(exitCode, 1);
  }
  sessionSecret.fill(0);

  const [serviceSource, cliSource, powershellSource] = await Promise.all([
    readFile(servicePath, 'utf8'),
    readFile(cliPath, 'utf8'),
    readFile(powershellPath, 'utf8'),
  ]);
  assert.doesNotMatch(serviceSource, /pathToFileURL|\bimport\s*\(/);
  assert.doesNotMatch(cliSource, /pathToFileURL|\bimport\s*\(/);
  assert.match(powershellSource, /External AdapterModule loading is disabled/);
  assert.doesNotMatch(powershellSource, /Resolve-Path|--adapter-module/);
});

async function authenticatedJsonRequest(port, sessionSecret, body) {
  const authenticated = await createAuthenticatedRequest(port, sessionSecret, body);
  return jsonRequest(port, body, '/route', authenticated.headers);
}

async function createAuthenticatedRequest(port, sessionSecret, body) {
  const nonce = createChallengeNonce();
  const challenge = await jsonRequest(
    port,
    JSON.stringify({
      schemaVersion: LOCAL_ROUTE_AUTH_CHALLENGE_SCHEMA_VERSION,
      nonce,
    }),
    '/auth/challenge',
  );
  assert.equal(challenge.statusCode, 200);
  assert.equal(verifyServerProof(sessionSecret, nonce, challenge.body.serverProof), true);
  const authorization = createRouteAuthorization(sessionSecret, nonce, body);
  return {
    challenge,
    nonce,
    headers: {
      'x-local-route-nonce': nonce,
      'x-local-route-body-digest': authorization.bodyDigest,
      'x-local-route-proof': authorization.proof,
    },
  };
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

function jsonRequest(port, body, path = '/route', extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...extraHeaders,
      },
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
