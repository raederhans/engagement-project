import {
  GEOFABRIK_ACQUISITION_MANIFEST_SCHEMA,
  GEOFABRIK_ACQUISITION_OBSERVATION_SCHEMA,
  OSM_ADAPTER_RESULT_SCHEMA,
  OSM_BOUNDARY_SCHEMA,
  OSM_EXTRACTOR_BINDING_SCHEMA,
  OSM_TURN_RESTRICTIONS_SCHEMA,
  OSM_WALK_PROFILE_SCHEMA,
  REAL_GRAPH_AUTHORITY_EVIDENCE_SET_SCHEMA,
  REAL_GRAPH_AUTHORITY_INGRESS_LIMITS,
  REAL_GRAPH_BUILD_EVIDENCE_SCHEMA,
  REAL_GRAPH_BUILD_TOOL_CERTIFICATE_SCHEMA,
  REAL_GRAPH_RECORD_COUNT_DEFINITION,
  REAL_GRAPH_SOURCE_READINESS_SCHEMA,
  REAL_GRAPH_SOURCE_READINESS_STATES,
  REAL_GRAPH_VERSION_BINDING_SCHEMA,
  ROUTE_GRAPH_CANDIDATE_SCHEMA,
  ROUTE_GRAPH_RAW_CANDIDATE_SCHEMA,
} from './contracts.mjs';
import {
  assertRecomputedAudit,
  recomputeNormalizedGraphSemantics,
} from './graph_semantics.mjs';
import {
  assertArray,
  boundedText,
  canonicalStringify,
  contentIdentity,
  exactDateOrTimestamp,
  exactIdentity,
  exactTimestamp,
  fail,
  freezeData,
  nonNegativeSafeInteger,
  parseStrictJson,
} from './safe_data.mjs';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const MD5_PATTERN = /^[a-f0-9]{32}$/;
const GEOFABRIK_DATED_URL =
  /^https:\/\/download\.geofabrik\.de\/north-america\/us\/pennsylvania-\d{6}\.osm\.pbf$/;
const SOURCE_READINESS_SET = new Set(REAL_GRAPH_SOURCE_READINESS_STATES);

export function admitRealGraphEvidenceDocuments(
  acquisitionJson,
  adapterJson,
  buildJson,
  readinessJson,
) {
  if (arguments.length !== 4) {
    fail(
      'evidence-arguments',
      'evidence admission accepts exactly four primitive JSON documents; caller hash, review, brand, registry, and policy arguments are forbidden',
    );
  }
  // Validate every ingress type before parsing any document. `typeof` does not
  // invoke Proxy or accessor traps, so hostile object ingress is a clean reject.
  if (![acquisitionJson, adapterJson, buildJson, readinessJson]
    .every((value) => typeof value === 'string')) {
    fail(
      'json-text-required',
      'all evidence inputs must be primitive JSON text; object, Proxy, getter, descriptor, sparse, hidden, and symbol ingress is forbidden',
    );
  }

  const parserOptions = {
    maxDepth: REAL_GRAPH_AUTHORITY_INGRESS_LIMITS.maximumDepth,
    maxItems: REAL_GRAPH_AUTHORITY_INGRESS_LIMITS.maximumItems,
  };
  const acquisition = admitAcquisitionEvidence(parseStrictJson(acquisitionJson, {
    ...parserOptions,
    label: 'RD-A acquisition evidence',
    maxCodeUnits: REAL_GRAPH_AUTHORITY_INGRESS_LIMITS.acquisitionCodeUnits,
  }));
  const adapter = admitAdapterEvidence(parseStrictJson(adapterJson, {
    ...parserOptions,
    label: 'RD-B adapter evidence',
    maxCodeUnits: REAL_GRAPH_AUTHORITY_INGRESS_LIMITS.adapterCodeUnits,
  }));
  const build = admitBuildEvidence(parseStrictJson(buildJson, {
    ...parserOptions,
    label: 'RD-E build evidence',
    maxCodeUnits: REAL_GRAPH_AUTHORITY_INGRESS_LIMITS.buildCodeUnits,
  }));
  const sourceReadiness = admitSourceReadiness(parseStrictJson(readinessJson, {
    ...parserOptions,
    label: 'real graph source readiness',
    maxCodeUnits: REAL_GRAPH_AUTHORITY_INGRESS_LIMITS.readinessCodeUnits,
  }));

  assertCrossEvidenceBindings({ acquisition, adapter, build, sourceReadiness });

  const identities = {
    sourcePayload: acquisition.integrity.localSha256,
    acquisitionManifest: acquisition.manifest.manifestIdentity,
    acquisitionObservation: acquisition.observationIdentity,
    acquisitionDocument: contentIdentity(acquisition),
    adapterProfile: adapter.profileIdentity,
    adapterIntermediate: adapter.intermediateIdentity,
    adapterResult: adapter.adapterIdentity,
    adapterDocument: contentIdentity(adapter),
    adapterBoundary: contentIdentity(adapter.boundary),
    normalizedGraph: contentIdentity(adapter.normalization.graph),
    graphTopology: adapter.normalization.graph.topologyIdentity,
    graphGeometry: adapter.normalization.graph.geometryIdentity,
    graphVersion: contentIdentity({
      schema: REAL_GRAPH_VERSION_BINDING_SCHEMA,
      version: build.output.graphVersion,
      graphIdentity: build.output.graphIdentity,
    }),
    recordCountDefinition: contentIdentity(REAL_GRAPH_RECORD_COUNT_DEFINITION),
    buildToolCertificate: build.tool.certificateIdentity,
    buildToolExecutable: build.tool.executableIdentity,
    buildToolCommand: build.tool.commandIdentity,
    buildBoundary: contentIdentity(build.boundary),
    buildBoundaryPolicy: build.boundary.boundaryPolicyIdentity,
    build: build.buildIdentity,
    sourceReadiness: contentIdentity(sourceReadiness),
  };
  const evidenceSetCore = {
    schema: REAL_GRAPH_AUTHORITY_EVIDENCE_SET_SCHEMA,
    sourceId: sourceReadiness.sourceId,
    identities,
  };

  return freezeData({
    ...evidenceSetCore,
    evidenceSetIdentity: contentIdentity(evidenceSetCore),
    acquisition,
    adapter,
    build,
    sourceReadiness,
  }, 'admitted real graph evidence set');
}

function admitAcquisitionEvidence(value) {
  const observation = exactObject(value, [
    'schema', 'dataClassification', 'manifest', 'status', 'clocks', 'transport',
    'integrity', 'localPayload', 'fallbackUsed', 'failure', 'claimBoundary',
    'observationIdentity',
  ], 'RD-A acquisition observation');
  if (observation.schema !== GEOFABRIK_ACQUISITION_OBSERVATION_SCHEMA) {
    fail('acquisition-schema', 'RD-A acquisition observation schema is unsupported');
  }
  if (observation.dataClassification !== 'candidate-external') {
    fail('synthetic-relabel', 'RD-A evidence must remain candidate-external');
  }
  const manifest = admitAcquisitionManifest(observation.manifest);
  if (observation.status !== 'payload-verified' || observation.failure !== null) {
    fail('acquisition-unavailable', 'RD-A payload evidence must be explicitly payload-verified without failure');
  }

  const clocks = admitFourClocks(observation.clocks, 'RD-A clocks', {
    sourceAsOfNullable: true,
    remainingNullable: false,
  });
  if (clocks.sourceAsOf !== null) {
    fail('unreviewed-source-as-of', 'RD-A caller evidence must keep sourceAsOf null without owner-reviewed provenance');
  }
  if (clocks.retrievedAt > clocks.builtAt || clocks.builtAt > clocks.observedAt) {
    fail('clock-order', 'RD-A retrievedAt, builtAt, and observedAt clocks are reversed');
  }

  const transport = exactObject(observation.transport, ['head', 'sidecar'], 'RD-A transport');
  const head = admitTransport(transport.head, 'HEAD', manifest.source.datedUrl, 'RD-A HEAD');
  const sidecar = admitTransport(
    transport.sidecar,
    'GET',
    manifest.source.sidecarMd5Url,
    'RD-A sidecar',
  );
  if (head.bodyBytes !== null || sidecar.bodyBytes === null || sidecar.bodyBytes > 4_096) {
    fail('acquisition-transport', 'RD-A transport must retain HEAD-only payload and bounded sidecar bytes');
  }

  const integrity = exactObject(observation.integrity, [
    'providerSidecarMd5', 'localMd5', 'localSha256', 'declaredBytes', 'localBytes',
    'md5MatchesSidecar', 'declaredBytesMatch',
  ], 'RD-A integrity');
  for (const field of ['providerSidecarMd5', 'localMd5']) {
    if (typeof integrity[field] !== 'string' || !MD5_PATTERN.test(integrity[field])) {
      fail('acquisition-md5', `RD-A integrity.${field} must be a lowercase MD5 digest`);
    }
  }
  exactIdentity(integrity.localSha256, 'RD-A integrity.localSha256');
  nonNegativeSafeInteger(integrity.declaredBytes, 'RD-A integrity.declaredBytes', { positive: true });
  nonNegativeSafeInteger(integrity.localBytes, 'RD-A integrity.localBytes', { positive: true });
  if (integrity.providerSidecarMd5 !== integrity.localMd5
    || integrity.declaredBytes !== integrity.localBytes
    || integrity.md5MatchesSidecar !== true
    || integrity.declaredBytesMatch !== true
    || head.contentLength !== integrity.declaredBytes) {
    fail('acquisition-integrity', 'RD-A local bytes must match the observed sidecar and declared byte count');
  }

  const localPayload = exactObject(
    observation.localPayload,
    ['status', 'persisted'],
    'RD-A local payload',
  );
  if (localPayload.status !== 'verified' || localPayload.persisted !== false) {
    fail('acquisition-local-payload', 'RD-A evidence must be verified without claiming payload persistence');
  }
  if (observation.fallbackUsed !== false) {
    fail('fallback-forbidden', 'RD-A evidence must not use fallback acquisition');
  }

  const claimBoundary = exactObject(observation.claimBoundary, [
    'candidateOnly', 'sourceAuthenticity', 'businessFreshness', 'productAdmission',
    'sourceHealthCurrent', 'publication',
  ], 'RD-A claim boundary');
  if (claimBoundary.candidateOnly !== true
    || claimBoundary.sourceAuthenticity !== 'not-established'
    || claimBoundary.businessFreshness !== 'unknown'
    || claimBoundary.productAdmission !== 'not-authorized'
    || claimBoundary.sourceHealthCurrent !== 'not-authorized'
    || claimBoundary.publication !== 'not-authorized') {
    fail('acquisition-claim-expansion', 'RD-A claim boundary was expanded beyond candidate evidence');
  }

  const { observationIdentity, ...observationCore } = observation;
  exactIdentity(observationIdentity, 'RD-A observationIdentity');
  if (observationIdentity !== contentIdentity(observationCore)) {
    fail('acquisition-identity-drift', 'RD-A observationIdentity does not match recomputed evidence');
  }
  return freezeData({
    ...observation,
    manifest,
    clocks,
    transport: { head, sidecar },
    integrity,
    localPayload,
    claimBoundary,
  }, 'admitted RD-A acquisition evidence');
}

function admitAcquisitionManifest(value) {
  const manifest = exactObject(value, [
    'schema', 'manifestIdentity', 'dataClassification', 'source', 'references',
    'policy', 'limitations',
  ], 'RD-A acquisition manifest');
  if (manifest.schema !== GEOFABRIK_ACQUISITION_MANIFEST_SCHEMA) {
    fail('acquisition-manifest-schema', 'RD-A manifest schema is unsupported');
  }
  if (manifest.dataClassification !== 'candidate-external') {
    fail('synthetic-relabel', 'RD-A manifest must remain candidate-external');
  }
  const source = exactObject(manifest.source, [
    'provider', 'providerPage', 'region', 'format', 'datedUrl', 'sidecarMd5Url',
  ], 'RD-A manifest source');
  if (source.provider !== 'Geofabrik GmbH'
    || source.providerPage !== 'https://download.geofabrik.de/north-america/us/pennsylvania.html'
    || source.region !== 'north-america/us/pennsylvania'
    || source.format !== 'osm.pbf'
    || typeof source.datedUrl !== 'string'
    || !GEOFABRIK_DATED_URL.test(source.datedUrl)
    || /latest/i.test(source.datedUrl)
    || source.sidecarMd5Url !== `${source.datedUrl}.md5`) {
    fail('acquisition-manifest-source', 'RD-A manifest must bind one exact dated Pennsylvania Geofabrik PBF');
  }
  const references = exactObject(
    manifest.references,
    ['boundary', 'profile', 'tool'],
    'RD-A manifest references',
  );
  for (const [name, reference] of Object.entries(references)) {
    boundedText(reference, `RD-A references.${name}`, { max: 240, pattern: ID_PATTERN });
  }
  const policy = exactObject(manifest.policy, [
    'candidateOnly', 'latestAllowed', 'fallbackAllowed', 'fullPayloadPersistenceAllowed',
  ], 'RD-A manifest policy');
  if (policy.candidateOnly !== true || policy.latestAllowed !== false
    || policy.fallbackAllowed !== false || policy.fullPayloadPersistenceAllowed !== false) {
    fail('acquisition-manifest-policy', 'RD-A manifest must remain candidate-only without latest, fallback, or persistence authority');
  }
  admitTextArray(manifest.limitations, 'RD-A manifest limitations', { minimum: 1, maximum: 16 });
  exactIdentity(manifest.manifestIdentity, 'RD-A manifestIdentity');
  const expectedIdentity = contentIdentity({
    schema: manifest.schema,
    dataClassification: manifest.dataClassification,
    source,
    references,
    policy,
    limitations: manifest.limitations,
  });
  if (manifest.manifestIdentity !== expectedIdentity) {
    fail('acquisition-manifest-identity-drift', 'RD-A manifestIdentity does not match recomputed evidence');
  }
  return freezeData({ ...manifest, source, references, policy }, 'admitted RD-A manifest');
}

function admitTransport(value, method, url, label) {
  const transport = exactObject(value, [
    'method', 'url', 'status', 'ok', 'contentLength', 'contentType', 'etag',
    'lastModified', 'bodyBytes',
  ], label);
  if (transport.method !== method || transport.url !== url
    || !Number.isSafeInteger(transport.status) || transport.status < 200
    || transport.status > 299 || transport.ok !== true) {
    fail('acquisition-transport', `${label} must bind the exact successful bounded request`);
  }
  nonNegativeSafeInteger(transport.contentLength, `${label}.contentLength`, { nullable: true });
  nonNegativeSafeInteger(transport.bodyBytes, `${label}.bodyBytes`, { nullable: true });
  for (const field of ['contentType', 'etag', 'lastModified']) {
    boundedText(transport[field], `${label}.${field}`, { max: 500, nullable: true });
  }
  return transport;
}

function admitAdapterEvidence(value) {
  const adapter = exactObject(value, [
    'schema', 'dataClassification', 'profile', 'profileIdentity', 'intermediateIdentity',
    'adapterIdentity', 'extractor', 'boundary', 'turnRestrictions', 'rawGraph',
    'normalization', 'decisions', 'limitations',
  ], 'RD-B adapter result');
  if (adapter.schema !== OSM_ADAPTER_RESULT_SCHEMA) {
    fail('adapter-schema', 'RD-B adapter result schema is unsupported');
  }
  if (adapter.dataClassification !== 'candidate-external') {
    fail('synthetic-relabel', 'RD-B adapter evidence must remain candidate-external');
  }

  const profile = admitAdapterProfile(adapter.profile);
  exactIdentity(adapter.profileIdentity, 'RD-B profileIdentity');
  if (adapter.profileIdentity !== contentIdentity(profile)) {
    fail('adapter-profile-identity-drift', 'RD-B profileIdentity does not match the embedded profile');
  }
  exactIdentity(adapter.intermediateIdentity, 'RD-B intermediateIdentity');
  exactIdentity(adapter.adapterIdentity, 'RD-B adapterIdentity');
  const extractor = admitExtractor(adapter.extractor);
  const boundary = admitBoundary(adapter.boundary);
  const turnRestrictions = admitTurnRestrictions(adapter.turnRestrictions);
  const rawGraph = admitRawGraph(adapter.rawGraph);
  const normalization = admitNormalization(
    adapter.normalization,
    rawGraph,
    profile.profileId,
    boundary,
  );
  const decisions = admitAdapterDecisions(adapter.decisions, rawGraph);
  admitTextArray(adapter.limitations, 'RD-B limitations', { minimum: 1, maximum: 16 });
  const limitationText = adapter.limitations.join(' ').toLowerCase();
  for (const required of ['candidate-only', 'not graphartifact', 'not product', 'not publication']) {
    if (!limitationText.includes(required)) {
      fail('adapter-claim-boundary', `RD-B limitations must preserve ${required}`);
    }
  }

  const identityProjection = {
    schema: adapter.schema,
    profileIdentity: adapter.profileIdentity,
    intermediateIdentity: adapter.intermediateIdentity,
    extractor,
    boundary,
    turnRestrictions,
    rawGraph,
    decisions,
  };
  if (adapter.adapterIdentity !== contentIdentity(identityProjection)) {
    fail('adapter-identity-drift', 'RD-B adapterIdentity does not match recomputed adapter evidence');
  }

  return freezeData({
    ...adapter,
    profile,
    extractor,
    boundary,
    turnRestrictions,
    rawGraph,
    normalization,
    decisions,
  }, 'admitted RD-B adapter evidence');
}

function admitAdapterProfile(value) {
  const profile = exactObject(value, [
    'schema', 'profileId', 'sourceKind', 'mode', 'inputSchema', 'inputRecordSchema',
    'outputRawSchema', 'outputNormalizedSchema', 'decisions', 'candidateProfile', 'claims',
  ], 'RD-B walk profile');
  if (profile.schema !== OSM_WALK_PROFILE_SCHEMA
    || profile.sourceKind !== 'osm' || profile.mode !== 'walking'
    || profile.inputSchema !== 'route-real-graph-osm-intermediate/v1'
    || profile.inputRecordSchema !== 'route-real-graph-osm-edge-record/v1'
    || profile.outputRawSchema !== ROUTE_GRAPH_RAW_CANDIDATE_SCHEMA
    || profile.outputNormalizedSchema !== ROUTE_GRAPH_CANDIDATE_SCHEMA) {
    fail('adapter-profile-schema', 'RD-B walk profile version and schema bindings are unsupported');
  }
  boundedText(profile.profileId, 'RD-B profileId', { max: 160, pattern: ID_PATTERN });

  const decisions = exactObject(profile.decisions, [
    'highway', 'foot', 'access', 'oneway', 'stairs', 'ferry', 'construction',
    'conditional', 'geometry', 'boundary', 'turnRestrictions', 'distanceAndCost',
    'identityAndOrder',
  ], 'RD-B profile decisions');
  const turnPolicy = exactObject(
    decisions.turnRestrictions,
    ['status', 'acceptedReason', 'interpretation'],
    'RD-B turn restriction policy',
  );
  if (turnPolicy.status !== 'unavailable'
    || turnPolicy.acceptedReason !== 'not-extracted'
    || turnPolicy.interpretation !== 'not-applied-and-not-treated-as-empty') {
    fail('turn-restrictions-unavailable', 'RD-B profile must keep turn restrictions unavailable rather than empty');
  }
  const boundaryPolicy = exactObject(decisions.boundary, [
    'clipping', 'outsideInputPolicy', 'unknownClipping', 'crossBoundaryCorrectness',
  ], 'RD-B boundary policy');
  if (boundaryPolicy.outsideInputPolicy !== 'reject'
    || boundaryPolicy.unknownClipping !== 'reject'
    || boundaryPolicy.crossBoundaryCorrectness !== 'unavailable') {
    fail('adapter-boundary-policy', 'RD-B boundary policy must reject unknown/outside evidence and preserve unavailable correctness');
  }
  const conditional = exactObject(
    decisions.conditional,
    ['fields', 'missing', 'present', 'unknown'],
    'RD-B conditional policy',
  );
  if (conditional.present !== 'reject-unresolved' || conditional.unknown !== 'reject') {
    fail('adapter-conditional-policy', 'RD-B unresolved conditional semantics must reject');
  }
  const cost = exactObject(decisions.distanceAndCost, [
    'inputDistanceUnit', 'outputCostUnit', 'conversion', 'minimum', 'maximum',
  ], 'RD-B cost policy');
  if (cost.inputDistanceUnit !== 'integer-millimeters'
    || cost.outputCostUnit !== 'integer-millimeters'
    || cost.conversion !== 'identity'
    || !Number.isSafeInteger(cost.minimum) || cost.minimum < 1
    || !Number.isSafeInteger(cost.maximum) || cost.maximum < cost.minimum) {
    fail('adapter-cost-policy', 'RD-B cost policy must retain bounded integer millimeters');
  }

  const candidateProfile = exactObject(profile.candidateProfile, [
    'schema', 'profileId', 'sourceKind', 'mode', 'fields', 'oneway', 'access',
    'modeValues', 'cost',
  ], 'RD-B candidate profile');
  if (candidateProfile.schema !== 'route-graph-mode-profile/v1'
    || candidateProfile.profileId !== profile.profileId
    || candidateProfile.sourceKind !== 'osm'
    || candidateProfile.mode !== 'walking') {
    fail('adapter-candidate-profile', 'RD-B candidate profile does not bind the walk profile');
  }
  exactObject(candidateProfile.fields, [
    'sourceEdgeId', 'fromNodeId', 'toNodeId', 'geometry', 'cost', 'oneway', 'access', 'mode',
  ], 'RD-B candidate profile fields');
  exactObject(candidateProfile.oneway, [
    'forward', 'reverse', 'bidirectional', 'missing', 'unknown',
  ], 'RD-B candidate profile oneway');
  exactObject(candidateProfile.access, [
    'allowed', 'denied', 'missing', 'unknown',
  ], 'RD-B candidate profile access');
  exactObject(candidateProfile.modeValues, ['allowed', 'missing', 'unknown'], 'RD-B candidate profile mode');
  exactObject(candidateProfile.cost, ['unit', 'minimum', 'maximum'], 'RD-B candidate profile cost');

  const claims = exactObject(profile.claims, [
    'candidateOnly', 'accessibility', 'safety', 'completeness', 'cityCorrectness',
    'productRouting', 'publication',
  ], 'RD-B claims');
  if (claims.candidateOnly !== true
    || claims.accessibility !== 'not-established'
    || claims.safety !== 'not-established'
    || claims.completeness !== 'not-established'
    || claims.cityCorrectness !== 'not-established'
    || claims.productRouting !== 'not-authorized'
    || claims.publication !== 'not-authorized') {
    fail('adapter-claim-expansion', 'RD-B profile claims were expanded beyond candidate evidence');
  }
  return profile;
}

function admitExtractor(value) {
  const extractor = exactObject(value, [
    'schema', 'extractorId', 'extractorVersion', 'recordSchema',
  ], 'RD-B extractor');
  if (extractor.schema !== OSM_EXTRACTOR_BINDING_SCHEMA
    || extractor.recordSchema !== 'route-real-graph-osm-edge-record/v1') {
    fail('adapter-extractor-schema', 'RD-B extractor binding schema is unsupported');
  }
  boundedText(extractor.extractorId, 'RD-B extractorId', { max: 160, pattern: ID_PATTERN });
  boundedText(extractor.extractorVersion, 'RD-B extractorVersion', { max: 160, pattern: ID_PATTERN });
  return extractor;
}

function admitBoundary(value) {
  const boundary = exactObject(value, [
    'schema', 'boundaryId', 'clipperId', 'clipperVersion', 'clippingStatus',
    'clippingPolicy', 'outsideInputPolicy', 'bbox',
  ], 'RD-B boundary');
  if (boundary.schema !== OSM_BOUNDARY_SCHEMA
    || boundary.clippingStatus !== 'complete'
    || boundary.clippingPolicy !== 'extractor-preclipped-explicit-endpoints'
    || boundary.outsideInputPolicy !== 'reject') {
    fail('adapter-boundary-schema', 'RD-B boundary binding is incomplete or unsupported');
  }
  for (const field of ['boundaryId', 'clipperId', 'clipperVersion']) {
    boundedText(boundary[field], `RD-B boundary.${field}`, { max: 160, pattern: ID_PATTERN });
  }
  assertArray(boundary.bbox, 'RD-B boundary bbox', { minimum: 4, maximum: 4 });
  if (!boundary.bbox.every(Number.isFinite)
    || boundary.bbox[0] < -180 || boundary.bbox[2] > 180
    || boundary.bbox[1] < -90 || boundary.bbox[3] > 90
    || boundary.bbox[0] >= boundary.bbox[2] || boundary.bbox[1] >= boundary.bbox[3]) {
    fail('adapter-boundary-bbox', 'RD-B boundary bbox must contain increasing finite coordinates');
  }
  return boundary;
}

function admitTurnRestrictions(value) {
  const restrictions = exactObject(
    value,
    ['schema', 'status', 'reason'],
    'RD-B turn restrictions',
  );
  if (restrictions.schema !== OSM_TURN_RESTRICTIONS_SCHEMA
    || restrictions.status !== 'unavailable' || restrictions.reason !== 'not-extracted') {
    fail('turn-restrictions-unavailable', 'RD-B turn restrictions must remain unavailable/not-extracted');
  }
  return restrictions;
}

function admitRawGraph(value) {
  const rawGraph = exactObject(
    value,
    ['schema', 'sourceId', 'sourceKind', 'features'],
    'RD-B raw graph',
  );
  if (rawGraph.schema !== ROUTE_GRAPH_RAW_CANDIDATE_SCHEMA || rawGraph.sourceKind !== 'osm') {
    fail('synthetic-relabel', 'RD-B raw graph must remain an OSM route-graph raw candidate');
  }
  boundedText(rawGraph.sourceId, 'RD-B raw graph sourceId', { max: 160, pattern: ID_PATTERN });
  assertArray(rawGraph.features, 'RD-B raw graph features', { minimum: 1, maximum: 1_000_000 });
  const ids = new Set();
  for (const [index, valueAtIndex] of rawGraph.features.entries()) {
    const feature = exactObject(valueAtIndex, [
      'source_edge_id', 'from_node_id', 'to_node_id', 'geometry_lon_lat_1e7',
      'cost_millimeters', 'walk_direction', 'walk_access', 'mode',
    ], `RD-B raw graph features[${index}]`);
    for (const field of ['source_edge_id', 'from_node_id', 'to_node_id']) {
      boundedText(feature[field], `RD-B feature.${field}`, { max: 240, pattern: ID_PATTERN });
    }
    if (ids.has(feature.source_edge_id)) fail('adapter-duplicate-feature', 'RD-B raw graph feature ids must be unique');
    ids.add(feature.source_edge_id);
    if (feature.from_node_id === feature.to_node_id) fail('adapter-self-loop', 'RD-B raw feature endpoints must differ');
    admitGeometry(feature.geometry_lon_lat_1e7, `RD-B feature ${feature.source_edge_id} geometry`);
    nonNegativeSafeInteger(feature.cost_millimeters, 'RD-B feature cost', { positive: true });
    if (!['forward', 'reverse', 'bidirectional'].includes(feature.walk_direction)
      || !['allowed', 'denied'].includes(feature.walk_access)
      || feature.mode !== 'walking') {
      fail('adapter-feature-semantics', 'RD-B raw feature contains unsupported walk semantics');
    }
  }
  return rawGraph;
}

function admitNormalization(value, rawGraph, profileId, boundary) {
  const normalization = exactObject(
    value,
    ['status', 'graph', 'audit'],
    'RD-B normalization',
  );
  if (normalization.status !== 'ready') {
    fail('adapter-normalization-unavailable', 'RD-B normalization must be explicitly ready');
  }
  const graph = exactObject(normalization.graph, [
    'schema', 'dataClassification', 'sourceId', 'sourceKind', 'profileId', 'mode',
    'nodes', 'edges', 'topologyIdentity', 'geometryIdentity', 'counts', 'limitations',
  ], 'RD-B normalized graph');
  if (graph.schema !== ROUTE_GRAPH_CANDIDATE_SCHEMA
    || graph.dataClassification !== 'candidate-external'
    || graph.sourceKind !== 'osm' || graph.mode !== 'walking'
    || graph.sourceId !== rawGraph.sourceId || graph.profileId !== profileId) {
    fail('synthetic-relabel', 'RD-B normalized graph must remain the bound external candidate graph');
  }
  admitTextArray(graph.limitations, 'RD-B graph limitations', { minimum: 1, maximum: 16 });
  const semantics = recomputeNormalizedGraphSemantics(graph, rawGraph, boundary);
  const audit = assertRecomputedAudit(normalization.audit, semantics);
  return freezeData({
    status: normalization.status,
    graph,
    audit,
  }, 'admitted RD-B normalization with recomputed semantics');
}

function admitAdapterDecisions(value, rawGraph) {
  const decisions = exactObject(value, [
    'inputPhysicalFeatureCount', 'includedPhysicalFeatureCount',
    'excludedPhysicalFeatureCount', 'stairsPhysicalFeatureCount',
    'ferryPhysicalFeatureCount', 'clippedPhysicalFeatureCount',
    'constructionExcludedPhysicalFeatureCount', 'turnRestrictionRecordCount',
  ], 'RD-B adapter decisions');
  for (const [field, count] of Object.entries(decisions)) {
    if (field === 'turnRestrictionRecordCount') continue;
    nonNegativeSafeInteger(count, `RD-B adapter decisions.${field}`);
  }
  if (decisions.turnRestrictionRecordCount !== null) {
    fail('turn-restrictions-unavailable', 'RD-B turnRestrictionRecordCount must remain null');
  }
  const inputCount = rawGraph.features.length;
  const excludedCount = rawGraph.features.filter(
    (feature) => feature.walk_access === 'denied',
  ).length;
  if (decisions.inputPhysicalFeatureCount !== inputCount
    || decisions.includedPhysicalFeatureCount !== inputCount - excludedCount
    || decisions.excludedPhysicalFeatureCount !== excludedCount) {
    fail('adapter-decision-count-drift', 'RD-B adapter decision counts do not match raw input features');
  }
  return decisions;
}

function admitBuildEvidence(value) {
  const build = exactObject(value, [
    'schema', 'buildIdentity', 'dataClassification', 'status', 'acquisition',
    'adapter', 'tool', 'boundary', 'output', 'clocks', 'fallbackUsed', 'failure',
    'claims', 'limitations',
  ], 'RD-E build evidence');
  if (build.schema !== REAL_GRAPH_BUILD_EVIDENCE_SCHEMA) {
    fail('build-schema', 'RD-E build evidence schema is unsupported');
  }
  if (build.dataClassification !== 'candidate-external' || build.status !== 'complete') {
    fail('build-unavailable', 'RD-E build evidence must remain a complete candidate-external build');
  }
  const acquisition = exactObject(build.acquisition, [
    'schema', 'observationIdentity', 'payloadSha256', 'payloadBytes',
  ], 'RD-E acquisition binding');
  if (acquisition.schema !== 'route-real-graph-build-acquisition-binding/v1') {
    fail('build-acquisition-schema', 'RD-E acquisition binding schema is unsupported');
  }
  exactIdentity(acquisition.observationIdentity, 'RD-E acquisition observationIdentity');
  exactIdentity(acquisition.payloadSha256, 'RD-E acquisition payloadSha256');
  nonNegativeSafeInteger(acquisition.payloadBytes, 'RD-E acquisition payloadBytes', { positive: true });

  const adapter = exactObject(build.adapter, [
    'schema', 'profileIdentity', 'intermediateIdentity', 'adapterIdentity',
    'adapterDocumentIdentity', 'normalizedGraphIdentity',
  ], 'RD-E adapter binding');
  if (adapter.schema !== 'route-real-graph-build-adapter-binding/v1') {
    fail('build-adapter-schema', 'RD-E adapter binding schema is unsupported');
  }
  for (const [field, identity] of Object.entries(adapter)) {
    if (field !== 'schema') exactIdentity(identity, `RD-E adapter.${field}`);
  }

  const tool = exactObject(build.tool, [
    'schema', 'certificateIdentity', 'status', 'extractorBindingIdentity',
    'toolId', 'toolVersion', 'executableIdentity', 'command', 'commandIdentity',
    'observedAt', 'fallbackUsed', 'failure',
  ], 'RD-E exact tool observation certificate');
  if (tool.schema !== REAL_GRAPH_BUILD_TOOL_CERTIFICATE_SCHEMA
    || tool.status !== 'observed-exact-tool'
    || tool.fallbackUsed !== false || tool.failure !== null) {
    fail('build-tool-schema', 'RD-E tool evidence must be an exact admitted observation certificate without fallback or failure');
  }
  boundedText(tool.toolId, 'RD-E toolId', { max: 160, pattern: ID_PATTERN });
  boundedText(tool.toolVersion, 'RD-E toolVersion', { max: 160, pattern: ID_PATTERN });
  exactIdentity(tool.extractorBindingIdentity, 'RD-E extractorBindingIdentity');
  exactIdentity(tool.executableIdentity, 'RD-E executableIdentity');
  admitTextArray(tool.command, 'RD-E exact tool command', { minimum: 1, maximum: 64 });
  exactIdentity(tool.commandIdentity, 'RD-E commandIdentity');
  if (tool.commandIdentity !== contentIdentity(tool.command)) {
    fail('build-tool-command-drift', 'RD-E commandIdentity does not match the exact primitive command vector');
  }
  exactTimestamp(tool.observedAt, 'RD-E tool observedAt');
  exactIdentity(tool.certificateIdentity, 'RD-E tool certificateIdentity');
  const { certificateIdentity, ...toolCore } = tool;
  if (certificateIdentity !== contentIdentity(toolCore)) {
    fail('build-tool-certificate-drift', 'RD-E tool certificateIdentity does not match the exact tool observation');
  }

  const boundary = exactObject(build.boundary, [
    'schema', 'boundaryId', 'boundaryPolicyIdentity', 'crossStatePolicy',
  ], 'RD-E boundary binding');
  if (boundary.schema !== 'route-real-graph-build-boundary-binding/v1'
    || boundary.crossStatePolicy !== 'resolved-explicitly') {
    fail('build-boundary-unavailable', 'RD-E boundary and cross-state policy must be explicitly resolved');
  }
  boundedText(boundary.boundaryId, 'RD-E boundaryId', { max: 160, pattern: ID_PATTERN });
  exactIdentity(boundary.boundaryPolicyIdentity, 'RD-E boundaryPolicyIdentity');

  const output = exactObject(build.output, [
    'schema', 'artifactSchema', 'graphVersion', 'graphIdentity', 'nodeCount',
    'directedEdgeCount', 'recordCountDefinition', 'recordCount',
  ], 'RD-E output binding');
  if (output.schema !== 'route-real-graph-build-output/v1'
    || output.artifactSchema !== ROUTE_GRAPH_CANDIDATE_SCHEMA) {
    fail('synthetic-relabel', 'RD-E output must remain a separate real candidate graph, never GraphArtifact/v1');
  }
  boundedText(output.graphVersion, 'RD-E graphVersion', { max: 240, pattern: ID_PATTERN });
  exactIdentity(output.graphIdentity, 'RD-E graphIdentity');
  const recordCountDefinition = exactObject(output.recordCountDefinition, [
    'schema', 'unit', 'inclusion',
  ], 'RD-E recordCount definition');
  if (canonicalStringify(recordCountDefinition)
    !== canonicalStringify(REAL_GRAPH_RECORD_COUNT_DEFINITION)) {
    fail('record-count-definition-drift', 'RD-E output recordCount definition is unsupported');
  }
  for (const field of ['nodeCount', 'directedEdgeCount', 'recordCount']) {
    nonNegativeSafeInteger(output[field], `RD-E output.${field}`, { positive: true });
  }

  const clocks = admitFourClocks(build.clocks, 'RD-E clocks', {
    sourceAsOfNullable: true,
    remainingNullable: false,
  });
  if (clocks.sourceAsOf !== null) {
    fail('unreviewed-source-as-of', 'RD-E caller evidence must keep sourceAsOf null until owner-reviewed provenance binds it');
  }
  if (clocks.retrievedAt > clocks.builtAt || clocks.builtAt > clocks.observedAt
    || tool.observedAt > clocks.observedAt) {
    fail('clock-order', 'RD-E retrieval, tool, build, and observation clocks are reversed');
  }
  if (build.fallbackUsed !== false || build.failure !== null) {
    fail('build-failure', 'RD-E build must be complete without fallback or failure');
  }
  const claims = exactObject(build.claims, [
    'candidateOnly', 'actualAdmission', 'sourceHealthCurrent', 'productRuntime', 'publication',
  ], 'RD-E claims');
  if (claims.candidateOnly !== true || claims.actualAdmission !== false
    || claims.sourceHealthCurrent !== false || claims.productRuntime !== false
    || claims.publication !== false) {
    fail('build-claim-expansion', 'RD-E build claims must remain candidate-only and unauthorized');
  }
  admitTextArray(build.limitations, 'RD-E limitations', { minimum: 1, maximum: 16 });
  exactIdentity(build.buildIdentity, 'RD-E buildIdentity');
  const { buildIdentity, ...buildCore } = build;
  if (buildIdentity !== contentIdentity(buildCore)) {
    fail('build-identity-drift', 'RD-E buildIdentity does not match recomputed evidence');
  }
  return freezeData({
    ...build,
    acquisition,
    adapter,
    tool,
    boundary,
    output,
    clocks,
    claims,
  }, 'admitted RD-E build evidence');
}

function admitSourceReadiness(value) {
  const readiness = exactObject(value, [
    'schema', 'dataClassification', 'sourceId', 'readiness', 'readinessReason',
    'clocks', 'snapshot', 'boundaryVintage', 'coverage', 'transport',
    'recordCountDefinition', 'recordCount',
  ], 'real graph source readiness');
  if (readiness.schema !== REAL_GRAPH_SOURCE_READINESS_SCHEMA
    || readiness.dataClassification !== 'candidate-external-source-readiness') {
    fail('source-readiness-schema', 'real graph source readiness schema or classification is unsupported');
  }
  boundedText(readiness.sourceId, 'source readiness sourceId', { max: 120, pattern: ID_PATTERN });
  if (!SOURCE_READINESS_SET.has(readiness.readiness)) {
    fail('source-readiness-state', 'source readiness is not one of the versioned candidate-only states');
  }
  boundedText(readiness.readinessReason, 'source readiness reason', { max: 240 });
  const clocks = admitFourClocks(readiness.clocks, 'source readiness clocks', {
    sourceAsOfNullable: true,
    remainingNullable: true,
  });
  if (clocks.sourceAsOf !== null) {
    fail('unreviewed-source-as-of', 'caller readiness must keep sourceAsOf null until owner-reviewed provenance binds it');
  }
  const snapshot = exactObject(readiness.snapshot, ['version', 'identity'], 'source readiness snapshot');
  if (snapshot.version !== null) {
    boundedText(snapshot.version, 'source readiness snapshot.version', {
      max: 240,
      pattern: ID_PATTERN,
    });
  }
  if (snapshot.identity !== null) exactIdentity(snapshot.identity, 'source readiness snapshot.identity');
  if (readiness.boundaryVintage !== null) {
    boundedText(readiness.boundaryVintage, 'source readiness boundaryVintage', {
      max: 240,
      pattern: ID_PATTERN,
    });
  }
  const coverage = exactObject(readiness.coverage, [
    'geography', 'temporalStart', 'temporalEnd',
  ], 'source readiness coverage');
  boundedText(coverage.geography, 'source readiness coverage.geography', { max: 500, nullable: true });
  exactDateOrTimestamp(coverage.temporalStart, 'source readiness coverage.temporalStart', { nullable: true });
  exactDateOrTimestamp(coverage.temporalEnd, 'source readiness coverage.temporalEnd', { nullable: true });
  if (coverage.temporalStart && coverage.temporalEnd
    && clockInstant(coverage.temporalStart) > clockInstant(coverage.temporalEnd)) {
    fail('source-readiness-coverage', 'source readiness temporal coverage is reversed');
  }
  const transport = exactObject(readiness.transport, [
    'endpointUrl', 'lastModified', 'etag',
  ], 'source readiness transport');
  if (transport.endpointUrl !== null) admitHttpUrl(transport.endpointUrl, 'source readiness endpointUrl');
  boundedText(transport.lastModified, 'source readiness lastModified', { max: 240, nullable: true });
  boundedText(transport.etag, 'source readiness etag', { max: 240, nullable: true });
  const recordCountDefinition = exactObject(readiness.recordCountDefinition, [
    'schema', 'unit', 'inclusion',
  ], 'source readiness recordCount definition');
  if (canonicalStringify(recordCountDefinition)
    !== canonicalStringify(REAL_GRAPH_RECORD_COUNT_DEFINITION)) {
    fail('record-count-definition-drift', 'source readiness recordCount definition is unsupported');
  }
  nonNegativeSafeInteger(readiness.recordCount, 'source readiness recordCount', { nullable: true });
  if (['candidate-evidence-unavailable', 'candidate-evidence-unknown'].includes(readiness.readiness)
    && readiness.recordCount !== null) {
    fail('source-readiness-record-count', `${readiness.readiness} must keep candidate recordCount null`);
  }
  if (readiness.readiness !== 'candidate-evidence-complete') {
    fail('source-readiness-ineligible', `${readiness.readiness} cannot enter owner-controlled matching`);
  }
  if (clocks.retrievedAt === null || clocks.builtAt === null || clocks.observedAt === null
    || snapshot.version === null || snapshot.identity === null
    || readiness.boundaryVintage === null || coverage.geography === null
    || readiness.recordCount === null || readiness.recordCount < 1) {
    fail('source-readiness-incomplete', 'complete candidate evidence must bind three evidence clocks, snapshot, boundary, coverage, and positive candidate record count');
  }
  if (clocks.retrievedAt > clocks.builtAt || clocks.builtAt > clocks.observedAt) {
    fail('clock-order', 'source readiness retrieval, build, and observation clocks are reversed');
  }

  return freezeData({
    ...readiness,
    clocks,
    snapshot,
    coverage,
    transport,
    recordCountDefinition,
  }, 'admitted real graph source readiness');
}

function assertCrossEvidenceBindings({ acquisition, adapter, build, sourceReadiness }) {
  const adapterDocumentIdentity = contentIdentity(adapter);
  const normalizedGraphIdentity = contentIdentity(adapter.normalization.graph);
  const extractorBindingIdentity = contentIdentity(adapter.extractor);
  const recomputedRecordCount = adapter.normalization.graph.edges.length;
  const checks = [
    [build.acquisition.observationIdentity, acquisition.observationIdentity, 'RD-E acquisition observation'],
    [build.acquisition.payloadSha256, acquisition.integrity.localSha256, 'RD-E payload SHA-256'],
    [build.acquisition.payloadBytes, acquisition.integrity.localBytes, 'RD-E payload byte count'],
    [
      acquisition.manifest.references.profile,
      `route-real-graph-osm-walk-profile/${adapter.profile.profileId}`,
      'RD-A profile reference',
    ],
    [
      acquisition.manifest.references.boundary,
      `route-real-graph-boundary/${build.boundary.boundaryId}`,
      'RD-A boundary reference',
    ],
    [
      acquisition.manifest.references.tool,
      `route-real-graph-extractor/${build.tool.toolId}-${build.tool.toolVersion}`,
      'RD-A tool reference',
    ],
    [build.adapter.profileIdentity, adapter.profileIdentity, 'RD-E profile identity'],
    [build.adapter.intermediateIdentity, adapter.intermediateIdentity, 'RD-E intermediate identity'],
    [build.adapter.adapterIdentity, adapter.adapterIdentity, 'RD-E adapter identity'],
    [build.adapter.adapterDocumentIdentity, adapterDocumentIdentity, 'RD-E adapter document identity'],
    [build.adapter.normalizedGraphIdentity, normalizedGraphIdentity, 'RD-E normalized graph identity'],
    [build.tool.extractorBindingIdentity, extractorBindingIdentity, 'RD-E exact tool certificate extractor binding'],
    [build.tool.toolId, adapter.extractor.extractorId, 'RD-E certified tool id'],
    [build.tool.toolVersion, adapter.extractor.extractorVersion, 'RD-E certified tool version'],
    [build.boundary.boundaryId, adapter.boundary.boundaryId, 'RD-E boundary id'],
    [build.output.graphIdentity, normalizedGraphIdentity, 'RD-E output graph identity'],
    [build.output.nodeCount, adapter.normalization.graph.nodes.length, 'RD-E recomputed node count'],
    [build.output.directedEdgeCount, recomputedRecordCount, 'RD-E recomputed edge count'],
    [build.output.recordCount, recomputedRecordCount, 'RD-E versioned record count'],
    [sourceReadiness.sourceId, adapter.normalization.graph.sourceId, 'source readiness source id'],
    [sourceReadiness.snapshot.version, build.output.graphVersion, 'source readiness snapshot version'],
    [sourceReadiness.snapshot.identity, build.output.graphIdentity, 'source readiness snapshot identity'],
    [sourceReadiness.boundaryVintage, build.boundary.boundaryId, 'source readiness boundary vintage'],
    [sourceReadiness.recordCount, recomputedRecordCount, 'source readiness versioned record count'],
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) fail('cross-evidence-identity-drift', `${label} does not bind the exact admitted evidence`);
  }
  for (const clock of ['sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt']) {
    if (sourceReadiness.clocks[clock] !== build.clocks[clock]) {
      fail('cross-evidence-clock-drift', `source readiness ${clock} does not equal the exact RD-E clock`);
    }
  }
  if (build.clocks.retrievedAt !== acquisition.clocks.retrievedAt) {
    fail('cross-evidence-clock-drift', 'RD-E retrievedAt must retain the exact RD-A retrieval clock');
  }
  if (sourceReadiness.transport.endpointUrl !== acquisition.manifest.source.datedUrl
    || sourceReadiness.transport.lastModified !== acquisition.transport.head.lastModified
    || sourceReadiness.transport.etag !== acquisition.transport.head.etag) {
    fail('cross-evidence-transport-drift', 'source readiness transport must retain exact RD-A transport evidence without becoming a business clock');
  }
}

function admitFourClocks(value, label, { sourceAsOfNullable, remainingNullable }) {
  const clocks = exactObject(
    value,
    ['sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt'],
    label,
  );
  exactDateOrTimestamp(clocks.sourceAsOf, `${label}.sourceAsOf`, { nullable: sourceAsOfNullable });
  for (const field of ['retrievedAt', 'builtAt', 'observedAt']) {
    exactTimestamp(clocks[field], `${label}.${field}`, { nullable: remainingNullable });
  }
  return clocks;
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('object-required', `${label} must be a parsed plain data object`);
  }
  const actual = Object.keys(value);
  const missing = keys.filter((key) => !actual.includes(key));
  const unknown = actual.filter((key) => !keys.includes(key));
  if (missing.length || unknown.length) {
    fail(
      'schema-mismatch',
      `${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`,
    );
  }
  return value;
}

function admitTextArray(value, label, { minimum, maximum }) {
  assertArray(value, label, { minimum, maximum });
  for (const [index, item] of value.entries()) {
    boundedText(item, `${label}[${index}]`, { max: 1_000 });
  }
  return value;
}

function admitGeometry(value, label) {
  assertArray(value, label, { minimum: 2, maximum: 4_096 });
  for (const [index, coordinate] of value.entries()) {
    assertArray(coordinate, `${label}[${index}]`, { minimum: 2, maximum: 2 });
    if (!coordinate.every(Number.isFinite)
      || coordinate[0] < -180 || coordinate[0] > 180
      || coordinate[1] < -90 || coordinate[1] > 90) {
      fail('adapter-coordinate', `${label}[${index}] is outside finite longitude/latitude bounds`);
    }
  }
}

function admitHttpUrl(value, label) {
  boundedText(value, label, { max: 2_048 });
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('invalid-url', `${label} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail('invalid-url', `${label} must use HTTP(S)`);
  }
  return value;
}

function clockInstant(value) {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
}
