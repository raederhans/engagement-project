import { applyTranslations, onLanguageChange, t } from '../i18n/index.js';
import { registerMessagePairs } from '../i18n/messages.js';
import { requestKnownRouteHin2025Context } from './hin_2025_context.js';

registerMessagePairs({
  'hin.title': ['HIN 2025 historical context', 'HIN 2025 历史上下文'],
  'hin.description': ['Street names whose snapshot geometry is within the fixed route-association tolerance.', '固定路线关联容差内，快照几何与已知路线接近或相交的街道名称。'],
  'hin.idle': ['Review a known route to load its versioned local HIN 2025 context.', '查看已知路线后，将加载其版本化本地 HIN 2025 上下文。'],
  'hin.pending': ['Checking the versioned local HIN 2025 snapshot…', '正在检查版本化的本地 HIN 2025 快照…'],
  'hin.ready': ['{count} street names are near or intersect this known route in the HIN 2025 snapshot.', 'HIN 2025 快照中有 {count} 个街道名称接近或相交于这条已知路线。'],
  'hin.zero': ['No HIN 2025 snapshot street geometry is within the fixed tolerance. This admitted zero is not a safety finding.', '固定容差内没有 HIN 2025 快照街道几何。这是已准入的零结果，不是安全结论。'],
  'hin.unavailable': ['HIN 2025 historical context is unavailable. This is not a zero result.', 'HIN 2025 历史上下文不可用；这不是零结果。'],
  'hin.relation': ['Relation', '关联关系'],
  'hin.method': ['Method and tolerance', '方法与容差'],
  'hin.period': ['Crash-data period / network', '事故数据期间／网络版本'],
  'hin.sourceAsOf': ['Source data edited', '来源数据编辑时间'],
  'hin.snapshot': ['Snapshot retrieved', '快照获取时间'],
  'hin.built': ['Snapshot built', '快照构建时间'],
  'hin.builtUnknown': ['Not recorded in the legacy snapshot; not inferred from retrieval', '旧版快照未记录；不会从获取时间推断'],
  'hin.snapshotIdentity': ['Snapshot identity', '快照标识'],
  'hin.receipt': ['Lifecycle receipt / review', '生命周期收据／审查'],
  'hin.features': ['Admitted features / geometry', '已准入要素／几何类型'],
  'hin.layerData': ['Layer data edited', '图层数据编辑时间'],
  'hin.layerSchema': ['Layer schema edited', '图层结构编辑时间'],
  'hin.itemMetadata': ['Item metadata modified', '条目元数据修改时间'],
  'hin.identity': ['Feature identity', '要素标识'],
  'hin.identityValue': ['Snapshot-local only; not a cross-version timeline key', '仅限本快照；不是跨版本时间线标识'],
  'hin.streetNames': ['Associated street names', '关联街道名称'],
  'hin.officialItem': ['Official ArcGIS item', '官方 ArcGIS 条目'],
  'hin.officialLayer': ['Official ArcGIS layer', '官方 ArcGIS 图层'],
  'hin.officialContext': ['Official Vision Zero context', '官方 Vision Zero 背景'],
  'hin.officialRelease': ['Official period and network release', '官方数据期间与网络发布说明'],
  'hin.license': ['City license and warranty', '市政府许可与保证条款'],
  'hin.limitations': ['This is a 2025 historical planning network based on 2019–2023 crash data. Known Route is user-supplied geometry, not GPS map matching. “Near or intersects” uses an inclusive 20 m local equirectangular segment-distance approximation. It does not mean the route belongs to the HIN, that a crash occurred on the route, or that the route is safer, certified, live, predictive, risk-scored, or safer-route advice.', '这是基于 2019–2023 年事故数据的 2025 历史规划网络。Known Route 是用户提供的几何，不是 GPS 地图匹配。“接近或相交”使用固定 20 米、包含边界的局部等距圆柱投影线段距离近似。它不表示路线属于 HIN、事故发生在路线上，也不表示路线更安全、经过认证、实时、可预测、具有风险评分或构成更安全路线建议。'],
});

export function createHin2025Presentation(result = {}) {
  const status = ['idle', 'ready', 'no-associated-streets', 'unavailable'].includes(result.status)
    ? result.status : 'unavailable';
  return {
    status,
    zeroClaim: status === 'no-associated-streets',
    matches: status === 'ready' && Array.isArray(result.matches) ? result.matches : [],
    snapshot: ['ready', 'no-associated-streets'].includes(status) ? result.snapshot || null : null,
    relation: result.relation || 'known-route-near-or-intersects-hin-snapshot',
    method: result.method || 'inclusive 20 m local segment-distance approximation',
    toleranceM: Number.isFinite(result.toleranceM) ? result.toleranceM : 20,
  };
}

export function initHin2025Ui({
  root,
  requestContext = requestKnownRouteHin2025Context,
  onSourceHealthObservation = () => {},
} = {}) {
  if (!root?.querySelector || typeof requestContext !== 'function') {
    throw new Error('HIN 2025 UI requires a root and request port.');
  }
  root.innerHTML = `<h3 id="hin-2025-context-title" data-i18n="hin.title">${t('hin.title')}</h3>
    <p data-i18n="hin.description">${t('hin.description')}</p>
    <p data-hin-status role="status" aria-live="polite" aria-atomic="true"></p>
    <dl data-hin-evidence></dl>
    <div data-hin-matches hidden><h4 data-i18n="hin.streetNames">${t('hin.streetNames')}</h4><ul data-hin-streets></ul></div>
    <p class="route-corridor__truth" data-i18n="hin.limitations">${t('hin.limitations')}</p>
    <p data-hin-handoff hidden></p>
    <details data-hin-license hidden><summary data-i18n="hin.license">${t('hin.license')}</summary><p></p></details>`;
  applyTranslations(root);
  const documentRef = root.ownerDocument || document;
  const statusNode = root.querySelector('[data-hin-status]');
  const evidenceNode = root.querySelector('[data-hin-evidence]');
  const matchesRegion = root.querySelector('[data-hin-matches]');
  const streetsNode = root.querySelector('[data-hin-streets]');
  const handoffNode = root.querySelector('[data-hin-handoff]');
  const licenseNode = root.querySelector('[data-hin-license]');
  let generation = 0;
  let lastResult = { status: 'unavailable' };

  const render = (result) => {
    lastResult = result;
    const presentation = createHin2025Presentation(result);
    root.dataset.hinStatus = presentation.status;
    statusNode.textContent = presentation.status === 'ready'
      ? t('hin.ready', { count: presentation.matches.length })
      : t(presentation.zeroClaim ? 'hin.zero' : presentation.status === 'idle' ? 'hin.idle' : 'hin.unavailable');
    renderEvidence(documentRef, evidenceNode, presentation);
    streetsNode.replaceChildren();
    for (const match of presentation.matches) {
      const item = documentRef.createElement('li');
      item.textContent = match.streetName;
      streetsNode.append(item);
    }
    matchesRegion.hidden = presentation.matches.length === 0;
    renderHandoff(documentRef, handoffNode, presentation.snapshot);
    licenseNode.hidden = !presentation.snapshot?.licenseAndWarranty;
    const licenseText = licenseNode.querySelector('p');
    if (licenseText) licenseText.textContent = presentation.snapshot?.licenseAndWarranty || '';
  };

  const releaseLanguage = onLanguageChange(() => {
    applyTranslations(root);
    render(lastResult);
  });

  render({ status: 'idle' });
  return {
    async review(routeInput) {
      const requestGeneration = ++generation;
      root.dataset.hinStatus = 'pending';
      statusNode.textContent = t('hin.pending');
      const result = await requestContext({ routeInput });
      if (requestGeneration !== generation) return { status: 'superseded' };
      if (result?.sourceHealthObservation) {
        try { onSourceHealthObservation(result.sourceHealthObservation); } catch {}
      }
      render(result);
      return result;
    },
    clear() {
      generation += 1;
      render({ status: 'idle' });
    },
    dispose() {
      generation += 1;
      releaseLanguage();
      root.replaceChildren();
    },
  };
}

function renderEvidence(documentRef, node, presentation) {
  node.replaceChildren();
  const snapshot = presentation.snapshot;
  if (!snapshot) return;
  const rows = [
    [t('hin.relation'), presentation.relation],
    [t('hin.method'), `${presentation.method}; ${presentation.toleranceM} m`],
    [t('hin.period'), `${snapshot.crashDataPeriod?.[0]}–${snapshot.crashDataPeriod?.[1]} / ${snapshot.networkVintage}`],
    [t('hin.sourceAsOf'), snapshot.sourceAsOf],
    [t('hin.snapshot'), snapshot.retrievedAt],
    [t('hin.built'), snapshot.builtAt || t('hin.builtUnknown')],
    [t('hin.snapshotIdentity'), snapshot.snapshotIdentity],
    [t('hin.receipt'), `${snapshot.receiptSchema || '—'} / ${snapshot.reviewStatus || '—'}`],
    [t('hin.features'), `${snapshot.featureCount ?? '—'} / ${(snapshot.geometryTypes || []).join(', ') || '—'}`],
    [t('hin.layerData'), snapshot.layerDataEditedAt],
    [t('hin.layerSchema'), snapshot.layerSchemaEditedAt],
    [t('hin.itemMetadata'), snapshot.itemMetadataModifiedAt],
    [t('hin.identity'), t('hin.identityValue')],
  ];
  for (const [label, value] of rows) {
    const group = documentRef.createElement('div');
    const term = documentRef.createElement('dt');
    const detail = documentRef.createElement('dd');
    term.textContent = label;
    detail.textContent = value || '—';
    group.append(term, detail);
    node.append(group);
  }
}

function renderHandoff(documentRef, node, snapshot) {
  node.replaceChildren();
  if (!snapshot) {
    node.hidden = true;
    return;
  }
  const links = [
    [snapshot.sourceItem, t('hin.officialItem')],
    [snapshot.sourceLayer, t('hin.officialLayer')],
    [snapshot.officialContext, t('hin.officialContext')],
    [snapshot.officialTimeSemantics, t('hin.officialRelease')],
  ].filter(([href]) => safeOfficialUrl(href));
  links.forEach(([href, label], index) => {
    if (index) node.append(documentRef.createTextNode(' · '));
    const link = documentRef.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    node.append(link);
  });
  node.hidden = links.length === 0;
}

function safeOfficialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && ['www.arcgis.com', 'services.arcgis.com', 'visionzerophl.com', 'www.phila.gov'].includes(url.hostname);
  } catch {
    return false;
  }
}
