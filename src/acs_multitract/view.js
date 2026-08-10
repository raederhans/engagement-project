const COPY = Object.freeze({
  en: Object.freeze({
    eyebrow: 'Complete-tract analysis',
    title: 'Compare complete Census tracts',
    intro: 'Enter at least two complete Philadelphia tract GEOIDs. Review verifies exact membership in the bundled 2020-vintage ACS VRE snapshot; nothing is calculated until you choose Calculate.',
    inputLabel: 'Philadelphia tract GEOIDs',
    inputHint: 'Use 11-digit GEOIDs separated by spaces, commas, or new lines. Example: 42101000101, 42101000102',
    review: 'Review tracts',
    calculate: 'Calculate aggregate',
    close: 'Close',
    selectionCaption: 'Complete tracts admitted for calculation',
    geoid: 'GEOID',
    coverage: 'Coverage',
    vintage: 'Geography vintage',
    fullTract: 'Complete tract',
    ready: 'Selection admitted. Check every GEOID, then calculate.',
    idle: 'Enter at least two complete tract GEOIDs to begin.',
    loading: 'Checking the selected GEOIDs against the ACS VRE snapshot…',
    unavailable: 'The selection is unavailable.',
    limitationsTitle: 'Boundaries and limitations',
    limitations: Object.freeze([
      'Only whole Philadelphia 2020 Census tracts are admitted; addresses, route buffers, partial tracts, centroids, and area weighting are not supported.',
      'The 2020–2024 ACS value is a period estimate. It does not describe a specific address or person.',
      'The 90% margin of error represents ACS sampling uncertainty for the admitted aggregate. Published tract MOEs are never added together.',
    ]),
  }),
  zh: Object.freeze({
    eyebrow: '完整 tract 分析',
    title: '比较完整 Census tract',
    intro: '输入至少两个 Philadelphia 完整 tract GEOID。审查步骤会核对它们是否准确存在于内置的 2020-vintage ACS VRE snapshot；只有点击“计算聚合”后才会计算。',
    inputLabel: 'Philadelphia tract GEOID',
    inputHint: '使用空格、逗号或换行分隔 11 位 GEOID，例如：42101000101, 42101000102',
    review: '审查 tract',
    calculate: '计算聚合',
    close: '关闭',
    selectionCaption: '已准入计算的完整 tract',
    geoid: 'GEOID',
    coverage: '覆盖范围',
    vintage: '地理版本',
    fullTract: '完整 tract',
    ready: '选择已准入。请核对每个 GEOID，然后再计算。',
    idle: '输入至少两个完整 tract GEOID 以开始。',
    loading: '正在使用 ACS VRE snapshot 核对所选 GEOID…',
    unavailable: '该选择不可用。',
    limitationsTitle: '边界与限制',
    limitations: Object.freeze([
      '只准入 Philadelphia 2020 Census 完整 tract；不支持地址、route buffer、partial tract、centroid 或 area weighting。',
      '2020–2024 ACS 数值是一个时期估计，不能描述具体地址或个人。',
      '90% MOE 表示该聚合的 ACS 抽样不确定性；绝不直接相加已发布的 tract MOE。',
    ]),
  }),
});

const REASONS = Object.freeze({
  en: Object.freeze({
    'tract-selection-required': 'Enter at least two tract GEOIDs.',
    'two-or-more-complete-tracts-required': 'At least two complete tracts are required.',
    'invalid-philadelphia-tract-geoid': 'Every GEOID must be an 11-digit Philadelphia County tract identifier beginning with 42101.',
    'invalid-tract-geoid': 'One or more tract GEOIDs are invalid.',
    'duplicate-tract-selection': 'Each tract GEOID must appear only once.',
    'full-tract-only': 'Only complete tracts are supported.',
    'mixed-geography-vintage': 'Tracts from mixed geography vintages are not comparable.',
    'unsupported-geography-vintage': 'Only 2020 Census tract geography is supported.',
    'geography-vintage-unavailable': 'The tract geography vintage could not be verified.',
    'tract-vre-unavailable': 'A selected GEOID has no reliable correspondence in the admitted VRE snapshot.',
    'vre-source-unavailable': 'The ACS VRE snapshot is unavailable. No aggregate was calculated.',
    'vre-source-schema-drift': 'The ACS VRE snapshot failed its schema contract. No aggregate was calculated.',
    'zero-variance-special-case-unavailable': 'This selection requires a Census zero-variance special case that is not admitted.',
  }),
  zh: Object.freeze({
    'tract-selection-required': '请输入至少两个 tract GEOID。',
    'two-or-more-complete-tracts-required': '至少需要两个完整 tract。',
    'invalid-philadelphia-tract-geoid': '每个 GEOID 必须是以 42101 开头的 11 位 Philadelphia County tract 标识。',
    'invalid-tract-geoid': '一个或多个 tract GEOID 无效。',
    'duplicate-tract-selection': '每个 tract GEOID 只能出现一次。',
    'full-tract-only': '仅支持完整 tract。',
    'mixed-geography-vintage': '不同地理版本的 tract 不可比较。',
    'unsupported-geography-vintage': '仅支持 2020 Census tract 地理版本。',
    'geography-vintage-unavailable': '无法核对 tract 地理版本。',
    'tract-vre-unavailable': '某个 GEOID 在已准入 VRE snapshot 中没有可靠对应关系。',
    'vre-source-unavailable': 'ACS VRE snapshot 不可用；未计算任何聚合。',
    'vre-source-schema-drift': 'ACS VRE snapshot 未通过 schema 契约；未计算任何聚合。',
    'zero-variance-special-case-unavailable': '该选择需要尚未准入的 Census zero-variance 特例处理。',
  }),
});

function localeKey(locale) {
  return String(locale || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function getAcsMultitractCopy(locale) {
  return COPY[localeKey(locale)];
}

export function acsMultitractReason(reason, locale) {
  return REASONS[localeKey(locale)][reason] || `${getAcsMultitractCopy(locale).unavailable} (${reason || 'unknown'})`;
}

export function acsMultitractProductHtml(locale = 'en') {
  const copy = getAcsMultitractCopy(locale);
  return [
    '<div class="acs-multitract__surface">',
    '<header class="acs-multitract__header">',
    `<p class="acs-multitract__eyebrow">${escapeHtml(copy.eyebrow)}</p>`,
    `<h2 id="acs-multitract-title">${escapeHtml(copy.title)}</h2>`,
    `<p id="acs-multitract-description">${escapeHtml(copy.intro)}</p>`,
    '</header>',
    '<div class="acs-multitract__workflow">',
    `<label for="acs-multitract-input">${escapeHtml(copy.inputLabel)}</label>`,
    '<textarea id="acs-multitract-input" data-acs-multitract-input rows="4" spellcheck="false" autocapitalize="off" aria-describedby="acs-multitract-input-hint"></textarea>',
    `<p id="acs-multitract-input-hint" class="acs-multitract__hint">${escapeHtml(copy.inputHint)}</p>`,
    '<div class="acs-multitract__actions">',
    `<button class="button button--secondary" type="button" data-acs-multitract-review>${escapeHtml(copy.review)}</button>`,
    `<button class="button button--primary" type="button" data-acs-multitract-calculate disabled>${escapeHtml(copy.calculate)}</button>`,
    '</div>',
    `<p class="acs-multitract__status" data-acs-multitract-status role="status" aria-live="polite">${escapeHtml(copy.idle)}</p>`,
    '<section data-acs-multitract-review-host></section>',
    '<section data-acs-multitract-result aria-live="polite" tabindex="-1"></section>',
    '</div>',
    '<details class="acs-multitract__limitations">',
    `<summary>${escapeHtml(copy.limitationsTitle)}</summary>`,
    `<ul>${copy.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
    '</details>',
    '<footer class="acs-multitract__footer">',
    `<button class="button button--secondary" type="button" data-acs-multitract-close>${escapeHtml(copy.close)}</button>`,
    '</footer>',
    '</div>',
  ].join('');
}

export function acsSelectionReviewHtml(outcome, { locale = 'en' } = {}) {
  const copy = getAcsMultitractCopy(locale);
  if (outcome?.status !== 'available' || !outcome.review) {
    return `<p class="acs-multitract__selection-error">${escapeHtml(acsMultitractReason(outcome?.reason, locale))}</p>`;
  }
  const rows = outcome.review.selections.map((selection) => [
    '<tr>',
    `<th scope="row"><code>${escapeHtml(selection.geoid)}</code></th>`,
    `<td>${escapeHtml(copy.fullTract)}</td>`,
    `<td>${escapeHtml(selection.geographyVintage)}</td>`,
    '</tr>',
  ].join('')).join('');
  return [
    '<div class="acs-multitract__table-scroll" tabindex="0" role="region"',
    ` aria-label="${escapeHtml(copy.selectionCaption)}">`,
    '<table class="acs-multitract__selection-table">',
    `<caption>${escapeHtml(copy.selectionCaption)}</caption>`,
    `<thead><tr><th scope="col">${escapeHtml(copy.geoid)}</th><th scope="col">${escapeHtml(copy.coverage)}</th><th scope="col">${escapeHtml(copy.vintage)}</th></tr></thead>`,
    `<tbody>${rows}</tbody>`,
    '</table>',
    '</div>',
  ].join('');
}
