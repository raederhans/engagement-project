import http from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createLocalRouteCompanion,
  createUnavailableEngineAdapter,
} from '../../src/route_generation/local_companion/index.js';

export const LOOPBACK_HOST = '127.0.0.1';
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_GENERATION_TIMEOUT_MS = 5_000;

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
  companion,
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

  if (companion && adapterModule) {
    throw new TypeError('Provide either companion or adapterModule, not both.');
  }
  const routeCompanion = companion ?? await companionFromAdapterModule(adapterModule);
  if (!routeCompanion || typeof routeCompanion.generate !== 'function') {
    throw new TypeError('Local route companion must provide generate(rawRequest).');
  }

  const adapterTrust = adapterModule !== undefined
    ? 'caller-trusted-local-module-unverified'
    : companion ? 'caller-injected-companion-unverified' : 'built-in-unavailable-adapter';
  const activeJobs = new Set();
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
        privacy_evidence: 'not_measured_by_health',
      });
      return;
    }

    if (request.method === 'POST' && path === '/route') {
      try {
        const rawRequest = await readJsonBody(request, maxBodyBytes);
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
        const statusCode = error instanceof RequestBodyError
          ? error.statusCode
          : error instanceof GenerationDeadlineError
            ? 504
            : error instanceof ActiveJobCancelledError ? 503 : 400;
        if (response.destroyed || response.writableEnded) return;
        sendJson(response, statusCode, {
          error: statusCode === 413
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

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port, exclusive: true }, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
    await closeServer(server);
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

async function companionFromAdapterModule(adapterModule) {
  if (adapterModule === undefined) {
    return createLocalRouteCompanion({ engineAdapter: createUnavailableEngineAdapter() });
  }
  validateTrustedAdapterModulePath(adapterModule);
  const loaded = await import(pathToFileURL(resolve(adapterModule)));
  return createLocalRouteCompanion({
    engineAdapter: loaded.engineAdapter ?? loaded.default,
    evidenceEnricher: loaded.evidenceEnricher,
  });
}

function validateTrustedAdapterModulePath(adapterModule) {
  if (typeof adapterModule !== 'string' || adapterModule.length === 0
    || !isAbsolute(adapterModule) || /^\\\\[?.]\\/.test(adapterModule)
    || /^\\\\/.test(adapterModule) || /^\/\//.test(adapterModule)
    || /^\w+:\/\//.test(adapterModule)) {
    throw new TypeError('adapterModule must be a caller-trusted local absolute filesystem path.');
  }
  if (process.platform === 'win32' && !/^[a-zA-Z]:[\\/]/.test(adapterModule)) {
    throw new TypeError('adapterModule must use a local Windows drive path.');
  }
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

async function readJsonBody(request, maxBodyBytes) {
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

  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch {
    throw new RequestBodyError(400);
  }
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
  const running = await startLocalRouteCompanionService(options);
  const ready = {
    event: 'local-route-companion-ready',
    host: running.host,
    port: running.port,
    adapterTrust: running.adapterTrust,
  };
  process.send?.(ready);
  process.stdout.write(`${JSON.stringify(ready)}\n`);

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
    process.disconnect?.();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.on('message', (message) => {
    if (message === 'shutdown' || message?.type === 'shutdown') void shutdown();
  });
  process.once('disconnect', shutdown);
}

function parseServiceArgs(args) {
  const options = { host: LOOPBACK_HOST, port: 0 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--host') options.host = args[++index];
    else if (argument === '--port') options.port = Number(args[++index]);
    else if (argument === '--adapter-module') options.adapterModule = args[++index];
    else throw new Error('Unknown service option.');
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`))) {
  runAsProcess().catch(() => {
    process.stderr.write('Local route companion failed to start.\n');
    process.exitCode = 1;
  });
}
