import { candidateDataClassification } from './contracts.mjs';
import {
  RouteGraphCandidateContractError,
  boundedText,
  exactDataObject,
  exactTimestamp,
  fail,
  freezeData,
  httpUrl,
} from './safe_data.mjs';

export const ROUTE_GRAPH_TRANSPORT_OBSERVATION_SCHEMA = 'route-graph-transport-observation/v1';

export async function acquireBoundedCandidatePayload({
  sourceId,
  sourceKind,
  transport,
  fetchImpl = globalThis.fetch,
  maxBytes = 1_000_000,
  timeoutMs = 5_000,
  now = () => new Date().toISOString(),
}) {
  boundedText(sourceId, 'sourceId', { max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/ });
  const dataClassification = candidateDataClassification(sourceKind);
  const request = exactDataObject(transport, ['endpoint', 'method'], 'candidate transport');
  httpUrl(request.endpoint, 'candidate transport.endpoint');
  if (request.method !== 'GET') fail('probe-method', 'bounded candidate acquisition supports read-only GET only');
  if (typeof fetchImpl !== 'function') fail('fetch-implementation', 'fetch implementation is unavailable');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 10_000_000) {
    fail('acquisition-max-bytes', 'maxBytes must be an integer between 1 and 10,000,000');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    fail('acquisition-timeout', 'timeoutMs must be an integer between 1 and 30,000');
  }
  const retrievedAt = now();
  exactTimestamp(retrievedAt, 'retrievedAt');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('candidate acquisition timeout')), timeoutMs);
  let response;
  try {
    response = await fetchImpl(request.endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json, application/geo+json;q=0.9, */*;q=0.1' },
      redirect: 'error',
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (error) {
    clearTimeout(timeout);
    fail(error?.name === 'AbortError' ? 'acquisition-timeout' : 'acquisition-network', 'candidate acquisition did not produce an HTTP response');
  }
  if (!response || typeof response.status !== 'number' || !response.headers) {
    clearTimeout(timeout);
    fail('acquisition-response', 'fetch implementation returned an invalid response');
  }
  let declaredLength;
  let bytes;
  try {
    declaredLength = parseContentLength(response.headers.get('content-length'));
    if (declaredLength !== null && declaredLength > maxBytes) fail('acquisition-too-large', 'candidate response exceeds maxBytes');
    bytes = await readBoundedBody(response, maxBytes);
  } catch (error) {
    if (error instanceof RouteGraphCandidateContractError) throw error;
    fail(controller.signal.aborted || error?.name === 'AbortError' ? 'acquisition-timeout' : 'acquisition-body', 'candidate response body could not be acquired within bounds');
  } finally {
    clearTimeout(timeout);
  }
  const observedAt = now();
  exactTimestamp(observedAt, 'observedAt');
  return freezeData({
    schema: ROUTE_GRAPH_TRANSPORT_OBSERVATION_SCHEMA,
    dataClassification,
    sourceId,
    sourceKind,
    transport: request,
    clocks: {
      sourceAsOf: null,
      retrievedAt,
      observedAt,
    },
    response: {
      status: response.status,
      ok: response.ok === true,
      contentType: response.headers.get('content-type'),
      contentLength: declaredLength,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      bytes: bytes.byteLength,
      contentIdentity: `sha256:${createHash('sha256').update(new Uint8Array(bytes)).digest('hex')}`,
    },
    interpretation: {
      endpointReachable: true,
      sourceFreshness: 'unknown',
      sourceCompleteness: 'unknown',
      modeFitness: 'unknown',
      licenseDisposition: 'not-evaluated',
      routingDisposition: 'not-evaluated',
      candidateAdmission: 'not-evaluated',
    },
    payloadText: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  }, 'bounded candidate acquisition observation');
}

async function readBoundedBody(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) fail('acquisition-too-large', 'candidate response exceeds maxBytes');
    return buffer;
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
        await reader.cancel('candidate response exceeds maxBytes');
        fail('acquisition-too-large', 'candidate response exceeds maxBytes');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

function parseContentLength(value) {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) fail('content-length', 'candidate response content-length is invalid');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail('content-length', 'candidate response content-length is too large');
  return parsed;
}
import { createHash } from 'node:crypto';
