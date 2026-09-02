const COPY = Object.freeze({
  en: Object.freeze({
    eyebrow: 'Complete-tract analysis',
    title: 'Compare complete Census tracts',
    intro: 'Enter at least 2 complete Philadelphia tract GEOIDs.',
    inputLabel: 'Philadelphia tract GEOIDs',
    inputHint: '11-digit GEOIDs, separated by commas or new lines.',
    review: 'Review tracts',
    calculate: 'Calculate aggregate',
    close: 'Close',
    selectionCaption: 'Complete tracts ready for calculation',
    geoid: 'GEOID',
    coverage: 'Coverage',
    vintage: 'Geography vintage',
    fullTract: 'Complete tract',
    ready: 'The selection passed the checks. Review each GEOID, then calculate.',
    idle: 'Enter at least two complete tract GEOIDs to begin.',
    loading: 'Checking the selected GEOIDs against the ACS VRE snapshot…',
    unavailable: 'The selection is unavailable.',
    limitationsTitle: 'Boundaries and limitations',
    limitations: Object.freeze([
      'Only whole Philadelphia 2020 Census tracts are supported; addresses, route buffers, partial tracts, centroids, and area weighting are not.',
      'The 2020–2024 ACS value is a period estimate. It does not describe a specific address or person.',
      'The 90% margin of error represents ACS sampling uncertainty for the combined result. Published tract margins of error are never added together directly.',
    ]),
  }),
  zh: Object.freeze({
    eyebrow: '完整人口普查区比较',
    title: '比较完整人口普查区',
    intro: '输入至少 2 个完整的费城人口普查区 GEOID。',
    inputLabel: '费城人口普查区 GEOID',
    inputHint: '使用逗号或换行分隔 11 位 GEOID。',
    review: '检查人口普查区',
    calculate: '计算汇总',
    close: '关闭',
    selectionCaption: '已通过检查、可参与计算的人口普查区',
    geoid: 'GEOID',
    coverage: '覆盖范围',
    vintage: '地理版本',
    fullTract: '完整人口普查区',
    ready: '所选区域已通过检查。请核对每个 GEOID，然后再计算。',
    idle: '请输入至少两个完整人口普查区 GEOID。',
    loading: '正在对照内置 ACS 估计与误差数据检查所选 GEOID…',
    unavailable: '该选择不可用。',
    limitationsTitle: '边界与限制',
    limitations: Object.freeze([
      '只支持费城 2020 年边界的完整人口普查区；不支持地址、路线缓冲区、部分区域、质心近似或面积加权。',
      '2020–2024 ACS 数值是五年期估计，不能描述具体地址或个人。',
      '90% 误差范围表示 ACS 抽样不确定性；系统不会直接把各人口普查区的误差范围相加。',
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
    'tract-vre-unavailable': 'A selected GEOID has no reliable match in the checked ACS estimate and uncertainty data.',
    'vre-source-unavailable': 'The ACS estimate and uncertainty data are unavailable. No combined result was calculated.',
    'vre-source-schema-drift': 'The ACS estimate and uncertainty data format changed. No combined result was calculated.',
    'zero-variance-special-case-unavailable': 'This selection requires a Census zero-variance special case that is not currently supported.',
  }),
  zh: Object.freeze({
    'tract-selection-required': '请输入至少两个人口普查区 GEOID。',
    'two-or-more-complete-tracts-required': '至少需要两个完整人口普查区。',
    'invalid-philadelphia-tract-geoid': '每个 GEOID 必须是以 42101 开头的 11 位费城县人口普查区标识。',
    'invalid-tract-geoid': '一个或多个人口普查区 GEOID 无效。',
    'duplicate-tract-selection': '每个人口普查区 GEOID 只能出现一次。',
    'full-tract-only': '仅支持完整人口普查区。',
    'mixed-geography-vintage': '不同地理版本的人口普查区不能直接比较。',
    'unsupported-geography-vintage': '目前只支持 2020 Census 人口普查区边界。',
    'geography-vintage-unavailable': '无法确认人口普查区所用的地理版本。',
    'tract-vre-unavailable': '某个 GEOID 在已通过校验的 ACS 估计与误差数据中没有可靠对应项。',
    'vre-source-unavailable': 'ACS 估计与误差数据不可用，本次未计算汇总。',
    'vre-source-schema-drift': 'ACS 估计与误差数据结构发生变化，本次未计算汇总。',
    'zero-variance-special-case-unavailable': '所选区域需要处理目前尚未支持的 Census 零方差特殊情况。',
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
    '<textarea id="acs-multitract-input" data-acs-multitract-input rows="4" spellcheck="false" autocapitalize="off" placeholder="42101000101, 42101000102" aria-describedby="acs-multitract-input-hint"></textarea>',
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
