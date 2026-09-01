const APPROVED_NEGATED_COPY = Object.freeze([
  'This is not live directions, an observed route evaluation, or a recommendation.',
  'Treat the cards as tradeoffs, not as a recommendation.',
  '它不是实时导航、实测路线评估或推荐，也不具备路线或安全权限。',
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
