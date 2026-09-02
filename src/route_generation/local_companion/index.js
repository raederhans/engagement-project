import { searchRouteCandidates } from '../candidate_search/index.js';
import { canonicalStringify, sha256Hex } from '../compact_graph/canonical_v1.js';

export { createInProcessOsrmEngineAdapter } from './osrm_in_process.js';

export const LOCAL_ROUTE_PRIVATE_REQUEST_SCHEMA_VERSION = 'LocalRoutePrivateRequest/v1';
export const LOCAL_ROUTE_COMPANION_RESULT_SCHEMA_VERSION = 'LocalRouteCompanionResult/v1';
export const EVIDENCE_COVERAGE_RECEIPT_SCHEMA_VERSION = 'mainline-m7-evidence-coverage-receipt/v1';

const DIMENSION_IDS = Object.freeze([
  'crime',
  'crash',
  'accessibility',
  'map-match',
  'sensitivity',
]);
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/;
const SHA256_IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/;
const COORDINATE_PATH_PATTERN = /(?:^|\/)[-+]?\d{1,3}(?:\.\d+)?[,;][-+]?\d{1,3}(?:\.\d+)?(?:[,;\/]|$)/;
const DEFAULT_OPERATION_TIMEOUT_MS = 5_000;
const MAX_OPERATION_TIMEOUT_MS = 300_000;

/**
 * Build the private local-route orchestration boundary.
 *
 * The adapter is the only component that receives the admitted private
 * origin/destination. The returned value deliberately projects neither that
 * request nor graph geometry/node/edge identities.
 */
export function createLocalRouteCompanion({
  engineAdapter,
  evidenceEnricher = createUnavailableEvidenceEnricher(),
  engineTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  evidenceTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  logger = null,
} = {}) {
  const engine = admitEngineAdapter(engineAdapter);
  const evidence = admitEvidenceEnricher(evidenceEnricher);
  const admittedEngineTimeoutMs = admitTimeout(engineTimeoutMs, 'engine timeout');
  const admittedEvidenceTimeoutMs = admitTimeout(evidenceTimeoutMs, 'evidence timeout');
  if (engine.identity === evidence.identity) {
    throw new TypeError('local companion engine and evidence identities must be independent');
  }
  if (logger !== null && typeof logger !== 'function') {
    throw new TypeError('local companion logger must be a function or null');
  }

  return Object.freeze({
    async generate(rawRequest, { signal = null } = {}) {
      const request = admitPrivateRequest(rawRequest);
      const admittedSignal = admitAbortSignal(signal);
      const ledger = createPrivacyLedger();
      const transportDecision = admitTransportForRequest(engine.transport, request);

      if (transportDecision.status === 'blocked') {
        ledger[transportDecision.ledgerKey] += 1;
        logCategory(logger, 'transport-blocked');
        return finalizeResult({
          requestId: request.requestId,
          status: 'blocked',
          fallback: 'known-route-paste-draw-required',
          engine,
          evidence,
          candidates: [],
          ledger,
        });
      }

      ledger[transportDecision.ledgerKey] += 1;
      logCategory(logger, 'engine-request-started');
      let engineResult;
      try {
        engineResult = await runWithDeadline(
          (operationSignal) => engine.generate(request, Object.freeze({ signal: operationSignal })),
          {
            signal: admittedSignal,
            timeoutMs: admittedEngineTimeoutMs,
            label: 'engine generation',
          },
        );
      } catch {
        logCategory(logger, 'engine-unavailable');
        return finalizeResult({
          requestId: request.requestId,
          status: 'unavailable',
          fallback: 'known-route-paste-draw-required',
          engine,
          evidence,
          candidates: [],
          ledger,
        });
      }

      let admittedEngineResult;
      try {
        admittedEngineResult = admitEngineResult(engineResult);
      } catch {
        logCategory(logger, 'engine-result-invalid');
        return finalizeResult({
          requestId: request.requestId,
          status: 'invalid',
          fallback: 'known-route-paste-draw-required',
          engine,
          evidence,
          candidates: [],
          ledger,
        });
      }
      if (admittedEngineResult.status === 'unavailable') {
        logCategory(logger, 'engine-unavailable');
        return finalizeResult({
          requestId: request.requestId,
          status: 'unavailable',
          fallback: 'known-route-paste-draw-required',
          engine,
          evidence,
          candidates: [],
          ledger,
        });
      }

      let searchResult;
      try {
        searchResult = searchRouteCandidates(
          admittedEngineResult.graphArtifact,
          admittedEngineResult.searchRequest,
          admittedEngineResult.edgeObservationsByEdgeId,
        );
      } catch {
        searchResult = null;
      }
      if (!isUsableSearchResult(searchResult)) {
        logCategory(logger, 'engine-result-invalid');
        return finalizeResult({
          requestId: request.requestId,
          status: 'invalid',
          fallback: 'known-route-paste-draw-required',
          engine,
          evidence,
          candidates: [],
          ledger,
        });
      }

      const candidateBindings = searchResult.candidateFacts.map((candidate) => Object.freeze({
        candidateId: candidate.candidateId,
        directedEdgeIds: Object.freeze([...candidate.edgeIds]),
        topologyIdentity: routeTopologyIdentity(
          admittedEngineResult.graphArtifact.graphId,
          candidate.edgeIds,
        ),
      }));
      let rawEvidence = null;
      try {
        rawEvidence = await runWithDeadline(
          (operationSignal) => evidence.enrich(Object.freeze({
            graphArtifact: admittedEngineResult.graphArtifact,
            searchResult,
            candidateBindings: Object.freeze(candidateBindings),
          }), Object.freeze({ signal: operationSignal })),
          {
            signal: admittedSignal,
            timeoutMs: admittedEvidenceTimeoutMs,
            label: 'evidence enrichment',
          },
        );
      } catch {
        logCategory(logger, 'evidence-unavailable');
      }
      const candidateEvidence = projectCandidateEvidence(rawEvidence, candidateBindings);
      const bindingsByCandidateId = Object.fromEntries(candidateBindings.map((binding) => [
        binding.candidateId, binding,
      ]));
      const candidates = searchResult.candidateFacts.map((candidate) => Object.freeze({
        candidateId: candidate.candidateId,
        topologyIdentity: bindingsByCandidateId[candidate.candidateId].topologyIdentity,
        distanceMm: candidate.distanceMm,
        objectiveCostUnits: candidate.objectiveCostUnits,
        evidence: candidateEvidence.dimensionsByCandidateId[candidate.candidateId],
        evidenceCoverage: candidateEvidence.coverageByCandidateId[candidate.candidateId],
      }));
      logCategory(logger, 'generation-completed');
      return finalizeResult({
        requestId: request.requestId,
        status: 'ready',
        fallback: null,
        engine,
        evidence,
        evidenceArtifactIdentity: candidateEvidence.evidenceArtifactIdentity,
        candidates,
        ledger,
      });
    },
  });
}

export function createUnavailableEngineAdapter({
  identity = 'local-engine-unavailable',
  transport = Object.freeze({ kind: 'in-process' }),
} = {}) {
  const admittedIdentity = boundedId(identity, 'engine identity');
  const admittedTransport = admitTransport(transport);
  return Object.freeze({
    identity: admittedIdentity,
    transport: admittedTransport,
    async generate() {
      return Object.freeze({ status: 'unavailable' });
    },
  });
}

function createUnavailableEvidenceEnricher() {
  return Object.freeze({
    identity: 'local-evidence-unavailable',
    async enrich() {
      return Object.freeze({ status: 'unavailable' });
    },
  });
}

function admitPrivateRequest(raw) {
  const value = exactObject(raw, 'private request', [
    'schemaVersion', 'requestId', 'mode', 'origin', 'destination',
  ]);
  if (value.schemaVersion !== LOCAL_ROUTE_PRIVATE_REQUEST_SCHEMA_VERSION) {
    throw new TypeError('local companion private request schemaVersion is unsupported');
  }
  if (value.mode !== 'walk') {
    throw new TypeError('local companion supports walk mode only');
  }
  return deepFreeze({
    schemaVersion: LOCAL_ROUTE_PRIVATE_REQUEST_SCHEMA_VERSION,
    requestId: boundedId(value.requestId, 'private request requestId'),
    mode: 'walk',
    origin: admitCoordinate(value.origin, 'origin'),
    destination: admitCoordinate(value.destination, 'destination'),
  });
}

function admitCoordinate(raw, label) {
  const value = exactObject(raw, label, ['longitude', 'latitude']);
  if (!Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180
    || !Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90) {
    throw new TypeError(`local companion ${label} must be a finite WGS84 coordinate`);
  }
  return Object.freeze({ longitude: value.longitude, latitude: value.latitude });
}

function admitEngineAdapter(raw) {
  const value = exactObject(raw, 'engine adapter', ['identity', 'transport', 'generate']);
  if (typeof value.generate !== 'function') {
    throw new TypeError('local companion engine generate must be a function');
  }
  return Object.freeze({
    identity: boundedId(value.identity, 'engine identity'),
    transport: admitTransport(value.transport),
    generate: value.generate.bind(raw),
  });
}

function admitEvidenceEnricher(raw) {
  const value = exactObject(raw, 'evidence enricher', ['identity', 'enrich']);
  if (typeof value.enrich !== 'function') {
    throw new TypeError('local companion evidence enrich must be a function');
  }
  return Object.freeze({
    identity: boundedId(value.identity, 'evidence identity'),
    enrich: value.enrich.bind(raw),
  });
}

function admitTransport(raw) {
  const base = inspectPlainObject(raw, 'engine transport');
  const kind = base.descriptors.kind?.value;
  if (kind === 'in-process' || kind === 'stdio') {
    exactObject(raw, 'engine transport', ['kind']);
    return Object.freeze({ kind });
  }
  if (kind === 'loopback') {
    const value = exactObject(raw, 'engine transport', ['kind', 'endpoint']);
    if (typeof value.endpoint !== 'string') {
      throw new TypeError('local companion loopback endpoint must be a string');
    }
    return Object.freeze({ kind, endpoint: value.endpoint });
  }
  if (kind === 'network') {
    const value = exactObject(raw, 'engine transport', ['kind', 'endpoint']);
    if (typeof value.endpoint !== 'string') {
      throw new TypeError('local companion network endpoint must be a string');
    }
    return Object.freeze({ kind, endpoint: value.endpoint });
  }
  throw new TypeError('local companion engine transport kind is unsupported');
}

function admitTransportForRequest(transport) {
  if (transport.kind === 'in-process') {
    return { status: 'allowed', ledgerKey: 'inProcessRequestCount' };
  }
  if (transport.kind === 'stdio') {
    return { status: 'allowed', ledgerKey: 'stdioRequestCount' };
  }
  if (transport.kind !== 'loopback') {
    return { status: 'blocked', ledgerKey: 'blockedNonLoopbackCount' };
  }

  try {
    const endpoint = new URL(transport.endpoint);
    if (!/^http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?(?:\/|$)/.test(transport.endpoint)
      || endpoint.protocol !== 'http:'
      || endpoint.hostname !== '127.0.0.1'
      || endpoint.username !== ''
      || endpoint.password !== ''
      || endpoint.search !== ''
      || endpoint.hash !== ''
      || COORDINATE_PATH_PATTERN.test(decodeURIComponent(endpoint.pathname))) {
      return { status: 'blocked', ledgerKey: 'blockedPrivateUrlCount' };
    }
  } catch {
    return { status: 'blocked', ledgerKey: 'blockedPrivateUrlCount' };
  }
  return { status: 'allowed', ledgerKey: 'loopbackRequestCount' };
}

function admitEngineResult(raw) {
  const inspected = inspectPlainObject(raw, 'engine result');
  const status = inspected.descriptors.status?.value;
  if (status === 'unavailable') {
    exactObject(raw, 'engine result', ['status']);
    return Object.freeze({ status });
  }
  const value = exactObject(raw, 'engine result', [
    'status', 'graphArtifact', 'searchRequest', 'edgeObservationsByEdgeId',
  ]);
  if (value.status !== 'ready') {
    throw new TypeError('local companion engine result status is unsupported');
  }
  return Object.freeze({
    status: 'ready',
    graphArtifact: value.graphArtifact,
    searchRequest: value.searchRequest,
    edgeObservationsByEdgeId: value.edgeObservationsByEdgeId,
  });
}

function isUsableSearchResult(result) {
  if (!result || result.status !== 'completed' || !result.candidateSet
    || result.candidateFacts.length === 0) return false;
  const candidateIds = result.candidateFacts.map(({ candidateId }) => candidateId);
  const routeKeys = result.candidateFacts.map(({ edgeIds }) => edgeIds.join('\u0000'));
  return new Set(candidateIds).size === candidateIds.length
    && new Set(routeKeys).size === routeKeys.length;
}

function projectCandidateEvidence(raw, candidateBindings) {
  const dimensionsByCandidateId = Object.create(null);
  const coverageByCandidateId = Object.create(null);
  let rawCandidateEvidence = null;
  let rawCandidateCoverage = null;
  let evidenceArtifactIdentity = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    try {
      const root = exactObject(raw, 'evidence result', [
        'status', 'evidenceArtifactIdentity', 'candidateEvidence', 'candidateCoverage',
      ]);
      if (root.status === 'ready' && SHA256_IDENTITY_PATTERN.test(root.evidenceArtifactIdentity)) {
        evidenceArtifactIdentity = root.evidenceArtifactIdentity;
        rawCandidateEvidence = inspectPlainObject(root.candidateEvidence, 'candidate evidence');
        rawCandidateCoverage = inspectPlainObject(root.candidateCoverage, 'candidate coverage');
      }
    } catch {
      try {
        const root = exactObject(raw, 'evidence result', ['status', 'candidateEvidence']);
        if (root.status === 'ready') {
          rawCandidateEvidence = inspectPlainObject(root.candidateEvidence, 'candidate evidence');
        }
      } catch {
        rawCandidateEvidence = null;
      }
    }
  }
  for (const binding of candidateBindings) {
    const { candidateId } = binding;
    const rawDimensions = rawCandidateEvidence?.descriptors[candidateId]?.value;
    const rawCoverage = rawCandidateCoverage?.descriptors[candidateId]?.value;
    dimensionsByCandidateId[candidateId] = projectDimensions(rawDimensions);
    coverageByCandidateId[candidateId] = projectCoverage(
      rawCoverage,
      binding,
      evidenceArtifactIdentity,
    );
  }
  return deepFreeze({
    dimensionsByCandidateId,
    coverageByCandidateId,
    evidenceArtifactIdentity,
  });
}

function projectCoverage(raw, binding, evidenceArtifactIdentity) {
  try {
    const value = exactObject(raw, 'candidate evidence coverage', [
      'topologyIdentity', 'routeDirectedEdgeIds', 'coveredDirectedEdgeIds',
      'coveredSegmentCount', 'totalSegmentCount', 'receiptIdentity',
    ]);
    const routeDirectedEdgeIds = admitDirectedEdgeIdentityList(
      value.routeDirectedEdgeIds,
      'candidate evidence route edge identities',
    );
    const coveredDirectedEdgeIds = admitDirectedEdgeIdentityList(
      value.coveredDirectedEdgeIds,
      'candidate evidence covered edge identities',
      { allowEmpty: true },
    );
    const routeEdgeSet = new Set(routeDirectedEdgeIds);
    if (!Number.isSafeInteger(value.coveredSegmentCount) || value.coveredSegmentCount < 0
      || !Number.isSafeInteger(value.totalSegmentCount) || value.totalSegmentCount < 1
      || value.topologyIdentity !== binding.topologyIdentity
      || !arraysEqual(routeDirectedEdgeIds, binding.directedEdgeIds)
      || value.totalSegmentCount !== binding.directedEdgeIds.length
      || value.coveredSegmentCount !== coveredDirectedEdgeIds.length
      || new Set(coveredDirectedEdgeIds).size !== coveredDirectedEdgeIds.length
      || coveredDirectedEdgeIds.some((edgeId) => !routeEdgeSet.has(edgeId))
      || evidenceArtifactIdentity === null
      || value.receiptIdentity !== deriveEvidenceCoverageReceiptIdentity({
        evidenceArtifactIdentity,
        topologyIdentity: binding.topologyIdentity,
        routeDirectedEdgeIds,
        coveredDirectedEdgeIds,
      })) {
      throw new TypeError('candidate evidence coverage is invalid');
    }
    return Object.freeze({
      status: 'available',
      coveredSegmentCount: value.coveredSegmentCount,
      totalSegmentCount: value.totalSegmentCount,
      receiptIdentity: value.receiptIdentity,
      reasonCode: null,
    });
  } catch {
    return Object.freeze({
      status: 'unavailable',
      coveredSegmentCount: null,
      totalSegmentCount: null,
      receiptIdentity: null,
      reasonCode: 'evidence-coverage-unavailable',
    });
  }
}

export function deriveEvidenceCoverageReceiptIdentity({
  evidenceArtifactIdentity,
  topologyIdentity,
  routeDirectedEdgeIds,
  coveredDirectedEdgeIds,
}) {
  if (!SHA256_IDENTITY_PATTERN.test(evidenceArtifactIdentity)
    || !SHA256_IDENTITY_PATTERN.test(topologyIdentity)) {
    throw new TypeError('evidence coverage receipt identities must be SHA-256 identities');
  }
  const routeEdges = admitDirectedEdgeIdentityList(
    routeDirectedEdgeIds,
    'evidence coverage receipt route edge identities',
  );
  const coveredEdges = admitDirectedEdgeIdentityList(
    coveredDirectedEdgeIds,
    'evidence coverage receipt covered edge identities',
    { allowEmpty: true },
  );
  const canonical = canonicalStringify({
    schemaVersion: EVIDENCE_COVERAGE_RECEIPT_SCHEMA_VERSION,
    evidenceArtifactIdentity,
    topologyIdentity,
    routeDirectedEdgeIds: routeEdges,
    coveredDirectedEdgeIds: coveredEdges,
  });
  return `sha256:${sha256Hex(new TextEncoder().encode(canonical))}`;
}

function admitDirectedEdgeIdentityList(raw, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(raw) || (!allowEmpty && raw.length < 1)
    || raw.some((edgeId) => typeof edgeId !== 'string' || !ID_PATTERN.test(edgeId))) {
    throw new TypeError(`${label} must be a non-empty bounded identity list`);
  }
  return [...raw];
}

function arraysEqual(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function projectDimensions(raw) {
  let admitted = null;
  try {
    admitted = exactObject(raw, 'candidate evidence dimensions', DIMENSION_IDS);
  } catch {
    admitted = null;
  }
  return deepFreeze(Object.fromEntries(DIMENSION_IDS.map((dimensionId) => [
    dimensionId,
    projectDimension(admitted?.[dimensionId]),
  ])));
}

function projectDimension(raw) {
  try {
    const value = exactObject(raw, 'evidence dimension', [
      'status', 'value', 'receiptIdentity',
    ]);
    if (value.status === 'available'
      && isSafeEvidenceScalar(value.value)
      && value.value !== null
      && SHA256_IDENTITY_PATTERN.test(value.receiptIdentity)) {
      return Object.freeze({
        status: 'available',
        value: value.value,
        receiptIdentity: value.receiptIdentity,
        reasonCode: null,
      });
    }
    const reasonCode = value.status === 'ambiguous'
      ? 'ambiguous-evidence'
      : 'evidence-unavailable';
    return unavailableDimension(reasonCode);
  } catch {
    return unavailableDimension('evidence-unavailable');
  }
}

function isSafeEvidenceScalar(value) {
  return typeof value === 'boolean'
    || typeof value === 'string' && value.length <= 120
    || Number.isFinite(value);
}

function unavailableDimension(reasonCode) {
  return Object.freeze({
    status: 'unavailable',
    value: null,
    receiptIdentity: null,
    reasonCode,
  });
}

function finalizeResult({
  requestId, status, fallback, engine, evidence, evidenceArtifactIdentity = null, candidates, ledger,
}) {
  const candidateCount = candidates.length;
  const candidateDisposition = candidateCount > 1
    ? 'alternatives'
    : candidateCount === 1 ? 'single' : 'none';
  return deepFreeze({
    schemaVersion: LOCAL_ROUTE_COMPANION_RESULT_SCHEMA_VERSION,
    requestId,
    status,
    fallback,
    candidateDisposition,
    candidateCount,
    candidates,
    engine: {
      status: status === 'ready' ? 'ready' : status,
      identity: engine.identity,
      identityClaimStatus: 'caller-provided-unverified',
      transportKind: engine.transport.kind,
    },
    evidence: {
      identity: evidence.identity,
      identityClaimStatus: 'caller-provided-unverified',
      artifactIdentity: evidenceArtifactIdentity,
      authority: {
        crime: false,
        crash: false,
        accessibility: false,
        mapMatch: false,
        sensitivity: false,
        safety: false,
        routing: false,
        official: false,
      },
    },
    privacy: { ...ledger },
  });
}

function createPrivacyLedger() {
  return {
    egressObservationStatus: 'unverified',
    privacyEgressCount: null,
    blockedNonLoopbackCount: 0,
    blockedPrivateUrlCount: 0,
    loopbackRequestCount: 0,
    inProcessRequestCount: 0,
    stdioRequestCount: 0,
  };
}

function routeTopologyIdentity(graphId, directedEdgeIds) {
  const canonical = canonicalStringify({
    schemaVersion: 'mainline-m7-local-route-topology-identity/v1',
    graphId,
    directedEdgeIds: [...directedEdgeIds],
  });
  return `sha256:${sha256Hex(new TextEncoder().encode(canonical))}`;
}

function admitTimeout(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_OPERATION_TIMEOUT_MS) {
    throw new TypeError(`local companion ${label} must be between 1 and ${MAX_OPERATION_TIMEOUT_MS} ms`);
  }
  return value;
}

function admitAbortSignal(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object'
    || typeof value.aborted !== 'boolean'
    || typeof value.addEventListener !== 'function'
    || typeof value.removeEventListener !== 'function') {
    throw new TypeError('local companion signal must be an AbortSignal or null');
  }
  return value;
}

async function runWithDeadline(operation, { signal, timeoutMs, label }) {
  if (signal?.aborted) {
    throw new Error(`local companion ${label} aborted`);
  }
  const controller = new AbortController();
  let timeoutId = null;
  let removeOuterAbortListener = null;
  const abortPromise = new Promise((resolve, reject) => {
    const abort = (reason) => {
      if (!controller.signal.aborted) controller.abort(reason);
      reject(new Error(`local companion ${label} aborted`));
    };
    if (signal) {
      const onAbort = () => abort(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      removeOuterAbortListener = () => signal.removeEventListener('abort', onAbort);
    }
    timeoutId = setTimeout(
      () => abort(new Error(`local companion ${label} deadline exceeded`)),
      timeoutMs,
    );
  });
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  try {
    return await Promise.race([operationPromise, abortPromise]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    removeOuterAbortListener?.();
  }
}

function logCategory(logger, category) {
  if (logger) logger(Object.freeze({ category }));
}

function boundedId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new TypeError(`local companion ${label} must be a bounded canonical id`);
  }
  return value;
}

function inspectPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`local companion ${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => typeof key === 'symbol')
    || keys.some((key) => !Object.hasOwn(descriptors[key], 'value'))) {
    throw new TypeError(`local companion ${label} must contain string data properties only`);
  }
  return { keys, descriptors };
}

function exactObject(value, label, expectedKeys) {
  const { keys, descriptors } = inspectPlainObject(value, label);
  const expected = new Set(expectedKeys);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new TypeError(`local companion ${label} schema mismatch`);
  }
  return Object.fromEntries(expectedKeys.map((key) => [key, descriptors[key].value]));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
