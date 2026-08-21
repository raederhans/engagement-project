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
  'knownRouteEvidence.title': ['Known Route evidence', '已知路线证据'],
  'knownRouteEvidence.description': ['Analyze the route you supplied against historical reported-incident, crash/HIN, and accessibility evidence. This does not generate or recommend a route.', '使用历史已记录事件、事故／HIN 与无障碍证据分析你提供的路线。此功能不会生成或推荐路线。'],
  'knownRouteEvidence.mode': ['Transport mode label', '出行方式标签'],
  'knownRouteEvidence.walking': ['Walking', '步行'],
  'knownRouteEvidence.cycling': ['Cycling', '骑行'],
  'knownRouteEvidence.driving': ['Driving', '驾车'],
  'knownRouteEvidence.transit': ['Transit', '公共交通'],
  'knownRouteEvidence.disclosure': ['Before the request: the official City Street Centerline endpoint receives a POST containing an exact route-derived bounding box expanded by 75 m, EPSG:4326, fixed field names, and returnGeometry=true. It does not receive the route polyline, vertices, addresses, destination, route name, Diary data, or transport mode. The route and response stay in this browser session.', '发送前说明：费城市官方 Street Centerline 端点将收到一个 POST 请求，其中包含由路线精确推导并向外扩展 75 米的边界框、EPSG:4326、固定字段名及 returnGeometry=true。不会发送路线折线、顶点、地址、目的地、路线名称、Diary 数据或出行方式。路线及响应仅保留在本次浏览器会话。'],
  'knownRouteEvidence.consent': ['I understand these exact fields and authorize this one public centerline request.', '我了解上述精确字段，并授权本次公共道路中心线请求。'],
  'knownRouteEvidence.analyze': ['Analyze this known route', '分析这条已知路线'],
  'knownRouteEvidence.idle': ['Choose a mode and review the disclosure. No centerline request has been made.', '请选择出行方式并阅读披露说明。目前尚未发送道路中心线请求。'],
  'knownRouteEvidence.pending': ['Validating and matching the supplied route against the official centerline…', '正在验证路线并与官方道路中心线匹配…'],
  'knownRouteEvidence.invalid': ['The supplied route is outside the strict M4 admission contract. No centerline request was made.', '所提供路线不符合 M4 严格准入合同；未发送道路中心线请求。'],
  'knownRouteEvidence.unavailable': ['Reliable centerline matching is unavailable for this route. This is not a zero result.', '无法为这条路线建立可靠的道路中心线匹配；这不是零结果。'],
  'knownRouteEvidence.ready': ['Route evidence is available with partial sources and disclosed uncertainty.', '路线证据已生成；来源为 partial，并明确披露不确定性。'],
  'knownRouteEvidence.source': ['Source', '来源'],
  'knownRouteEvidence.status': ['Status', '状态'],
  'knownRouteEvidence.asOf': ['Data as of', '数据截至'],
  'knownRouteEvidence.coverage': ['Coverage', '覆盖范围'],
  'knownRouteEvidence.precision': ['Location precision', '位置精度'],
  'knownRouteEvidence.uncertainty': ['Uncertainty / limitations', '不确定性／限制'],
  'knownRouteEvidence.unavailableReason': ['Unavailable reason', '不可用原因'],
  'knownRouteEvidence.centerlineTitle': ['Street centerline and deterministic match', '道路中心线与确定性匹配'],
  'knownRouteEvidence.centerlineCoverage': ['City-published features returned only for the route-derived 75 m query envelope.', '仅包含路线推导的 75 米查询边界内返回的市政府发布要素。'],
  'knownRouteEvidence.centerlinePrecision': ['Published LineString centerline geometry; match samples every 20 m, maximum admitted distance 35 m.', '发布的 LineString 道路中心线；每 20 米采样匹配，最大准入距离 35 米。'],
  'knownRouteEvidence.centerlineLimits': ['Reference topology only; no mode-legality or accessibility authority. Undocumented one-way values are not used. Ambiguous, off-network, and disconnected matches fail closed.', '仅作参考拓扑，不具备出行合法性或无障碍 authority；不使用无编码域的 one-way 值。多候选、离路及断连匹配均 fail closed。'],
  'knownRouteEvidence.incidentTitle': ['Historical reported-incident contribution', '历史已记录事件贡献'],
  'knownRouteEvidence.incidentCoverage': ['The currently admitted historical query and filters; runtime evidence is bounded and therefore partial, not a full-warehouse claim.', '当前已准入的历史查询与筛选；runtime 证据为有界查询，因此是 partial，不代表完整 warehouse。'],
  'knownRouteEvidence.incidentPrecision': ['Source locations are generalized to the hundred block and are treated with a disclosed 200 m uncertainty kernel.', '来源位置已泛化到百号街区，并使用公开的 200 米不确定性核。'],
  'knownRouteEvidence.incidentLimits': ['Modeled/reported exposure only: no precise sidewalk or segment location, safety/danger finding, causation, or personal probability.', '仅为 modeled/reported exposure：不表示精确人行道或街段位置，也不构成安全／危险、因果或个人概率结论。'],
  'knownRouteEvidence.hinTitle': ['Crash / HIN context', '事故／HIN 上下文'],
  'knownRouteEvidence.hinCoverage': ['HIN 2025 planning network based on 2019–2023 crash data; the separate HIN card above performs the local versioned route association.', '基于 2019–2023 年事故数据的 HIN 2025 规划网络；上方独立 HIN 卡执行本地版本化路线关联。'],
  'knownRouteEvidence.hinPrecision': ['Published HIN planning geometry, not individual crash locations.', '发布的 HIN 规划几何，不是单次事故位置。'],
  'knownRouteEvidence.hinLimits': ['Partial historical planning context only. Raw crash evidence is unavailable in this workflow, so no crash count or zero is inferred.', '仅为 partial 历史规划上下文。本 workflow 中 raw crash 证据 unavailable，因此不会推断事故数量或零值。'],
  'knownRouteEvidence.accessibilityTitle': ['Accessibility evidence', '无障碍证据'],
  'knownRouteEvidence.accessibilityCoverage': ['Unavailable', '不可用'],
  'knownRouteEvidence.accessibilityPrecision': ['Unavailable', '不可用'],
  'knownRouteEvidence.accessibilityLimits': ['No reviewed citywide source proves sidewalk continuity, curb-ramp access, wheelchair passability, or obstructions.', '尚无经审查的全市来源可证明人行道连续性、缘石坡道、轮椅通行或障碍物。'],
  'knownRouteEvidence.segmentTitle': ['Analysis-segment contributions', '分析区段贡献'],
  'knownRouteEvidence.segmentSummary': ['Reported contribution: {contribution}; contributing generalized rows: {rows}.', '已记录事件贡献：{contribution}；参与贡献的泛化记录行：{rows}。'],
  'knownRouteEvidence.segmentWhy': ['Why: nearby generalized source rows contribute through the disclosed uncertainty kernel. More or less contribution is not a safe/dangerous street judgment.', '原因：附近的泛化来源记录通过已披露的不确定性核贡献。贡献较多或较少并不表示街段安全或危险。'],
  'knownRouteEvidence.segmentAvailability': ['Not unavailable: this is partial evidence with the stated coverage and uncertainty.', '并非 unavailable：这是具有上述覆盖范围和不确定性的 partial 证据。'],
  'knownRouteEvidence.routeAggregate': ['Route reported contribution', '路线已记录事件贡献'],
  'knownRouteEvidence.routeAggregateValue': ['{contribution} additive contribution units from {rows} generalized rows; {excluded} rows excluded.', '{contribution} 个可加总贡献单位，来自 {rows} 条泛化记录；排除 {excluded} 条。'],
  'knownRouteEvidence.noCrossScore': ['No total safety score: reported-incident contributions, HIN context, raw crashes, and accessibility remain separate because their sources and units are not interchangeable.', '不提供总体安全分数：已记录事件贡献、HIN 上下文、raw crash 与无障碍证据保持独立，因为来源和量纲不可互换。'],
  'knownRouteEvidence.partial': ['Partial', 'Partial'],
  'knownRouteEvidence.unavailableValue': ['Unavailable — not zero', 'Unavailable——不是零值'],
  'knownRouteEvidence.matched': ['Matched under strict reference-topology contract', '已按严格参考拓扑合同匹配'],
  'knownRouteEvidence.reason.off-network': ['Route samples are too far from admitted centerline geometry.', '路线采样点距准入道路中心线过远。'],
  'knownRouteEvidence.reason.multiple-candidate-ambiguity': ['Two or more centerline candidates cannot be distinguished reliably.', '两个或更多道路中心线候选无法可靠区分。'],
  'knownRouteEvidence.reason.disconnected-centerline-chain': ['The selected centerline edges do not form a connected node chain.', '所选道路中心线边无法形成连通节点链。'],
  'knownRouteEvidence.reason.consent-required': ['External centerline consent was not granted.', '未授权外部道路中心线请求。'],
  'knownRouteEvidence.reason.source': ['Official centerline response or schema could not be admitted.', '官方道路中心线响应或 schema 无法准入。'],
  'knownRouteEvidence.rawCrashUnavailable': ['Raw official crash records were not acquired and validated for this milestone.', '本 milestone 未取得并验证官方 raw crash 记录。'],
});

export function initKnownRouteEvidenceUi({
  root,
  requestCatalog = requestPhiladelphiaCenterlineCatalog,
  matchRoute = matchKnownRouteToCenterline,
  aggregateIncidents = aggregateRuntimeReportedRecords,
} = {}) {
  if (!root?.querySelector || typeof requestCatalog !== 'function') {
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
        consent: true,
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
      controller = null;
      render({ status: 'ready', matched, incidents, incidentResult: prepared.incidentResult });
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
    <label><input data-known-route-consent type="checkbox"> <span data-i18n="knownRouteEvidence.consent">${t('knownRouteEvidence.consent')}</span></label>
    <p><button class="button button--primary" data-known-route-analyze data-i18n="knownRouteEvidence.analyze" type="button" disabled>${t('knownRouteEvidence.analyze')}</button></p>
    <p data-known-route-evidence-status role="status" aria-live="polite" aria-atomic="true"></p>
    <div data-known-route-evidence-results></div>`;
}

function renderReady(documentRef, root, presentation) {
  const { matched, incidents, incidentResult } = presentation;
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
      title: t('knownRouteEvidence.hinTitle'),
      href: HIN_SOURCE_URL,
      status: t('knownRouteEvidence.partial'),
      asOf: 'HIN 2025 / crash data 2019–2023',
      coverage: t('knownRouteEvidence.hinCoverage'),
      precision: t('knownRouteEvidence.hinPrecision'),
      uncertainty: t('knownRouteEvidence.hinLimits'),
      unavailableReason: t('knownRouteEvidence.rawCrashUnavailable'),
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

function sourceCard(documentRef, {
  title, href, status, asOf, coverage, precision, uncertainty, unavailableReason = null,
}) {
  const section = documentRef.createElement('section');
  const heading = documentRef.createElement('h4');
  heading.append(sourceLink(documentRef, href, title));
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
