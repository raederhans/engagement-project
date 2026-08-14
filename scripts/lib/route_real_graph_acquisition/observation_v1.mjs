import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { admitGeofabrikAcquisitionManifest } from './contract_v1.mjs';
import {
  contentIdentity,
  exactTimestamp,
  fail,
  freezeData,
} from './safe_data.mjs';

export const GEOFABRIK_ACQUISITION_OBSERVATION_SCHEMA = 'route-real-graph-geofabrik-acquisition-observation/v1';
export const GEOFABRIK_SIDECAR_MAX_BYTES = 4_096;
export const GEOFABRIK_OBSERVATION_TIMEOUT_MS = 15_000;

const trustedObservations = new WeakSet();

export async function observeGeofabrikAcquisitionManifest(manifestJsonText) {
  if (arguments.length !== 1) {
    fail('observation-arguments', 'observation accepts only one primitive manifest JSON text; caller-authored checksum, clock, fetch, fallback, and transport overrides are forbidden');
  }
  const manifest = admitGeofabrikAcquisitionManifest(manifestJsonText);
  if (typeof globalThis.fetch !== 'function') fail('fetch-unavailable', 'global fetch is unavailable');

  const retrievedAt = currentClock('retrievedAt');
  const [headResult, sidecarResult] = await Promise.allSettled([
    boundedFetch(manifest.source.datedUrl, 'HEAD', 0),
    boundedFetch(manifest.source.sidecarMd5Url, 'GET', GEOFABRIK_SIDECAR_MAX_BYTES),
  ]);
  const observedAt = currentClock('observedAt');

  const head = headResult.status === 'fulfilled'
    ? headResult.value.transport
    : failedTransport('HEAD', manifest.source.datedUrl);
  const sidecar = sidecarResult.status === 'fulfilled'
    ? sidecarResult.value.transport
    : failedTransport('GET', manifest.source.sidecarMd5Url);
  const declaredBytes = head.ok
    && Number.isSafeInteger(head.contentLength)
    && head.contentLength > 0
    ? head.contentLength
    : null;

  let sidecarMd5 = null;
  let failure = failureFromSettled(headResult, sidecarResult);
  if (!failure && (!head.ok || !sidecar.ok)) {
    failure = Object.freeze({
      code: 'http-status',
      phase: !head.ok ? 'payload-head' : 'md5-sidecar',
      message: 'bounded source observation received a non-success HTTP status',
    });
  }
  if (!failure && head.ok && declaredBytes === null) {
    failure = Object.freeze({
      code: 'payload-byte-count-unavailable',
      phase: 'payload-head',
      message: 'bounded payload HEAD did not provide a positive safe content-length',
    });
  }
  if (!failure) {
    try {
      sidecarMd5 = parseSidecarMd5(
        sidecarResult.value.bodyText,
        manifest.source.datedUrl.split('/').at(-1),
      );
    } catch (error) {
      failure = Object.freeze({
        code: error?.code === 'sidecar-format' ? 'sidecar-format' : 'sidecar-invalid',
        phase: 'md5-sidecar',
        message: 'provider MD5 sidecar did not match the exact dated payload filename and format',
      });
    }
  }

  const observation = freezeObservation({
    schema: GEOFABRIK_ACQUISITION_OBSERVATION_SCHEMA,
    dataClassification: 'candidate-external',
    manifest,
    status: failure ? 'failed' : 'observed',
    clocks: {
      sourceAsOf: null,
      retrievedAt,
      builtAt: null,
      observedAt,
    },
    transport: { head, sidecar },
    integrity: {
      providerSidecarMd5: sidecarMd5,
      localMd5: null,
      localSha256: null,
      declaredBytes,
      localBytes: null,
      md5MatchesSidecar: null,
      declaredBytesMatch: null,
    },
    localPayload: { status: 'not-supplied', persisted: false },
    fallbackUsed: false,
    failure,
    claimBoundary: {
      candidateOnly: true,
      sourceAuthenticity: 'not-established',
      businessFreshness: 'unknown',
      productAdmission: 'not-authorized',
      sourceHealthCurrent: 'not-authorized',
      publication: 'not-authorized',
    },
  }, 'Geofabrik bounded observation');
  trustedObservations.add(observation);
  return observation;
}

export function verifySuppliedGeofabrikPayload(observation, payloadBytes) {
  if (arguments.length !== 2) {
    fail('verification-arguments', 'local verification accepts only a trusted live observation and actual payload bytes');
  }
  if (!trustedObservations.has(observation)) {
    fail('untrusted-observation', 'local verification rejects caller-authored or deserialized checksum and clock evidence');
  }
  if (observation.status !== 'observed' || observation.failure !== null) {
    fail('observation-failed', 'local verification requires a successful bounded observation');
  }
  if (utilTypes.isProxy(payloadBytes)) fail('payload-proxy', 'payload bytes must not be a Proxy');
  const payloadPrototype = payloadBytes && typeof payloadBytes === 'object'
    ? Object.getPrototypeOf(payloadBytes)
    : null;
  const exactUint8Array = payloadPrototype === Uint8Array.prototype;
  const exactBuffer = Buffer.isBuffer(payloadBytes) && payloadPrototype === Buffer.prototype;
  if (!exactUint8Array && !exactBuffer) {
    fail('payload-bytes', 'payload must be actual non-shared Uint8Array or Buffer bytes');
  }
  for (const key of ['buffer', 'byteOffset', 'byteLength']) {
    if (Object.getOwnPropertyDescriptor(payloadBytes, key)) {
      fail('payload-descriptor', `payload must not override the typed-array ${key} descriptor`);
    }
  }
  const { buffer, byteOffset, byteLength } = payloadBytes;
  if (buffer instanceof SharedArrayBuffer) {
    fail('payload-bytes', 'payload must be actual non-shared Uint8Array or Buffer bytes');
  }
  if (byteLength < 1) fail('payload-bytes', 'payload bytes must not be empty');

  const view = Buffer.from(buffer, byteOffset, byteLength);
  const localMd5 = createHash('md5').update(view).digest('hex');
  const localSha256 = `sha256:${createHash('sha256').update(view).digest('hex')}`;
  const localBytes = byteLength;
  const md5MatchesSidecar = localMd5 === observation.integrity.providerSidecarMd5;
  const declaredBytesMatch = localBytes === observation.integrity.declaredBytes;
  const builtAt = currentClock('builtAt');
  const observedAt = currentClock('observedAt');
  const failure = !md5MatchesSidecar
    ? {
      code: 'payload-md5-mismatch',
      phase: 'local-verification',
      message: 'actual payload MD5 does not match the observed provider sidecar',
    }
    : !declaredBytesMatch
      ? {
        code: 'payload-byte-count-mismatch',
        phase: 'local-verification',
        message: 'actual payload byte count does not match the observed HEAD content-length',
      }
      : null;

  const { observationIdentity: _priorIdentity, ...observationProjection } = observation;
  const verified = freezeObservation({
    ...observationProjection,
    status: failure ? 'failed' : 'payload-verified',
    clocks: { ...observation.clocks, builtAt, observedAt },
    integrity: {
      ...observation.integrity,
      localMd5,
      localSha256,
      localBytes,
      md5MatchesSidecar,
      declaredBytesMatch,
    },
    localPayload: { status: failure ? 'rejected' : 'verified', persisted: false },
    failure,
  }, 'locally verified Geofabrik observation');
  trustedObservations.add(verified);
  return verified;
}

async function boundedFetch(url, method, maxBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEOFABRIK_OBSERVATION_TIMEOUT_MS);
  let response;
  try {
    response = await globalThis.fetch(url, {
      method,
      headers: method === 'GET' ? { Accept: 'text/plain' } : undefined,
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response || !response.headers || typeof response.headers.get !== 'function') {
      fail('transport-response', `${method} transport returned an invalid response`);
    }
    const status = response.status;
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      fail('transport-response', `${method} transport returned an invalid HTTP status`);
    }
    const ok = status >= 200 && status <= 299;
    const reportedOk = response.ok;
    if (reportedOk !== undefined && (typeof reportedOk !== 'boolean' || reportedOk !== ok)) {
      fail('transport-response', `${method} transport ok contradicts its HTTP status`);
    }
    const contentLength = parseContentLength(response.headers.get('content-length'));
    let bodyText = null;
    let bodyBytes = null;
    if (method === 'GET') {
      if (contentLength !== null && contentLength > maxBytes) fail('sidecar-too-large', 'MD5 sidecar declared length exceeds the bound');
      const bytes = await readBoundedBody(response, maxBytes);
      bodyBytes = bytes.byteLength;
      try {
        bodyText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        fail('sidecar-encoding', 'MD5 sidecar must be valid UTF-8 text');
      }
    }
    return {
      transport: freezeData({
        method,
        url,
        status,
        ok,
        contentLength,
        contentType: response.headers.get('content-type'),
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        bodyBytes,
      }, `${method} transport observation`),
      bodyText,
    };
  } catch (error) {
    if (error?.code) throw error;
    fail(
      controller.signal.aborted || error?.name === 'AbortError' ? 'transport-timeout' : 'transport-network',
      `${method} request did not produce bounded transport evidence`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    fail('sidecar-stream-required', 'MD5 sidecar response must expose a bounded readable stream');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('sidecar bound exceeded');
        fail('sidecar-too-large', 'MD5 sidecar body exceeds the bound');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseContentLength(value) {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) fail('content-length', 'transport content-length is invalid');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail('content-length', 'transport content-length exceeds the supported range');
  return parsed;
}

function parseSidecarMd5(text, filename) {
  const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^([a-f0-9]{32}) {2}${escapedFilename}\\r?\\n?$`));
  if (!match) fail('sidecar-format', 'MD5 sidecar must contain one lowercase digest for the exact dated filename');
  return match[1];
}

function failedTransport(method, url) {
  return freezeData({
    method,
    url,
    status: null,
    ok: false,
    contentLength: null,
    contentType: null,
    etag: null,
    lastModified: null,
    bodyBytes: null,
  }, 'failed transport observation');
}

function failureFromSettled(head, sidecar) {
  if (head.status === 'rejected') return transportFailure(head.reason, 'payload-head');
  if (sidecar.status === 'rejected') return transportFailure(sidecar.reason, 'md5-sidecar');
  return null;
}

function transportFailure(error, phase) {
  return Object.freeze({
    code: typeof error?.code === 'string' ? error.code : 'transport-failure',
    phase,
    message: `bounded ${phase} observation failed without fallback`,
  });
}

function currentClock(label) {
  const value = new Date().toISOString();
  exactTimestamp(value, label);
  return value;
}

function freezeObservation(projection, label) {
  return freezeData({
    ...projection,
    observationIdentity: contentIdentity(projection),
  }, label);
}
