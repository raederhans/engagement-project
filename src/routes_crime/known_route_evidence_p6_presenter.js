import { validateKnownRouteEvidenceP6Projection } from './known_route_evidence_p6_projection.js';

export { validateKnownRouteEvidenceP6Projection };

export function renderKnownRouteEvidenceP6Projection({
  documentRef,
  root,
  projection,
  renderSourceCard,
  sources,
  translate,
} = {}) {
  if (!documentRef?.createElement || !root?.append
    || typeof renderSourceCard !== 'function' || typeof translate !== 'function'
    || !sources || typeof sources !== 'object') {
    throw new Error('Known Route P6 renderer requires bounded presentation ports.');
  }
  const boundary = documentRef.createElement('p');
  boundary.className = 'route-corridor__truth';
  boundary.textContent = translate('knownRouteEvidence.p6Boundary');
  root.append(boundary);

  const cards = [
    [translate('knownRouteEvidence.incidentTitle'), sources.incident,
      projection.dimensions.generalizedReportedPpdIncidents],
    [translate('knownRouteEvidence.hinPlanningTitle'), sources.hin,
      projection.dimensions.hinHistoricalPlanningContext],
    [translate('knownRouteEvidence.rawCrashTitle'), null, projection.dimensions.rawCrash],
    [translate('knownRouteEvidence.accessibilityTitle'), sources.accessibility,
      projection.dimensions.accessibility],
    ...Object.entries(projection.dimensions.modeLegality).map(([mode, dimension]) => [
      translate('knownRouteEvidence.modeLegalityTitle', {
        mode: translate(`knownRouteEvidence.${mode}`),
      }),
      sources.centerline,
      dimension,
    ]),
    [translate('knownRouteEvidence.mapMatchQualityTitle'), sources.centerline,
      projection.dimensions.mapMatchQuality],
  ];
  for (const [title, href, dimension] of cards) {
    root.append(renderSourceCard(documentRef, {
      title,
      href,
      status: p6StatusLabel(dimension.status, translate),
      asOf: dimension.sourceAsOf,
      coverage: dimension.summary,
      precision: dimension.precision,
      uncertainty: dimension.summary,
      unavailableReason: dimension.unavailableReason,
    }));
  }

  const sensitivity = documentRef.createElement('section');
  const heading = documentRef.createElement('h4');
  heading.textContent = translate('knownRouteEvidence.sensitivityTitle');
  const summary = documentRef.createElement('p');
  summary.textContent = projection.sensitivity.status === 'unavailable'
    ? translate('knownRouteEvidence.sensitivityUnavailable', {
      reason: projection.sensitivity.reason,
    })
    : translate('knownRouteEvidence.sensitivityAvailable', {
      count: projection.sensitivity.comparisons.length,
    });
  sensitivity.append(heading, summary);
  root.append(sensitivity);
  return root;
}

function p6StatusLabel(status, translate) {
  if (status === 'unavailable') return translate('knownRouteEvidence.unavailableValue');
  if (status === 'admitted-zero') return translate('knownRouteEvidence.admittedZero');
  if (status === 'available') return translate('knownRouteEvidence.availableAggregate');
  return translate('knownRouteEvidence.partial');
}
