const COPY = Object.freeze({
  en: {
    title: 'ACS complete-tract population aggregate',
    estimate: 'Population estimate',
    standardError: 'Standard error',
    moe: '90% margin of error',
    period: 'ACS period',
    release: 'Release',
    vintage: 'Tract geography vintage',
    count: 'Complete tracts',
    method: 'Method',
    limitation: 'Limitations',
    unavailable: 'ACS aggregate unavailable',
    notComparable: 'ACS geographies are not comparable',
  },
  zh: {
    title: 'ACS 完整 tract 人口聚合',
    estimate: '人口估计值',
    standardError: '标准误（SE）',
    moe: '90% 误差范围（MOE）',
    period: 'ACS 时段',
    release: '发布版本',
    vintage: 'Tract 地理版本',
    count: '完整 tract 数',
    method: '方法',
    limitation: '限制',
    unavailable: 'ACS 聚合不可用',
    notComparable: 'ACS 地理范围不可比较',
  },
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function row(label, value) {
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

/** Text/table-only renderer. It has no map, canvas, or SVG dependency. */
export function acsAggregationTableHtml(outcome, { locale = 'en' } = {}) {
  const isChinese = String(locale).toLowerCase().startsWith('zh');
  const copy = COPY[isChinese ? 'zh' : 'en'];
  if (outcome?.status !== 'available' || !outcome.result) {
    const title = outcome?.status === 'not-comparable' ? copy.notComparable : copy.unavailable;
    const reason = outcome?.reason || 'unknown';
    return `<section class="acs-aggregate" data-acs-aggregate-status="${escapeHtml(outcome?.status || 'unavailable')}"><h3>${escapeHtml(title)}</h3><p role="status">${escapeHtml(reason)}</p></section>`;
  }
  const value = outcome.result;
  const formatter = new Intl.NumberFormat(isChinese ? 'zh-CN' : 'en-US');
  const decimalFormatter = new Intl.NumberFormat(isChinese ? 'zh-CN' : 'en-US', {
    maximumFractionDigits: 2,
  });
  return [
    '<section class="acs-aggregate" data-acs-aggregate-status="available">',
    '<table>',
    `<caption>${escapeHtml(copy.title)}</caption>`,
    '<tbody>',
    row(copy.estimate, formatter.format(value.estimate)),
    row(copy.standardError, decimalFormatter.format(value.standardError)),
    row(copy.moe, `±${formatter.format(value.moe90)}`),
    row(copy.period, value.period),
    row(copy.release, value.release),
    row(copy.vintage, value.geographyVintage),
    row(copy.count, formatter.format(value.tractCount)),
    row(copy.method, value.method),
    row(copy.limitation, value.limitation),
    '</tbody>',
    '</table>',
    '</section>',
  ].join('');
}
