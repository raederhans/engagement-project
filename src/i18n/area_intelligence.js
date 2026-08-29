import { registerMessagePairs } from './messages.js';

registerMessagePairs({
  'areaIntelligence.eyebrow': ['Area Intelligence evidence', '区域洞察证据'],
  'areaIntelligence.title': ['Read the historical count', '读取历史计数'],
  'areaIntelligence.subtitle': [
    'Understand admitted reported-incident counts before checking why prediction is unavailable.',
    '先理解经接纳的报告事件计数，再查看预测为何不可用。',
  ],
  'areaIntelligence.loading': ['Checking the required v2 evidence…', '正在核验必需的 v2 证据…'],
  'areaIntelligence.historyKicker': ['Historical evidence', '历史证据'],
  'areaIntelligence.historyTitle': ['Reported incident aggregate count', '报告事件历史聚合计数'],
  'areaIntelligence.historyTask': [
    'Read this as the number of admitted PPD reported incidents in a completed spatial-unit week—not a person’s chance of harm or an area judgment.',
    '请将其理解为一个完整空间单元周内，经接纳的 PPD 报告事件数量；它不是个人受害概率，也不是区域安全结论。',
  ],
  'areaIntelligence.measureLabel': ['Measure', '指标'],
  'areaIntelligence.measureValue': ['Historical aggregate count of reported incidents', '报告事件历史聚合计数'],
  'areaIntelligence.sourceAsOfLabel': ['Source as of', '来源截至'],
  'areaIntelligence.coverageLabel': ['Coverage', '覆盖范围'],
  'areaIntelligence.coverageWindow': [
    '{start} through {end} (exclusive end)',
    '{start} 至 {end}（不含结束日）',
  ],
  'areaIntelligence.completeWeeksLabel': ['Complete weeks through', '完整周截至'],
  'areaIntelligence.completeWeeksValue': ['Before {end}', '{end} 之前'],
  'areaIntelligence.geometryLabel': ['Analysis geometry', '分析几何'],
  'areaIntelligence.geometryValue': ['Census tract and fixed grid', '人口普查区与固定网格'],
  'areaIntelligence.precisionLabel': ['Location precision', '位置精度'],
  'areaIntelligence.precisionValue': ['Hundred-block source precision before aggregation', '聚合前采用百号街区级来源精度'],
  'areaIntelligence.methodTitle': ['How the count is constructed', '计数如何构成'],
  'areaIntelligence.weekMethod': [
    'Week: UTC Monday 00:00 inclusive to the next Monday exclusive.',
    '周定义：UTC 周一 00:00（含）至下一个周一（不含）。',
  ],
  'areaIntelligence.denominatorMethod': [
    'Denominators stay separate: admitted tract-weeks for tracts and admitted grid-weeks for the fixed grid.',
    '分母保持分离：人口普查区使用经接纳的 tract-week，固定网格使用经接纳的 grid-week。',
  ],
  'areaIntelligence.holdoutMethod': [
    'Spatial holdout: a 2 km separation keeps held-out blocks out of count-model training.',
    '空间留出：以 2 公里间隔将留出街区排除在计数模型训练之外。',
  ],
  'areaIntelligence.exclusionMethod': [
    'Exclusions: incomplete weeks and ambiguous, unmapped, or unavailable spatial assignments are not counted.',
    '排除项：不完整周，以及空间归属模糊、未映射或不可用的记录均不计入。',
  ],
  'areaIntelligence.aggregateBoundary': [
    'Aggregate-only evidence: no event locations, addresses, record identifiers, or event-level rows are shown.',
    '仅展示聚合证据：不显示事件位置、地址、记录标识符或事件级数据行。',
  ],
  'areaIntelligence.unavailableKicker': ['Forecast status', '预测状态'],
  'areaIntelligence.unavailableTitle': ['Prediction unavailable', '预测不可用'],
  'areaIntelligence.noPromotionReason': [
    'Why unavailable: no-promotion. The promotion gate did not pass. All 64 fit states were non-converged, and required gates failed.',
    '不可用原因：未晋级。64 个拟合状态均未收敛，且必需门槛未通过。',
  ],
  'areaIntelligence.localCandidateReason': [
    'Why unavailable: the local evaluation has no serving authority, and required gates did not establish a product forecast.',
    '不可用原因：本地评估不具备服务授权，且必需门槛未形成产品预测。',
  ],
  'areaIntelligence.intervalLabel': ['90% interval', '90% 区间'],
  'areaIntelligence.intervalUnavailable': ['Unavailable—no interval is displayed', '不可用——不显示区间'],
  'areaIntelligence.failedGatesLabel': ['Failed primary interval gates', '未通过的主要区间门槛'],
  'areaIntelligence.failedGatesValue': ['{count} failed slice(s)', '{count} 个切片未通过'],
  'areaIntelligence.intervalMeaning': [
    'If a model were admitted, its 90% prediction interval would describe uncertainty in a weekly reported-incident count: across similarly constructed weeks, about 90% would be expected to fall inside under the model assumptions. No interval is available now because promotion and authority gates failed.',
    '若模型获准使用，90% 预测区间将描述每周报告事件计数的不确定性：在模型假设下，以相同方式构造的周中，预计约 90% 会落在区间内。当前晋级与授权门槛未通过，因此没有可用区间。',
  ],
  'areaIntelligence.historicalOnly': [
    'Use the historical aggregate evidence above; no zero forecast or hidden fallback has been substituted, including a default value, prediction, or legacy v1.',
    '请使用上方历史聚合证据；系统没有用零、预测、默认值或旧版 v1 降级结果替代不可用状态。',
  ],
  'areaIntelligence.missingV2': [
    'The required v2 baseline was not found. Historical and forecast content are withheld; legacy v1 was not requested.',
    '未找到必需的 v2 基线。历史与预测内容均不展示，且未请求旧版 v1。',
  ],
  'areaIntelligence.legacyNotCurrent': [
    'A legacy v1 artifact may be readable for historical compatibility, but it is not current evidence and was not used as a fallback.',
    '旧版 v1 制品可为历史兼容而读取，但它不是当前证据，也没有被用作降级结果。',
  ],
  'areaIntelligence.invalidV2': [
    'The v2 baseline failed its contract or lineage check. Historical and forecast content are withheld.',
    'v2 基线未通过契约或血缘核验。历史与预测内容均不展示。',
  ],
});
