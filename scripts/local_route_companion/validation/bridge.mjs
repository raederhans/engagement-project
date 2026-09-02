import { createHash } from 'node:crypto';

import { canonicalIdentity } from './canonical.mjs';

const trustedBridges = new WeakMap();
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/;

export function createTrustedLocalCompanionBridge({ companion, artifactInputs, runtimeBindings }) {
  if (!companion || typeof companion.generate !== 'function') {
    throw new TypeError('trusted bridge requires a local companion');
  }
  assertExactKeys(artifactInputs, ['engine', 'graph', 'candidateGenerator', 'evidence'], 'artifactInputs');
  assertExactKeys(runtimeBindings, ['engineIdentity', 'evidenceIdentity', 'transportKind'], 'runtimeBindings');
  if (!ID_PATTERN.test(runtimeBindings.engineIdentity || '')
    || !ID_PATTERN.test(runtimeBindings.evidenceIdentity || '')
    || runtimeBindings.transportKind !== 'in-process') {
    throw new TypeError('formal bridge requires bounded runtime identities and in-process transport');
  }
  if (runtimeBindings.engineIdentity === runtimeBindings.evidenceIdentity) {
    throw new TypeError('formal bridge requires independent engine and evidence runtime identities');
  }
  const artifactIdentities = Object.freeze(Object.fromEntries(
    Object.entries(artifactInputs).map(([key, value]) => [key, artifactIdentity(value)]),
  ));
  if (artifactIdentities.engine === artifactIdentities.evidence) {
    throw new TypeError('formal bridge requires independent engine and evidence artifacts');
  }
  const bridge = Object.freeze({
    async generate({ pair, policy, signal }) {
      if (signal?.aborted) throw signal.reason ?? new Error('benchmark pair aborted');
      const request = Object.freeze({
        schemaVersion: 'LocalRoutePrivateRequest/v1',
        requestId: pair.pairId,
        mode: policy.mode,
        origin: Object.freeze({ longitude: pair.origin.longitude, latitude: pair.origin.latitude }),
        destination: Object.freeze({ longitude: pair.destination.longitude, latitude: pair.destination.latitude }),
      });
      const generated = await raceAbort(companion.generate(request, { signal }), signal);
      return projectLocalCompanionResult(generated, pair, policy.candidateLimit, {
        artifactIdentities,
        runtimeBindings,
      });
    },
  });
  trustedBridges.set(bridge, Object.freeze({ artifactIdentities }));
  return bridge;
}

export function trustedBridgeContext(value) {
  return trustedBridges.get(value) ?? null;
}

export function deriveRouteSetIdentity(observations) {
  return canonicalIdentity({
    schemaVersion: 'mainline-m7-route-set-identity-input/v1',
    routes: observations.flatMap((observation) => observation.status === 'success'
      ? observation.candidates.map(({ candidateIdentity }) => ({ pairId: observation.pairId, candidateIdentity })) : []),
  });
}

function projectLocalCompanionResult(generated, pair, candidateLimit, context) {
  if (!generated || typeof generated !== 'object' || Array.isArray(generated)) return invalid('invalid-companion-result');
  if (generated.engine?.identity !== context.runtimeBindings.engineIdentity
    || generated.evidence?.identity !== context.runtimeBindings.evidenceIdentity
    || generated.engine?.transportKind !== context.runtimeBindings.transportKind) {
    return invalid('runtime-binding-mismatch');
  }
  if (generated.status === 'unavailable' || generated.status === 'blocked') {
    return { status: 'unavailable', reasonCode: generated.status === 'blocked'
      ? 'local-transport-blocked' : 'local-companion-unavailable' };
  }
  if (generated.status === 'invalid') return invalid('local-companion-invalid');
  if (generated.status !== 'ready' || !Array.isArray(generated.candidates)
    || generated.candidates.length < 1 || generated.candidates.length > candidateLimit
    || generated.candidates.some((candidate) => !SHA_IDENTITY.test(candidate.topologyIdentity || ''))
    || generated.candidates.some((candidate) => candidate.evidenceCoverage?.status === 'available'
      && (generated.evidence?.artifactIdentity !== context.artifactIdentities.evidence
        || !SHA_IDENTITY.test(candidate.evidenceCoverage.receiptIdentity || '')))) {
    return invalid('invalid-companion-result');
  }
  const straightLineDistanceM = haversineMetres(pair.origin, pair.destination);
  return {
    status: 'success',
    candidates: generated.candidates.map((candidate) => ({
      candidateIdentity: canonicalIdentity({
        schemaVersion: 'mainline-m7-candidate-identity-input/v1',
        graphIdentity: context.artifactIdentities.graph,
        topologyIdentity: candidate.topologyIdentity,
      }),
      mapMatchDistanceM: availableNonNegativeNumber(candidate.evidence?.['map-match']),
      routeDistanceM: Number.isFinite(candidate.distanceMm) && candidate.distanceMm >= 0
        ? candidate.distanceMm / 1000 : null,
      straightLineDistanceM,
      evidence: candidate.evidenceCoverage?.status === 'available' ? {
        coveredSegmentCount: candidate.evidenceCoverage.coveredSegmentCount,
        totalSegmentCount: candidate.evidenceCoverage.totalSegmentCount,
      } : { coveredSegmentCount: null, totalSegmentCount: null },
      weightSensitivityChanged: availableBoolean(candidate.evidence?.sensitivity),
    })),
  };
}

const SHA_IDENTITY = /^sha256:[0-9a-f]{64}$/;

function invalid(reasonCode) { return { status: 'invalid', reasonCode, candidates: [] }; }
function availableNonNegativeNumber(dimension) {
  return dimension?.status === 'available' && Number.isFinite(dimension.value) && dimension.value >= 0
    ? dimension.value : null;
}
function availableBoolean(dimension) {
  return dimension?.status === 'available' && typeof dimension.value === 'boolean' ? dimension.value : null;
}
function haversineMetres(origin, destination) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const firstLatitude = radians(origin.latitude);
  const secondLatitude = radians(destination.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function artifactIdentity(value) {
  if (typeof value === 'string') return hashBytes(Buffer.from(value, 'utf8'));
  if (value instanceof Uint8Array) return hashBytes(value);
  if (!isCanonicalData(value)) throw new TypeError('artifact input must be bytes, text, or canonical JSON data');
  return canonicalIdentity(value);
}
function hashBytes(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function isCanonicalData(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || ancestors.has(value)) return false;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) return value.every((child) => isCanonicalData(child, nextAncestors));
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).every((key) => typeof key === 'string'
    && Object.hasOwn(descriptors[key], 'value')
    && isCanonicalData(descriptors[key].value, nextAncestors));
}
function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} exact keys mismatch`);
  }
}
function raceAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('benchmark pair aborted'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
