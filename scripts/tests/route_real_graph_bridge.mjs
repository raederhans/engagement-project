import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { admitGeofabrikAcquisitionManifest } from '../lib/route_real_graph_acquisition/index.mjs';
import {
  contentIdentity,
} from '../lib/route_graph_candidate/safe_data.mjs';
import { adaptOsmWalkingIntermediate } from '../lib/route_real_graph_osm/index.mjs';
import {
  BOUNDARY_POLICY_ID,
  BUILD_AUTHORITY_LIMITATION,
  BUILD_CLAIM_LIMITATION,
  EXTRACTOR_PACKAGE_FILENAME,
  EXTRACTOR_TOOL_ID,
  EXTRACTOR_VERSION,
  INTERNAL_DIGEST_LIMITATION,
  REAL_GRAPH_ACQUISITION_RELEASE_SCHEMA,
  REAL_GRAPH_EXTRACTION_RELEASE_SCHEMA,
  REAL_GRAPH_INTERMEDIATE_ADAPTER_SCHEMA,
  REAL_GRAPH_OBSERVED_PAYLOAD_RECEIPT_SCHEMA,
  REAL_GRAPH_OWNER_LEASE_SCHEMA,
  REAL_GRAPH_SUPERVISOR_ADMISSION_SCHEMA,
  RELEASE_CERTIFICATE_LIMITATION,
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT,
  parseAcquisitionReleaseJson,
  parseExtractionReleaseJson,
  parseObservedPayloadReceiptJson,
  parseRealGraphBuildPolicyJson,
  parseSupervisorAdmissionJson,
} from '../lib/route_real_graph_build/index.mjs';
import { deriveWorkspacePaths } from '../lib/route_real_graph_build/workspace_paths.mjs';
import {
  BRIDGE_JSON_INGRESS_LIMITS,
  OPL_DISTANCE_MECHANICS_IDENTITY,
  OPL_INGRESS_LIMITS,
  OSMIUM_OPL_BRIDGE_RESULT_SCHEMA,
  SYNTHETIC_BRIDGE_CLAIMS,
  SYNTHETIC_BRIDGE_LIMITATIONS,
  TRUSTED_BUILD_BOUND_OUTPUT_OBSERVATION_SCHEMA,
  TRUSTED_BUILD_BRIDGE_INPUT_CAPTURE_SCHEMA,
  TRUSTED_BUILD_CLAIMS,
  TRUSTED_BUILD_EVIDENCE_SCHEMA,
  TRUSTED_BUILD_LIMITATIONS,
  inspectCallerTrustedBuildEvidenceClaim,
  inspectRouteRealGraphBridge,
  inspectTrustedBuildEvidence,
  materializeSyntheticOsmiumOplFixture,
} from '../lib/route_real_graph_bridge/index.mjs';
import { preflightPrimitiveUtf8Text } from '../lib/route_real_graph_bridge/primitive_ingress.mjs';
import * as bridgeRegistry from '../lib/route_real_graph_bridge/private_registry.mjs';

const FIXTURE_ROOT = new URL('../fixtures/route-real-graph-bridge/', import.meta.url);
const SOURCE_MANIFEST_URL = new URL(
  '../fixtures/route-real-graph-acquisition/pennsylvania-260813-manifest.json',
  import.meta.url,
);
const [oplText, metadataText, unavailableExpectation, sourceManifestText] = await Promise.all([
  readFile(new URL('synthetic-walking.osm.opl', FIXTURE_ROOT), 'utf8'),
  readFile(new URL('synthetic-bridge-metadata.json', FIXTURE_ROOT), 'utf8'),
  readJson(new URL('expected-unavailable-status.json', FIXTURE_ROOT)),
  readFile(SOURCE_MANIFEST_URL, 'utf8'),
]);
const metadata = JSON.parse(metadataText);
const syntheticBridge = materializeSyntheticOsmiumOplFixture(oplText, metadataText);

function readJson(url) {
  return readFile(url, 'utf8').then(JSON.parse);
}

function json(value) {
  return JSON.stringify(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasCode(expectedCode) {
  return (error) => {
    assert.equal(error?.code, expectedCode);
    return true;
  };
}

function trapProxy(counter) {
  return new Proxy({}, {
    get() {
      counter.count += 1;
      throw new Error('get trap must not execute');
    },
    getOwnPropertyDescriptor() {
      counter.count += 1;
      throw new Error('descriptor trap must not execute');
    },
    getPrototypeOf() {
      counter.count += 1;
      throw new Error('prototype trap must not execute');
    },
    ownKeys() {
      counter.count += 1;
      throw new Error('ownKeys trap must not execute');
    },
  });
}

test('default real bridge and TrustedBuildEvidence registries remain empty and unavailable', () => {
  const bridge = inspectRouteRealGraphBridge();
  const evidence = inspectTrustedBuildEvidence();
  for (const [key, expected] of Object.entries(unavailableExpectation.bridge)) {
    assert.deepEqual(bridge[key], expected);
  }
  for (const [key, expected] of Object.entries(unavailableExpectation.evidence)) {
    assert.deepEqual(evidence[key], expected);
  }
  assert.equal(bridgeRegistry.readInstalledRealBridgeObservationJsonText(), null);
  assert.equal(bridgeRegistry.readInstalledTrustedBuildEvidenceJsonText(), null);
  assert.throws(() => inspectRouteRealGraphBridge('{}'), hasCode('caller-bridge-observation-forbidden'));
  assert.throws(() => inspectTrustedBuildEvidence('{}'), hasCode('caller-evidence-forbidden'));
});

test('exact synthetic OPL fixture materializes the accepted RD-B intermediate and result', () => {
  const result = syntheticBridge;
  assert.equal(result.schema, OSMIUM_OPL_BRIDGE_RESULT_SCHEMA);
  assert.equal(result.status, 'synthetic-fixture-mechanics-only');
  assert.equal(result.identities.distanceMechanicsIdentity, OPL_DISTANCE_MECHANICS_IDENTITY);
  assert.equal(result.identities.oplIdentity, metadata.expected.oplIdentity);
  assert.equal(result.identities.intermediateIdentity, metadata.expected.intermediateIdentity);
  assert.equal(result.identities.rdBAdapterIdentity, metadata.expected.rdBAdapterIdentity);
  assert.equal(result.rdBResult.intermediateIdentity, result.identities.intermediateIdentity);
  assert.deepEqual(result.claims, SYNTHETIC_BRIDGE_CLAIMS);
  assert.deepEqual(result.limitations, SYNTHETIC_BRIDGE_LIMITATIONS);
  assert.equal(result.audit.nodeRecordCount, 4);
  assert.equal(result.audit.wayRecordCount, 2);
  assert.equal(result.audit.relationRecordCount, 0);
  assert.equal(result.audit.edgeRecordCount, 2);
  assert.deepEqual(
    result.intermediate.edges.map(({ recordId, distanceMillimeters }) => ({
      recordId,
      distanceMillimeters,
    })),
    metadata.expected.edgeDistances,
  );
  assert.deepEqual(
    result.intermediate.edges.map(({ recordId }) => recordId),
    [...result.intermediate.edges.map(({ recordId }) => recordId)].sort(),
  );
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.intermediate.edges));
  assert.ok(Object.isFrozen(result.rdBResult.normalization.graph.edges));
  assert.match(result.bridgeIdentity, /^sha256:[a-f0-9]{64}$/);
});

test('reviewed OPL tags map exactly into RD-B ferry, construction, and conditional semantics', () => {
  const ferryOpl = oplText.replace(
    'Thighway=residential,foot=yes,access=yes,oneway=no N',
    'Tfoot=yes,access=yes,oneway=no,route=ferry N',
  );
  const ferry = materializeVariant(ferryOpl, (intermediate) => {
    const edge = intermediate.edges.find(({ osmWayId }) => osmWayId === '200');
    edge.tags.highway = null;
    edge.tags.route = 'ferry';
  });
  assert.equal(ferry.rdBResult.decisions.ferryPhysicalFeatureCount, 1);

  const constructionOpl = oplText.replace(
    'oneway=no Nn100',
    'oneway=no,construction=residential Nn100',
  );
  const construction = materializeVariant(constructionOpl, (intermediate) => {
    intermediate.edges.find(({ osmWayId }) => osmWayId === '200').tags.construction = 'residential';
  }, 1);
  assert.equal(construction.rdBResult.decisions.constructionExcludedPhysicalFeatureCount, 1);
  assert.equal(
    construction.rdBResult.rawGraph.features.find(({ source_edge_id: id }) => id.includes('way:200:')).walk_access,
    'denied',
  );

  const conditionalOpl = oplText.replace(
    'oneway=no Nn100',
    'oneway=no,foot:conditional=yes%40%dawn Nn100',
  );
  const conditionalMetadata = clone(metadata);
  const conditionalIntermediate = clone(syntheticBridge.intermediate);
  conditionalIntermediate.edges.find(({ osmWayId }) => osmWayId === '200')
    .tags.conditional.foot = 'yes@dawn';
  conditionalMetadata.expected.oplIdentity = sha256Text(conditionalOpl);
  conditionalMetadata.expected.tagCount += 1;
  conditionalMetadata.expected.intermediateIdentity = contentIdentity(conditionalIntermediate);
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(conditionalOpl, json(conditionalMetadata)),
    hasCode('conditional-semantics-unresolved'),
  );
});

test('bridge ingress accepts primitive text only and executes zero Proxy, getter, or coercion traps', () => {
  const oplCounter = { count: 0 };
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(trapProxy(oplCounter), metadataText),
    hasCode('primitive-text-required'),
  );
  assert.equal(oplCounter.count, 0);

  const metadataCounter = { count: 0 };
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(oplText, trapProxy(metadataCounter)),
    hasCode('primitive-text-required'),
  );
  assert.equal(metadataCounter.count, 0);

  let coercions = 0;
  const coercionObject = {
    toString() {
      coercions += 1;
      return oplText;
    },
    valueOf() {
      coercions += 1;
      return oplText;
    },
  };
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(coercionObject, metadataText),
    hasCode('primitive-text-required'),
  );
  assert.equal(coercions, 0);

  let getterCalls = 0;
  const getterObject = {};
  Object.defineProperty(getterObject, 'text', {
    get() {
      getterCalls += 1;
      return oplText;
    },
  });
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(oplText, getterObject),
    hasCode('primitive-text-required'),
  );
  assert.equal(getterCalls, 0);
});

test('OPL lexical, UTF-8, line, token, and record subset is fail closed', () => {
  const cases = [
    [oplText.slice(0, -1), 'opl-final-newline'],
    [oplText.replace('\n', '\r\n'), 'opl-carriage-return'],
    [oplText.replace(' v1 ', '  v1 '), 'opl-field-spacing'],
    [oplText.replace(/^n100/u, 'c100'), 'opl-record-type'],
    [oplText.replace(' T x-75.1000000', ' T c1 x-75.1000000'), 'opl-field-count'],
    [`${oplText.slice(0, -1)}\n\n`, 'opl-empty-line'],
    [`${oplText.slice(0, -1)}\u0000\n`, 'opl-nul'],
    [`${oplText.slice(0, -1)}\t\n`, 'opl-tab'],
    [`${oplText.slice(0, -1)}\ud800\n`, 'text-invalid-unicode'],
  ];
  for (const [input, code] of cases) {
    assert.throws(() => materializeSyntheticOsmiumOplFixture(input, metadataText), hasCode(code));
  }

  const oversizedLine = `${'n'.repeat(OPL_INGRESS_LIMITS.maximumLineCodeUnits + 1)}\n`;
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(oversizedLine, metadataText),
    hasCode('opl-line-length-limit'),
  );
  const manyLines = 'n1 v1 t2026-08-13T20:21:01Z T x0 y0\n'
    .repeat(OPL_INGRESS_LIMITS.maximumLines + 1);
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(manyLines, metadataText),
    hasCode('opl-line-limit'),
  );
  const oversizedText = 'x'.repeat(OPL_INGRESS_LIMITS.maximumCodeUnits + 1);
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(oversizedText, metadataText),
    hasCode('text-code-unit-limit'),
  );
});

test('unknown and duplicate tags, missing locations, relations, and ordering drift fail closed', () => {
  const appendWayTag = (tag) => oplText.replace(
    'Thighway=residential,foot=yes,access=yes,oneway=no N',
    `Thighway=residential,foot=yes,access=yes,oneway=no,${tag} N`,
  );
  const cases = [
    [appendWayTag('name=Hostile'), 'opl-tag-unknown'],
    [appendWayTag('highway=residential'), 'opl-tag-duplicate'],
    [oplText.replace('n101x-75.0900000y39.9000000', 'n999x-75.0900000y39.9000000'), 'opl-missing-node'],
    [oplText.replace('n101x-75.0900000y39.9000000', 'n101'), 'opl-way-node-location'],
    [oplText.replace('n101x-75.0900000y39.9000000', 'n101x-75.0800000y39.9000000'), 'opl-node-location-drift'],
    [swapFirstTwoLines(oplText), 'opl-id-order'],
    [withNodeAfterWays(oplText), 'opl-object-order'],
    [oplText.replace(/^n100/u, 'n101'), 'opl-id-order'],
    [withRestrictionRelation(oplText), 'relation-turn-restrictions-unavailable'],
  ];
  for (const [input, code] of cases) {
    assert.throws(() => materializeSyntheticOsmiumOplFixture(input, metadataText), hasCode(code));
  }

  const tooManyTags = oplText.replace(
    'Thighway=residential,foot=yes,access=yes,oneway=no',
    `T${Array.from(
      { length: OPL_INGRESS_LIMITS.maximumTagsPerRecord + 1 },
      () => 'highway=residential',
    ).join(',')}`,
  );
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(tooManyTags, metadataText),
    hasCode('opl-tag-record-limit'),
  );

  const tooManyRefs = minimalOplWithRefs(OPL_INGRESS_LIMITS.maximumNodeReferencesPerWay + 1);
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(tooManyRefs, metadataText),
    hasCode('opl-way-node-limit'),
  );

  const aggregateEdges = minimalOplWithManyWays(
    Math.ceil(OPL_INGRESS_LIMITS.maximumEdgeRecords
      / (OPL_INGRESS_LIMITS.maximumNodeReferencesPerWay - 1)) + 1,
    OPL_INGRESS_LIMITS.maximumNodeReferencesPerWay,
  );
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(aggregateEdges, metadataText),
    hasCode('opl-edge-limit'),
  );

  const relations = withManyRestrictionRelations(
    oplText,
    OPL_INGRESS_LIMITS.maximumRelationRecords + 1,
  );
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(relations, metadataText),
    hasCode('opl-relation-limit'),
  );
});

test('outside-buffer geometry and every exact fixture identity are recomputed', () => {
  const outside = oplText
    .replace('x-75.1000000 y39.9000000', 'x-75.3000000 y39.9000000')
    .replace('n100x-75.1000000y39.9000000', 'n100x-75.3000000y39.9000000');
  const outsideMetadata = clone(metadata);
  outsideMetadata.expected.oplIdentity = sha256Text(outside);
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(outside, json(outsideMetadata)),
    hasCode('bridge-outside-buffer'),
  );

  const mutations = [
    [(value) => { value.expected.oplIdentity = fakeSha('a'); }, 'bridge-opl-identity-drift'],
    [(value) => { value.expected.intermediateIdentity = fakeSha('b'); }, 'bridge-intermediate-identity-drift'],
    [(value) => { value.expected.edgeDistances[0].distanceMillimeters += 1; }, 'bridge-distance-recomputation-drift'],
    [(value) => { value.expected.rdBAdapterIdentity = fakeSha('c'); }, 'bridge-rd-b-identity-drift'],
  ];
  for (const [mutate, code] of mutations) {
    const changed = clone(metadata);
    mutate(changed);
    assert.throws(
      () => materializeSyntheticOsmiumOplFixture(oplText, json(changed)),
      hasCode(code),
    );
  }
});

test('bridge metadata JSON applies bounded strict schema, depth, key, and string rules', () => {
  const unknown = clone(metadata);
  unknown.reviewedBy = 'caller';
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(oplText, json(unknown)),
    hasCode('schema-mismatch'),
  );

  const duplicate = metadataText.replace(
    '"schema": "route-real-graph-osmium-opl-bridge-metadata/v1",',
    '"schema": "route-real-graph-osmium-opl-bridge-metadata/v1",\n  "schema": "route-real-graph-osmium-opl-bridge-metadata/v1",',
  );
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(oplText, duplicate),
    hasCode('json-duplicate-key'),
  );

  let nested = '0';
  for (let index = 0; index <= BRIDGE_JSON_INGRESS_LIMITS.maximumDepth; index += 1) {
    nested = `{"x":${nested}}`;
  }
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(oplText, nested),
    hasCode('json-depth-limit'),
  );
  const oversized = `{"x":"${'a'.repeat(BRIDGE_JSON_INGRESS_LIMITS.maximumStringCodeUnits + 1)}"}`;
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(oplText, oversized),
    hasCode('json-string-limit'),
  );
  const utf8Oversized = `{"x":"${'€'.repeat(175_000)}"}`;
  assert.ok(utf8Oversized.length < BRIDGE_JSON_INGRESS_LIMITS.maximumCodeUnits);
  assert.throws(
    () => materializeSyntheticOsmiumOplFixture(oplText, utf8Oversized),
    hasCode('text-utf8-byte-limit'),
  );
});

function swapFirstTwoLines(value) {
  const lines = value.split('\n');
  [lines[0], lines[1]] = [lines[1], lines[0]];
  return lines.join('\n');
}

function withNodeAfterWays(value) {
  return `${value}n104 v1 t2026-08-13T20:24:01Z T x-75.0400000 y40.0100000\n`;
}

function withRestrictionRelation(value) {
  return `${value}r400 v1 t2026-08-13T20:23:01Z Ttype=restriction,restriction=no_left_turn Mw200@from,n101@via,w300@to\n`;
}

function minimalOplWithRefs(count) {
  const refs = Array.from({ length: count }, (_, index) => (
    index % 2 === 0 ? 'n1x-75.1000000y39.9000000' : 'n2x-75.0900000y39.9000000'
  ));
  return [
    'n1 v1 t2026-08-13T20:21:01Z T x-75.1000000 y39.9000000',
    'n2 v1 t2026-08-13T20:21:02Z T x-75.0900000 y39.9000000',
    `w3 v1 t2026-08-13T20:22:01Z Thighway=residential,foot=yes,access=yes N${refs.join(',')}`,
    '',
  ].join('\n');
}

function minimalOplWithManyWays(wayCount, refCount) {
  const refs = Array.from({ length: refCount }, (_, index) => (
    index % 2 === 0 ? 'n1x-75.1000000y39.9000000' : 'n2x-75.0900000y39.9000000'
  )).join(',');
  const ways = Array.from({ length: wayCount }, (_, index) => (
    `w${index + 3} v1 t2026-08-13T20:22:01Z Thighway=residential,foot=yes,access=yes N${refs}`
  ));
  return [
    'n1 v1 t2026-08-13T20:21:01Z T x-75.1000000 y39.9000000',
    'n2 v1 t2026-08-13T20:21:02Z T x-75.0900000 y39.9000000',
    ...ways,
    '',
  ].join('\n');
}

function withManyRestrictionRelations(value, count) {
  const relations = Array.from({ length: count }, (_, index) => (
    `r${index + 400} v1 t2026-08-13T20:23:01Z Ttype=restriction,restriction=no_left_turn Mw200@from,n101@via,w300@to`
  ));
  return `${value}${relations.join('\n')}\n`;
}

function fakeSha(character) {
  return `sha256:${character.repeat(64)}`;
}

function materializeVariant(input, mutateIntermediate, addedTags = 0) {
  const expectedIntermediate = clone(syntheticBridge.intermediate);
  mutateIntermediate(expectedIntermediate);
  const expectedResult = adaptOsmWalkingIntermediate(expectedIntermediate);
  const changedMetadata = clone(metadata);
  changedMetadata.expected.oplIdentity = sha256Text(input);
  changedMetadata.expected.tagCount += addedTags;
  changedMetadata.expected.intermediateIdentity = contentIdentity(expectedIntermediate);
  changedMetadata.expected.rdBAdapterIdentity = expectedResult.adapterIdentity;
  return materializeSyntheticOsmiumOplFixture(input, json(changedMetadata));
}

function sha256Text(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

const BUILD_POLICY = parseRealGraphBuildPolicyJson(ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT);
const WORKSPACE_ROOT = 'C:\\Users\\raede\\.codex\\worktrees\\synthetic-rdf\\engagement_project';
const BUILD_LIMITATIONS = [
  BUILD_AUTHORITY_LIMITATION,
  RELEASE_CERTIFICATE_LIMITATION,
  BUILD_CLAIM_LIMITATION,
  INTERNAL_DIGEST_LIMITATION,
];

test('a fully self-consistent caller TrustedBuildEvidence claim remains non-capability non-evidence', () => {
  const bundle = makeEvidenceBundle();
  const inspection = inspectEvidenceBundle(bundle);
  assert.equal(inspection.status, 'caller-claim-only-not-trusted');
  assert.equal(inspection.contractShapeValidated, true);
  assert.equal(inspection.certificateChainRecomputed, true);
  assert.equal(inspection.embeddedCaptureDigestsRecomputed, true);
  assert.equal(inspection.boundOutputObservationClaimsCrossChecked, true);
  assert.equal(inspection.syntheticBridgeResultRecomputed, true);
  assert.equal(inspection.resolvedArgvRecomputed, true);
  assert.equal(inspection.resolvedPathsRecomputed, true);
  assert.equal(inspection.trustedBuildEvidence, false);
  assert.equal(inspection.processObservationTrusted, false);
  assert.equal(inspection.capability, false);
  assert.equal(inspection.commandAuthorization, false);
  assert.equal(inspection.successEvidence, false);
  assert.equal(inspection.graphArtifactAuthority, false);
  assert.equal(inspection.rdCAdmissionAuthority, false);
  assert.equal(inspection.rdDRealArtifactAuthority, false);
  assert.equal(inspection.sourceHealthCurrent, false);
  assert.match(inspection.evidenceIdentity, /^sha256:[a-f0-9]{64}$/);

  const selfConsistentHashClaim = clone(bundle.evidence);
  selfConsistentHashClaim.bridgeResult.bridgeIdentity = fakeSha('e');
  assert.throws(
    () => inspectEvidenceBundle(bundle, selfConsistentHashClaim),
    hasCode('evidence-bridge-recomputation-drift'),
  );
});

test('TrustedBuildEvidence external boundary executes zero caller Proxy, getter, or coercion traps', () => {
  const bundle = makeEvidenceBundle();
  const evidenceCounter = { count: 0 };
  assert.throws(
    () => inspectCallerTrustedBuildEvidenceClaim(
      trapProxy(evidenceCounter),
      bundle.manifestText,
      bundle.admissionText,
      bundle.acquisitionText,
      bundle.receiptText,
      bundle.extractionText,
    ),
    hasCode('primitive-text-required'),
  );
  assert.equal(evidenceCounter.count, 0);

  const manifestCounter = { count: 0 };
  assert.throws(
    () => inspectCallerTrustedBuildEvidenceClaim(
      json(bundle.evidence),
      trapProxy(manifestCounter),
      bundle.admissionText,
      bundle.acquisitionText,
      bundle.receiptText,
      bundle.extractionText,
    ),
    hasCode('primitive-text-required'),
  );
  assert.equal(manifestCounter.count, 0);

  let coercions = 0;
  const coercionObject = {
    toString() {
      coercions += 1;
      return json(bundle.evidence);
    },
  };
  assert.throws(
    () => inspectCallerTrustedBuildEvidenceClaim(
      coercionObject,
      bundle.manifestText,
      bundle.admissionText,
      bundle.acquisitionText,
      bundle.receiptText,
      bundle.extractionText,
    ),
    hasCode('primitive-text-required'),
  );
  assert.equal(coercions, 0);
});

test('deep primitive text preflight rejects hostile values and options with zero traps', () => {
  const valueCounter = { count: 0 };
  const optionsCounter = { count: 0 };
  assert.throws(
    () => preflightPrimitiveUtf8Text(
      trapProxy(valueCounter),
      'hostile value',
      trapProxy(optionsCounter),
    ),
    hasCode('primitive-text-required'),
  );
  assert.equal(valueCounter.count, 0);
  assert.equal(optionsCounter.count, 0);

  const extraOptionsCounter = { count: 0 };
  assert.throws(
    () => preflightPrimitiveUtf8Text('bounded text', 'hostile options', trapProxy(extraOptionsCounter)),
    hasCode('text-preflight-arguments'),
  );
  assert.equal(extraOptionsCounter.count, 0);
});

test('TrustedBuildEvidence recomputes chain, tool, lease, argv, path, capture, and promotion claims', () => {
  const bundle = makeEvidenceBundle();
  const mutations = [
    [(value) => { value.reviewedBy = 'caller'; }, 'schema-mismatch'],
    [(value) => { value.bindings.extractionReleaseIdentity = fakeSha('f'); }, 'evidence-binding-drift'],
    [(value) => { value.tool.binarySha256 = fakeSha('f'); }, 'evidence-tool-drift'],
    [(value) => { value.leases.extraction.nonce = 'f'.repeat(32); }, 'evidence-lease-drift'],
    [(value) => { value.execution.cwdAbsolute += '-drift'; }, 'evidence-cwd-drift'],
    [(value) => { value.execution.resolvedPaths.intermediateOplAbsolute += '.drift'; }, 'evidence-resolved-path-drift'],
    [(value) => { value.execution.preflight.checks[0].reparsePoint = true; }, 'evidence-preflight-check-drift'],
    [(value) => { value.execution.preflight.checks[1].exists = true; }, 'evidence-preflight-check-drift'],
    [(value) => { value.execution.steps[0].argv[0] = '--retry'; }, 'evidence-argv-drift'],
    [(value) => { value.execution.steps[2].exitCode = 1; }, 'evidence-exit-status'],
    [(value) => { value.execution.steps[3].retryOrdinal = 1; }, 'evidence-retry'],
    [(value) => { value.execution.steps[1].stdout.sha256 = fakeSha('f'); }, 'evidence-capture-sha256'],
    [(value) => { value.execution.promotions[2].method = 'copy-and-delete'; }, 'evidence-promotion-drift'],
    [(value) => { value.execution.promotions[3].partialAbsentAfter = false; }, 'evidence-true-required'],
    [(value) => { value.execution.promotions[2].sha256 = fakeSha('a'); }, 'evidence-promotion-byte-drift'],
    [(value) => { value.execution.promotions[2].byteCount += 1; }, 'evidence-promotion-byte-drift'],
    [(value) => { value.execution.promotions[3].sha256 = fakeSha('b'); }, 'evidence-promotion-byte-drift'],
    [(value) => { value.execution.promotions[3].byteCount += 1; }, 'evidence-promotion-byte-drift'],
    [(value) => { value.outputs.bufferExtractPbf.controllerIdentity += '-drift'; }, 'evidence-bound-output-observer-drift'],
    [(value) => { value.outputs.walkingFilteredPbf.completeByteTraversal = false; }, 'evidence-true-required'],
    [(value) => { value.outputs.bufferExtractPbf.observedAt = '2026-08-14T08:22:31.000Z'; }, 'evidence-bound-output-clock'],
    [(value) => { value.bridgeResult.relationRecordCount = 1; }, 'evidence-bridge-counts'],
    [(value) => { value.claims.sourceHealthCurrent = true; }, 'evidence-claims'],
  ];
  for (const [mutate, code] of mutations) {
    const changed = clone(bundle.evidence);
    mutate(changed);
    assert.throws(() => inspectEvidenceBundle(bundle, changed), hasCode(code));
  }
});

test('TrustedBuildEvidence binds exact stdout, stderr, log, fileinfo, OPL bytes, and RD-B identities', () => {
  const bundle = makeEvidenceBundle();
  const evidence = bundle.evidence;
  assert.equal(
    evidence.outputs.sourceFileInfo.capture.sha256,
    evidence.execution.steps[1].stdout.sha256,
  );
  assert.equal(
    evidence.outputs.intermediateFileInfo.capture.sha256,
    evidence.execution.steps[6].stdout.sha256,
  );
  assert.equal(evidence.outputs.intermediateOpl.capture.sha256, syntheticBridge.identities.oplIdentity);
  assert.equal(
    evidence.execution.promotions[2].sha256,
    evidence.outputs.bufferExtractPbf.sha256,
  );
  assert.equal(
    evidence.execution.promotions[3].sha256,
    evidence.outputs.walkingFilteredPbf.sha256,
  );
  assert.equal(evidence.bridgeResult.oplIdentity, syntheticBridge.identities.oplIdentity);
  assert.equal(evidence.bridgeResult.rdBIntermediateIdentity, syntheticBridge.identities.intermediateIdentity);
  assert.equal(evidence.bridgeResult.rdBAdapterIdentity, syntheticBridge.identities.rdBAdapterIdentity);
  assert.equal(
    evidence.bridgeResult.rdBTopologyIdentity,
    syntheticBridge.rdBResult.normalization.graph.topologyIdentity,
  );
  assert.equal(
    evidence.bridgeResult.rdBGeometryIdentity,
    syntheticBridge.rdBResult.normalization.graph.geometryIdentity,
  );

  const fileinfoDrift = clone(evidence);
  fileinfoDrift.outputs.sourceFileInfo.capture = capture('different exact bytes\n');
  assert.throws(
    () => inspectEvidenceBundle(bundle, fileinfoDrift),
    hasCode('evidence-source-fileinfo-bytes'),
  );

  const oplDrift = clone(evidence);
  oplDrift.bridgeResult.oplIdentity = fakeSha('f');
  assert.throws(() => inspectEvidenceBundle(bundle, oplDrift), hasCode('evidence-bridge-opl-drift'));

  const promotionDrift = clone(evidence);
  promotionDrift.execution.promotions[4].byteCount += 1;
  assert.throws(
    () => inspectEvidenceBundle(bundle, promotionDrift),
    hasCode('evidence-promotion-byte-drift'),
  );
});

test('TrustedBuildEvidence recomputes exact OPL, metadata, bridge, RD-B identities, and counts', () => {
  const bundle = makeEvidenceBundle();

  const oplBytesDrift = clone(bundle.evidence);
  const changedOplCapture = capture(
    oplText.replaceAll('x-75.1000000', 'x-75.1000001'),
  );
  oplBytesDrift.outputs.intermediateOpl.capture = changedOplCapture;
  oplBytesDrift.bridgeResult.oplIdentity = changedOplCapture.sha256;
  assert.throws(
    () => inspectEvidenceBundle(bundle, oplBytesDrift),
    hasCode('bridge-opl-identity-drift'),
  );

  const metadataBytesDrift = clone(bundle.evidence);
  const changedMetadata = clone(metadata);
  changedMetadata.fixtureId = 'synthetic-osmium-opl-walking-drift-v1';
  metadataBytesDrift.outputs.bridgeMetadata.capture = capture(json(changedMetadata));
  assert.throws(
    () => inspectEvidenceBundle(bundle, metadataBytesDrift),
    hasCode('evidence-bridge-recomputation-drift'),
  );

  for (const key of [
    'bridgeIdentity',
    'bridgeMetadataIdentity',
    'rdBIntermediateIdentity',
    'rdBAdapterIdentity',
    'rdBTopologyIdentity',
    'rdBGeometryIdentity',
  ]) {
    const changed = clone(bundle.evidence);
    changed.bridgeResult[key] = fakeSha('d');
    assert.throws(
      () => inspectEvidenceBundle(bundle, changed),
      hasCode('evidence-bridge-recomputation-drift'),
      key,
    );
  }

  for (const key of [
    'nodeRecordCount',
    'wayRecordCount',
    'relationRecordCount',
    'edgeRecordCount',
  ]) {
    const changed = clone(bundle.evidence);
    changed.bridgeResult[key] += 1;
    assert.throws(
      () => inspectEvidenceBundle(bundle, changed),
      hasCode('evidence-bridge-counts'),
      key,
    );
  }
});

test('production bridge modules expose no controller, filesystem, network, or process execution path', async () => {
  const names = [
    'bridge.mjs',
    'contracts.mjs',
    'index.mjs',
    'opl_parser.mjs',
    'primitive_ingress.mjs',
    'private_registry.mjs',
    'trusted_build_evidence.mjs',
  ];
  for (const name of names) {
    const source = await readFile(new URL(`../lib/route_real_graph_bridge/${name}`, import.meta.url), 'utf8');
    for (const forbidden of [
      /node:child_process/u,
      /node:fs/u,
      /\bfetch\s*\(/u,
      /\bspawn\s*\(/u,
      /\bexecFile\s*\(/u,
      /\bexecSync\s*\(/u,
      /\bWebSocket\b/u,
    ]) assert.doesNotMatch(source, forbidden, `${name} contains forbidden runtime surface ${forbidden}`);
  }
});

function makeEvidenceBundle() {
  const manifest = admitGeofabrikAcquisitionManifest(sourceManifestText);
  const admission = makeAdmission(manifest.manifestIdentity);
  const admissionText = json(admission);
  const acquisition = makeAcquisitionRelease(admissionText);
  const acquisitionText = json(acquisition);
  const receipt = makeObservedReceipt(acquisitionText, admissionText);
  const receiptText = json(receipt);
  const extraction = makeExtractionRelease(receiptText, acquisitionText, admissionText);
  const extractionText = json(extraction);
  const evidence = makeEvidence(
    manifest,
    admissionText,
    acquisitionText,
    receiptText,
    extractionText,
  );
  return {
    evidence,
    manifestText: sourceManifestText,
    admissionText,
    acquisitionText,
    receiptText,
    extractionText,
  };
}

function inspectEvidenceBundle(bundle, evidence = bundle.evidence) {
  return inspectCallerTrustedBuildEvidenceClaim(
    json(evidence),
    bundle.manifestText,
    bundle.admissionText,
    bundle.acquisitionText,
    bundle.receiptText,
    bundle.extractionText,
  );
}

function makeLease({ ownerId, nonce, issuedAt, deadlineAt }) {
  const projection = {
    schema: REAL_GRAPH_OWNER_LEASE_SCHEMA,
    ownerId,
    nonce,
    issuedAt,
    deadlineAt,
  };
  return {
    schema: projection.schema,
    leaseIdentity: contentIdentity(projection),
    ownerId,
    nonce,
    issuedAt,
    deadlineAt,
  };
}

function makeAdmission(sourceManifestIdentity) {
  const paths = deriveWorkspacePaths(WORKSPACE_ROOT);
  return {
    schema: REAL_GRAPH_SUPERVISOR_ADMISSION_SCHEMA,
    admissionId: 'synthetic-rd-f-supervisor-admission/v2',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    admittedRevision: 'a'.repeat(40),
    workspaceRootAbsolute: WORKSPACE_ROOT,
    sourceManifestIdentity,
    boundaryBinding: {
      policyId: BOUNDARY_POLICY_ID,
      core: {
        absolutePath: paths.artifacts.coreBoundary,
        sha256: fakeSha('2'),
        byteCount: 2_002,
        observedAt: '2026-08-14T08:00:00.000Z',
      },
      buffer: {
        absolutePath: paths.artifacts.bufferBoundary,
        sha256: fakeSha('3'),
        byteCount: 3_003,
        builtAt: '2026-08-14T08:01:00.000Z',
      },
      builderIdentity: fakeSha('4'),
    },
    intermediateAdapter: {
      schema: REAL_GRAPH_INTERMEDIATE_ADAPTER_SCHEMA,
      identity: syntheticBridge.bridgeIdentity,
      admittedRevision: 'b'.repeat(40),
      acceptedAt: '2026-08-14T08:02:00.000Z',
      status: 'reviewed-admitted',
    },
    extractorObservation: {
      toolId: EXTRACTOR_TOOL_ID,
      version: EXTRACTOR_VERSION,
      packageChannel: 'conda-forge',
      packagePlatform: 'win-64',
      packageFilename: EXTRACTOR_PACKAGE_FILENAME,
      absolutePackagePath: `${WORKSPACE_ROOT}\\tools\\${EXTRACTOR_PACKAGE_FILENAME}`,
      packageSha256: fakeSha('6'),
      packageByteCount: 6_006,
      packageObservedAt: '2026-08-14T08:03:00.000Z',
      absoluteBinaryPath: `${WORKSPACE_ROOT}\\tools\\osmium\\Library\\bin\\osmium.exe`,
      versionArguments: ['--version'],
      versionOutput: 'synthetic osmium version 1.19.1 observation',
      binarySha256: fakeSha('7'),
      binaryByteCount: 7_007,
      observedAt: '2026-08-14T08:04:00.000Z',
    },
    transportObservation: {
      toolId: 'curl/8.0.1/supervisor-observed',
      version: '8.0.1',
      absoluteBinaryPath: `${WORKSPACE_ROOT}\\tools\\curl\\curl.exe`,
      versionArguments: ['--version'],
      versionOutput: 'synthetic curl 8.0.1 observation',
      binarySha256: fakeSha('8'),
      binaryByteCount: 8_008,
      observedAt: '2026-08-14T08:05:00.000Z',
    },
    acceptedAt: '2026-08-14T08:06:00.000Z',
    evidenceRef: 'synthetic-rd-f-contract-test-only',
    limitations: BUILD_LIMITATIONS,
  };
}

function makeAcquisitionRelease(admissionText) {
  const admission = parseSupervisorAdmissionJson(
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const paths = deriveWorkspacePaths(admission.workspaceRootAbsolute);
  return {
    schema: REAL_GRAPH_ACQUISITION_RELEASE_SCHEMA,
    releaseId: 'synthetic-rd-f-acquisition-release/v1',
    admissionIdentity: contentIdentity(admission),
    datedUrl: BUILD_POLICY.source.datedUrl,
    transportObservationIdentity: contentIdentity(admission.transportObservation),
    workspaceRootAbsolute: admission.workspaceRootAbsolute,
    paths: {
      workingDirectoryAbsolute: paths.workingDirectoryAbsolute,
      outputDirectoryAbsolute: paths.outputDirectoryAbsolute,
      logPathAbsolute: paths.logPathAbsolute,
      sourcePartialPathAbsolute: paths.artifacts.sourcePartial,
      sourceFinalPathAbsolute: paths.artifacts.sourcePbf,
    },
    ownerLease: makeLease({
      ownerId: 'synthetic-acquisition-owner',
      nonce: 'a'.repeat(32),
      issuedAt: '2026-08-14T08:10:00.000Z',
      deadlineAt: '2026-08-14T08:30:00.000Z',
    }),
    trustedController: {
      identity: fakeSha('c'),
      observedAt: '2026-08-14T08:11:00.000Z',
    },
    oneShotConsumption: {
      required: true,
      consumptionOrdinal: 0,
      consumedAt: null,
    },
    preflight: unobservedPreflight(),
    retryAllowed: false,
    fallbackAllowed: false,
    limitations: BUILD_LIMITATIONS,
  };
}

function makeObservedReceipt(acquisitionText, admissionText) {
  const admission = parseSupervisorAdmissionJson(
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const acquisition = parseAcquisitionReleaseJson(
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  return {
    schema: REAL_GRAPH_OBSERVED_PAYLOAD_RECEIPT_SCHEMA,
    receiptId: 'synthetic-rd-f-observed-payload-receipt/v1',
    acquisitionReleaseIdentity: contentIdentity(acquisition),
    admissionIdentity: contentIdentity(admission),
    ownerLeaseIdentity: acquisition.ownerLease.leaseIdentity,
    ownerNonce: acquisition.ownerLease.nonce,
    trustedControllerIdentity: acquisition.trustedController.identity,
    controllerObservedAt: acquisition.trustedController.observedAt,
    consumptionOrdinal: 1,
    consumedAt: '2026-08-14T08:12:00.000Z',
    sourcePayload: {
      absolutePath: acquisition.paths.sourceFinalPathAbsolute,
      sha256: fakeSha('9'),
      byteCount: 9_009,
      retrievedAt: '2026-08-14T08:14:00.000Z',
      observedAt: '2026-08-14T08:15:00.000Z',
    },
    partialRemoved: true,
    retryUsed: false,
    fallbackUsed: false,
    limitations: BUILD_LIMITATIONS,
  };
}

function makeExtractionRelease(receiptText, acquisitionText, admissionText) {
  const admission = parseSupervisorAdmissionJson(
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const receipt = parseObservedPayloadReceiptJson(
    receiptText,
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const paths = deriveWorkspacePaths(admission.workspaceRootAbsolute);
  return {
    schema: REAL_GRAPH_EXTRACTION_RELEASE_SCHEMA,
    releaseId: 'synthetic-rd-f-extraction-release/v1',
    admissionIdentity: contentIdentity(admission),
    observedPayloadReceiptIdentity: contentIdentity(receipt),
    extractorObservationIdentity: contentIdentity(admission.extractorObservation),
    boundaryBinding: clone(admission.boundaryBinding),
    intermediateAdapterIdentity: contentIdentity(admission.intermediateAdapter),
    workspaceRootAbsolute: admission.workspaceRootAbsolute,
    paths: {
      workingDirectoryAbsolute: paths.workingDirectoryAbsolute,
      outputDirectoryAbsolute: paths.outputDirectoryAbsolute,
      logPathAbsolute: paths.logPathAbsolute,
      sourcePbfAbsolute: paths.artifacts.sourcePbf,
      sourceFileInfoAbsolute: paths.artifacts.sourceFileInfo,
      coreBoundaryAbsolute: paths.artifacts.coreBoundary,
      bufferBoundaryAbsolute: paths.artifacts.bufferBoundary,
      bufferExtractPbfAbsolute: paths.artifacts.bufferExtractPbf,
      walkingFilteredPbfAbsolute: paths.artifacts.walkingFilteredPbf,
      intermediateOplAbsolute: paths.artifacts.intermediateOpl,
      intermediateFileInfoAbsolute: paths.artifacts.intermediateFileInfo,
      buildEvidenceAbsolute: paths.artifacts.buildEvidence,
    },
    ownerLease: makeLease({
      ownerId: 'synthetic-extraction-owner',
      nonce: 'b'.repeat(32),
      issuedAt: '2026-08-14T08:16:00.000Z',
      deadlineAt: '2026-08-14T09:00:00.000Z',
    }),
    trustedController: {
      identity: fakeSha('d'),
      observedAt: '2026-08-14T08:17:00.000Z',
    },
    oneShotConsumption: {
      required: true,
      consumptionOrdinal: 0,
      consumedAt: null,
    },
    preflight: unobservedPreflight(),
    retryAllowed: false,
    fallbackAllowed: false,
    limitations: BUILD_LIMITATIONS,
  };
}

function unobservedPreflight() {
  return {
    status: 'not-observed',
    symlinkAndReparseCheckRequired: true,
    preExistingOutputCheckRequired: true,
    exactByteRevalidationRequired: true,
  };
}

function makeEvidence(manifest, admissionText, acquisitionText, receiptText, extractionText) {
  const admission = parseSupervisorAdmissionJson(
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const acquisition = parseAcquisitionReleaseJson(
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const receipt = parseObservedPayloadReceiptJson(
    receiptText,
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const extraction = parseExtractionReleaseJson(
    extractionText,
    receiptText,
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const paths = fixtureResolvedPaths(acquisition, extraction);
  const sourceFileInfo = capture('{"file":"source","synthetic":true}\n');
  const intermediateFileInfo = capture('{"file":"intermediate-opl","synthetic":true}\n');
  const log = capture('synthetic TrustedBuildEvidence contract fixture log\n');
  const buildEvidenceFile = bytesBinding('synthetic controller build-evidence payload bytes');
  const steps = fixtureSteps(admission, paths, sourceFileInfo, intermediateFileInfo);
  const bufferExtractPbf = boundOutputObservation(
    'bufferExtractPbf',
    'extract-buffer',
    paths.staging.bufferExtractPbfAbsolute,
    paths.bufferExtractPbfAbsolute,
    '2026-08-14T08:22:10.000Z',
    extraction,
    bytesBinding('synthetic buffer extract bytes'),
  );
  const walkingFilteredPbf = boundOutputObservation(
    'walkingFilteredPbf',
    'filter-walking',
    paths.staging.walkingFilteredPbfAbsolute,
    paths.walkingFilteredPbfAbsolute,
    '2026-08-14T08:24:10.000Z',
    extraction,
    bytesBinding('synthetic walking filtered bytes'),
  );
  const outputs = {
    log: {
      absolutePath: paths.logPathAbsolute,
      observedAt: '2026-08-14T08:31:10.000Z',
      capture: log,
    },
    sourceFileInfo: {
      absolutePath: paths.sourceFileInfoAbsolute,
      observedAt: '2026-08-14T08:20:10.000Z',
      capture: sourceFileInfo,
    },
    bufferExtractPbf,
    walkingFilteredPbf,
    intermediateFileInfo: {
      absolutePath: paths.intermediateFileInfoAbsolute,
      observedAt: '2026-08-14T08:30:10.000Z',
      capture: intermediateFileInfo,
    },
    intermediateOpl: {
      absolutePath: paths.intermediateOplAbsolute,
      observedAt: '2026-08-14T08:28:10.000Z',
      capture: capture(oplText),
    },
    bridgeMetadata: {
      schema: TRUSTED_BUILD_BRIDGE_INPUT_CAPTURE_SCHEMA,
      input: 'bridge-metadata-json',
      observationKind: 'future-controller-exact-invocation-argument-byte-capture',
      controllerIdentity: extraction.trustedController.identity,
      leaseIdentity: extraction.ownerLease.leaseIdentity,
      leaseNonce: extraction.ownerLease.nonce,
      observedAt: '2026-08-14T08:30:20.000Z',
      capture: capture(metadataText),
    },
    buildEvidenceFile: {
      absolutePath: paths.buildEvidenceAbsolute,
      sha256: buildEvidenceFile.sha256,
      byteCount: buildEvidenceFile.byteCount,
      observedAt: '2026-08-14T08:31:20.000Z',
    },
  };
  return {
    schema: TRUSTED_BUILD_EVIDENCE_SCHEMA,
    evidenceId: 'synthetic-caller-claim-never-trusted/v1',
    dataClassification: 'candidate-private-process-observation',
    admittedRevision: admission.admittedRevision,
    evidenceObservedAt: '2026-08-14T08:32:00.000Z',
    bindings: {
      policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
      sourceManifestIdentity: manifest.manifestIdentity,
      supervisorAdmissionIdentity: contentIdentity(admission),
      acquisitionReleaseIdentity: contentIdentity(acquisition),
      observedPayloadReceiptIdentity: contentIdentity(receipt),
      extractionReleaseIdentity: contentIdentity(extraction),
      extractorObservationIdentity: contentIdentity(admission.extractorObservation),
      boundaryBindingIdentity: contentIdentity(admission.boundaryBinding),
      intermediateAdapterIdentity: contentIdentity(admission.intermediateAdapter),
    },
    tool: {
      toolId: admission.extractorObservation.toolId,
      version: admission.extractorObservation.version,
      packageChannel: admission.extractorObservation.packageChannel,
      packagePlatform: admission.extractorObservation.packagePlatform,
      packageFilename: admission.extractorObservation.packageFilename,
      packageAbsolutePath: admission.extractorObservation.absolutePackagePath,
      packageSha256: admission.extractorObservation.packageSha256,
      packageByteCount: admission.extractorObservation.packageByteCount,
      packageObservedAt: admission.extractorObservation.packageObservedAt,
      binaryAbsolutePath: admission.extractorObservation.absoluteBinaryPath,
      binarySha256: admission.extractorObservation.binarySha256,
      binaryByteCount: admission.extractorObservation.binaryByteCount,
      binaryObservedAt: admission.extractorObservation.observedAt,
      versionOutput: admission.extractorObservation.versionOutput,
    },
    leases: {
      acquisition: leaseObservation(
        acquisition,
        receipt.consumptionOrdinal,
        receipt.consumedAt,
      ),
      extraction: leaseObservation(extraction, 1, '2026-08-14T08:18:00.000Z'),
    },
    execution: {
      cwdAbsolute: paths.workingDirectoryAbsolute,
      resolvedPaths: paths,
      preflight: {
        status: 'observed-passed',
        acquisitionObservedAt: '2026-08-14T08:11:30.000Z',
        extractionObservedAt: '2026-08-14T08:17:30.000Z',
        checks: fixturePreflightChecks(admission, paths),
      },
      steps,
      promotions: fixturePromotions(receipt, paths, outputs),
      retryUsed: false,
      fallbackUsed: false,
    },
    outputs,
    bridgeResult: {
      schema: OSMIUM_OPL_BRIDGE_RESULT_SCHEMA,
      bridgeIdentity: syntheticBridge.bridgeIdentity,
      oplIdentity: syntheticBridge.identities.oplIdentity,
      bridgeMetadataIdentity: syntheticBridge.identities.metadataIdentity,
      rdBIntermediateIdentity: syntheticBridge.identities.intermediateIdentity,
      rdBAdapterIdentity: syntheticBridge.identities.rdBAdapterIdentity,
      rdBTopologyIdentity: syntheticBridge.rdBResult.normalization.graph.topologyIdentity,
      rdBGeometryIdentity: syntheticBridge.rdBResult.normalization.graph.geometryIdentity,
      nodeRecordCount: syntheticBridge.audit.nodeRecordCount,
      wayRecordCount: syntheticBridge.audit.wayRecordCount,
      relationRecordCount: syntheticBridge.audit.relationRecordCount,
      edgeRecordCount: syntheticBridge.audit.edgeRecordCount,
    },
    claims: TRUSTED_BUILD_CLAIMS,
    limitations: TRUSTED_BUILD_LIMITATIONS,
  };
}

function leaseObservation(release, consumptionOrdinal, consumedAt) {
  return {
    leaseIdentity: release.ownerLease.leaseIdentity,
    ownerId: release.ownerLease.ownerId,
    nonce: release.ownerLease.nonce,
    issuedAt: release.ownerLease.issuedAt,
    deadlineAt: release.ownerLease.deadlineAt,
    trustedControllerIdentity: release.trustedController.identity,
    controllerObservedAt: release.trustedController.observedAt,
    consumptionOrdinal,
    consumedAt,
  };
}

function fixtureResolvedPaths(acquisition, extraction) {
  const paths = extraction.paths;
  return {
    workingDirectoryAbsolute: paths.workingDirectoryAbsolute,
    outputDirectoryAbsolute: paths.outputDirectoryAbsolute,
    logPathAbsolute: paths.logPathAbsolute,
    sourcePartialPathAbsolute: acquisition.paths.sourcePartialPathAbsolute,
    sourcePbfAbsolute: paths.sourcePbfAbsolute,
    sourceFileInfoAbsolute: paths.sourceFileInfoAbsolute,
    coreBoundaryAbsolute: paths.coreBoundaryAbsolute,
    bufferBoundaryAbsolute: paths.bufferBoundaryAbsolute,
    bufferExtractPbfAbsolute: paths.bufferExtractPbfAbsolute,
    walkingFilteredPbfAbsolute: paths.walkingFilteredPbfAbsolute,
    intermediateOplAbsolute: paths.intermediateOplAbsolute,
    intermediateFileInfoAbsolute: paths.intermediateFileInfoAbsolute,
    buildEvidenceAbsolute: paths.buildEvidenceAbsolute,
    staging: {
      sourcePbfAbsolute: acquisition.paths.sourcePartialPathAbsolute,
      sourceFileInfoAbsolute: `${paths.sourceFileInfoAbsolute}.partial`,
      bufferExtractPbfAbsolute: `${paths.bufferExtractPbfAbsolute}.partial`,
      walkingFilteredPbfAbsolute: `${paths.walkingFilteredPbfAbsolute}.partial`,
      intermediateOplAbsolute: `${paths.intermediateOplAbsolute}.partial`,
      intermediateFileInfoAbsolute: `${paths.intermediateFileInfoAbsolute}.partial`,
      logPathAbsolute: `${paths.logPathAbsolute}.partial`,
      buildEvidenceAbsolute: `${paths.buildEvidenceAbsolute}.partial`,
    },
  };
}

function fixturePreflightChecks(admission, paths) {
  const check = (phase, absolutePath, disposition, exists) => ({
    phase,
    absolutePath,
    disposition,
    exists,
    reparsePoint: false,
    finalResolvedPath: true,
  });
  return [
    check('acquisition', admission.transportObservation.absoluteBinaryPath, 'existing-input', true),
    check('acquisition', paths.staging.sourcePbfAbsolute, 'absent-output', false),
    check('acquisition', paths.sourcePbfAbsolute, 'absent-output', false),
    check('extraction', admission.extractorObservation.absoluteBinaryPath, 'existing-input', true),
    check('extraction', paths.sourcePbfAbsolute, 'existing-input', true),
    check('extraction', paths.coreBoundaryAbsolute, 'existing-input', true),
    check('extraction', paths.bufferBoundaryAbsolute, 'existing-input', true),
    ...[
      'sourceFileInfoAbsolute',
      'bufferExtractPbfAbsolute',
      'walkingFilteredPbfAbsolute',
      'intermediateOplAbsolute',
      'intermediateFileInfoAbsolute',
      'logPathAbsolute',
      'buildEvidenceAbsolute',
    ].flatMap((key) => [
      check('extraction', paths.staging[key], 'absent-output', false),
      check('extraction', paths[key], 'absent-output', false),
    ]),
  ];
}

function fixtureSteps(admission, paths, sourceFileInfo, intermediateFileInfo) {
  const plans = [
    ...BUILD_POLICY.acquisitionCommandPlan,
    ...BUILD_POLICY.extractionCommandPlan,
  ];
  const clocks = [
    ['2026-08-14T08:12:10.000Z', '2026-08-14T08:13:00.000Z'],
    ['2026-08-14T08:19:00.000Z', '2026-08-14T08:20:00.000Z'],
    ['2026-08-14T08:21:00.000Z', '2026-08-14T08:22:00.000Z'],
    ['2026-08-14T08:23:00.000Z', '2026-08-14T08:24:00.000Z'],
    ['2026-08-14T08:25:00.000Z', '2026-08-14T08:26:00.000Z'],
    ['2026-08-14T08:27:00.000Z', '2026-08-14T08:28:00.000Z'],
    ['2026-08-14T08:29:00.000Z', '2026-08-14T08:30:00.000Z'],
  ];
  return plans.map((plan, index) => ({
    stepId: plan.stepId,
    executableAbsolutePath: index === 0
      ? admission.transportObservation.absoluteBinaryPath
      : admission.extractorObservation.absoluteBinaryPath,
    argv: fixtureResolvedArgv(plan.argv, plan.stepId, paths),
    cwdAbsolute: paths.workingDirectoryAbsolute,
    shell: false,
    startedAt: clocks[index][0],
    endedAt: clocks[index][1],
    exitStatus: 'exited',
    exitCode: 0,
    signal: null,
    stdout: index === 1
      ? clone(sourceFileInfo)
      : index === 6
        ? clone(intermediateFileInfo)
        : capture(''),
    stderr: capture(''),
    retryOrdinal: 0,
    fallbackUsed: false,
  }));
}

function fixtureResolvedArgv(argv, stepId, paths) {
  const replacements = {
    SOURCE_PBF_PARTIAL: paths.staging.sourcePbfAbsolute,
    SOURCE_PBF: paths.sourcePbfAbsolute,
    BUFFER_BOUNDARY_GEOJSON: paths.bufferBoundaryAbsolute,
    BUFFER_EXTRACT_PBF: stepId === 'extract-buffer'
      ? paths.staging.bufferExtractPbfAbsolute
      : paths.bufferExtractPbfAbsolute,
    WALKING_FILTERED_PBF: stepId === 'filter-walking'
      ? paths.staging.walkingFilteredPbfAbsolute
      : paths.walkingFilteredPbfAbsolute,
    INTERMEDIATE_OPL: stepId === 'write-opl'
      ? paths.staging.intermediateOplAbsolute
      : paths.intermediateOplAbsolute,
  };
  return argv.map((argument) => {
    const match = /^\{([A-Z_]+)\}$/.exec(argument);
    return match ? replacements[match[1]] : argument;
  });
}

function fixturePromotions(receipt, paths, outputs) {
  const values = [
    ['sourcePbf', paths.staging.sourcePbfAbsolute, paths.sourcePbfAbsolute,
      '2026-08-14T08:13:10.000Z', receipt.sourcePayload],
    ['sourceFileInfo', paths.staging.sourceFileInfoAbsolute, paths.sourceFileInfoAbsolute,
      '2026-08-14T08:20:30.000Z', outputs.sourceFileInfo.capture],
    ['bufferExtractPbf', paths.staging.bufferExtractPbfAbsolute, paths.bufferExtractPbfAbsolute,
      '2026-08-14T08:22:30.000Z', outputs.bufferExtractPbf],
    ['walkingFilteredPbf', paths.staging.walkingFilteredPbfAbsolute, paths.walkingFilteredPbfAbsolute,
      '2026-08-14T08:24:30.000Z', outputs.walkingFilteredPbf],
    ['intermediateOpl', paths.staging.intermediateOplAbsolute, paths.intermediateOplAbsolute,
      '2026-08-14T08:28:30.000Z', outputs.intermediateOpl.capture],
    ['intermediateFileInfo', paths.staging.intermediateFileInfoAbsolute, paths.intermediateFileInfoAbsolute,
      '2026-08-14T08:30:30.000Z', outputs.intermediateFileInfo.capture],
    ['log', paths.staging.logPathAbsolute, paths.logPathAbsolute,
      '2026-08-14T08:31:00.000Z', outputs.log.capture],
    ['buildEvidence', paths.staging.buildEvidenceAbsolute, paths.buildEvidenceAbsolute,
      '2026-08-14T08:31:30.000Z', outputs.buildEvidenceFile],
  ];
  return values.map(([slot, partialPathAbsolute, finalPathAbsolute, promotedAt, binding]) => ({
    slot,
    partialPathAbsolute,
    finalPathAbsolute,
    method: 'atomic-rename-no-replace',
    promotedAt,
    partialAbsentAfter: true,
    finalPresentAfter: true,
    finalReparsePoint: false,
    sha256: binding.sha256,
    byteCount: binding.byteCount,
  }));
}

function capture(text) {
  const bytes = Buffer.from(text, 'utf8');
  return {
    encoding: 'base64-chunks',
    chunksBase64: bytes.byteLength === 0 ? [] : [bytes.toString('base64')],
    byteCount: bytes.byteLength,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    truncated: false,
  };
}

function bytesBinding(text) {
  const value = capture(text);
  return { sha256: value.sha256, byteCount: value.byteCount };
}

function boundOutputObservation(
  slot,
  producerStepId,
  partialPathAbsolute,
  finalPathAbsolute,
  observedAt,
  extraction,
  binding,
) {
  return {
    schema: TRUSTED_BUILD_BOUND_OUTPUT_OBSERVATION_SCHEMA,
    slot,
    observationKind: 'future-controller-direct-closed-file-byte-observation',
    controllerIdentity: extraction.trustedController.identity,
    leaseIdentity: extraction.ownerLease.leaseIdentity,
    leaseNonce: extraction.ownerLease.nonce,
    producerStepId,
    partialPathAbsolute,
    finalPathAbsolute,
    observedAt,
    closedBeforeObservation: true,
    completeByteTraversal: true,
    reparsePoint: false,
    sha256: binding.sha256,
    byteCount: binding.byteCount,
  };
}
