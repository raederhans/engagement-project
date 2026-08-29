import {
  deterministicIdentity,
  stableCanonicalText,
} from './known_route_evidence_contract.js';

export const KNOWN_ROUTE_EVIDENCE_P6_SCHEMA = 'KnownRouteEvidenceProjection/v1';
export const KNOWN_ROUTE_EVIDENCE_SENSITIVITY_SCHEMA = 'KnownRouteEvidenceSensitivity/v1';
export const KNOWN_ROUTE_EVIDENCE_SCENARIO_SCHEMA = 'KnownRouteEvidenceSensitivityScenario/v1';

const CRASH_ACCESSIBILITY_SCHEMA = 'KnownRouteCrashAccessibilityEvidence/v1';
const MODE_LEGALITY_QUALITY_SCHEMA = 'KnownRouteModeLegalityQualityEvidence/v1';
const MODES = Object.freeze(['walking', 'cycling', 'driving', 'transit']);
const DIMENSION_STATUSES = Object.freeze(['available', 'admitted-zero', 'partial', 'unavailable']);
const DIMENSION_KEYS = Object.freeze([
  'status', 'sourceAsOf', 'precision', 'unavailableReason', 'summary', 'segments',
]);
const SEGMENT_CONTEXT_KEYS = Object.freeze([
  'analysisSegmentId', 'status', 'sourceAsOf', 'precision', 'unavailableReason', 'summary',
]);
const AUTHORITY_KEYS = Object.freeze([
  'accessibility', 'crash', 'mapMatch', 'mode', 'routeChoice', 'routing', 'safety',
]);
const PRIVACY_KEYS = Object.freeze([
  'containsAddresses', 'containsEventRows', 'containsGeneralizedLocations',
  'containsRawRoute', 'containsRouteCoordinates', 'containsRouteEndpoints',
  'containsSourceRecordIds',
]);
const FORBIDDEN_PRIVATE_FIELD = /"(?:address|coordinates|eventRow|eventRows|generalized_location|latitude|longitude|matchedEdges|rawRoute|routeGeometry|routeInput|source_record_id|sourceRecordId)"\s*:/i;
const FORBIDDEN_PRODUCT_CLAIM = /\b(?:rank(?:ed|ing)?|safest|winner)\b|\brecommend(?:ation|ed|ing)?\b/i;

export function createKnownRouteEvidenceP6Projection({
  aggregateReport,
  validateAggregateReport,
  crashAccessibilityEvidence,
  validateCrashAccessibilityEvidence,
  adaptCrashAccessibilityEvidence = adaptKnownRouteCrashAccessibilityEvidence,
  modeLegalityQualityEvidence,
  validateModeLegalityQualityEvidence,
  adaptModeLegalityQualityEvidence = adaptKnownRouteModeLegalityQualityEvidence,
  sensitivityScenarios = [],
} = {}) {
  const aggregate = admitWithValidator(
    aggregateReport,
    validateAggregateReport,
    'M4 aggregate report',
  );
  requireAggregateBoundary(aggregate);
  const admittedCrashAccessibility = admitWithValidator(
    crashAccessibilityEvidence,
    validateCrashAccessibilityEvidence,
    CRASH_ACCESSIBILITY_SCHEMA,
  );
  const admittedModeLegalityQuality = admitWithValidator(
    modeLegalityQualityEvidence,
    validateModeLegalityQualityEvidence,
    MODE_LEGALITY_QUALITY_SCHEMA,
  );
  const crashAccessibility = adaptEvidence(
    admittedCrashAccessibility,
    adaptCrashAccessibilityEvidence,
    CRASH_ACCESSIBILITY_SCHEMA,
  );
  const modeLegalityQuality = adaptEvidence(
    admittedModeLegalityQuality,
    adaptModeLegalityQualityEvidence,
    MODE_LEGALITY_QUALITY_SCHEMA,
  );
  requireProducerBoundary(crashAccessibility, CRASH_ACCESSIBILITY_SCHEMA, ['rawCrash', 'accessibility']);
  requireProducerBoundary(modeLegalityQuality, MODE_LEGALITY_QUALITY_SCHEMA, ['modeLegality', 'mapMatchQuality']);

  const aggregateRouteIdentity = aggregate.publicRoute.sessionIdentity;
  const corridorIdentity = aggregate.centerline.corridorIdentity;
  for (const [label, artifact] of [
    ['crash/accessibility', crashAccessibility],
    ['mode-legality/map-match', modeLegalityQuality],
  ]) {
    if (artifact.identity.corridorIdentity !== corridorIdentity
      || artifact.identity.dataVersion !== aggregate.centerline.dataVersion) {
      throw new Error(`Known Route P6 ${label} identity does not match the M4 corridor and data version.`);
    }
  }
  if (crashAccessibility.identity.routeIdentity !== modeLegalityQuality.identity.routeIdentity
    || crashAccessibility.identity.centerlineIdentity
      !== modeLegalityQuality.identity.centerlineIdentity
    || crashAccessibility.identity.dataVersion !== modeLegalityQuality.identity.dataVersion) {
    throw new Error('Known Route P6 A/B route, centerline, or data-version identity does not match.');
  }

  const identity = Object.freeze({
    routeIdentity: crashAccessibility.identity.routeIdentity,
    aggregateRouteIdentity,
    corridorIdentity,
    centerlineIdentity: crashAccessibility.identity.centerlineIdentity,
    aggregateCatalogIdentity: aggregate.centerline.catalogIdentity,
    dataVersion: aggregate.centerline.dataVersion,
    crashAccessibilityProducerIdentity: crashAccessibility.identity.producerIdentity,
    modeLegalityQualityProducerIdentity: modeLegalityQuality.identity.producerIdentity,
    aggregateSemanticIdentity: aggregate.semanticIdentity,
  });
  const reportedIncidents = projectReportedIncidents(aggregate);
  const dimensions = Object.freeze({
    generalizedReportedPpdIncidents: reportedIncidents,
    hinHistoricalPlanningContext: Object.freeze({
      status: aggregate.hin.status,
      sourceAsOf: `network-${aggregate.hin.networkVintage}; crashes-${aggregate.hin.crashDataPeriod.join('-')}`,
      precision: 'Historical planning-network context; no event-level or current-condition precision.',
      unavailableReason: null,
      summary: aggregate.hin.meaning,
      segments: Object.freeze([]),
    }),
    rawCrash: projectDimension(crashAccessibility.dimensions.rawCrash, 'raw crash'),
    accessibility: projectDimension(crashAccessibility.dimensions.accessibility, 'accessibility'),
    modeLegality: Object.freeze(Object.fromEntries(MODES.map((mode) => [
      mode,
      projectDimension(modeLegalityQuality.dimensions.modeLegality[mode], `${mode} legality`),
    ]))),
    mapMatchQuality: projectDimension(modeLegalityQuality.dimensions.mapMatchQuality, 'map-match quality'),
  });
  const baselineScenario = createKnownRouteEvidenceSensitivityScenario({
    kind: 'generalization',
    configIdentity: deterministicIdentity('known-route-existing-200m-kernel-config', {
      method: reportedIncidents.method,
    }),
    identity,
    reportedIncidentEvidence: reportedIncidents,
  });
  const projection = {
    schema: KNOWN_ROUTE_EVIDENCE_P6_SCHEMA,
    status: 'partial',
    identity,
    sourceBoundary: Object.freeze({
      aggregate: 'validated-known-route-corridor-aggregate/v2',
      crashAccessibility: CRASH_ACCESSIBILITY_SCHEMA,
      modeLegalityQuality: MODE_LEGALITY_QUALITY_SCHEMA,
    }),
    dimensions,
    sensitivity: runKnownRouteEvidenceSensitivity({
      baselineScenario,
      variants: sensitivityScenarios,
    }),
    authority: falseAuthority(),
    privacy: falsePrivacy(),
    limitations: Object.freeze([
      'The existing triangular kernel represents hundred-block generalized report points near a route.',
      'It is not raw crash evidence, an exact street-segment fact, a current-condition fact, or a route-selection basis.',
      'Every evidence dimension remains separate; no cross-dimension total is produced.',
    ]),
  };
  projection.projectionIdentity = projectionIdentity(projection);
  validateKnownRouteEvidenceP6Projection(projection);
  return deepFreeze(projection);
}

export function adaptKnownRouteCrashAccessibilityEvidence(value) {
  if (value?.schema !== CRASH_ACCESSIBILITY_SCHEMA) {
    throw new Error(`Known Route P6 adapter requires ${CRASH_ACCESSIBILITY_SCHEMA}.`);
  }
  const receipts = Array.isArray(value.source_receipts) ? value.source_receipts : [];
  const receiptFor = (role) => receipts.find((receipt) => receipt.role === role);
  const rawCrashReceipt = receiptFor('raw-crash');
  if (rawCrashReceipt?.status === 'unavailable' && value.crash?.status !== 'unavailable') {
    throw new Error('Known Route P6 refuses to promote unavailable raw crash evidence through HIN context.');
  }
  return {
    schema: value.schema,
    identity: {
      routeIdentity: value.route_identity,
      corridorIdentity: value.corridor_identity,
      centerlineIdentity: value.centerline_identity,
      dataVersion: value.data_version,
      producerIdentity: value.semantic_identity,
    },
    dimensions: {
      rawCrash: adaptCrashAccessibilityDimension(
        value.crash,
        rawCrashReceipt,
      ),
      accessibility: adaptCrashAccessibilityDimension(
        value.accessibility,
        receiptFor('accessibility'),
      ),
    },
  };
}

export function adaptKnownRouteModeLegalityQualityEvidence(value) {
  if (value?.schema !== MODE_LEGALITY_QUALITY_SCHEMA) {
    throw new Error(`Known Route P6 adapter requires ${MODE_LEGALITY_QUALITY_SCHEMA}.`);
  }
  if (value.match_quality?.match_status !== 'matched'
    && MODES.some((mode) => value.mode_legality?.[mode]?.status !== 'unavailable')) {
    throw new Error('Known Route P6 requires every mode to remain unavailable when map matching is unavailable.');
  }
  const sourceAsOf = value.match_quality?.source_version || 'unavailable';
  return {
    schema: value.schema,
    identity: {
      routeIdentity: value.route_identity,
      corridorIdentity: value.corridor_identity,
      centerlineIdentity: value.centerline_identity,
      dataVersion: value.match_quality?.source_version,
      producerIdentity: value.semantic_identity,
    },
    dimensions: {
      modeLegality: Object.fromEntries(MODES.map((mode) => {
        const entry = value.mode_legality?.[mode];
        return [mode, {
          status: entry?.status === 'available' ? 'partial' : 'unavailable',
          sourceAsOf: entry?.source_receipt?.source_version || sourceAsOf,
          precision: entry?.status === 'available'
            ? 'Version-bound aggregate mode-restriction receipt; no current-condition precision.'
            : 'Mode-restriction evidence unavailable; no legality fact is inferred.',
          unavailableReason: entry?.status === 'available' ? null : entry?.reason,
          summary: entry?.reason,
          segments: [],
        }];
      })),
      mapMatchQuality: {
        status: 'unavailable',
        sourceAsOf,
        precision: 'Bounded aggregate reference-centerline match context; uncalibrated.',
        unavailableReason: value.match_quality?.reason,
        summary: value.match_quality?.reason,
        segments: [],
      },
    },
  };
}

export function validateKnownRouteEvidenceP6Projection(value) {
  requireExactKeys(value, [
    'schema', 'status', 'identity', 'sourceBoundary', 'dimensions', 'sensitivity',
    'authority', 'privacy', 'limitations', 'projectionIdentity',
  ], 'projection');
  requireExactKeys(value.identity, [
    'routeIdentity', 'aggregateRouteIdentity', 'corridorIdentity', 'centerlineIdentity',
    'aggregateCatalogIdentity', 'dataVersion',
    'crashAccessibilityProducerIdentity',
    'modeLegalityQualityProducerIdentity', 'aggregateSemanticIdentity',
  ], 'projection identity');
  requireExactKeys(value.sourceBoundary, [
    'aggregate', 'crashAccessibility', 'modeLegalityQuality',
  ], 'source boundary');
  requireExactKeys(value.dimensions, [
    'generalizedReportedPpdIncidents', 'hinHistoricalPlanningContext', 'rawCrash',
    'accessibility', 'modeLegality', 'mapMatchQuality',
  ], 'dimensions');
  requireExactKeys(value.dimensions.modeLegality, MODES, 'mode legality');
  requireExactKeys(value.authority, AUTHORITY_KEYS, 'authority');
  requireExactKeys(value.privacy, PRIVACY_KEYS, 'privacy');
  if (value.schema !== KNOWN_ROUTE_EVIDENCE_P6_SCHEMA
    || value.status !== 'partial'
    || Object.values(value.identity).some((entry) => !identityText(entry))
    || value.sourceBoundary.aggregate !== 'validated-known-route-corridor-aggregate/v2'
    || value.sourceBoundary.crashAccessibility !== CRASH_ACCESSIBILITY_SCHEMA
    || value.sourceBoundary.modeLegalityQuality !== MODE_LEGALITY_QUALITY_SCHEMA
    || Object.values(value.authority).some((entry) => entry !== false)
    || Object.values(value.privacy).some((entry) => entry !== false)
    || !Array.isArray(value.limitations) || value.limitations.length < 3
    || value.limitations.some((entry) => !safeText(entry))
    || value.projectionIdentity !== projectionIdentity(value)) {
    throw new Error('Known Route P6 projection schema, identity, privacy, or authority is invalid.');
  }
  validateReportedIncidents(value.dimensions.generalizedReportedPpdIncidents);
  for (const dimension of [
    value.dimensions.hinHistoricalPlanningContext,
    value.dimensions.rawCrash,
    value.dimensions.accessibility,
    ...MODES.map((mode) => value.dimensions.modeLegality[mode]),
    value.dimensions.mapMatchQuality,
  ]) validateDimension(dimension);
  validateKnownRouteEvidenceSensitivity(value.sensitivity, { baselineIdentity: value.identity });
  assertSafeProjection(value);
  return value;
}

export function createKnownRouteEvidenceSensitivityScenario({
  kind,
  configIdentity,
  identity,
  reportedIncidentEvidence,
} = {}) {
  const scenario = {
    schema: KNOWN_ROUTE_EVIDENCE_SCENARIO_SCHEMA,
    kind,
    configIdentity,
    routeIdentity: identity?.routeIdentity,
    aggregateRouteIdentity: identity?.aggregateRouteIdentity,
    corridorIdentity: identity?.corridorIdentity,
    centerlineIdentity: identity?.centerlineIdentity,
    aggregateCatalogIdentity: identity?.aggregateCatalogIdentity,
    dataVersion: identity?.dataVersion,
    crashAccessibilityProducerIdentity: identity?.crashAccessibilityProducerIdentity,
    modeLegalityQualityProducerIdentity: identity?.modeLegalityQualityProducerIdentity,
    reportedIncidentEvidence: normalizeReportedIncidentEvidence(reportedIncidentEvidence),
  };
  scenario.scenarioIdentity = deterministicIdentity('known-route-sensitivity-scenario', scenario);
  validateSensitivityScenario(scenario);
  return deepFreeze(scenario);
}

export function runKnownRouteEvidenceSensitivity({ baselineScenario, variants = [] } = {}) {
  validateSensitivityScenario(baselineScenario);
  if (!Array.isArray(variants)) throw new Error('Known Route sensitivity variants must be an array.');
  if (!variants.length) return unavailableSensitivity(
    baselineScenario.scenarioIdentity,
    'No caller-provided sensitivity variants were supplied.',
  );
  const admitted = variants.map((variant) => validateSensitivityScenario(variant));
  const distinct = admitted.filter((variant) => {
    if (variant.routeIdentity !== baselineScenario.routeIdentity) {
      throw new Error('Known Route sensitivity route identity drifted.');
    }
    if (variant.scenarioIdentity === baselineScenario.scenarioIdentity
      || variant.configIdentity === baselineScenario.configIdentity) return false;
    if (variant.kind === 'generalization') {
      if (variant.corridorIdentity !== baselineScenario.corridorIdentity
        || variant.crashAccessibilityProducerIdentity !== baselineScenario.crashAccessibilityProducerIdentity
        || variant.modeLegalityQualityProducerIdentity !== baselineScenario.modeLegalityQualityProducerIdentity
        || variant.centerlineIdentity !== baselineScenario.centerlineIdentity
        || variant.aggregateCatalogIdentity !== baselineScenario.aggregateCatalogIdentity
        || variant.dataVersion !== baselineScenario.dataVersion
        || variant.aggregateRouteIdentity !== baselineScenario.aggregateRouteIdentity) {
        throw new Error('Known Route generalization scenario producer or corridor identity drifted.');
      }
    } else if (variant.corridorIdentity === baselineScenario.corridorIdentity) {
      return false;
    }
    return true;
  });
  if (!distinct.length) {
    return unavailableSensitivity(
      baselineScenario.scenarioIdentity,
      'No genuinely different, identity-valid corridor or generalization variant was supplied.',
    );
  }
  const comparisons = distinct.map((variant) => Object.freeze({
    scenarioIdentity: variant.scenarioIdentity,
    kind: variant.kind,
    configIdentity: variant.configIdentity,
    corridorIdentity: variant.corridorIdentity,
    aggregateRouteIdentity: variant.aggregateRouteIdentity,
    centerlineIdentity: variant.centerlineIdentity,
    aggregateCatalogIdentity: variant.aggregateCatalogIdentity,
    dataVersion: variant.dataVersion,
    crashAccessibilityProducerIdentity: variant.crashAccessibilityProducerIdentity,
    modeLegalityQualityProducerIdentity: variant.modeLegalityQualityProducerIdentity,
    contributionUnits: variant.reportedIncidentEvidence.route.contributionUnits,
    deltaFromBaseline: round(
      variant.reportedIncidentEvidence.route.contributionUnits
        - baselineScenario.reportedIncidentEvidence.route.contributionUnits,
      6,
    ),
  })).sort((left, right) => left.kind.localeCompare(right.kind)
    || left.configIdentity.localeCompare(right.configIdentity)
    || left.scenarioIdentity.localeCompare(right.scenarioIdentity));
  const result = {
    schema: KNOWN_ROUTE_EVIDENCE_SENSITIVITY_SCHEMA,
    status: 'available',
    reason: null,
    baselineScenarioIdentity: baselineScenario.scenarioIdentity,
    comparisons: Object.freeze(comparisons),
    authority: falseAuthority(),
  };
  result.identity = deterministicIdentity('known-route-sensitivity-result', result);
  return deepFreeze(result);
}

export function validateKnownRouteEvidenceSensitivity(value, { baselineIdentity } = {}) {
  requireExactKeys(value, [
    'schema', 'status', 'reason', 'baselineScenarioIdentity', 'comparisons', 'authority', 'identity',
  ], 'sensitivity');
  requireExactKeys(value.authority, AUTHORITY_KEYS, 'sensitivity authority');
  if (value.schema !== KNOWN_ROUTE_EVIDENCE_SENSITIVITY_SCHEMA
    || !['available', 'unavailable'].includes(value.status)
    || !identityText(value.baselineScenarioIdentity)
    || !identityText(value.identity)
    || !Array.isArray(value.comparisons)
    || Object.values(value.authority).some((entry) => entry !== false)) {
    throw new Error('Known Route sensitivity schema or authority is invalid.');
  }
  if (value.status === 'unavailable') {
    if (!safeText(value.reason) || value.comparisons.length) {
      throw new Error('Known Route unavailable sensitivity must explain why and contain no comparisons.');
    }
  } else if (value.reason !== null || !value.comparisons.length) {
    throw new Error('Known Route available sensitivity requires identity-valid comparisons.');
  }
  const sorted = [...value.comparisons].sort((left, right) => left.kind.localeCompare(right.kind)
    || left.configIdentity.localeCompare(right.configIdentity)
    || left.scenarioIdentity.localeCompare(right.scenarioIdentity));
  if (stableCanonicalText(sorted) !== stableCanonicalText(value.comparisons)) {
    throw new Error('Known Route sensitivity comparison ordering is unstable.');
  }
  for (const comparison of value.comparisons) {
    requireExactKeys(comparison, [
      'scenarioIdentity', 'kind', 'configIdentity', 'corridorIdentity',
      'aggregateRouteIdentity',
      'centerlineIdentity', 'dataVersion',
      'aggregateCatalogIdentity',
      'crashAccessibilityProducerIdentity', 'modeLegalityQualityProducerIdentity',
      'contributionUnits', 'deltaFromBaseline',
    ], 'sensitivity comparison');
    if (!['corridor', 'generalization'].includes(comparison.kind)
      || [comparison.scenarioIdentity, comparison.configIdentity, comparison.corridorIdentity,
        comparison.aggregateRouteIdentity,
        comparison.centerlineIdentity, comparison.dataVersion,
        comparison.aggregateCatalogIdentity,
        comparison.crashAccessibilityProducerIdentity,
        comparison.modeLegalityQualityProducerIdentity].some((entry) => !identityText(entry))
      || !nonnegativeNumber(comparison.contributionUnits)
      || !Number.isFinite(comparison.deltaFromBaseline)) {
      throw new Error('Known Route sensitivity comparison is invalid.');
    }
  }
  if (baselineIdentity && value.status === 'available'
    && value.comparisons.some((comparison) => comparison.kind === 'generalization'
      && (comparison.corridorIdentity !== baselineIdentity.corridorIdentity
        || comparison.aggregateRouteIdentity !== baselineIdentity.aggregateRouteIdentity
        || comparison.centerlineIdentity !== baselineIdentity.centerlineIdentity
        || comparison.aggregateCatalogIdentity !== baselineIdentity.aggregateCatalogIdentity
        || comparison.dataVersion !== baselineIdentity.dataVersion
        || comparison.crashAccessibilityProducerIdentity !== baselineIdentity.crashAccessibilityProducerIdentity
        || comparison.modeLegalityQualityProducerIdentity !== baselineIdentity.modeLegalityQualityProducerIdentity))) {
    throw new Error('Known Route sensitivity comparison drifted from baseline producer binding.');
  }
  const candidate = structuredClone(value);
  delete candidate.identity;
  if (value.identity !== deterministicIdentity('known-route-sensitivity-result', candidate)) {
    throw new Error('Known Route sensitivity identity drifted.');
  }
  assertSafeProjection(value);
  return value;
}

function projectReportedIncidents(aggregate) {
  return projectReportedIncidentInput(aggregate.reportedIncidentEvidence, {
    sourceAsOf: aggregate.warehouse.coverage.latest_event_at,
  });
}

function normalizeReportedIncidentEvidence(value) {
  if (typeof value?.method === 'string') {
    const projected = structuredClone(value);
    validateReportedIncidents(projected);
    return deepFreeze(projected);
  }
  return projectReportedIncidentInput(value);
}

function projectReportedIncidentInput(value, { sourceAsOf = value?.sourceAsOf } = {}) {
  const projected = {
    status: value?.status,
    sourceAsOf: sourceAsOf || 'unavailable',
    precision: value?.method?.precision,
    summary: 'Generalized PPD reported incidents near the analyzed route under the declared uncertainty method.',
    unavailableReason: value?.status === 'admitted-zero'
      ? 'No contribution was admitted under this complete scenario; this is not a missing-source state.'
      : null,
    method: value?.method?.contribution,
    route: {
      contributionUnits: round(value?.route?.contributionUnits, 6),
      contributingRows: value?.route?.contributingRows,
    },
    segments: (value?.segments || []).map((segment) => ({
      analysisSegmentId: segment.analysisSegmentId,
      contributionUnits: round(segment.contributionUnits, 6),
      contributingRows: segment.contributingRows,
      categories: (segment.categories || []).map((category) => ({
        category: category.category,
        contributionUnits: round(category.contributionUnits, 6),
      })).sort((left, right) => right.contributionUnits - left.contributionUnits
        || left.category.localeCompare(right.category)),
    })).sort((left, right) => left.analysisSegmentId.localeCompare(right.analysisSegmentId)),
  };
  validateReportedIncidents(projected);
  return deepFreeze(projected);
}

function validateReportedIncidents(value) {
  requireExactKeys(value, [
    'status', 'sourceAsOf', 'precision', 'summary', 'unavailableReason', 'method', 'route', 'segments',
  ], 'reported incidents');
  requireExactKeys(value.route, ['contributionUnits', 'contributingRows'], 'reported incident route');
  if (!['partial', 'admitted-zero'].includes(value.status)
    || !safeText(value.sourceAsOf) || !safeText(value.precision) || !safeText(value.summary)
    || !safeText(value.method)
    || (value.unavailableReason !== null && !safeText(value.unavailableReason))
    || !nonnegativeNumber(value.route.contributionUnits)
    || !nonnegativeInteger(value.route.contributingRows)
    || !Array.isArray(value.segments) || !value.segments.length) {
    throw new Error('Known Route reported-incident projection is invalid.');
  }
  let routeUnits = 0;
  let priorSegment = '';
  for (const segment of value.segments) {
    requireExactKeys(segment, [
      'analysisSegmentId', 'contributionUnits', 'contributingRows', 'categories',
    ], 'reported incident segment');
    if (!segmentId(segment.analysisSegmentId) || segment.analysisSegmentId <= priorSegment
      || !nonnegativeNumber(segment.contributionUnits)
      || !nonnegativeInteger(segment.contributingRows)
      || !Array.isArray(segment.categories)) {
      throw new Error('Known Route reported-incident segment is invalid or unstably ordered.');
    }
    priorSegment = segment.analysisSegmentId;
    routeUnits = round(routeUnits + segment.contributionUnits, 6);
    const categoryUnits = round(segment.categories.reduce((sum, category) => {
      requireExactKeys(category, ['category', 'contributionUnits'], 'reported incident category');
      if (!safeText(category.category) || !nonnegativeNumber(category.contributionUnits)) {
        throw new Error('Known Route reported-incident category is invalid.');
      }
      return sum + category.contributionUnits;
    }, 0), 6);
    if (categoryUnits !== segment.contributionUnits) {
      throw new Error('Known Route P6 segment/category contribution mass does not reconcile.');
    }
  }
  if (routeUnits !== value.route.contributionUnits) {
    throw new Error('Known Route P6 route/segment contribution mass does not reconcile.');
  }
  return value;
}

function projectDimension(value, label) {
  validateDimension(value, label);
  return deepFreeze({
    status: value.status,
    sourceAsOf: value.sourceAsOf,
    precision: value.precision,
    unavailableReason: value.unavailableReason,
    summary: value.summary,
    segments: [...value.segments].map((segment) => ({ ...segment }))
      .sort((left, right) => left.analysisSegmentId.localeCompare(right.analysisSegmentId)),
  });
}

function adaptCrashAccessibilityDimension(value, receipt) {
  const sourceAsOf = receipt?.clocks?.source_as_of
    || receipt?.clocks?.observed_at
    || 'unavailable';
  const precision = receipt?.precision
    ? `${receipt.precision.status}; ${receipt.precision.unit || 'unit unavailable'}`
    : 'Precision unavailable.';
  return {
    status: value?.status,
    sourceAsOf,
    precision,
    unavailableReason: value?.status === 'unavailable' ? value.reason : null,
    summary: value?.reason,
    segments: [],
  };
}

function validateDimension(value, label = 'dimension') {
  requireExactKeys(value, DIMENSION_KEYS, label);
  if (!DIMENSION_STATUSES.includes(value.status)
    || !safeText(value.sourceAsOf) || !safeText(value.precision) || !safeText(value.summary)
    || !Array.isArray(value.segments)
    || (value.status === 'unavailable' ? !safeText(value.unavailableReason) : value.unavailableReason !== null)) {
    throw new Error(`Known Route ${label} source-as-of, precision, or unavailable reason is invalid.`);
  }
  let prior = '';
  for (const segment of [...value.segments].sort((left, right) => left.analysisSegmentId.localeCompare(right.analysisSegmentId))) {
    requireExactKeys(segment, SEGMENT_CONTEXT_KEYS, `${label} segment`);
    if (!segmentId(segment.analysisSegmentId) || segment.analysisSegmentId === prior
      || !DIMENSION_STATUSES.includes(segment.status)
      || !safeText(segment.sourceAsOf) || !safeText(segment.precision) || !safeText(segment.summary)
      || (segment.status === 'unavailable' ? !safeText(segment.unavailableReason) : segment.unavailableReason !== null)) {
      throw new Error(`Known Route ${label} segment context is invalid.`);
    }
    prior = segment.analysisSegmentId;
  }
  return value;
}

function requireAggregateBoundary(value) {
  if (value?.schema !== 'known-route-corridor-aggregate/v2'
    || !identityText(value.publicRoute?.sessionIdentity)
    || !identityText(value.centerline?.corridorIdentity)
    || !identityText(value.centerline?.catalogIdentity)
    || !identityText(value.centerline?.dataVersion)
    || !identityText(value.semanticIdentity)
    || value.dimensionsCombinedIntoSafetyScore !== false) {
    throw new Error('Known Route P6 requires a validated legacy v2 aggregate with exact route and corridor identity.');
  }
  validateReportedIncidents(projectReportedIncidents(value));
  return value;
}

function requireProducerBoundary(value, schema, dimensionKeys) {
  if (value?.schema !== schema) throw new Error(`Known Route P6 requires validated ${schema}.`);
  requireExactKeys(value.identity, [
    'routeIdentity', 'corridorIdentity', 'centerlineIdentity', 'dataVersion', 'producerIdentity',
  ], `${schema} identity`);
  if (Object.values(value.identity).some((entry) => !identityText(entry))) {
    throw new Error(`Known Route P6 ${schema} identity is invalid.`);
  }
  if (!value.dimensions || dimensionKeys.some((key) => !(key in value.dimensions))) {
    throw new Error(`Known Route P6 ${schema} dimensions are unavailable.`);
  }
  if (schema === MODE_LEGALITY_QUALITY_SCHEMA) {
    requireExactKeys(value.dimensions.modeLegality, MODES, 'validated mode-legality evidence');
    for (const mode of MODES) validateDimension(value.dimensions.modeLegality[mode], `${mode} legality`);
    validateDimension(value.dimensions.mapMatchQuality, 'map-match quality');
  } else {
    validateDimension(value.dimensions.rawCrash, 'raw crash');
    validateDimension(value.dimensions.accessibility, 'accessibility');
  }
  assertSafeProjection(value.dimensions);
  return value;
}

function validateSensitivityScenario(value) {
  requireExactKeys(value, [
    'schema', 'kind', 'configIdentity', 'routeIdentity', 'corridorIdentity',
    'aggregateRouteIdentity',
    'centerlineIdentity', 'dataVersion',
    'aggregateCatalogIdentity',
    'crashAccessibilityProducerIdentity', 'modeLegalityQualityProducerIdentity',
    'reportedIncidentEvidence', 'scenarioIdentity',
  ], 'sensitivity scenario');
  const candidate = structuredClone(value);
  const declaredIdentity = candidate.scenarioIdentity;
  delete candidate.scenarioIdentity;
  if (value.schema !== KNOWN_ROUTE_EVIDENCE_SCENARIO_SCHEMA
    || !['corridor', 'generalization'].includes(value.kind)
    || [value.configIdentity, value.routeIdentity, value.corridorIdentity,
      value.aggregateRouteIdentity,
      value.centerlineIdentity, value.dataVersion,
      value.aggregateCatalogIdentity,
      value.crashAccessibilityProducerIdentity, value.modeLegalityQualityProducerIdentity]
      .some((entry) => !identityText(entry))
    || declaredIdentity !== deterministicIdentity('known-route-sensitivity-scenario', candidate)) {
    throw new Error('Known Route sensitivity scenario identity or config drifted.');
  }
  validateReportedIncidents(value.reportedIncidentEvidence);
  assertSafeProjection(value);
  return value;
}

function unavailableSensitivity(baselineScenarioIdentity, reason) {
  const result = {
    schema: KNOWN_ROUTE_EVIDENCE_SENSITIVITY_SCHEMA,
    status: 'unavailable',
    reason,
    baselineScenarioIdentity,
    comparisons: Object.freeze([]),
    authority: falseAuthority(),
  };
  result.identity = deterministicIdentity('known-route-sensitivity-result', result);
  return deepFreeze(result);
}

function admitWithValidator(value, validator, label) {
  if (typeof validator !== 'function') {
    throw new Error(`Known Route P6 ${label} requires its producer validator.`);
  }
  const validated = validator(value);
  return validated && typeof validated === 'object' ? validated : value;
}

function adaptEvidence(value, adapter, label) {
  if (typeof adapter !== 'function') {
    throw new Error(`Known Route P6 ${label} requires an explicit projection adapter.`);
  }
  return adapter(value);
}

function projectionIdentity(value) {
  const candidate = structuredClone(value);
  delete candidate.projectionIdentity;
  return deterministicIdentity('known-route-evidence-p6-projection', candidate);
}

function falseAuthority() {
  return Object.freeze(Object.fromEntries(AUTHORITY_KEYS.map((key) => [key, false])));
}

function falsePrivacy() {
  return Object.freeze(Object.fromEntries(PRIVACY_KEYS.map((key) => [key, false])));
}

function assertSafeProjection(value) {
  const text = JSON.stringify(value);
  if (FORBIDDEN_PRIVATE_FIELD.test(text)) {
    throw new Error('Known Route P6 projection contains a forbidden private or row-level field.');
  }
  if (FORBIDDEN_PRODUCT_CLAIM.test(text)) {
    throw new Error('Known Route P6 projection contains a forbidden product claim.');
  }
}

function requireExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Known Route P6 ${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Known Route P6 ${label} has an invalid closed schema.`);
  }
}

function identityText(value) {
  return typeof value === 'string' && value.length > 4 && value.length <= 200 && !/\s/.test(value);
}

function segmentId(value) {
  return typeof value === 'string' && /^segment-\d{3}$/.test(value);
}

function safeText(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 800
    && !FORBIDDEN_PRODUCT_CLAIM.test(value);
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonnegativeNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
