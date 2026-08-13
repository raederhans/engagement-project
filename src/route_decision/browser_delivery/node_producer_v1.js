import { admitRouteDecisionIntegrationRun } from '../integration/index.js';
import {
  canonicalStringify,
  contentIdentity,
  deepFreeze,
  snapshotData,
} from '../integration/contract_support.js';

import {
  ROUTE_DECISION_BROWSER_DELIVERY_CANONICALIZATION,
  ROUTE_DECISION_BROWSER_DELIVERY_IDENTITY_VERSION,
  ROUTE_DECISION_BROWSER_DELIVERY_VERSION,
  ROUTE_DECISION_BROWSER_TERMINAL_TRUTH_TABLE_VERSION,
} from './browser_delivery_v1.js';

const DELIVERY_LIMITATIONS = Object.freeze([
  'synthetic-evidence-only',
  'not-real-philadelphia-data',
  'not-product-or-public-admitted',
  'not-second-city-transferability-evidence',
  'unknown-unavailable-preserved-not-zero-or-false',
  'not-source-authenticity',
  'not-typed-recomputation',
  'not-performance-authority',
  'not-external-graph-authority',
  'not-product-admission',
]);

function fail(message) {
  throw new TypeError(`RouteDecisionBrowserDelivery/v1 producer: ${message}`);
}

function unicodeScalarData(value, label, seen = new WeakSet()) {
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail(`${label} contains an unpaired surrogate`);
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        fail(`${label} contains an unpaired surrogate`);
      }
    }
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) unicodeScalarData(child, `${label}.${key}`, seen);
}

function copy(value, label) {
  return snapshotData(value, label, fail);
}

function requestedFactorStatesPresentInBoundGraph(run) {
  const factorIds = new Set(run.searchRequest.hardConstraints.map(({ factorId }) => factorId));
  const states = new Set();
  for (const factors of Object.values(run.binding.edgeObservationsByEdgeId)) {
    for (const factorId of factorIds) {
      const state = factors[factorId].state;
      if (state !== 'observed') states.add(state);
    }
  }
  return [...states].sort();
}

function explanationLimitations(searchTruth) {
  const limitations = [
    'synthetic-evidence-only',
    ...(searchTruth.candidateCount > 0 ? ['provided-candidate-set-only'] : []),
    'bounded-search-scope-only',
    'soft-contribution-not-decisive-cause',
    'counterfactual-effect-not-causal',
    'no-user-preference-inference',
    'no-accessibility-outcome-claim',
    'no-safety-claim',
  ];
  if (searchTruth.boundedSearchCompleteness === 'not-proven') {
    limitations.push('route-search-completeness-not-proven');
  }
  if (searchTruth.stopped) limitations.push('route-search-stopped');
  for (const state of searchTruth.requestedFactorStatesPresentInBoundGraph) {
    limitations.push(`constraint-evidence-${state}`);
  }
  return limitations;
}

function line(code, text) {
  return { code, text };
}

function displayLimitationCodes(limitations) {
  return [...new Set([
    ...limitations.cityAdapterLimitations,
    ...limitations.runLimitations,
    ...limitations.explanationLimitations,
    ...limitations.deliveryLimitations,
  ])];
}

function displayModel(searchTruth, provenance, limitations, sourcePresentationSchemaVersion) {
  const limitationCodes = displayLimitationCodes(limitations);
  return {
    schemaVersion: 'engagement-route-decision-browser-display-model/v1',
    sourcePresentationSchemaVersion,
    sourcePresentationRelationship: 'source-fact-contract-only-not-full-s4-presentation-projection',
    displayCompletenessScope: 'browser-boundary-summary/v1',
    textCompleteForBoundarySummary: true,
    mapOptional: true,
    mapModel: null,
    sections: {
      summary: [
        line(
          'search-terminal',
          `Search status: ${searchTruth.status}; termination: ${searchTruth.termination}.`,
        ),
        line(
          'candidate-count',
          `Returned candidates: ${searchTruth.candidateCount}; requested candidates: ${searchTruth.requestedCandidateCount}.`,
        ),
        line(
          'bounded-completeness',
          `Bounded search completeness: ${searchTruth.boundedSearchCompleteness}; full search space completeness: not claimed.`,
        ),
        line(
          'constraint-outcome',
          `Constraints present: ${searchTruth.hasConstraints ? 'yes' : 'no'}; outcome: ${searchTruth.constraintOutcome}; unresolved evidence: ${searchTruth.unresolvedEvidence ? 'yes' : 'no'}.`,
        ),
        line(
          'resource-outcomes',
          `Search budget: ${searchTruth.budgetOutcome}; search capacity: ${searchTruth.capacityOutcome}.`,
        ),
        line(
          'bound-graph-requested-factor-states',
          `Requested-factor unresolved states present anywhere in the bound graph: ${searchTruth.requestedFactorStatesPresentInBoundGraph.length ? searchTruth.requestedFactorStatesPresentInBoundGraph.join(', ') : 'none'}. This is conservative graph-wide disclosure, not a terminal cause.`,
        ),
        line(
          'revision-binding',
          `Graph, candidate set, and explanation revisions are exactly bound: ${provenance.graphArtifactVersion}.`,
        ),
      ],
      claimBoundary: [
        line(
          'no-claim-eligible-from-explanation-v1',
          'No route outcome claim is admitted from this browser delivery.',
        ),
        line(
          'browser-admission-boundary',
          'Browser admission proves serialized internal consistency only; it does not prove source, authority, or product status.',
        ),
      ],
      limitations: limitationCodes.map((code) => line(code, `Limitation: ${code}.`)),
    },
  };
}

function projectionFromAdmittedRun(run) {
  const binding = run.binding;
  const adaptation = binding.cityAdaptationResult;
  const graph = adaptation.graphArtifact;
  const candidateSet = run.searchResult.candidateSet;
  if (candidateSet === null) fail('fully admitted run must contain a searched CandidateSet');
  const provenance = {
    schemaVersion: 'engagement-route-decision-browser-provenance/v1',
    bindingSchemaVersion: binding.schemaVersion,
    bindingIdentity: copy(binding.bindingIdentity, 'binding identity'),
    sourceGraphSchemaVersion: binding.sourceGraph.schemaVersion,
    sourceId: binding.sourceGraph.sourceId,
    sourceVersion: binding.sourceGraph.sourceVersion,
    sourceContentIdentity: copy(adaptation.inputContentIdentity, 'source content identity'),
    cityAdapterSchemaVersion: binding.cityAdapter.schemaVersion,
    cityAdapterVersion: binding.cityAdapter.adapterVersion,
    cityAdapterContentIdentity: copy(binding.cityAdapter.adapterContentIdentity,
      'city adapter content identity'),
    cityAdaptationResultSchemaVersion: adaptation.schemaVersion,
    cityOutputContentIdentity: copy(adaptation.outputContentIdentity,
      'city output content identity'),
    graphArtifactSchemaVersion: graph.schemaVersion,
    graphId: graph.graphId,
    graphArtifactVersion: run.revisions.graphArtifactVersion,
    candidateSetSchemaVersion: candidateSet.schemaVersion,
    candidateSetId: candidateSet.candidateSetId,
    candidateSetRevision: run.revisions.candidateSetRevision,
    explanationInputRevision: run.revisions.explanationInputRevision,
    revisionsExactMatch: run.revisions.exactMatch,
  };
  const searchTruth = {
    schemaVersion: 'engagement-route-decision-browser-search-truth/v1',
    terminalTruthTableVersion: ROUTE_DECISION_BROWSER_TERMINAL_TRUTH_TABLE_VERSION,
    searchResultSchemaVersion: run.searchResult.schemaVersion,
    status: run.truth.searchStatus,
    termination: run.truth.termination,
    candidateCount: candidateSet.candidateCount,
    requestedCandidateCount: candidateSet.requestedCandidateCount,
    hasConstraints: candidateSet.searchConstraintIds.length > 0,
    searched: run.truth.searched,
    stopped: run.truth.stopped,
    stoppedWithPartialExecution: run.truth.partial,
    incomplete: run.truth.incomplete,
    boundedSearchCompleteness: run.truth.routeSearchCompleteness,
    fullSearchSpaceCompleteness: 'not-claimed',
    constraintOutcome: run.truth.constraintOutcome,
    budgetOutcome: candidateSet.budgetOutcome,
    capacityOutcome: candidateSet.capacityOutcome,
    missingCoverageAccepted: run.truth.missingCoverageAccepted,
    boundedNoEligibleRouteProven: run.truth.boundedNoEligibleRouteProven,
    unresolvedEvidence: run.truth.constraintOutcome === 'unresolved-evidence',
    requestedFactorStatesPresentInBoundGraph: requestedFactorStatesPresentInBoundGraph(run),
    unknownUnavailablePolicy: 'preserve-unresolved-never-false-zero-or-complete',
  };
  const browserExplanationLimitations = explanationLimitations(searchTruth);
  const limitations = {
    schemaVersion: 'engagement-route-decision-browser-limitations/v1',
    cityAdapterLimitations: copy(binding.cityAdapter.limitations, 'city adapter limitations'),
    runLimitations: copy(run.claimBoundary.limitations, 'run limitations'),
    explanationLimitations: browserExplanationLimitations,
    deliveryLimitations: [...DELIVERY_LIMITATIONS],
  };

  return {
    schemaVersion: ROUTE_DECISION_BROWSER_DELIVERY_VERSION,
    serialization: {
      schemaVersion: 'engagement-route-decision-browser-serialization/v1',
      mediaType: 'application/json',
      characterEncoding: 'utf-8',
      canonicalization: ROUTE_DECISION_BROWSER_DELIVERY_CANONICALIZATION,
      inputContract: 'primitive-json-text-only',
    },
    run: {
      schemaVersion: run.schemaVersion,
      identity: copy(run.runIdentity, 'run identity'),
    },
    provenance,
    searchTruth,
    explanation: {
      schemaVersion: run.explanation.schemaVersion,
      presentationSchemaVersion: run.presentation.schemaVersion,
      textComplete: run.presentation.textComplete,
      mapOptional: run.presentation.mapModel === null,
      noClaimInterpretation: run.explanation.explanation.claimBoundary.interpretation,
      prohibitedClaimTags: copy(
        run.explanation.explanation.claimBoundary.prohibitedClaimTags,
        'prohibited claim tags',
      ),
    },
    claimBoundary: copy(run.claimBoundary, 'run claim boundary'),
    limitations,
    admissionBoundary: {
      schemaVersion: 'engagement-route-decision-browser-admission-boundary/v1',
      proves: [
        'serialized-json-internal-consistency',
        'delivery-content-identity-match',
      ],
      doesNotProve: [
        'source-authenticity',
        'typed-recomputation',
        'performance-authority',
        'external-graph-authority',
        'product-admission',
      ],
    },
    displayModel: displayModel(
      searchTruth,
      provenance,
      limitations,
      run.presentation.schemaVersion,
    ),
  };
}

/**
 * Node/tooling producer. The full S5-A run is re-admitted and recomputed before
 * any browser projection is created; neither a digest nor a caller projection
 * can substitute for that admission.
 */
export function buildRouteDecisionBrowserDelivery(rawRun) {
  const admittedRun = admitRouteDecisionIntegrationRun(rawRun);
  unicodeScalarData(admittedRun, 'admitted RouteDecisionIntegrationRun');
  const projection = projectionFromAdmittedRun(admittedRun);
  const deliveryIdentity = contentIdentity(
    ROUTE_DECISION_BROWSER_DELIVERY_IDENTITY_VERSION,
    ROUTE_DECISION_BROWSER_DELIVERY_CANONICALIZATION,
    projection,
  );
  return deepFreeze({ ...projection, deliveryIdentity });
}

export function serializeRouteDecisionBrowserDelivery(rawRun) {
  return canonicalStringify(buildRouteDecisionBrowserDelivery(rawRun));
}
