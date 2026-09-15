const APPROVED_NEGATED_COPY = Object.freeze([
  'Static examples—not live directions or route recommendations.',
  '静态示例，不提供实时导航或路线推荐。',
  'The ordering changes with the selected emphasis. These are comparisons, not recommendations.',
  '排序会随侧重点变化；这些是比较结果，不是推荐。',
  'The ordering stayed the same under the tested emphasis. This is still a comparison, not a recommendation.',
  '在测试的侧重点下排序保持不变；这仍是比较结果，不是推荐。',
  'This is not live directions, an observed route evaluation, or a recommendation.',
  'They are not live directions, observed journeys, or route recommendations.',
  'Treat the cards as tradeoffs, not as a recommendation.',
  '它不是实时导航、实测路线评估或推荐，也不具备路线或安全权限。',
  '不是实时导航、实测行程或路线推荐。',
  '请将卡片视为权衡说明，而非推荐。',
]);

const FORBIDDEN_ENGLISH_COPY =
  /\b(?:safest|safer|best route|lowest risk|least risk|recommend(?:ed|ation|ations|ing)?|risk score|safety score|winner)\b|personal victim probability/i;
const FORBIDDEN_CHINESE_COPY =
  /最安全|更安全|最佳路线|最低风险|风险最低|低风险|推荐|首选|风险评分|安全评分|个人受害概率|优胜者/;

export function assertPublicRouteCopyBoundary(text, label = 'public route copy') {
  let inspected = String(text);
  for (const approved of APPROVED_NEGATED_COPY) inspected = inspected.replaceAll(approved, '');
  if (FORBIDDEN_ENGLISH_COPY.test(inspected) || FORBIDDEN_CHINESE_COPY.test(inspected)) {
    throw new TypeError(`${label} crosses the product copy boundary`);
  }
}
