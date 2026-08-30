import fs from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';

import { inspectArtifact } from './integrity.mjs';
import { restoreError } from './errors.mjs';
import {
  assertSafeDestinationWithinRoot,
  assertSafeFileWithinRoot,
  validateRelativeArtifactPath,
} from './safe_paths.mjs';

const MUTABLE_URL_SEGMENTS = new Set(['current', 'head', 'latest', 'live']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function validateHttpsLocation(value, label = 'https location') {
  if (typeof value !== 'string' || value.includes('%')) {
    throw restoreError('UNSAFE_HTTPS_LOCATION', `${label} must be canonical and unencoded.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw restoreError('INVALID_HTTPS_LOCATION', `${label} must be an absolute URL.`, undefined, {
      cause: error,
    });
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw restoreError(
      'UNSAFE_HTTPS_LOCATION',
      `${label} must use HTTPS without credentials, query parameters, or fragments.`,
    );
  }
  if (!url.hostname || url.pathname.includes('/../') || url.pathname.endsWith('/..')) {
    throw restoreError('UNSAFE_HTTPS_LOCATION', `${label} is not an immutable safe HTTPS location.`);
  }
  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  if (isIP(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname.endsWith('.local') || hostname.endsWith('.internal')
    || segments.some((segment) => MUTABLE_URL_SEGMENTS.has(segment))) {
    throw restoreError('UNSAFE_HTTPS_LOCATION', `${label} is private or mutable.`);
  }
  return url;
}

export async function stageFromLocation({
  location,
  destinationRoot,
  destinationPath,
  expected,
  fileLocationRoot,
  fetchImpl = globalThis.fetch,
  fileSystem = fs,
  timeoutMs = 120_000,
  maxRedirects = 4,
}) {
  const destination = await prepareDestination(
    destinationRoot,
    destinationPath,
    fileSystem,
  );
  if (location.scheme === 'file') {
    await copyVerifiedFile({
      sourceRoot: fileLocationRoot,
      sourcePath: location.path,
      destination,
      expected,
      fileSystem,
      label: destinationPath,
    });
  } else if (location.scheme === 'https') {
    await downloadHttps({
      url: location.url,
      destination,
      expectedBytes: expected.bytes,
      fetchImpl,
      fileSystem,
      timeoutMs,
      maxRedirects,
    });
  } else {
    throw restoreError('UNSUPPORTED_LOCATION', 'Artifact location scheme is unsupported.');
  }

  return inspectArtifact(destination, expected, { fileSystem, label: destinationPath });
}

export async function copyVerifiedFile({
  sourceRoot,
  sourcePath,
  destination,
  expected,
  fileSystem = fs,
  label = 'artifact',
}) {
  const relative = validateRelativeArtifactPath(sourcePath, `${label} file location`);
  const source = await assertSafeFileWithinRoot(sourceRoot, relative, {
    fileSystem,
    label: `${label} source`,
  });
  await inspectArtifact(source.absolute, expected, { fileSystem, label: `${label} source` });
  await copyRegularFile(source.absolute, destination, {
    fileSystem,
    label,
    expectedBytes: expected.bytes,
  });
}

async function prepareDestination(destinationRoot, destinationPath, fileSystem) {
  const { absolute, parent } = await assertSafeDestinationWithinRoot(
    destinationRoot,
    destinationPath,
    { fileSystem, label: destinationPath },
  );
  await fileSystem.mkdir(parent, { recursive: true });
  await assertSafeDestinationWithinRoot(destinationRoot, destinationPath, {
    fileSystem,
    label: destinationPath,
  });
  return absolute;
}

async function copyRegularFile(source, destination, { fileSystem, label, expectedBytes }) {
  const sourceHandle = await fileSystem.open(source, 'r');
  let destinationHandle;
  let copiedBytes = 0;
  let copyError;
  try {
    const sourceStat = await sourceHandle.stat();
    if (!sourceStat.isFile()) {
      throw restoreError('UNSAFE_ARTIFACT_FILE', `${label} source must be a regular file.`);
    }
    destinationHandle = await fileSystem.open(destination, 'wx');
    for await (const chunk of sourceHandle.createReadStream({ autoClose: false })) {
      copiedBytes += chunk.length;
      assertWithinDeclaredSize(copiedBytes, expectedBytes, label);
      await writeAll(destinationHandle, chunk);
    }
    await destinationHandle.sync();
  } catch (error) {
    copyError = error;
  } finally {
    await destinationHandle?.close().catch(() => {});
    await sourceHandle.close().catch(() => {});
  }
  if (copyError) {
    await fileSystem.rm(destination, { force: true }).catch(() => {});
    throw copyError;
  }
}

async function downloadHttps({
  url,
  destination,
  expectedBytes,
  fetchImpl,
  fileSystem,
  timeoutMs,
  maxRedirects,
}) {
  if (typeof fetchImpl !== 'function') {
    throw restoreError('HTTPS_FETCH_UNAVAILABLE', 'HTTPS restore requires an explicit fetch implementation.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    throw restoreError('INVALID_TIMEOUT', 'HTTPS timeout must be between 1 and 600000 milliseconds.');
  }
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 8) {
    throw restoreError('INVALID_REDIRECT_LIMIT', 'HTTPS redirect limit must be between 0 and 8.');
  }

  const initial = validateHttpsLocation(url);
  let current = initial;
  let redirects = 0;
  const signal = AbortSignal.timeout(timeoutMs);
  let response;

  while (true) {
    response = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        accept: 'application/octet-stream',
        'accept-encoding': 'identity',
      },
    });
    if (response.status < 300 || response.status > 399) break;
    if (!REDIRECT_STATUSES.has(response.status)) {
      throw restoreError('HTTPS_REDIRECT_STATUS', 'HTTPS artifact returned an unsupported redirect status.');
    }
    if (redirects >= maxRedirects) {
      throw restoreError('HTTPS_REDIRECT_LIMIT', 'HTTPS artifact redirect limit was exceeded.');
    }
    const location = response.headers?.get?.('location');
    if (!location) {
      throw restoreError('HTTPS_REDIRECT_MISSING_LOCATION', 'HTTPS artifact redirect omitted Location.');
    }
    const next = validateHttpsLocation(new URL(location, current).href, 'redirect location');
    if (next.origin !== initial.origin) {
      throw restoreError('HTTPS_REDIRECT_ORIGIN', 'HTTPS artifact redirect changed origin.');
    }
    current = next;
    redirects += 1;
  }

  if (response.status !== 200 || !response.body) {
    throw restoreError(
      'HTTPS_FETCH_FAILED',
      `HTTPS artifact request returned status ${response.status}.`,
    );
  }

  const contentLength = response.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      throw restoreError(
        'HTTPS_CONTENT_LENGTH_INVALID',
        'HTTPS artifact returned an invalid Content-Length header.',
      );
    }
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength)) {
      throw restoreError(
        'HTTPS_CONTENT_LENGTH_INVALID',
        'HTTPS artifact Content-Length exceeds the supported safe integer range.',
      );
    }
    assertWithinDeclaredSize(declaredLength, expectedBytes, 'HTTPS artifact');
  }

  let handle;
  let downloadedBytes = 0;
  let downloadError;
  try {
    handle = await fileSystem.open(destination, 'wx');
    for await (const chunk of response.body) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      downloadedBytes += bytes.length;
      assertWithinDeclaredSize(downloadedBytes, expectedBytes, 'HTTPS artifact');
      await writeAll(handle, bytes);
    }
    await handle.sync();
  } catch (error) {
    downloadError = error;
  } finally {
    await handle?.close().catch(() => {});
  }
  if (downloadError) {
    await fileSystem.rm(destination, { force: true }).catch(() => {});
    throw downloadError;
  }
}

function assertWithinDeclaredSize(observedBytes, expectedBytes, label) {
  if (observedBytes > expectedBytes) {
    throw restoreError(
      'ARTIFACT_SIZE_LIMIT_EXCEEDED',
      `${label} exceeded its registry-declared byte length.`,
      { expected_bytes: expectedBytes, observed_bytes: observedBytes },
    );
  }
}

async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1) {
      throw restoreError('ARTIFACT_WRITE_STALLED', 'Artifact staging write made no progress.');
    }
    offset += bytesWritten;
  }
}
