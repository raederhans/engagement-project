import {
  ROUTE_DECISION_SCHEMA_VERSIONS,
  admitSourceObservation,
} from '../contracts/index.js';
import {
  CITY_ADAPTER_SCHEMA_VERSIONS,
  admitCityAdaptationResult,
  admitCityAdapter,
} from '../../route_generation/city_adapter/index.js';

import {
  compareCodeUnits,
  contentIdentity,
  contractFail,
  deepFreeze,
  exactDataObject,
  sameData,
  snapshotData,
} from './contract_support.js';

export const CITY_ROUTE_DECISION_BINDING_VERSION =
  'engagement-city-route-decision-binding/v1';
export const CITY_ROUTE_DECISION_BINDING_IDENTITY_VERSION =
  'engagement-city-route-decision-binding-identity/v1';
export const CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_VERSION =
  'engagement-city-capability-to-source-observation-mapping/v1';

const BINDING_IDENTITY_CANONICALIZATION =
  'city-route-decision-binding-canonical-json/v1';
const CAPABILITY_FACTOR_IDS = Object.freeze([
  'step-free',
  'curb-ramp-present',
  'paved-surface',
]);
const FACTOR_ORDER = new Map(CAPABILITY_FACTOR_IDS.map((factorId, index) => [factorId, index]));

export const CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_V1 = deepFreeze({
  schemaVersion: CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_VERSION,
  inputSchemaVersion: CITY_ADAPTER_SCHEMA_VERSIONS.capabilityObservation,
  outputSchemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
  factorIds: [...CAPABILITY_FACTOR_IDS],
  aliases: 'forbidden',
  missingEdgeOrFactorCoverage: 'reject',
  states: [
    {
      cityState: 'observed',
      cityReasonCode: null,
      sourceState: 'observed',
      sourceReasonCode: null,
      valuePolicy: 'preserve-boolean',
    },
    {
      cityState: 'unknown',
      cityReasonCode: 'source-unknown',
      sourceState: 'unknown',
      sourceReasonCode: 'not-observed',
      valuePolicy: 'preserve-null-unresolved',
    },
    {
      cityState: 'unavailable',
      cityReasonCode: 'source-unavailable',
      sourceState: 'unavailable',
      sourceReasonCode: 'source-unavailable',
      valuePolicy: 'preserve-null-unresolved',
    },
  ],
});

function fail(message) {
  contractFail('CityRouteDecisionBinding/v1 contract', message);
}

function mappingFor(cityObservation) {
  if (cityObservation.schemaVersion !== CITY_ADAPTER_SCHEMA_VERSIONS.capabilityObservation) {
    fail('capability observation schemaVersion is unsupported');
  }
  if (!FACTOR_ORDER.has(cityObservation.capabilityId)) {
    fail(`capability alias or unsupported capabilityId ${cityObservation.capabilityId}`);
  }
  const mapping = CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_V1.states.find((entry) => (
    entry.cityState === cityObservation.state
      && entry.cityReasonCode === cityObservation.reasonCode
  ));
  if (!mapping) fail('capability state/reason vocabulary is unsupported');
  if (cityObservation.unit !== 'boolean') fail('capability unit must be boolean');
  if (mapping.valuePolicy === 'preserve-boolean'
    && typeof cityObservation.value !== 'boolean') {
    fail('observed capability must preserve a boolean value');
  }
  if (mapping.valuePolicy === 'preserve-null-unresolved'
    && cityObservation.value !== null) {
    fail('unknown/unavailable capability must preserve null unresolved truth');
  }
  return mapping;
}

function mapCapabilityObservation(cityObservation) {
  const mapping = mappingFor(cityObservation);
  return admitSourceObservation({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
    factorId: cityObservation.capabilityId,
    state: mapping.sourceState,
    value: cityObservation.value,
    unit: 'boolean',
    reasonCode: mapping.sourceReasonCode,
    sourceId: cityObservation.sourceId,
  });
}

function buildEvidence(adaptationResult) {
  const graphEdgeIds = [...adaptationResult.graphArtifact.edges]
    .map(({ edgeId }) => edgeId)
    .sort(compareCodeUnits);
  const observationRows = [...adaptationResult.edgeCapabilityObservations]
    .sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId));
  if (observationRows.length !== graphEdgeIds.length
    || observationRows.some(({ edgeId }, index) => edgeId !== graphEdgeIds[index])) {
    fail('edge capability coverage must exactly match every admitted graph edge');
  }

  const edgeObservationsByEdgeId = {};
  const mappingTrace = [];
  for (const row of observationRows) {
    const observations = [...row.observations].sort((left, right) => (
      FACTOR_ORDER.get(left.capabilityId) - FACTOR_ORDER.get(right.capabilityId)
    ));
    if (observations.length !== CAPABILITY_FACTOR_IDS.length
      || observations.some(({ capabilityId }, index) => (
        capabilityId !== CAPABILITY_FACTOR_IDS[index]
      ))) {
      fail(`edge ${row.edgeId} must contain exact capability coverage without aliases`);
    }
    const factors = {};
    for (const cityObservation of observations) {
      const sourceObservation = mapCapabilityObservation(cityObservation);
      factors[sourceObservation.factorId] = sourceObservation;
      mappingTrace.push({
        edgeId: row.edgeId,
        factorId: sourceObservation.factorId,
        cityObservation: snapshotData(
          cityObservation,
          `mapping trace ${row.edgeId}.${sourceObservation.factorId}.cityObservation`,
          fail,
        ),
        sourceObservation: snapshotData(
          sourceObservation,
          `mapping trace ${row.edgeId}.${sourceObservation.factorId}.sourceObservation`,
          fail,
        ),
      });
    }
    edgeObservationsByEdgeId[row.edgeId] = factors;
  }
  return { edgeObservationsByEdgeId, mappingTrace };
}

function provenance(adaptationResult, adapter) {
  return {
    schemaVersion: 'engagement-city-route-decision-binding-provenance/v1',
    cityAdapterSchemaVersion: adapter.schemaVersion,
    cityAdapterVersion: adapter.adapterVersion,
    cityAdapterContentIdentity: adapter.adapterContentIdentity,
    cityAdaptationResultSchemaVersion: adaptationResult.schemaVersion,
    cityInputContentIdentity: adaptationResult.inputContentIdentity,
    cityOutputContentIdentity: adaptationResult.outputContentIdentity,
    graphArtifactSchemaVersion: adaptationResult.graphArtifact.schemaVersion,
    graphId: adaptationResult.graphArtifact.graphId,
    graphArtifactVersion: adaptationResult.graphArtifact.receipt.artifactVersion,
    capabilityObservationSchemaVersion: CITY_ADAPTER_SCHEMA_VERSIONS.capabilityObservation,
    sourceObservationSchemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
    mappingPolicyVersion: CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_VERSION,
  };
}

function expectedBinding(rawInput) {
  const input = exactDataObject(
    rawInput,
    ['sourceGraph', 'cityAdapter', 'cityAdaptationResult'],
    'binding build input',
    fail,
  );
  const sourceGraph = snapshotData(input.sourceGraph, 'binding sourceGraph', fail);
  const cityAdapterInput = snapshotData(input.cityAdapter, 'binding cityAdapter', fail);
  const cityAdaptationResultInput = snapshotData(
    input.cityAdaptationResult,
    'binding cityAdaptationResult',
    fail,
  );
  const cityAdapter = admitCityAdapter(cityAdapterInput);
  if (cityAdapter.schemaVersion !== CITY_ADAPTER_SCHEMA_VERSIONS.cityAdapter
    || cityAdapter.adapterVersion !== 'philadelphia-synthetic-city-adapter/v2') {
    fail('only the exact admitted CityAdapter/v2 is supported');
  }
  const cityAdaptationResult = admitCityAdaptationResult(cityAdaptationResultInput, {
    sourceGraph,
    adapter: cityAdapter,
  });
  const evidence = buildEvidence(cityAdaptationResult);
  const admittedProvenance = provenance(cityAdaptationResult, cityAdapter);
  const bindingIdentity = contentIdentity(
    CITY_ROUTE_DECISION_BINDING_IDENTITY_VERSION,
    BINDING_IDENTITY_CANONICALIZATION,
    {
      schemaVersion: CITY_ROUTE_DECISION_BINDING_VERSION,
      provenance: admittedProvenance,
      mappingPolicy: CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_V1,
      mappingTrace: evidence.mappingTrace,
    },
  );
  return deepFreeze({
    schemaVersion: CITY_ROUTE_DECISION_BINDING_VERSION,
    sourceGraph,
    cityAdapter,
    cityAdaptationResult,
    provenance: admittedProvenance,
    mappingPolicy: CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_V1,
    edgeObservationsByEdgeId: evidence.edgeObservationsByEdgeId,
    mappingTrace: evidence.mappingTrace,
    bindingIdentity,
  });
}

export function buildCityRouteDecisionBinding(input) {
  return expectedBinding(input);
}

export function admitCityRouteDecisionBinding(raw) {
  const value = exactDataObject(raw, [
    'schemaVersion',
    'sourceGraph',
    'cityAdapter',
    'cityAdaptationResult',
    'provenance',
    'mappingPolicy',
    'edgeObservationsByEdgeId',
    'mappingTrace',
    'bindingIdentity',
  ], 'CityRouteDecisionBinding', fail);
  if (value.schemaVersion !== CITY_ROUTE_DECISION_BINDING_VERSION) {
    fail('schemaVersion is unsupported');
  }
  const expected = expectedBinding({
    sourceGraph: value.sourceGraph,
    cityAdapter: value.cityAdapter,
    cityAdaptationResult: value.cityAdaptationResult,
  });
  const supplied = snapshotData(raw, 'CityRouteDecisionBinding', fail);
  if (!sameData(supplied, expected)) {
    fail('artifact must exactly match full recomputation from original sourceGraph and CityAdapter/v2');
  }
  return expected;
}

export function projectBindingEvidenceForSearch(rawBinding, rawFactorIds) {
  const binding = admitCityRouteDecisionBinding(rawBinding);
  const factorIds = snapshotData(rawFactorIds, 'search factorIds', fail);
  if (!Array.isArray(factorIds)) fail('search factorIds must be an array');
  if (new Set(factorIds).size !== factorIds.length
    || factorIds.some((factorId) => !FACTOR_ORDER.has(factorId))) {
    fail('search factorIds must be unique exact capability IDs; aliases are forbidden');
  }
  factorIds.sort((left, right) => FACTOR_ORDER.get(left) - FACTOR_ORDER.get(right));
  if (factorIds.length === 0) return deepFreeze({});
  const projected = {};
  for (const edgeId of Object.keys(binding.edgeObservationsByEdgeId).sort(compareCodeUnits)) {
    projected[edgeId] = Object.fromEntries(factorIds.map((factorId) => [
      factorId,
      binding.edgeObservationsByEdgeId[edgeId][factorId],
    ]));
  }
  return deepFreeze(projected);
}
