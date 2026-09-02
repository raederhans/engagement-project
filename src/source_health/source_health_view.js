const COPY = Object.freeze({
  en: Object.freeze({
    title: 'Data sources and update status',
    intro: 'Review source status, coverage, and update times.',
    rejected: 'One or more source observations failed schema admission. Affected sources are unavailable until valid evidence is supplied.',
    dataset: 'Dataset', provider: 'Provider', status: 'Status', canonical: 'Canonical source',
    license: 'License / reuse', coverage: 'Coverage', clocks: 'Evidence clocks',
    sourceAsOf: 'Source as of', retrievedAt: 'Retrieved at', builtAt: 'Built at', observedAt: 'Observed at',
    snapshot: 'Snapshot / version', boundary: 'Boundary vintage', revision: 'Revision policy',
    limitations: 'Limitations', handoff: 'Official handoff', transport: 'Transport evidence',
    recordCount: 'Admitted record count', unavailableValue: 'Not available', notApplicable: 'Not supplied / not applicable',
    current: 'Current', partial: 'Partial', stale: 'Stale', unavailable: 'Unavailable', unknown: 'Unknown',
  }),
  'zh-CN': Object.freeze({
    title: '数据来源与更新时间',
    intro: '查看各数据源的状态、覆盖范围和更新时间。',
    rejected: '一个或多个来源观测未通过 schema 接纳；在提供有效证据前，受影响来源保持不可用。',
    dataset: '数据集', provider: '提供方', status: '状态', canonical: '规范来源',
    license: '许可 / 复用条款', coverage: '覆盖范围', clocks: '证据时钟',
    sourceAsOf: '来源事实截至', retrievedAt: '获取时间', builtAt: '构建时间', observedAt: '观测时间',
    snapshot: '快照 / 版本', boundary: '边界版本', revision: '修订政策',
    limitations: '局限', handoff: '官方交接页', transport: '传输证据',
    recordCount: '已接纳记录数', unavailableValue: '不可用', notApplicable: '未提供 / 不适用',
    current: '当前', partial: '部分可用', stale: '陈旧', unavailable: '不可用', unknown: '未知',
  }),
});

function copyFor(language) {
  return COPY[language === 'zh-CN' ? 'zh-CN' : 'en'];
}

function el(documentRef, tag, text = null, className = '') {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function addDefinition(documentRef, list, term, value, unavailableValue) {
  list.append(el(documentRef, 'dt', term));
  list.append(el(documentRef, 'dd', value ?? unavailableValue));
}

function link(documentRef, label, url) {
  const anchor = el(documentRef, 'a', label);
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

function formatCoverage(source, copy) {
  const temporal = source.coverage.temporalStart || source.coverage.temporalEnd
    ? `${source.coverage.temporalStart ?? copy.unavailableValue} – ${source.coverage.temporalEnd ?? copy.unavailableValue}`
    : copy.notApplicable;
  return `${source.coverage.geography}; ${temporal}`;
}

function formatSnapshot(source, copy) {
  const parts = [source.snapshot.version, source.snapshot.identity].filter(Boolean);
  return parts.length ? parts.join(' · ') : copy.notApplicable;
}

function formatTransport(source, copy) {
  const parts = [];
  if (source.transport.endpointUrl) parts.push(`URL: ${source.transport.endpointUrl}`);
  if (source.transport.lastModified) parts.push(`Last-Modified: ${source.transport.lastModified}`);
  if (source.transport.etag) parts.push(`ETag: ${source.transport.etag}`);
  return parts.length ? parts.join(' · ') : copy.notApplicable;
}

export function renderSourceHealthSurface({ host, model, language = 'en' } = {}) {
  const documentRef = host?.ownerDocument || globalThis.document;
  if (!host || !documentRef?.createElement) throw new TypeError('source health host requires a document');
  const copy = copyFor(language);
  const fragment = documentRef.createDocumentFragment?.() || el(documentRef, 'div');
  const heading = el(documentRef, 'h4', copy.title, 'source-health__title');
  heading.id = 'source-health-title';
  fragment.append(heading);
  fragment.append(el(documentRef, 'p', copy.intro, 'source-health__intro'));
  if (model.rejectedObservationCount > 0) {
    const alert = el(documentRef, 'p', copy.rejected, 'source-health__admission-warning');
    alert.setAttribute('role', 'alert');
    fragment.append(alert);
  }

  const list = el(documentRef, 'div', null, 'source-health__sources');
  for (const source of model.sources) {
    const article = el(documentRef, 'article', null, 'source-health__source');
    article.dataset.sourceHealthId = source.id;
    article.dataset.sourceHealthStatus = source.status;
    const sourceTitle = el(documentRef, 'h5', source.dataset, 'source-health__source-title');
    const status = el(documentRef, 'span', copy[source.status], 'source-health__status');
    status.dataset.status = source.status;
    sourceTitle.append(status);
    article.append(sourceTitle);

    const facts = el(documentRef, 'dl', null, 'source-health__facts');
    addDefinition(documentRef, facts, copy.dataset, source.dataset, copy.unavailableValue);
    addDefinition(documentRef, facts, copy.provider, source.provider, copy.unavailableValue);
    addDefinition(documentRef, facts, copy.status, `${copy[source.status]} · ${source.statusReason || copy.notApplicable}`, copy.unavailableValue);
    facts.append(el(documentRef, 'dt', copy.canonical));
    const canonical = el(documentRef, 'dd');
    canonical.append(link(documentRef, source.canonicalUrl, source.canonicalUrl));
    facts.append(canonical);
    facts.append(el(documentRef, 'dt', copy.license));
    const license = el(documentRef, 'dd');
    license.append(link(documentRef, source.license.label, source.license.url));
    facts.append(license);
    addDefinition(documentRef, facts, copy.coverage, formatCoverage(source, copy), copy.unavailableValue);

    const clocksTerm = el(documentRef, 'dt', copy.clocks);
    clocksTerm.className = 'source-health__subheading';
    facts.append(clocksTerm);
    const clocks = el(documentRef, 'dd');
    const clockList = el(documentRef, 'dl', null, 'source-health__clocks');
    addDefinition(documentRef, clockList, copy.sourceAsOf, source.clocks.sourceAsOf, copy.notApplicable);
    addDefinition(documentRef, clockList, copy.retrievedAt, source.clocks.retrievedAt, copy.notApplicable);
    addDefinition(documentRef, clockList, copy.builtAt, source.clocks.builtAt, copy.notApplicable);
    addDefinition(documentRef, clockList, copy.observedAt, source.clocks.observedAt, copy.notApplicable);
    clocks.append(clockList);
    facts.append(clocks);

    addDefinition(documentRef, facts, copy.snapshot, formatSnapshot(source, copy), copy.unavailableValue);
    addDefinition(documentRef, facts, copy.boundary, source.boundaryVintage ?? copy.notApplicable, copy.unavailableValue);
    addDefinition(documentRef, facts, copy.revision, source.revisionPolicy, copy.unavailableValue);
    addDefinition(documentRef, facts, copy.transport, formatTransport(source, copy), copy.unavailableValue);
    addDefinition(documentRef, facts, copy.recordCount, source.recordCount === null ? copy.unavailableValue : String(source.recordCount), copy.unavailableValue);
    article.append(facts);

    article.append(el(documentRef, 'h6', copy.limitations));
    const limitations = el(documentRef, 'ul', null, 'source-health__limitations');
    for (const limitation of source.limitations) limitations.append(el(documentRef, 'li', limitation));
    article.append(limitations);
    const handoff = el(documentRef, 'p', null, 'source-health__handoff');
    handoff.append(`${copy.handoff}: `, link(documentRef, source.officialHandoff.label, source.officialHandoff.url));
    article.append(handoff);
    list.append(article);
  }
  fragment.append(list);
  host.replaceChildren(fragment);
  host.hidden = false;
  host.setAttribute('aria-labelledby', heading.id);
  return host;
}
