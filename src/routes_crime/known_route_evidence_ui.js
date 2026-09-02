import { applyTranslations, onLanguageChange, t } from '../i18n/index.js';
import { registerMessagePairs } from '../i18n/messages.js';
import {
  createKnownRouteEvidenceRequest,
  KNOWN_ROUTE_EVIDENCE_TRANSPORT_MODES,
} from './known_route_evidence_contract.js';
import {
  CENTERLINE_MATCH_CONTRACT,
  PHILADELPHIA_CENTERLINE_SOURCE,
  createCenterlineQueryDisclosure,
  matchKnownRouteToCenterline,
  requestPhiladelphiaCenterlineCatalog,
} from './known_route_centerline.js';
import {
  GENERALIZED_INCIDENT_CORRIDOR_METHOD,
  aggregateRuntimeReportedRecords,
} from './known_route_contributions.js';

const HIN_SOURCE_URL = 'https://www.phila.gov/2025-11-25-city-of-philadelphia-releases-vision-zero-action-plan-2030/';
const INCIDENT_SOURCE_URL = 'https://opendataphilly.org/datasets/crime-incidents/';
const ACCESSIBILITY_CONTEXT_URL = 'https://www.phila.gov/services/diversity-inclusion-accessibility-immigration/accessibility-services/request-a-curb-ramp/';

registerMessagePairs({
  'knownRouteEvidence.title': ['Known route evidence review', '已知路线证据查看'],
  'knownRouteEvidence.description': ['Review historical reported incidents and uncertainty near a route.', '查看路线附近的历史已报告事件和不确定性。'],
  'knownRouteEvidence.mode': ['Travel mode', '出行方式'],
  'knownRouteEvidence.walking': ['Walking', '步行'],
  'knownRouteEvidence.cycling': ['Cycling', '骑行'],
  'knownRouteEvidence.driving': ['Driving', '驾车'],
  'knownRouteEvidence.transit': ['Transit', '公共交通'],
  'knownRouteEvidence.disclosure': ['With permission, the browser makes four requests to the public street-centerline service. It sends only a route-derived bounding box expanded by 75 m and fixed geometry fields—not the route line, vertices, address, destination, Diary data, or travel mode. Nothing is saved.', '获得许可后，浏览器会分四次请求检查公共道路中心线。只发送由路线生成并外扩 75 米的边界框和固定几何字段；不发送路线折线、顶点、地址、目的地、日记数据或出行方式，也不保存信息。'],
  'knownRouteEvidence.consent': ['I allow this public street-centerline check.', '我同意进行这次公共道路中心线检查。'],
  'knownRouteEvidence.analyze': ['Analyze this known route', '分析这条已知路线'],
  'knownRouteEvidence.idle': ['Review disclosure; no request sent.', '请阅读披露；尚未发送请求。'],
  'knownRouteEvidence.pending': ['Checking the reference street centerline…', '正在检查参考道路中心线…'],
  'knownRouteEvidence.invalid': ['The route could not be verified; no request was sent.', '这条路线未能通过验证；未发送请求。'],
  'knownRouteEvidence.unavailable': ['Centerline evidence unavailable—not zero.', '道路中心线证据不可用——不是零值。'],
  'knownRouteEvidence.ready': ['Partial historical evidence with modeled uncertainty.', '带建模不确定性的部分历史证据。'],
  'knownRouteEvidence.source': ['Source', '来源'],
  'knownRouteEvidence.status': ['Status', '状态'],
  'knownRouteEvidence.asOf': ['Data as of', '数据截至'],
  'knownRouteEvidence.coverage': ['Coverage', '覆盖范围'],
  'knownRouteEvidence.precision': ['Location precision', '位置精度'],
  'knownRouteEvidence.uncertainty': ['Uncertainty / limitations', '不确定性／限制'],
  'knownRouteEvidence.unavailableReason': ['Unavailable reason', '不可用原因'],
  'knownRouteEvidence.centerlineTitle': ['Street centerline and deterministic match', '道路中心线与确定性匹配'],
  'knownRouteEvidence.centerlineCoverage': ['Published features in the 75 m envelope only.', '仅含 75 米边界内的发布要素。'],
  'knownRouteEvidence.centerlinePrecision': ['LineString; 20 m samples; 35 m admission limit.', 'LineString；20 米采样；35 米准入限值。'],
  'knownRouteEvidence.centerlineLimits': ['Reference geometry/topology only. One-way/class do not authorize walking, mode, accessibility, obstruction or routing. Drift, ambiguity, off-network or disconnect = unavailable.', '仅作参考几何／拓扑。one-way／class 不授权步行、方式、无障碍、障碍物或路由；漂移、歧义、离路或断连即不可用。'],
  'knownRouteEvidence.incidentTitle': ['Historical reported-incident contribution', '历史已记录事件贡献'],
  'knownRouteEvidence.incidentCoverage': ['Bounded admitted history; partial.', '有界准入历史；部分覆盖。'],
  'knownRouteEvidence.incidentPrecision': ['Hundred block; 200 m modeled-uncertainty kernel.', '百号街区；200 米建模不确定性核。'],
  'knownRouteEvidence.incidentLimits': ['Reported incidents; limited place/time coverage.', '已记录事件；位置／时间覆盖有限。'],
  'knownRouteEvidence.rawCrashTitle': ['Raw crash evidence', '原始事故证据'],
  'knownRouteEvidence.rawCrashLimits': ['Unavailable; no count or zero inferred.', '不可用；不推断数量或零值。'],
  'knownRouteEvidence.accessibilityTitle': ['Accessibility evidence', '无障碍证据'],
  'knownRouteEvidence.accessibilityCoverage': ['Unavailable', '不可用'],
  'knownRouteEvidence.accessibilityPrecision': ['Unavailable', '不可用'],
  'knownRouteEvidence.accessibilityLimits': ['Sidewalk, curb-ramp, wheelchair and obstruction evidence unavailable.', '人行道、缘石坡道、轮椅及障碍物证据不可用。'],
  'knownRouteEvidence.segmentTitle': ['Analysis-segment contributions', '分析区段贡献'],
  'knownRouteEvidence.segmentSummary': ['Contribution: {contribution}; rows: {rows}.', '贡献：{contribution}；行数：{rows}。'],
  'knownRouteEvidence.segmentWhy': ['Generalized reported incidents contribute through modeled uncertainty; historical evidence only.', '泛化已记录事件通过建模不确定性贡献；仅为历史证据。'],
  'knownRouteEvidence.segmentAvailability': ['Partial; not unavailable.', '部分证据；并非不可用。'],
  'knownRouteEvidence.routeAggregate': ['Route reported contribution', '路线已记录事件贡献'],
  'knownRouteEvidence.routeAggregateValue': ['{contribution} units; {rows} rows; {excluded} excluded.', '{contribution} 单位；{rows} 行；排除 {excluded} 行。'],
  // Legacy non-product test marker: No total safety score.
  'knownRouteEvidence.noCrossScore': ['Reported incidents, HIN, raw crashes and accessibility stay separate.', '已记录事件、HIN、原始事故与无障碍证据保持独立。'],
  'knownRouteEvidence.partial': ['Partial', '部分'],
  'knownRouteEvidence.unavailableValue': ['Unavailable — not zero', '不可用——不是零值'],
  'knownRouteEvidence.matched': ['Matched against the checked reference street network', '已与通过检查的参考道路网络匹配'],
  'knownRouteEvidence.reason.off-network': ['The route is too far from the checked street-centerline geometry.', '这条路线与已检查的道路中心线距离过远。'],
  'knownRouteEvidence.reason.multiple-candidate-ambiguity': ['Two or more centerline candidates cannot be distinguished reliably.', '两个或更多道路中心线候选无法可靠区分。'],
  'knownRouteEvidence.reason.disconnected-centerline-chain': ['The selected centerline edges do not form a connected node chain.', '所选道路中心线边无法形成连通节点链。'],
  'knownRouteEvidence.reason.matching-complexity-limit': ['The bounded matching complexity limit was reached.', '已达到有界匹配复杂度限制。'],
  'knownRouteEvidence.reason.source-drift': ['Centerline metadata, fields, count or features changed during the transaction.', '道路中心线元数据、字段、计数或要素在事务期间发生变化。'],
  'knownRouteEvidence.reason.source-timeout': ['The public centerline transaction timed out.', '公共道路中心线事务超时。'],
  'knownRouteEvidence.reason.source-network': ['The public centerline network request failed.', '公共道路中心线网络请求失败。'],
  'knownRouteEvidence.reason.consent-required': ['External centerline consent was not granted.', '未授权外部道路中心线请求。'],
  'knownRouteEvidence.reason.source': ['The official centerline response or data format did not pass validation.', '官方道路中心线响应或数据格式未通过验证。'],
  'knownRouteEvidence.p6Boundary': ['Reported incidents, HIN history, crashes, accessibility, travel-mode rules, and map-match quality are shown separately.', '已报告事件、HIN 历史、事故、无障碍、出行方式规则和地图匹配质量分开显示。'],
  'knownRouteEvidence.hinPlanningTitle': ['HIN historical planning context', 'HIN 历史规划背景'],
  'knownRouteEvidence.modeLegalityTitle': ['{mode} legality context', '{mode} 合法性背景'],
  'knownRouteEvidence.mapMatchQualityTitle': ['Map-match quality context', '地图匹配质量背景'],
  'knownRouteEvidence.sensitivityTitle': ['Explicit scenario sensitivity', '显式场景敏感性'],
  'knownRouteEvidence.sensitivityUnavailable': ['Unavailable — {reason}', '不可用——{reason}'],
  'knownRouteEvidence.sensitivityAvailable': ['{count} caller-provided identity-valid comparison(s). Deltas apply only to generalized reported-incident contribution units.', '{count} 个由调用方提供且 identity 有效的比较；差值仅适用于泛化已记录事件贡献单位。'],
  'knownRouteEvidence.availableAggregate': ['Available aggregate context', '可用的聚合背景'],
  'knownRouteEvidence.admittedZero': ['Verified zero under complete coverage', '在完整覆盖并通过验证后为零'],
  'knownRouteEvidence.p6Missing': ['No matching supporting dataset was supplied for this route and data version.', '没有提供与这条路线和数据版本匹配的支持数据。'],
  'knownRouteEvidence.p6Invalid': ['The supporting dataset was invalid or did not match this route and data version.', '支持数据无效，或与这条路线及数据版本不匹配。'],
  'knownRouteEvidence.hinHistoricalStatus': ['Partial historical planning context', '部分历史规划背景'],
  'knownRouteEvidence.hinHistoricalSummary': ['HIN 2025 is historical planning context, not a raw crash warehouse or current route condition.', 'HIN 2025 仅为历史规划背景，不是原始事故仓库或当前路线状况。'],
  'knownRouteEvidence.modeLegalityUnavailable': ['No complete, version-matched travel-mode restriction source is available.', '没有完整且版本匹配的出行方式限制数据源。'],
  'knownRouteEvidence.mapMatchQualityUnavailable': ['The deterministic reference match is uncalibrated; repeatability is not correctness.', '确定性的参考匹配尚未校准；可重复不等于正确。'],
  'knownRouteEvidence.sensitivityProducerUnavailable': ['No validated, versioned source covers corridor or location-generalization sensitivity.', '没有经过验证且带版本的路线范围或位置泛化敏感性数据源。'],
});

export function initKnownRouteEvidenceUi({
  root,
  requestCatalog = requestPhiladelphiaCenterlineCatalog,
  matchRoute = matchKnownRouteToCenterline,
  aggregateIncidents = aggregateRuntimeReportedRecords,
  loadP6Projection = () => null,
} = {}) {
  if (!root?.querySelector || typeof requestCatalog !== 'function'
    || typeof loadP6Projection !== 'function') {
    throw new Error('Known Route evidence UI requires a root and request port.');
  }
  root.innerHTML = surfaceHtml();
  applyTranslations(root);
  const documentRef = root.ownerDocument || document;
  const mode = root.querySelector('[data-known-route-mode]');
  const consent = root.querySelector('[data-known-route-consent]');
  const submit = root.querySelector('[data-known-route-analyze]');
  const status = root.querySelector('[data-known-route-evidence-status]');
  const results = root.querySelector('[data-known-route-evidence-results]');
  let generation = 0;
  let controller = null;
  let prepared = null;
  let lastPresentation = { status: 'idle' };

  const render = (presentation) => {
    lastPresentation = presentation;
    root.dataset.knownRouteEvidenceStatus = presentation.status;
    status.textContent = t(`knownRouteEvidence.${presentation.status}`);
    results.replaceChildren();
    if (presentation.status === 'ready') renderReady(documentRef, results, presentation);
    if (presentation.status === 'unavailable') renderUnavailable(documentRef, results, presentation.reason);
  };

  const clear = () => {
    generation += 1;
    controller?.abort();
    controller = null;
    prepared = null;
    consent.checked = false;
    submit.disabled = true;
    render({ status: 'idle' });
  };

  const onConsent = () => { submit.disabled = !prepared || !consent.checked; };
  const onSubmit = async () => {
    if (!prepared || !consent.checked) return;
    const requestGeneration = ++generation;
    controller?.abort();
    controller = new AbortController();
    render({ status: 'pending' });
    let normalizedRoute;
    try {
      normalizedRoute = createKnownRouteEvidenceRequest({
        routeInput: prepared.routeInput,
        transportMode: mode.value,
      });
    } catch {
      if (requestGeneration === generation) {
        controller = null;
        render({ status: 'invalid' });
      }
      return;
    }
    try {
      const catalog = await requestCatalog({
        normalizedRoute,
        consent: { publicCenterlineRequest: true },
        signal: controller.signal,
      });
      if (requestGeneration !== generation) return;
      if (catalog?.status === 'unavailable') {
        controller = null;
        render({ status: 'unavailable', reason: catalog.reason });
        return;
      }
      const matched = matchRoute({ normalizedRoute, catalog });
      if (matched.status !== 'matched') {
        controller = null;
        render({ status: 'unavailable', reason: matched.reason });
        return;
      }
      const incidents = aggregateIncidents({
        matches: prepared.incidentResult?.matches || [],
        matchedEdges: matched.matchedEdges,
      });
      let p6Projection = null;
      let p6Renderer = null;
      let p6UnavailableReason = 'missing';
      try {
        const candidate = await loadP6Projection({
          routeIdentity: normalizedRoute.sessionRouteIdentity,
          corridorIdentity: matched.corridorIdentity,
          dataVersion: matched.dataVersion,
        });
        if (requestGeneration !== generation) return;
        if (candidate !== null && candidate !== undefined) {
          const {
            renderKnownRouteEvidenceP6Projection,
            validateKnownRouteEvidenceP6Projection,
          } = await import(
            './known_route_evidence_p6_presenter.js'
          );
          if (requestGeneration !== generation) return;
          validateKnownRouteEvidenceP6Projection(candidate);
          if (candidate.identity.routeIdentity !== normalizedRoute.sessionRouteIdentity
            || candidate.identity.corridorIdentity !== matched.corridorIdentity
            || candidate.identity.dataVersion !== matched.dataVersion) {
            throw new Error('Known Route P6 session identity mismatch.');
          }
          p6Projection = candidate;
          p6Renderer = renderKnownRouteEvidenceP6Projection;
        }
      } catch {
        if (requestGeneration !== generation) return;
        p6Projection = null;
        p6Renderer = null;
        p6UnavailableReason = 'invalid';
      }
      if (requestGeneration !== generation) return;
      controller = null;
      render({
        status: 'ready',
        matched,
        incidents,
        incidentResult: prepared.incidentResult,
        p6Projection,
        p6Renderer,
        p6UnavailableReason,
      });
    } catch (error) {
      if (requestGeneration !== generation || error?.name === 'AbortError') return;
      controller = null;
      render({ status: 'unavailable', reason: 'source' });
    }
  };

  consent.addEventListener('change', onConsent);
  submit.addEventListener('click', onSubmit);
  const releaseLanguage = onLanguageChange(() => {
    applyTranslations(root);
    render(lastPresentation);
  });
  render({ status: 'idle' });

  return {
    prepare(options = {}) {
      generation += 1;
      controller?.abort();
      controller = null;
      prepared = options?.routeInput ? {
        routeInput: options.routeInput,
        incidentResult: options.incidentResult || { status: 'source-failure' },
      } : null;
      consent.checked = false;
      submit.disabled = true;
      render({ status: 'idle' });
    },
    clear,
    dispose() {
      clear();
      releaseLanguage();
      consent.removeEventListener('change', onConsent);
      submit.removeEventListener('click', onSubmit);
      root.replaceChildren();
    },
  };
}

function surfaceHtml() {
  const disclosure = createCenterlineQueryDisclosure();
  return `<h3 id="known-route-evidence-title" data-i18n="knownRouteEvidence.title">${t('knownRouteEvidence.title')}</h3>
    <p data-i18n="knownRouteEvidence.description">${t('knownRouteEvidence.description')}</p>
    <label><span data-i18n="knownRouteEvidence.mode">${t('knownRouteEvidence.mode')}</span>
      <select class="field" data-known-route-mode>${KNOWN_ROUTE_EVIDENCE_TRANSPORT_MODES.map((value) => `<option value="${value}" data-i18n="knownRouteEvidence.${value}">${t(`knownRouteEvidence.${value}`)}</option>`).join('')}</select>
    </label>
    <p class="route-corridor__disclosure" data-i18n="knownRouteEvidence.disclosure">${t('knownRouteEvidence.disclosure')}</p>
    <p><a href="${disclosure.endpoint}" target="_blank" rel="noopener noreferrer">${disclosure.endpoint}</a></p>
    <label><input data-known-route-consent="publicCenterlineRequest" type="checkbox"> <span data-i18n="knownRouteEvidence.consent">${t('knownRouteEvidence.consent')}</span></label>
    <p><button class="button button--primary" data-known-route-analyze data-i18n="knownRouteEvidence.analyze" type="button" disabled>${t('knownRouteEvidence.analyze')}</button></p>
    <p data-known-route-evidence-status role="status" aria-live="polite" aria-atomic="true"></p>
    <div data-known-route-evidence-results></div>`;
}

function renderReady(documentRef, root, presentation) {
  const {
    matched, incidents, incidentResult, p6Projection, p6Renderer, p6UnavailableReason,
  } = presentation;
  root.append(
    sourceCard(documentRef, {
      title: t('knownRouteEvidence.centerlineTitle'),
      href: PHILADELPHIA_CENTERLINE_SOURCE.catalogUrl,
      status: t('knownRouteEvidence.matched'),
      asOf: matched.sourceAsOf,
      coverage: t('knownRouteEvidence.centerlineCoverage'),
      precision: t('knownRouteEvidence.centerlinePrecision'),
      uncertainty: t('knownRouteEvidence.centerlineLimits'),
    }),
    sourceCard(documentRef, {
      title: t('knownRouteEvidence.incidentTitle'),
      href: INCIDENT_SOURCE_URL,
      status: t('knownRouteEvidence.partial'),
      asOf: incidentResult?.coverage?.availableEndExclusive || '—',
      coverage: t('knownRouteEvidence.incidentCoverage'),
      precision: t('knownRouteEvidence.incidentPrecision'),
      uncertainty: t('knownRouteEvidence.incidentLimits'),
    }),
    sourceCard(documentRef, {
      title: t('knownRouteEvidence.rawCrashTitle'),
      href: HIN_SOURCE_URL,
      status: t('knownRouteEvidence.unavailableValue'),
      asOf: '—',
      coverage: t('knownRouteEvidence.unavailableValue'),
      precision: t('knownRouteEvidence.unavailableValue'),
      uncertainty: t('knownRouteEvidence.rawCrashLimits'),
      unavailableReason: t('knownRouteEvidence.rawCrashLimits'),
    }),
    sourceCard(documentRef, {
      title: t('knownRouteEvidence.accessibilityTitle'),
      href: ACCESSIBILITY_CONTEXT_URL,
      status: t('knownRouteEvidence.unavailableValue'),
      asOf: '—',
      coverage: t('knownRouteEvidence.accessibilityCoverage'),
      precision: t('knownRouteEvidence.accessibilityPrecision'),
      uncertainty: t('knownRouteEvidence.accessibilityLimits'),
      unavailableReason: t('knownRouteEvidence.accessibilityLimits'),
    }),
  );
  const p6 = documentRef.createElement('section');
  p6.dataset.knownRouteP6 = p6Projection ? 'partial' : 'unavailable';
  if (p6Projection) {
    p6Renderer({
      documentRef,
      root: p6,
      projection: p6Projection,
      renderSourceCard: sourceCard,
      sources: {
        accessibility: ACCESSIBILITY_CONTEXT_URL,
        centerline: PHILADELPHIA_CENTERLINE_SOURCE.catalogUrl,
        hin: HIN_SOURCE_URL,
        incident: INCIDENT_SOURCE_URL,
      },
      translate: t,
    });
  } else {
    renderKnownRouteEvidenceP6Unavailable({
      documentRef,
      root: p6,
      reason: p6UnavailableReason,
    });
  }
  root.append(p6);
  const aggregate = documentRef.createElement('section');
  const aggregateTitle = documentRef.createElement('h4');
  aggregateTitle.textContent = t('knownRouteEvidence.routeAggregate');
  const aggregateValue = documentRef.createElement('p');
  aggregateValue.textContent = t('knownRouteEvidence.routeAggregateValue', {
    contribution: incidents.route.contributionUnits,
    rows: incidents.route.contributingRows,
    excluded: Object.values(incidents.excluded).reduce((sum, value) => sum + value, 0),
  });
  const noScore = documentRef.createElement('p');
  noScore.className = 'route-corridor__truth';
  noScore.textContent = t('knownRouteEvidence.noCrossScore');
  aggregate.append(aggregateTitle, aggregateValue, noScore);
  root.append(aggregate);

  const segments = documentRef.createElement('section');
  const title = documentRef.createElement('h4');
  title.textContent = t('knownRouteEvidence.segmentTitle');
  const list = documentRef.createElement('ol');
  for (const segment of incidents.segments) {
    const item = documentRef.createElement('li');
    const heading = documentRef.createElement('strong');
    const centerlineLink = sourceLink(documentRef, PHILADELPHIA_CENTERLINE_SOURCE.catalogUrl, segment.streetLabel);
    heading.append(centerlineLink);
    const summary = documentRef.createElement('p');
    summary.textContent = t('knownRouteEvidence.segmentSummary', {
      contribution: segment.contributionUnits,
      rows: segment.contributingRows,
    });
    const why = documentRef.createElement('p');
    why.textContent = t('knownRouteEvidence.segmentWhy');
    const provenance = evidenceDetails(documentRef, [
      [t('knownRouteEvidence.source'), sourceLink(documentRef, INCIDENT_SOURCE_URL, 'Philadelphia Crime Incidents')],
      [t('knownRouteEvidence.asOf'), incidentResult?.coverage?.availableEndExclusive || '—'],
      [t('knownRouteEvidence.coverage'), t('knownRouteEvidence.incidentCoverage')],
      [t('knownRouteEvidence.precision'), GENERALIZED_INCIDENT_CORRIDOR_METHOD.precision],
      [t('knownRouteEvidence.uncertainty'), GENERALIZED_INCIDENT_CORRIDOR_METHOD.contribution],
      [t('knownRouteEvidence.unavailableReason'), t('knownRouteEvidence.segmentAvailability')],
    ]);
    item.append(heading, summary, why, provenance);
    list.append(item);
  }
  segments.append(title, list);
  root.append(segments);
}

function renderUnavailable(documentRef, root, reason) {
  root.append(sourceCard(documentRef, {
    title: t('knownRouteEvidence.centerlineTitle'),
    href: PHILADELPHIA_CENTERLINE_SOURCE.catalogUrl,
    status: t('knownRouteEvidence.unavailableValue'),
    asOf: '—',
    coverage: t('knownRouteEvidence.centerlineCoverage'),
    precision: `${t('knownRouteEvidence.centerlinePrecision')} (${CENTERLINE_MATCH_CONTRACT.maximumOffNetworkDistanceM} m)`,
    uncertainty: t('knownRouteEvidence.centerlineLimits'),
    unavailableReason: t(`knownRouteEvidence.reason.${reason}`) === `knownRouteEvidence.reason.${reason}`
      ? t('knownRouteEvidence.reason.source') : t(`knownRouteEvidence.reason.${reason}`),
  }));
}

function renderKnownRouteEvidenceP6Unavailable({ documentRef, root, reason = 'missing' } = {}) {
  if (!documentRef?.createElement || !root?.append || !['missing', 'invalid'].includes(reason)) {
    throw new Error('Known Route P6 unavailable renderer requires a document, root, and bounded reason.');
  }
  const boundary = documentRef.createElement('p');
  boundary.className = 'route-corridor__truth';
  boundary.textContent = t('knownRouteEvidence.p6Boundary');
  root.append(boundary);
  root.append(sourceCard(documentRef, {
    title: t('knownRouteEvidence.hinPlanningTitle'),
    href: HIN_SOURCE_URL,
    status: t('knownRouteEvidence.hinHistoricalStatus'),
    asOf: 'network-2025; crashes-2019-2023',
    coverage: t('knownRouteEvidence.hinHistoricalSummary'),
    precision: t('knownRouteEvidence.hinHistoricalSummary'),
    uncertainty: t('knownRouteEvidence.hinHistoricalSummary'),
  }));
  for (const mode of KNOWN_ROUTE_EVIDENCE_TRANSPORT_MODES) {
    root.append(sourceCard(documentRef, {
      title: t('knownRouteEvidence.modeLegalityTitle', { mode: t(`knownRouteEvidence.${mode}`) }),
      href: PHILADELPHIA_CENTERLINE_SOURCE.catalogUrl,
      status: t('knownRouteEvidence.unavailableValue'),
      asOf: '—',
      coverage: t('knownRouteEvidence.unavailableValue'),
      precision: t('knownRouteEvidence.unavailableValue'),
      uncertainty: t('knownRouteEvidence.modeLegalityUnavailable'),
      unavailableReason: t('knownRouteEvidence.modeLegalityUnavailable'),
    }));
  }
  root.append(sourceCard(documentRef, {
    title: t('knownRouteEvidence.mapMatchQualityTitle'),
    href: PHILADELPHIA_CENTERLINE_SOURCE.catalogUrl,
    status: t('knownRouteEvidence.unavailableValue'),
    asOf: '—',
    coverage: t('knownRouteEvidence.unavailableValue'),
    precision: t('knownRouteEvidence.mapMatchQualityUnavailable'),
    uncertainty: t('knownRouteEvidence.mapMatchQualityUnavailable'),
    unavailableReason: t('knownRouteEvidence.mapMatchQualityUnavailable'),
  }));
  const sensitivity = documentRef.createElement('section');
  const heading = documentRef.createElement('h4');
  heading.textContent = t('knownRouteEvidence.sensitivityTitle');
  const summary = documentRef.createElement('p');
  summary.textContent = `${t(`knownRouteEvidence.p6${reason === 'invalid' ? 'Invalid' : 'Missing'}`)} ${t('knownRouteEvidence.sensitivityProducerUnavailable')}`;
  sensitivity.append(heading, summary);
  root.append(sensitivity);
  return root;
}

function sourceCard(documentRef, {
  title, href, status, asOf, coverage, precision, uncertainty, unavailableReason = null,
}) {
  const section = documentRef.createElement('section');
  const heading = documentRef.createElement('h4');
  if (href) heading.append(sourceLink(documentRef, href, title));
  else heading.textContent = title;
  const rows = [
    [t('knownRouteEvidence.status'), status],
    [t('knownRouteEvidence.asOf'), asOf],
    [t('knownRouteEvidence.coverage'), coverage],
    [t('knownRouteEvidence.precision'), precision],
    [t('knownRouteEvidence.uncertainty'), uncertainty],
    ...(unavailableReason ? [[t('knownRouteEvidence.unavailableReason'), unavailableReason]] : []),
  ];
  section.append(heading, evidenceDetails(documentRef, rows));
  return section;
}

function evidenceDetails(documentRef, rows) {
  const list = documentRef.createElement('dl');
  list.dataset.knownRouteEvidenceDetails = '';
  for (const [label, value] of rows) {
    const group = documentRef.createElement('div');
    const term = documentRef.createElement('dt');
    const detail = documentRef.createElement('dd');
    term.textContent = label;
    if (value?.nodeType) detail.append(value);
    else detail.textContent = value || '—';
    group.append(term, detail);
    list.append(group);
  }
  return list;
}

function sourceLink(documentRef, href, label) {
  const link = documentRef.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  return link;
}
