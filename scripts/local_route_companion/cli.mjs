import { fork } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOOPBACK_HOST,
  startLocalRouteCompanionService,
  validateLoopbackHost,
} from './service.mjs';
import {
  LOCAL_ROUTE_AUTH_CHALLENGE_SCHEMA_VERSION,
  LOCAL_ROUTE_AUTH_PROOF_SCHEMA_VERSION,
  LOCAL_ROUTE_SESSION_SECRET_ENV,
  createChallengeNonce,
  createRouteAuthorization,
  createSessionSecret,
  encodeSessionSecret,
  verifyServerProof,
} from './session_auth.mjs';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CHILD_READY_TIMEOUT_MS = 5_000;
const CHILD_SHUTDOWN_TIMEOUT_MS = 2_000;
const serviceProcessPath = fileURLToPath(new URL('./service.mjs', import.meta.url));

export async function runCli(args = process.argv.slice(2), {
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const [command, ...rest] = args;
  if (command === 'serve') {
    const options = parseConnectionOptions(rest, { allowZeroPort: true });
    const sessionSecret = createSessionSecret();
    let running;
    try {
      running = await startLocalRouteCompanionService({ ...options, sessionSecret });
    } finally {
      sessionSecret.fill(0);
    }
    const ready = {
      event: 'local-route-companion-ready',
      host: running.host,
      port: running.port,
      adapterTrust: running.adapterTrust,
      routeAuthentication: 'one-time-hmac-sha256',
    };
    process.send?.(ready);
    output.write(`${JSON.stringify(ready)}\n`);
    await installShutdown(running);
    return;
  }
  if (command === 'health') {
    const options = parseConnectionOptions(rest);
    output.write(`${JSON.stringify(await requestJson({ ...options, method: 'GET', path: '/health' }))}\n`);
    return;
  }
  if (command === 'route') {
    const options = parseConnectionOptions(rest, { allowZeroPort: true });
    const body = await readStdin(input);
    JSON.parse(body);
    output.write(`${JSON.stringify(await runAuthenticatedChildRoute(options, body))}\n`);
    return;
  }
  throw new Error('Usage: cli.mjs <serve|health|route> [--host 127.0.0.1] [--port number]');
}

function parseConnectionOptions(args, {
  allowZeroPort = false,
} = {}) {
  const options = { host: LOOPBACK_HOST, port: allowZeroPort ? 0 : 43127 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--host') options.host = args[++index];
    else if (argument === '--port') options.port = Number(args[++index]);
    else if (argument === '--adapter-module') throw new Error('External adapter modules are disabled.');
    else throw new Error('Unknown option.');
  }
  validateLoopbackHost(options.host);
  if (!Number.isSafeInteger(options.port) || options.port < (allowZeroPort ? 0 : 1) || options.port > 65535) {
    throw new Error('Invalid local route companion port.');
  }
  return options;
}

async function runAuthenticatedChildRoute({ host, port }, body) {
  const sessionSecret = createSessionSecret();
  const childEnvironment = {
    ...process.env,
    [LOCAL_ROUTE_SESSION_SECRET_ENV]: encodeSessionSecret(sessionSecret),
  };
  let child;
  try {
    child = fork(serviceProcessPath, [
      '--host', host,
      '--port', String(port),
    ], {
      env: childEnvironment,
      silent: true,
      windowsHide: true,
    });
  } catch (error) {
    delete childEnvironment[LOCAL_ROUTE_SESSION_SECRET_ENV];
    sessionSecret.fill(0);
    throw error;
  }
  delete childEnvironment[LOCAL_ROUTE_SESSION_SECRET_ENV];
  child.stdout?.resume();
  child.stderr?.resume();
  try {
    const ready = await waitForChildReady(child, { requestedPort: port });
    return await requestAuthenticatedRoute({
      host: ready.host,
      port: ready.port,
      body,
      sessionSecret,
    });
  } finally {
    sessionSecret.fill(0);
    await stopChild(child);
  }
}

export async function requestAuthenticatedRoute({
  host = LOOPBACK_HOST,
  port,
  body,
  sessionSecret,
}) {
  validateLoopbackHost(host);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid local route companion port.');
  }
  if (typeof body !== 'string' || Buffer.byteLength(body) < 1) {
    throw new TypeError('Local route request body must be a non-empty string.');
  }
  const nonce = createChallengeNonce();
  const challengeBody = JSON.stringify({
    schemaVersion: LOCAL_ROUTE_AUTH_CHALLENGE_SCHEMA_VERSION,
    nonce,
  });
  const challenge = await requestJson({
    host,
    port,
    method: 'POST',
    path: '/auth/challenge',
    body: challengeBody,
  });
  if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge)
    || Object.keys(challenge).length !== 2
    || challenge.schemaVersion !== LOCAL_ROUTE_AUTH_PROOF_SCHEMA_VERSION
    || !verifyServerProof(sessionSecret, nonce, challenge.serverProof)) {
    throw new Error('Local companion identity proof was rejected.');
  }
  const authorization = createRouteAuthorization(sessionSecret, nonce, body);
  return requestJson({
    host,
    port,
    method: 'POST',
    path: '/route',
    body,
    headers: {
      'x-local-route-nonce': nonce,
      'x-local-route-body-digest': authorization.bodyDigest,
      'x-local-route-proof': authorization.proof,
    },
  });
}

function waitForChildReady(child, { requestedPort }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Local companion child readiness timed out.')),
      CHILD_READY_TIMEOUT_MS);
    timer.unref?.();
    const onMessage = (message) => {
      if (!message || typeof message !== 'object'
        || message.event !== 'local-route-companion-ready'
        || message.host !== LOOPBACK_HOST
        || !Number.isSafeInteger(message.port) || message.port < 1 || message.port > 65535
        || (requestedPort !== 0 && message.port !== requestedPort)
        || message.adapterTrust !== 'built-in-unavailable-adapter'
        || message.routeAuthentication !== 'one-time-hmac-sha256') {
        finish(new Error('Local companion child readiness proof was invalid.'));
        return;
      }
      finish(null, Object.freeze({ host: message.host, port: message.port }));
    };
    const onExit = () => finish(new Error('Local companion child exited before readiness.'));
    const onError = () => finish(new Error('Local companion child failed before readiness.'));
    const finish = (error, value) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else resolve(value);
    };
    child.once('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (child.connected) {
    child.send({ type: 'shutdown' }, (error) => {
      if (error && child.exitCode === null && child.signalCode === null) child.kill();
    });
  } else {
    child.kill();
  }
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(resolve, CHILD_SHUTDOWN_TIMEOUT_MS, 'timeout');
    timer.unref?.();
  });
  if (await Promise.race([exited, timeout]) === 'timeout'
    && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await exited;
  }
}

function requestJson({ host, port, method, path, body, headers = {} }) {
  validateLoopbackHost(host);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: LOOPBACK_HOST,
      port,
      method,
      path,
      headers: body === undefined ? headers : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...headers,
      },
    }, (response) => {
      if ((response.statusCode ?? 500) >= 300 && (response.statusCode ?? 500) < 400) {
        response.resume();
        reject(new Error('Local companion redirect was rejected.'));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new Error('Local companion response exceeded the limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Local companion request failed with HTTP ${response.statusCode}.`));
          } else {
            resolve(parsed);
          }
        } catch (error) {
          reject(error);
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(5_000, () => request.destroy(
      new Error('Local companion request timed out.'),
    ));
    request.end(body);
  });
}

async function readStdin(input) {
  const chunks = [];
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('Route input exceeded the limit.');
    chunks.push(chunk);
  }
  if (size === 0) throw new Error('Route input must be provided on stdin.');
  return Buffer.concat(chunks, size).toString('utf8');
}

function installShutdown(running) {
  return new Promise((resolve) => {
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      try {
        await running.close();
        process.exitCode = 0;
      } catch {
        process.exitCode = 1;
      }
      if (process.connected) process.disconnect();
      resolve();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    process.on('message', (message) => {
      if (message === 'shutdown' || message?.type === 'shutdown') void shutdown();
    });
    process.once('disconnect', shutdown);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli().catch(() => {
    process.stderr.write('Local route companion command failed.\n');
    process.exitCode = 1;
  });
}
