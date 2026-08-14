import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  GEOFABRIK_ACQUISITION_MANIFEST_SCHEMA,
  GEOFABRIK_ACQUISITION_OBSERVATION_SCHEMA,
  GEOFABRIK_CANDIDATE_LIMITATIONS,
  admitGeofabrikAcquisitionManifest,
  observeGeofabrikAcquisitionManifest,
  parseGeofabrikAcquisitionManifest,
  verifySuppliedGeofabrikPayload,
} from '../lib/route_real_graph_acquisition/index.mjs';
import { freezeData } from '../lib/route_real_graph_acquisition/safe_data.mjs';

const manifestText = await readFile(
  new URL('../fixtures/route-real-graph-acquisition/pennsylvania-260813-manifest.json', import.meta.url),
  'utf8',
);
const manifestFixture = JSON.parse(manifestText);

test('dated Pennsylvania manifest is versioned, immutable, candidate-only, and binds exact references', () => {
  const manifest = parseGeofabrikAcquisitionManifest(manifestText);
  assert.equal(manifest.schema, GEOFABRIK_ACQUISITION_MANIFEST_SCHEMA);
  assert.match(manifest.manifestIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(manifest.dataClassification, 'candidate-external');
  assert.equal(manifest.source.providerPage, 'https://download.geofabrik.de/north-america/us/pennsylvania.html');
  assert.equal(manifest.source.datedUrl, 'https://download.geofabrik.de/north-america/us/pennsylvania-260813.osm.pbf');
  assert.equal(manifest.source.sidecarMd5Url, `${manifest.source.datedUrl}.md5`);
  assert.deepEqual(manifest.limitations, GEOFABRIK_CANDIDATE_LIMITATIONS);
  assert.deepEqual(manifest.policy, {
    candidateOnly: true,
    latestAllowed: false,
    fallbackAllowed: false,
    fullPayloadPersistenceAllowed: false,
  });
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.source));
  assert.ok(Object.isFrozen(manifest.references));
  assert.ok(Object.isFrozen(manifest.limitations));
});

test('latest, fallback, persistence, schema drift, source drift, and unknown fields fail closed', () => {
  const latest = fixture();
  latest.source.datedUrl = 'https://download.geofabrik.de/north-america/us/pennsylvania-latest.osm.pbf';
  latest.source.sidecarMd5Url = `${latest.source.datedUrl}.md5`;
  assert.throws(() => admitGeofabrikAcquisitionManifest(manifestJson(latest)), hasCode('latest-forbidden'));

  const fallback = fixture();
  fallback.policy.fallbackAllowed = true;
  assert.throws(() => admitGeofabrikAcquisitionManifest(manifestJson(fallback)), hasCode('fallback-forbidden'));

  const persistence = fixture();
  persistence.policy.fullPayloadPersistenceAllowed = true;
  assert.throws(() => admitGeofabrikAcquisitionManifest(manifestJson(persistence)), hasCode('payload-persistence-forbidden'));

  const future = fixture();
  future.schema = 'route-real-graph-geofabrik-acquisition-manifest/v2';
  assert.throws(() => admitGeofabrikAcquisitionManifest(manifestJson(future)), hasCode('manifest-schema'));

  const identityDrift = fixture();
  identityDrift.manifestIdentity = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => admitGeofabrikAcquisitionManifest(manifestJson(identityDrift)), hasCode('manifest-identity-drift'));

  const otherRegion = fixture();
  otherRegion.source.datedUrl = 'https://download.geofabrik.de/north-america/us/new-jersey-260813.osm.pbf';
  otherRegion.source.sidecarMd5Url = `${otherRegion.source.datedUrl}.md5`;
  assert.throws(() => admitGeofabrikAcquisitionManifest(manifestJson(otherRegion)), hasCode('dated-url'));

  const unknown = fixture();
  unknown.source.checksum = 'caller-authored';
  assert.throws(() => admitGeofabrikAcquisitionManifest(manifestJson(unknown)), hasCode('schema-mismatch'));
});

test('caller-authored checksum and clock fields are not part of manifest ingress', () => {
  for (const [field, value] of [
    ['clocks', { retrievedAt: '2026-08-14T00:00:00.000Z' }],
    ['sidecarMd5', 'c5eb6fea08b4d6ea3ebbb1cc61dd9fbe'],
    ['sha256', `sha256:${'0'.repeat(64)}`],
    ['bytes', 344436627],
    ['reviewedBy', 'caller-authored-reviewer'],
    ['brand', 'caller-authored-brand'],
  ]) {
    const input = fixture();
    input[field] = value;
    assert.throws(() => admitGeofabrikAcquisitionManifest(manifestJson(input)), hasCode('schema-mismatch'));
  }
});

test('primitive JSON boundary rejects duplicate keys, objects, and duplicate references', () => {
  assert.throws(
    () => parseGeofabrikAcquisitionManifest('{"schema":"a","schema":"b"}'),
    hasCode('duplicate-json-key'),
  );
  assert.throws(() => parseGeofabrikAcquisitionManifest({}), hasCode('json-text-required'));
  assert.throws(
    () => parseGeofabrikAcquisitionManifest(manifestText, { clock: 'caller-authored' }),
    hasCode('manifest-arguments'),
  );
  assert.throws(
    () => admitGeofabrikAcquisitionManifest(manifestText, { checksum: 'caller-authored' }),
    hasCode('manifest-arguments'),
  );
  assert.throws(
    () => admitGeofabrikAcquisitionManifest(parseGeofabrikAcquisitionManifest(manifestText)),
    hasCode('json-text-required'),
  );

  const duplicate = fixture();
  duplicate.references.tool = duplicate.references.profile;
  assert.throws(() => admitGeofabrikAcquisitionManifest(manifestJson(duplicate)), hasCode('duplicate-reference'));
});

test('public manifest ingress rejects arbitrary objects before descriptors, getters, traps, or coercion', () => {
  let trapCalls = 0;
  const proxy = new Proxy(fixture(), {
    get() { trapCalls += 1; throw new Error('must not execute'); },
    getOwnPropertyDescriptor() { trapCalls += 1; throw new Error('must not execute'); },
    getPrototypeOf() { trapCalls += 1; throw new Error('must not execute'); },
    ownKeys() { trapCalls += 1; throw new Error('must not execute'); },
  });
  assert.throws(() => admitGeofabrikAcquisitionManifest(proxy), hasCode('json-text-required'));
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  let coercionCalls = 0;
  const ultraWide = wideObject(10_000, 'wide');
  Object.defineProperty(ultraWide, 'hostileGetter', {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return 'must not execute'; },
  });
  Object.defineProperty(ultraWide, Symbol.toPrimitive, {
    configurable: true,
    value() { coercionCalls += 1; return 'must not execute'; },
  });

  const customArray = new Array(1_000).fill(null);
  for (let index = 0; index < 10_000; index += 1) customArray[`custom${index}`] = index;
  Object.defineProperty(customArray, 'hostileGetter', {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return 'must not execute'; },
  });
  Object.defineProperty(customArray, Symbol.toPrimitive, {
    configurable: true,
    value() { coercionCalls += 1; return 'must not execute'; },
  });

  const originalGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  let ultraWideDescriptorCalls = 0;
  let customArrayDescriptorCalls = 0;
  Object.getOwnPropertyDescriptors = (target) => {
    if (target === ultraWide) ultraWideDescriptorCalls += 1;
    if (target === customArray) customArrayDescriptorCalls += 1;
    return originalGetOwnPropertyDescriptors(target);
  };
  try {
    assert.throws(() => admitGeofabrikAcquisitionManifest(ultraWide), hasCode('json-text-required'));
    assert.throws(() => admitGeofabrikAcquisitionManifest(customArray), hasCode('json-text-required'));
  } finally {
    Object.getOwnPropertyDescriptors = originalGetOwnPropertyDescriptors;
  }
  assert.equal(ultraWideDescriptorCalls, 0);
  assert.equal(customArrayDescriptorCalls, 0);
  assert.equal(getterCalls, 0);
  assert.equal(coercionCalls, 0);
});

test('module-internal array clone preserves bounded fail-closed descriptor handling', () => {
  let arrayTrapCalls = 0;
  const arrayProxy = new Proxy(new Array(3).fill('bounded'), {
    get() { arrayTrapCalls += 1; throw new Error('must not execute'); },
    getOwnPropertyDescriptor() { arrayTrapCalls += 1; throw new Error('must not execute'); },
    getPrototypeOf() { arrayTrapCalls += 1; throw new Error('must not execute'); },
    ownKeys() { arrayTrapCalls += 1; throw new Error('must not execute'); },
  });
  assert.throws(() => freezeData(arrayProxy), hasCode('proxy-object'));
  assert.equal(arrayTrapCalls, 0);

  const denseOversized = new Array(1001).fill('bounded hostile item');
  const originalGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  let pluralDescriptorCalls = 0;
  Object.getOwnPropertyDescriptors = (target) => {
    if (target === denseOversized) pluralDescriptorCalls += 1;
    return originalGetOwnPropertyDescriptors(target);
  };
  try {
    assert.throws(() => freezeData(denseOversized), hasCode('array-size'));
  } finally {
    Object.getOwnPropertyDescriptors = originalGetOwnPropertyDescriptors;
  }
  assert.equal(pluralDescriptorCalls, 0);

  let oversizedGetterCalls = 0;
  const oversized = new Array(1001);
  Object.defineProperty(oversized, '0', {
    enumerable: true,
    configurable: true,
    get() { oversizedGetterCalls += 1; return 'must not execute'; },
  });
  assert.throws(() => freezeData(oversized), hasCode('array-size'));
  assert.equal(oversizedGetterCalls, 0);

  let hugeSparseGetterCalls = 0;
  const hugeSparse = new Array(50_000_000);
  Object.defineProperty(hugeSparse, '0', {
    enumerable: true,
    configurable: true,
    get() { hugeSparseGetterCalls += 1; return 'must not execute'; },
  });
  assert.throws(() => freezeData(hugeSparse), hasCode('array-size'));
  assert.equal(hugeSparseGetterCalls, 0);

  let hugeSparseTrapCalls = 0;
  const hugeSparseProxy = new Proxy(new Array(50_000_000), {
    get() { hugeSparseTrapCalls += 1; throw new Error('must not execute'); },
    getOwnPropertyDescriptor() { hugeSparseTrapCalls += 1; throw new Error('must not execute'); },
    getPrototypeOf() { hugeSparseTrapCalls += 1; throw new Error('must not execute'); },
    ownKeys() { hugeSparseTrapCalls += 1; throw new Error('must not execute'); },
  });
  assert.throws(() => freezeData(hugeSparseProxy), hasCode('proxy-object'));
  assert.equal(hugeSparseTrapCalls, 0);

  let arrayGetterCalls = 0;
  const arrayGetter = new Array(1).fill('bounded');
  Object.defineProperty(arrayGetter, '0', {
    enumerable: true,
    configurable: true,
    get() { arrayGetterCalls += 1; return 'must not execute'; },
  });
  assert.throws(() => freezeData(arrayGetter), hasCode('accessor-property'));
  assert.equal(arrayGetterCalls, 0);

  const hiddenIndex = new Array(1).fill('bounded');
  Object.defineProperty(hiddenIndex, '0', {
    enumerable: false,
    configurable: true,
    writable: true,
    value: hiddenIndex[0],
  });
  assert.throws(() => freezeData(hiddenIndex), hasCode('hidden-property'));

  assert.throws(() => freezeData(Array(3)), hasCode('sparse-array'));
});

test('primitive JSON ingress enforces depth, aggregate, container, string, key, and number bounds', () => {
  for (const depth of [5_000, 10_000]) {
    const json = `${'{"x":'.repeat(depth)}null${'}'.repeat(depth)}`;
    assert.throws(() => parseGeofabrikAcquisitionManifest(json), hasCode('json-depth'));
  }

  const crossBranch = JSON.stringify({
    left: wideObject(500, 'left'),
    right: wideObject(500, 'right'),
  });
  assert.throws(() => parseGeofabrikAcquisitionManifest(crossBranch), hasCode('json-items'));
  assert.throws(
    () => parseGeofabrikAcquisitionManifest(JSON.stringify(new Array(1_001).fill(null))),
    hasCode('json-array-size'),
  );
  assert.throws(
    () => parseGeofabrikAcquisitionManifest(JSON.stringify(wideObject(1_001, 'key'))),
    hasCode('json-object-size'),
  );
  assert.throws(
    () => parseGeofabrikAcquisitionManifest(JSON.stringify('x'.repeat(4_097))),
    hasCode('json-string-size'),
  );
  assert.throws(
    () => parseGeofabrikAcquisitionManifest(JSON.stringify({ ['k'.repeat(129)]: true })),
    hasCode('json-key-size'),
  );
  assert.throws(() => parseGeofabrikAcquisitionManifest('{"__proto__":true}'), hasCode('blocked-property-key'));
  assert.throws(() => parseGeofabrikAcquisitionManifest('-0'), hasCode('json-number'));
});

test('module-internal data clone enforces shared depth and aggregate-item budgets without hostile reads', () => {
  for (const depth of [5_000, 10_000]) {
    let getterCalls = 0;
    let trapCalls = 0;
    const hostileLeafTarget = {};
    Object.defineProperty(hostileLeafTarget, 'value', {
      enumerable: true,
      configurable: true,
      get() { getterCalls += 1; return 'must not execute'; },
    });
    let value = new Proxy(hostileLeafTarget, {
      get() { trapCalls += 1; throw new Error('must not execute'); },
      getOwnPropertyDescriptor() { trapCalls += 1; throw new Error('must not execute'); },
      getPrototypeOf() { trapCalls += 1; throw new Error('must not execute'); },
      ownKeys() { trapCalls += 1; throw new Error('must not execute'); },
    });
    for (let index = 0; index < depth; index += 1) value = { next: value };
    assert.throws(() => freezeData(value, `${depth}-deep probe`), hasCode('data-depth'));
    assert.equal(getterCalls, 0);
    assert.equal(trapCalls, 0);
  }

  let wideGetterCalls = 0;
  let wideTrapCalls = 0;
  const left = wideObject(600, 'left');
  const right = wideObject(598, 'right');
  right.hostileProxy = new Proxy({}, {
    get() { wideTrapCalls += 1; throw new Error('must not execute'); },
    getOwnPropertyDescriptor() { wideTrapCalls += 1; throw new Error('must not execute'); },
    getPrototypeOf() { wideTrapCalls += 1; throw new Error('must not execute'); },
    ownKeys() { wideTrapCalls += 1; throw new Error('must not execute'); },
  });
  Object.defineProperty(right, 'hostileGetter', {
    enumerable: true,
    configurable: true,
    get() { wideGetterCalls += 1; return 'must not execute'; },
  });
  assert.throws(() => freezeData({ left, right }, 'wide aggregate probe'), hasCode('data-items'));
  assert.equal(wideGetterCalls, 0);
  assert.equal(wideTrapCalls, 0);
});

test('bounded HEAD and MD5 sidecar observation records transport truth and keeps business clocks unknown', async () => {
  const payload = Buffer.from('bounded-pbf-fixture');
  const md5 = createHash('md5').update(payload).digest('hex');
  const calls = [];
  const observation = await withFetch(async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'content-length': String(payload.byteLength),
          'content-type': 'application/octet-stream',
          etag: '"bounded-fixture"',
          'last-modified': 'Thu, 13 Aug 2026 23:26:51 GMT',
        },
      });
    }
    return new Response(`${md5}  pennsylvania-260813.osm.pbf\n`, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }, () => observeGeofabrikAcquisitionManifest(manifestText));

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ options }) => options.method).sort(), ['GET', 'HEAD']);
  assert.ok(calls.every(({ options }) => options.redirect === 'error' && options.cache === 'no-store'));
  assert.equal(observation.schema, GEOFABRIK_ACQUISITION_OBSERVATION_SCHEMA);
  assert.match(observation.observationIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(observation.status, 'observed');
  assert.equal(observation.transport.head.ok, true);
  assert.equal(observation.transport.sidecar.ok, true);
  assert.equal(observation.integrity.providerSidecarMd5, md5);
  assert.equal(observation.integrity.declaredBytes, payload.byteLength);
  assert.equal(observation.integrity.localSha256, null);
  assert.equal(observation.integrity.localBytes, null);
  assert.deepEqual(observation.clocks.sourceAsOf, null);
  assert.deepEqual(observation.clocks.builtAt, null);
  assert.match(observation.clocks.retrievedAt, /^2026-/);
  assert.match(observation.clocks.observedAt, /^2026-/);
  assert.equal(observation.transport.head.lastModified, 'Thu, 13 Aug 2026 23:26:51 GMT');
  assert.equal(observation.claimBoundary.businessFreshness, 'unknown');
  assert.equal(observation.fallbackUsed, false);
  assert.equal(observation.failure, null);
  assert.ok(Object.isFrozen(observation));
});

test('non-success HEAD content-length remains transport-only and cannot project payload integrity', async () => {
  for (const status of [404, 500]) {
    const observation = await withFetch(async (_url, options) => (
      options.method === 'HEAD'
        ? new Response(null, {
          status,
          headers: {
            'content-length': '344436627',
            'content-type': 'application/octet-stream',
          },
        })
        : new Response('c5eb6fea08b4d6ea3ebbb1cc61dd9fbe  pennsylvania-260813.osm.pbf\n', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
    ), () => observeGeofabrikAcquisitionManifest(manifestText));

    assert.equal(observation.status, 'failed');
    assert.equal(observation.failure.code, 'http-status');
    assert.equal(observation.failure.phase, 'payload-head');
    assert.equal(observation.transport.head.status, status);
    assert.equal(observation.transport.head.contentLength, 344436627);
    assert.equal(observation.integrity.declaredBytes, null);
    assert.equal(observation.integrity.providerSidecarMd5, null);
    assert.equal(observation.integrity.localBytes, null);
    assert.equal(observation.integrity.localSha256, null);
    assert.equal(observation.fallbackUsed, false);
  }
});

test('HTTP success derives only from valid status and response.ok contradictions fail closed', async () => {
  const payload = Buffer.from('bounded-pbf-fixture');
  const md5 = createHash('md5').update(payload).digest('hex');
  const validSidecar = () => new Response(`${md5}  pennsylvania-260813.osm.pbf\n`, { status: 200 });

  const contradictoryBoth = await withFetch(async (_url, options) => (
    options.method === 'HEAD'
      ? transportResponse({ status: 500, ok: true, contentLength: payload.byteLength })
      : transportResponse({ status: 404, ok: true, contentLength: 0 })
  ), () => observeGeofabrikAcquisitionManifest(manifestText));
  assert.equal(contradictoryBoth.status, 'failed');
  assert.equal(contradictoryBoth.failure.code, 'transport-response');
  assert.equal(contradictoryBoth.failure.phase, 'payload-head');
  assert.equal(contradictoryBoth.integrity.declaredBytes, null);
  assert.equal(contradictoryBoth.integrity.providerSidecarMd5, null);
  assert.equal(contradictoryBoth.integrity.localMd5, null);
  assert.equal(contradictoryBoth.integrity.localSha256, null);
  assert.equal(contradictoryBoth.integrity.localBytes, null);
  assert.throws(
    () => verifySuppliedGeofabrikPayload(contradictoryBoth, payload),
    hasCode('observation-failed'),
  );

  const contradictoryHead = await withFetch(async (_url, options) => (
    options.method === 'HEAD'
      ? transportResponse({ status: 200, ok: false, contentLength: payload.byteLength })
      : validSidecar()
  ), () => observeGeofabrikAcquisitionManifest(manifestText));
  assert.equal(contradictoryHead.status, 'failed');
  assert.equal(contradictoryHead.failure.code, 'transport-response');
  assert.equal(contradictoryHead.failure.phase, 'payload-head');
  assert.equal(contradictoryHead.integrity.declaredBytes, null);

  const contradictorySidecar = await withFetch(async (_url, options) => (
    options.method === 'HEAD'
      ? new Response(null, { status: 200, headers: { 'content-length': String(payload.byteLength) } })
      : transportResponse({ status: 404, ok: true, contentLength: 0 })
  ), () => observeGeofabrikAcquisitionManifest(manifestText));
  assert.equal(contradictorySidecar.status, 'failed');
  assert.equal(contradictorySidecar.failure.code, 'transport-response');
  assert.equal(contradictorySidecar.failure.phase, 'md5-sidecar');
  assert.equal(contradictorySidecar.integrity.declaredBytes, payload.byteLength);
  assert.equal(contradictorySidecar.integrity.providerSidecarMd5, null);
  assert.equal(contradictorySidecar.integrity.localBytes, null);
  assert.equal(contradictorySidecar.integrity.localSha256, null);
  assert.throws(
    () => verifySuppliedGeofabrikPayload(contradictorySidecar, payload),
    hasCode('observation-failed'),
  );
});

test('invalid numeric HTTP statuses return stable transport-response failures', async () => {
  for (const status of [200.5, Number.NaN, 99, 600]) {
    const observation = await withFetch(async (_url, options) => (
      options.method === 'HEAD'
        ? transportResponse({ status, ok: false, contentLength: 12 })
        : new Response('c5eb6fea08b4d6ea3ebbb1cc61dd9fbe  pennsylvania-260813.osm.pbf\n', { status: 200 })
    ), () => observeGeofabrikAcquisitionManifest(manifestText));
    assert.equal(observation.status, 'failed');
    assert.equal(observation.failure.code, 'transport-response');
    assert.equal(observation.failure.phase, 'payload-head');
    assert.equal(observation.integrity.declaredBytes, null);
    assert.equal(observation.integrity.providerSidecarMd5, null);
    assert.throws(
      () => verifySuppliedGeofabrikPayload(observation, Buffer.from('bounded')),
      hasCode('observation-failed'),
    );
  }
});

test('successful HEAD with zero or missing length retains transport truth but no integrity bytes', async () => {
  for (const contentLength of [0, null]) {
    const observation = await withFetch(async (_url, options) => (
      options.method === 'HEAD'
        ? transportResponse({ status: 200, ok: true, contentLength })
        : new Response('c5eb6fea08b4d6ea3ebbb1cc61dd9fbe  pennsylvania-260813.osm.pbf\n', { status: 200 })
    ), () => observeGeofabrikAcquisitionManifest(manifestText));
    assert.equal(observation.status, 'failed');
    assert.equal(observation.failure.code, 'payload-byte-count-unavailable');
    assert.equal(observation.failure.phase, 'payload-head');
    assert.equal(observation.transport.head.status, 200);
    assert.equal(observation.transport.head.ok, true);
    assert.equal(observation.transport.head.contentLength, contentLength);
    assert.equal(observation.integrity.declaredBytes, null);
    assert.equal(observation.integrity.providerSidecarMd5, null);
    assert.equal(observation.integrity.localBytes, null);
    assert.equal(observation.integrity.localSha256, null);
    assert.throws(
      () => verifySuppliedGeofabrikPayload(observation, Buffer.from('bounded')),
      hasCode('observation-failed'),
    );
  }
});

test('actual supplied payload bytes produce local SHA-256, bytes, build clock, and integrity comparison', async () => {
  const payload = Buffer.from('bounded-pbf-fixture');
  const observation = await successfulObservation(payload);
  const verified = verifySuppliedGeofabrikPayload(observation, payload);

  assert.equal(verified.status, 'payload-verified');
  assert.equal(verified.integrity.localBytes, payload.byteLength);
  assert.equal(
    verified.integrity.localSha256,
    `sha256:${createHash('sha256').update(payload).digest('hex')}`,
  );
  assert.equal(verified.integrity.localMd5, createHash('md5').update(payload).digest('hex'));
  assert.equal(verified.integrity.md5MatchesSidecar, true);
  assert.equal(verified.integrity.declaredBytesMatch, true);
  assert.match(verified.clocks.builtAt, /^2026-/);
  assert.match(verified.clocks.observedAt, /^2026-/);
  assert.equal(verified.localPayload.persisted, false);
  assert.equal(verified.failure, null);
});

test('caller-authored or deserialized observation evidence cannot authorize local verification', async () => {
  const payload = Buffer.from('bounded-pbf-fixture');
  const observation = await successfulObservation(payload);
  const authored = structuredClone(observation);
  authored.clocks.builtAt = '2026-08-14T00:00:00.000Z';
  authored.integrity.localSha256 = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => verifySuppliedGeofabrikPayload(authored, payload), hasCode('untrusted-observation'));

  await assert.rejects(
    observeGeofabrikAcquisitionManifest(manifestText, { checksum: 'caller-authored' }),
    hasCode('observation-arguments'),
  );
});

test('local mismatch returns explicit failure truth while retaining computed actual-byte evidence', async () => {
  const expected = Buffer.from('expected');
  const supplied = Buffer.from('different');
  const observation = await successfulObservation(expected);
  const failed = verifySuppliedGeofabrikPayload(observation, supplied);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.localPayload.status, 'rejected');
  assert.equal(failed.integrity.localBytes, supplied.byteLength);
  assert.equal(failed.integrity.md5MatchesSidecar, false);
  assert.equal(failed.failure.code, 'payload-md5-mismatch');
  assert.equal(failed.fallbackUsed, false);
});

test('network and malformed-sidecar failures remain explicit, bounded, and fallback-free', async () => {
  let calls = 0;
  const networkFailure = await withFetch(async () => {
    calls += 1;
    throw new Error('offline');
  }, () => observeGeofabrikAcquisitionManifest(manifestText));
  assert.equal(calls, 2);
  assert.equal(networkFailure.status, 'failed');
  assert.equal(networkFailure.failure.code, 'transport-network');
  assert.equal(networkFailure.failure.phase, 'payload-head');
  assert.equal(networkFailure.fallbackUsed, false);
  assert.equal(networkFailure.integrity.providerSidecarMd5, null);

  const malformed = await withFetch(async (_url, options) => (
    options.method === 'HEAD'
      ? new Response(null, { status: 200, headers: { 'content-length': '12' } })
      : new Response('one\nentry\nper\nline\n', { status: 200 })
  ), () => observeGeofabrikAcquisitionManifest(manifestText));
  assert.equal(malformed.status, 'failed');
  assert.equal(malformed.failure.code, 'sidecar-format');
  assert.equal(malformed.integrity.providerSidecarMd5, null);

  let arrayBufferCalls = 0;
  const noReadableStream = await withFetch(async (_url, options) => (
    options.method === 'HEAD'
      ? new Response(null, { status: 200, headers: { 'content-length': '12' } })
      : {
        status: 200,
        ok: true,
        headers: new Headers({ 'content-length': '12', 'content-type': 'text/plain' }),
        body: null,
        async arrayBuffer() {
          arrayBufferCalls += 1;
          return new ArrayBuffer(12);
        },
      }
  ), () => observeGeofabrikAcquisitionManifest(manifestText));
  assert.equal(noReadableStream.status, 'failed');
  assert.equal(noReadableStream.failure.code, 'sidecar-stream-required');
  assert.equal(noReadableStream.failure.phase, 'md5-sidecar');
  assert.equal(noReadableStream.fallbackUsed, false);
  assert.equal(arrayBufferCalls, 0);
});

test('payload Proxy is rejected without invoking traps', async () => {
  const payload = Buffer.from('bounded-pbf-fixture');
  const observation = await successfulObservation(payload);
  let trapCalls = 0;
  const proxy = new Proxy(payload, {
    get() { trapCalls += 1; throw new Error('must not execute'); },
    getPrototypeOf() { trapCalls += 1; throw new Error('must not execute'); },
  });
  assert.throws(() => verifySuppliedGeofabrikPayload(observation, proxy), hasCode('payload-proxy'));
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const getter = Uint8Array.from(payload);
  Object.defineProperty(getter, 'buffer', {
    configurable: true,
    get() { getterCalls += 1; return payload.buffer; },
  });
  assert.throws(() => verifySuppliedGeofabrikPayload(observation, getter), hasCode('payload-descriptor'));
  assert.equal(getterCalls, 0);
});

async function successfulObservation(payload) {
  const md5 = createHash('md5').update(payload).digest('hex');
  return withFetch(async (_url, options) => (
    options.method === 'HEAD'
      ? new Response(null, { status: 200, headers: { 'content-length': String(payload.byteLength) } })
      : new Response(`${md5}  pennsylvania-260813.osm.pbf\n`, { status: 200 })
  ), () => observeGeofabrikAcquisitionManifest(manifestText));
}

async function withFetch(fetchImpl, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

function fixture() {
  return structuredClone(manifestFixture);
}

function manifestJson(value) {
  return JSON.stringify(value);
}

function wideObject(count, prefix) {
  const result = {};
  for (let index = 0; index < count; index += 1) result[`${prefix}${index}`] = index;
  return result;
}

function transportResponse({ status, ok, contentLength }) {
  const headers = new Headers();
  if (contentLength !== null) headers.set('content-length', String(contentLength));
  return { status, ok, headers, body: null };
}

function hasCode(code) {
  return (error) => error?.code === code;
}
