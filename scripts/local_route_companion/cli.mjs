import http from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  LOOPBACK_HOST,
  startLocalRouteCompanionService,
  validateLoopbackHost,
} from './service.mjs';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function runCli(args = process.argv.slice(2), {
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const [command, ...rest] = args;
  if (command === 'serve') {
    const options = parseConnectionOptions(rest, {
      allowZeroPort: true,
      allowAdapterModule: true,
    });
    const running = await startLocalRouteCompanionService(options);
    const ready = {
      event: 'local-route-companion-ready',
      host: running.host,
      port: running.port,
      adapterTrust: running.adapterTrust,
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
    const options = parseConnectionOptions(rest);
    const body = await readStdin(input);
    JSON.parse(body);
    output.write(`${JSON.stringify(await requestJson({
      ...options,
      method: 'POST',
      path: '/route',
      body,
    }))}\n`);
    return;
  }
  throw new Error('Usage: cli.mjs <serve|health|route> [--host 127.0.0.1] [--port number] [--adapter-module local-path]');
}

function parseConnectionOptions(args, {
  allowZeroPort = false,
  allowAdapterModule = false,
} = {}) {
  const options = { host: LOOPBACK_HOST, port: allowZeroPort ? 0 : 43127 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--host') options.host = args[++index];
    else if (argument === '--port') options.port = Number(args[++index]);
    else if (argument === '--adapter-module' && allowAdapterModule) {
      options.adapterModule = args[++index];
    }
    else throw new Error('Unknown option.');
  }
  validateLoopbackHost(options.host);
  if (!Number.isSafeInteger(options.port) || options.port < (allowZeroPort ? 0 : 1) || options.port > 65535) {
    throw new Error('Invalid local route companion port.');
  }
  return options;
}

function requestJson({ host, port, method, path, body }) {
  validateLoopbackHost(host);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: LOOPBACK_HOST,
      port,
      method,
      path,
      headers: body === undefined ? undefined : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
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
      process.disconnect?.();
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

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`))) {
  runCli().catch(() => {
    process.stderr.write('Local route companion command failed.\n');
    process.exitCode = 1;
  });
}
