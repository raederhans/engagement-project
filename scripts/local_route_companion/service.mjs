import http from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  createLocalRouteCompanion,
  createUnavailableEngineAdapter,
} from '../../src/route_generation/local_companion/index.js';
import {
  LOCAL_ROUTE_AUTH_CHALLENGE_SCHEMA_VERSION,
  LOCAL_ROUTE_AUTH_PROOF_SCHEMA_VERSION,
  LOCAL_ROUTE_SESSION_SECRET_ENV,
  admitChallengeNonce,
  bodyMatchesDigest,
  copySessionSecret,
  createServerProof,
  decodeSessionSecret,
  verifyRouteProof,
} from './session_auth.mjs';

export const LOOPBACK_HOST = '127.0.0.1';
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_GENERATION_TIMEOUT_MS = 5_000;

const AUTH_CHALLENGE_PATH = '/auth/challenge';
const AUTH_CHALLENGE_TTL_MS = 5_000;
const MAX_ACTIVE_CHALLENGES = 64;
const MAX_SESSION_CHALLENGES = 4_096;
const MAX_AUTH_BODY_BYTES = 512;

const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function validateLoopbackHost(host) {
  if (host !== LOOPBACK_HOST) {
    throw new Error(`Local route companion host must be ${LOOPBACK_HOST}.`);
  }
  return host;
}

export async function startLocalRouteCompanionService({
  host = LOOPBACK_HOST,
  port = 0,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  generationTimeoutMs = DEFAULT_GENERATION_TIMEOUT_MS,
  authChallengeTtlMs = AUTH_CHALLENGE_TTL_MS,
  companion,
  sessionSecret,
  adapterModule,
} = {}) {
  validateLoopbackHost(host);
  validatePort(port);
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new TypeError('maxBodyBytes must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(generationTimeoutMs)
    || generationTimeoutMs < 1 || generationTimeoutMs > 30_000) {
    throw new TypeError('generationTimeoutMs must be an integer from 1 through 30000.');
  }
  if (!Number.isSafeInteger(authChallengeTtlMs)
    || authChallengeTtlMs < 1 || authChallengeTtlMs > 30_000) {
    throw new TypeError('authChallengeTtlMs must be an integer from 1 through 30000.');
  }

  if (adapterModule !== undefined) {
    throw new TypeError('External adapter modules are disabled; use a reviewed in-process companion.');
  }
  const authenticationKey = copySessionSecret(sessionSecret);
  let routeCompanion;
  try {
    routeCompanion = companion
      ?? createLocalRouteCompanion({ engineAdapter: createUnavailableEngineAdapter() });
  } catch (error) {
    authenticationKey.fill(0);
    throw error;
  }
  if (!routeCompanion || typeof routeCompanion.generate !== 'function') {
    authenticationKey.fill(0);
    throw new TypeError('Local route companion must provide generate(rawRequest).');
  }

  const adapterTrust = companion
    ? 'caller-injected-companion-unverified' : 'built-in-unavailable-adapter';
  const activeJobs = new Set();
  const activeChallenges = new Map();
  let acceptingRequests = true;
  let expectedHost = null;

  const server = http.createServer(async (request, response) => {
    if (!acceptingRequests) {
      discardRequest(request);
      sendJson(response, 503, { error: 'service_closing' });
      return;
    }
    if (!isLoopbackPeer(request.socket.remoteAddress)) {
      discardRequest(request);
      sendJson(response, 403, { error: 'loopback_peer_required' });
      return;
    }
    if (request.headers.host !== expectedHost || hasNonEmptyOrigin(request.headers.origin)) {
      discardRequest(request);
      sendJson(response, 403, { error: 'local_request_headers_required' });
      return;
    }

    const path = safePathname(request.url);
    if (request.method === 'GET' && path === '/health') {
      sendJson(response, 200, {
        status: 'ok',
        host: LOOPBACK_HOST,
        adapter_trust: adapterTrust,
        route_authentication: 'one-time-hmac-sha256',
        privacy_evidence: 'not_measured_by_health',
      });
      return;
    }

    if (request.method === 'POST' && path === AUTH_CHALLENGE_PATH) {
      try {
        const challenge = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        const nonce = admitAuthChallenge(challenge, activeChallenges, authChallengeTtlMs);
        sendJson(response, 200, {
          schemaVersion: LOCAL_ROUTE_AUTH_PROOF_SCHEMA_VERSION,
          serverProof: createServerProof(authenticationKey, nonce),
        });
      } catch (error) {
        if (response.destroyed || response.writableEnded) return;
        sendJson(response, error instanceof ChallengeCapacityError ? 429 : 400, {
          error: error instanceof ChallengeCapacityError
            ? 'challenge_capacity_exceeded' : 'invalid_auth_challenge',
        });
      }
      return;
    }

    if (request.method === 'POST' && path === '/route') {
      const authorization = consumeRouteAuthorization(
        request,
        activeChallenges,
        authenticationKey,
      );
      if (authorization === null) {
        discardRequest(request);
        sendJson(response, 403, { error: 'local_route_authentication_required' });
        return;
      }
      try {
        const rawRequest = await readJsonBody(
          request,
          maxBodyBytes,
          authorization.bodyDigest,
        );
        const result = await generateWithDeadline({
          routeCompanion,
          rawRequest,
          timeoutMs: generationTimeoutMs,
          activeJobs,
          request,
          response,
        });
        sendJson(response, 200, result);
      } catch (error) {
        const statusCode = error instanceof RouteAuthenticationError
          ? 403
          : error instanceof RequestBodyError
          ? error.statusCode
          : error instanceof GenerationDeadlineError
            ? 504
            : error instanceof ActiveJobCancelledError ? 503 : 400;
        if (response.destroyed || response.writableEnded) return;
        sendJson(response, statusCode, {
          error: statusCode === 403
            ? 'local_route_authentication_required'
            : statusCode === 413
            ? 'request_body_too_large'
            : statusCode === 504
              ? 'route_generation_timed_out'
              : statusCode === 503 ? 'route_generation_cancelled' : 'invalid_route_request',
        });
      }
      return;
    }

    discardRequest(request);
    sendJson(response, 404, { error: 'not_found' });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 6_000;
  server.keepAliveTimeout = 1_000;
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host, port, exclusive: true }, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    authenticationKey.fill(0);
    throw error;
  }

  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
    try {
      await closeServer(server);
    } finally {
      authenticationKey.fill(0);
    }
    throw new Error('Local route companion failed to bind the required loopback address.');
  }
  expectedHost = `${LOOPBACK_HOST}:${address.port}`;

  let closing;
  return {
    host: LOOPBACK_HOST,
    port: address.port,
    adapterTrust,
    server,
    close() {
      if (!closing) {
        acceptingRequests = false;
        activeChallenges.clear();
        authenticationKey.fill(0);
        for (const controller of activeJobs) controller.abort('service-closing');
        closing = closeServer(server);
      }
      return closing;
    },
  };
}

function validatePort(port) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('port must be an integer between 0 and 65535.');
  }
}

function admitAuthChallenge(challenge, activeChallenges, authChallengeTtlMs) {
  if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge)
    || Object.getPrototypeOf(challenge) !== Object.prototype
    || Object.keys(challenge).length !== 2
    || challenge.schemaVersion !== LOCAL_ROUTE_AUTH_CHALLENGE_SCHEMA_VERSION) {
    throw new TypeError('Local route authentication challenge is invalid.');
  }
  const nonce = admitChallengeNonce(challenge.nonce);
  pruneExpiredChallenges(activeChallenges);
  if (activeChallenges.has(nonce)) {
    throw new TypeError('Local route authentication challenge was already issued.');
  }
  if (activeChallenges.size >= MAX_SESSION_CHALLENGES
    || activeChallengeCount(activeChallenges) >= MAX_ACTIVE_CHALLENGES) {
    throw new ChallengeCapacityError();
  }
  activeChallenges.set(nonce, {
    consumed: false,
    expiresAt: Date.now() + authChallengeTtlMs,
  });
  return nonce;
}

function consumeRouteAuthorization(request, activeChallenges, authenticationKey) {
  pruneExpiredChallenges(activeChallenges);
  const nonce = singleHeader(request.headers['x-local-route-nonce']);
  const bodyDigest = singleHeader(request.headers['x-local-route-body-digest']);
  const proof = singleHeader(request.headers['x-local-route-proof']);
  if (nonce === null || bodyDigest === null || proof === null) return null;
  const challenge = activeChallenges.get(nonce);
  if (challenge === undefined || challenge.consumed) return null;
  challenge.consumed = true;
  if (challenge.expiresAt <= Date.now()
    || !verifyRouteProof(authenticationKey, nonce, bodyDigest, proof)) return null;
  return Object.freeze({ bodyDigest });
}

function singleHeader(value) {
  return typeof value === 'string' && value.length <= 128 ? value : null;
}

function pruneExpiredChallenges(activeChallenges) {
  const now = Date.now();
  for (const challenge of activeChallenges.values()) {
    if (challenge.expiresAt <= now) challenge.consumed = true;
  }
}

function activeChallengeCount(activeChallenges) {
  let count = 0;
  for (const challenge of activeChallenges.values()) {
    if (!challenge.consumed) count += 1;
  }
  return count;
}

function isLoopbackPeer(remoteAddress) {
  return LOOPBACK_PEERS.has(remoteAddress ?? '');
}

function hasNonEmptyOrigin(origin) {
  return Array.isArray(origin) ? origin.some((value) => value !== '') : origin !== undefined && origin !== '';
}

async function generateWithDeadline({
  routeCompanion, rawRequest, timeoutMs, activeJobs, request, response,
}) {
  const controller = new AbortController();
  activeJobs.add(controller);
  const abortOnDisconnect = () => controller.abort('client-disconnected');
  request.once('aborted', abortOnDisconnect);
  response.once('close', abortOnDisconnect);
  let timer;
  const cancellation = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(controller.signal.reason === 'deadline-exceeded'
        ? new GenerationDeadlineError()
        : new ActiveJobCancelledError());
    }, { once: true });
  });
  timer = setTimeout(() => {
    controller.abort('deadline-exceeded');
  }, timeoutMs);
  timer.unref?.();
  const generation = Promise.resolve().then(() => routeCompanion.generate(
    rawRequest,
    Object.freeze({ signal: controller.signal, deadlineMs: timeoutMs }),
  ));
  try {
    return await Promise.race([generation, cancellation]);
  } finally {
    clearTimeout(timer);
    request.off('aborted', abortOnDisconnect);
    response.off('close', abortOnDisconnect);
    activeJobs.delete(controller);
  }
}

function safePathname(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) {
    return '';
  }
  try {
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    if (parsed.search !== '' || parsed.hash !== '') return '';
    return parsed.pathname;
  } catch {
    return '';
  }
}

function discardRequest(request) {
  request.resume();
}

async function readJsonBody(request, maxBodyBytes, expectedBodyDigest = null) {
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new RequestBodyError(415);
  }
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new RequestBodyError(413);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new RequestBodyError(413);
    }
    chunks.push(chunk);
  }
  if (size === 0) throw new RequestBodyError(400);

  const body = Buffer.concat(chunks, size);
  if (expectedBodyDigest !== null && !bodyMatchesDigest(body, expectedBodyDigest)) {
    body.fill(0);
    for (const chunk of chunks) chunk.fill(0);
    throw new RouteAuthenticationError();
  }

  let value;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    body.fill(0);
    for (const chunk of chunks) chunk.fill(0);
    throw new RequestBodyError(400);
  }
  body.fill(0);
  for (const chunk of chunks) chunk.fill(0);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestBodyError(400);
  }
  return value;
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    connection: 'close',
  });
  response.end(body);
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

class RequestBodyError extends Error {
  constructor(statusCode) {
    super('Route request body was rejected.');
    this.statusCode = statusCode;
  }
}

class RouteAuthenticationError extends Error {
  constructor() {
    super('Local route request authentication failed.');
  }
}

class ChallengeCapacityError extends Error {
  constructor() {
    super('Local route authentication challenge capacity was exceeded.');
  }
}

class GenerationDeadlineError extends Error {
  constructor() {
    super('Route generation exceeded its local deadline.');
  }
}

class ActiveJobCancelledError extends Error {
  constructor() {
    super('Route generation was cancelled.');
  }
}

async function runAsProcess() {
  const options = parseServiceArgs(process.argv.slice(2));
  const sessionSecret = consumeSessionSecretFromEnvironment();
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
  try {
    process.send?.(ready);
    process.stdout.write(`${JSON.stringify(ready)}\n`);
  } catch (error) {
    await running.close();
    throw error;
  }

  let shutdownStarted = false;
  const shutdown = async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    try {
      await running.close();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
    if (process.connected) process.disconnect();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.on('message', (message) => {
    if (message === 'shutdown' || message?.type === 'shutdown') void shutdown();
  });
  process.once('disconnect', shutdown);
  if (typeof process.send === 'function' && !process.connected) void shutdown();
}

function parseServiceArgs(args) {
  const options = { host: LOOPBACK_HOST, port: 0 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--host') options.host = args[++index];
    else if (argument === '--port') options.port = Number(args[++index]);
    else if (argument === '--adapter-module') {
      throw new Error('External adapter modules are disabled.');
    }
    else throw new Error('Unknown service option.');
  }
  return options;
}

function consumeSessionSecretFromEnvironment() {
  const encoded = process.env[LOCAL_ROUTE_SESSION_SECRET_ENV];
  delete process.env[LOCAL_ROUTE_SESSION_SECRET_ENV];
  return decodeSessionSecret(encoded);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`))) {
  runAsProcess().catch(() => {
    delete process.env[LOCAL_ROUTE_SESSION_SECRET_ENV];
    process.stderr.write('Local route companion failed to start.\n');
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}
