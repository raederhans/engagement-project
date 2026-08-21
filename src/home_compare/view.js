import { HOME_COMPARE_DIMENSIONS, HOME_COMPARE_EVIDENCE_KEYS } from './contract.js';

const COPY = Object.freeze({
  en: Object.freeze({
    eyebrow: 'Home & neighborhood compare',
    title: 'Compare 2–4 Philadelphia homes',
    intro: 'Enter full street addresses. Addresses, coordinates, and parcel IDs are used ephemerally to query the listed official public sources; commute destinations remain in this session. None are retained in the comparison artifact or shared settings.',
    address: 'Home address',
    addressHint: 'A unique City geocoder match and exact OPA parcel join are required.',
    add: 'Add another home',
    remove: 'Remove',
    commute: 'Optional commute destinations',
    commuteHint: 'Up to 3, one per line. They are not transmitted because no validated routing authority is installed.',
    weights: 'Evidence emphasis',
    weightsHint: 'Weights reorder evidence dimensions only. They never rank homes or create a recommendation.',
    compare: 'Compare evidence',
    close: 'Close',
    share: 'Copy settings link',
    shareHint: 'The link contains weights and visible dimensions only—no address, parcel, coordinate, or destination.',
    idle: 'Enter 2–4 addresses to begin.',
    loading: 'Resolving addresses and querying official public records…',
    results: 'Evidence profiles',
    profile: 'Home',
    sourceDetails: 'Source, coverage, and limitations',
    dataAsOf: 'Data as of',
    coverage: 'Coverage',
    precision: 'Precision / uncertainty',
    limitations: 'Limitations',
    source: 'Official source',
    records: 'records',
    unavailable: 'Unavailable—not zero',
    partial: 'Partial evidence',
    available: 'Available evidence',
    noValue: 'No admitted value',
    forecastTitle: 'Forecast remains unavailable',
    forecastBody: 'M2 was not promoted because it did not exceed the predefined seasonal baseline. Historical reported-incident evidence remains available; predictions remain empty.',
    commuteTitle: 'Travel-time and isochrone summary unavailable',
    commuteBody: 'No validated road or public-transit routing authority is installed. Straight-line distance and synthetic graphs are not used as substitutes.',
    sensitivity: 'Weight sensitivity',
    topDimensions: 'Current evidence emphasis',
    stable: 'Stable under ±20% perturbation',
    noStable: 'No single leading dimension stays stable under every ±20% perturbation.',
    noRanking: 'This view changes evidence order only; it does not calculate a safety score, rank homes, or recommend a home.',
    statusAvailable: 'Comparison completed with admitted evidence.',
    statusPartial: 'Comparison completed with partial evidence. Open each metric to review gaps.',
    property: 'Property record',
    assessments: 'Assessment history',
    transfers: 'Recorded transfers',
    serviceRequests: 'Nearby 311 requests',
    liHistory: 'L&I property history',
    vacancy: 'Vacancy indicator',
    reportedIncidents: 'Nearby reported incidents',
    hinContext: 'High Injury Network context',
    dimensionProperty: 'Property',
    dimensionCostHistory: 'Cost history',
    dimensionCivicRecords: 'Civic records',
    dimensionTransportContext: 'Transport context',
    dimensionDataQuality: 'Data quality',
  }),
  'zh-CN': Object.freeze({
    eyebrow: '住宅与社区比较',
    title: '并排比较 2–4 个费城住宅',
    intro: '请输入完整街道地址。地址、坐标和 parcel ID 仅临时用于查询列出的官方公共来源；通勤目的地只保留在本次会话中。这些内容都不会写入比较产物或共享设置。',
    address: '住宅地址',
    addressHint: '必须同时通过 City geocoder 唯一匹配与 OPA parcel 精确关联。',
    add: '添加住宅',
    remove: '移除',
    commute: '可选通勤目的地',
    commuteHint: '最多 3 个，每行一个。由于没有已验证 routing authority，这些内容不会被发送。',
    weights: '证据侧重',
    weightsHint: '权重只改变证据维度的展示顺序，不给住宅排名，也不生成推荐。',
    compare: '比较证据',
    close: '关闭',
    share: '复制设置链接',
    shareHint: '链接只包含权重和可见维度；不包含地址、parcel、坐标或目的地。',
    idle: '输入 2–4 个地址后开始。',
    loading: '正在解析地址并查询官方公共记录……',
    results: '证据档案',
    profile: '住宅',
    sourceDetails: '来源、覆盖与限制',
    dataAsOf: '数据截至',
    coverage: '覆盖范围',
    precision: '精度 / 不确定性',
    limitations: '限制',
    source: '官方来源',
    records: '条记录',
    unavailable: '不可用——不是零',
    partial: '部分证据',
    available: '可用证据',
    noValue: '没有已准入数值',
    forecastTitle: '预测继续不可用',
    forecastBody: 'M2 因未超过预定义季节性基线而未获准上线。历史 reported-incident 证据仍可用；预测数组保持为空。',
    commuteTitle: '通勤时间与 isochrone 不可用',
    commuteBody: '当前没有已验证的道路或公共交通 routing authority；不会用直线距离或 synthetic graph 替代。',
    sensitivity: '权重敏感性',
    topDimensions: '当前证据侧重',
    stable: '在 ±20% 扰动下稳定',
    noStable: '没有任何单一领先维度能在全部 ±20% 扰动下保持稳定。',
    noRanking: '本视图只改变证据顺序；不计算 safety score、不排名，也不推荐住宅。',
    statusAvailable: '比较已完成，证据通过准入。',
    statusPartial: '比较已完成，但存在部分证据；请展开每个指标查看缺口。',
    property: '房产记录',
    assessments: '评估历史',
    transfers: '登记交易',
    serviceRequests: '附近 311 请求',
    liHistory: 'L&I 房产历史',
    vacancy: '空置指标',
    reportedIncidents: '附近 reported incidents',
    hinContext: 'High Injury Network 情境',
    dimensionProperty: '房产',
    dimensionCostHistory: '成本历史',
    dimensionCivicRecords: '市政记录',
    dimensionTransportContext: '交通情境',
    dimensionDataQuality: '数据质量',
  }),
});

export function getHomeCompareCopy(locale) {
  return COPY[locale] || COPY.en;
}

export function homeCompareProductHtml({ locale = 'en', addressCount = 2, weights, busy = false } = {}) {
  const copy = getHomeCompareCopy(locale);
  const addresses = Array.from({ length: addressCount }, (_, index) => `
    <div class="home-compare__address-row">
      <label for="home-compare-address-${index}">${escapeHtml(copy.address)} ${index + 1}</label>
      <div>
        <input id="home-compare-address-${index}" type="search" autocomplete="street-address" enterkeyhint="next" data-home-address="${index}" aria-describedby="home-compare-address-hint">
        ${addressCount > 2 ? `<button class="button button--secondary" type="button" data-home-remove="${index}">${escapeHtml(copy.remove)}</button>` : ''}
      </div>
    </div>`).join('');
  const weightControls = HOME_COMPARE_DIMENSIONS.map((dimension) => `
    <label>
      <span>${escapeHtml(dimensionLabel(dimension, copy))}: <output data-home-weight-output="${dimension}">${weights[dimension]}</output></span>
      <input type="range" min="0" max="100" step="5" value="${weights[dimension]}" data-home-weight="${dimension}">
    </label>`).join('');
  return `
    <div class="home-compare__surface">
      <header class="home-compare__header">
        <p class="home-compare__eyebrow">${escapeHtml(copy.eyebrow)}</p>
        <h2 id="home-compare-title">${escapeHtml(copy.title)}</h2>
        <p id="home-compare-description">${escapeHtml(copy.intro)}</p>
      </header>
      <section class="home-compare__workflow" aria-label="${escapeHtml(copy.title)}">
        <div class="home-compare__addresses">${addresses}</div>
        <p id="home-compare-address-hint" class="home-compare__hint">${escapeHtml(copy.addressHint)}</p>
        <button class="button button--secondary" type="button" data-home-add ${addressCount >= 4 ? 'disabled' : ''}>${escapeHtml(copy.add)}</button>
        <label for="home-compare-destinations">${escapeHtml(copy.commute)}</label>
        <textarea id="home-compare-destinations" data-home-destinations rows="3" aria-describedby="home-compare-commute-hint"></textarea>
        <p id="home-compare-commute-hint" class="home-compare__hint">${escapeHtml(copy.commuteHint)}</p>
        <fieldset class="home-compare__weights">
          <legend>${escapeHtml(copy.weights)}</legend>
          <p>${escapeHtml(copy.weightsHint)}</p>
          <div>${weightControls}</div>
        </fieldset>
        <div class="home-compare__actions">
          <button class="button button--primary" type="button" data-home-run ${busy ? 'disabled' : ''}>${escapeHtml(copy.compare)}</button>
          <button class="button button--secondary" type="button" data-home-share ${busy ? 'disabled' : ''}>${escapeHtml(copy.share)}</button>
          <button class="button button--secondary" type="button" data-home-close>${escapeHtml(copy.close)}</button>
        </div>
        <p class="home-compare__hint">${escapeHtml(copy.shareHint)}</p>
        <p class="home-compare__status" data-home-status role="status" aria-live="polite">${escapeHtml(busy ? copy.loading : copy.idle)}</p>
      </section>
      <section class="home-compare__results" data-home-results aria-labelledby="home-compare-results-title" tabindex="-1"></section>
    </div>`;
}

function dimensionLabel(key, copy) {
  return copy[`dimension${key[0].toUpperCase()}${key.slice(1)}`] || key;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
