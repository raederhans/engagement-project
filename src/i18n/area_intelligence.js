import { registerMessagePairs } from './messages.js';

registerMessagePairs({
  'areaIntelligence.eyebrow': ['Area Intelligence evidence', '区域洞察证据'],
  'areaIntelligence.title': ['Read the historical ledger', '读取历史台账'],
  'areaIntelligence.subtitle': [
    'Review the complete-coverage admission ledger before checking why no forecast is available.',
    '先查看完整覆盖 admission 台账，再了解为何没有可用预测。',
  ],
  'areaIntelligence.loading': ['Checking the required v2 evidence…', '正在核验必需的 v2 证据…'],
  'areaIntelligence.historyKicker': ['Historical evidence', '历史证据'],
  'areaIntelligence.historyTitle': ['Reported incident aggregate ledger', '报告事件聚合台账'],
  'areaIntelligence.historyTask': [
    'This is complete-coverage aggregate evidence, not a count for the currently selected district, tract, or week.',
    '这是完整覆盖的聚合证据，不是当前所选分局、普查区或周的计数。',
  ],
  'areaIntelligence.measureLabel': ['Measure', '指标'],
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
  'areaIntelligence.precisionLabel': ['Source location precision', '来源位置精度'],
  'areaIntelligence.precisionValue': ['Artifact precision: {precision}', '制品精度：{precision}'],
  'areaIntelligence.ledgerTitle': ['Complete-coverage admission ledger', '完整覆盖 admission 台账'],
  'areaIntelligence.ledgerScope': [
    'This ledger covers the admitted evidence population. Current district and tract selections do not change these values.',
    '本台账覆盖经接纳的证据总体；当前分局和普查区选择不会改变这些数值。',
  ],
  'areaIntelligence.canonicalRowsLabel': ['Canonical rows seen', '已见 canonical 行数'],
  'areaIntelligence.tractAdmittedLabel': ['Tract admitted', '普查区已接纳'],
  'areaIntelligence.tractAmbiguousLabel': ['Tract ambiguous excluded', '普查区模糊排除'],
  'areaIntelligence.tractUnmappedLabel': ['Tract unmapped excluded', '普查区未映射排除'],
  'areaIntelligence.gridAdmittedLabel': ['Fixed-grid admitted', '固定网格已接纳'],
  'areaIntelligence.gridUnavailableLabel': ['Fixed-grid unavailable excluded', '固定网格不可用排除'],
  'areaIntelligence.tractUnitsLabel': ['Tract units', '普查区单元数'],
  'areaIntelligence.gridUnitsLabel': ['Fixed-grid units', '固定网格单元数'],
  'areaIntelligence.martRowsLabel': ['Mart rows', 'Mart 行数'],
  'areaIntelligence.parallelDenominators': [
    'Tract and fixed-grid ledgers are parallel denominators; their counts are not added together.',
    '普查区与固定网格台账是平行分母；两者计数不相加。',
  ],
  'areaIntelligence.methodTitle': ['How the ledger is constructed', '台账如何构成'],
  'areaIntelligence.weekMethod': [
    'Week: {definition}.',
    '周定义：{definition}。',
  ],
  'areaIntelligence.denominatorMethod': [
    'Tract and fixed-grid are kept as separate spatial-unit-week denominators.',
    '人口普查区与固定网格保持为独立的 spatial-unit-week 分母。',
  ],
  'areaIntelligence.holdoutMethod': [
    'Spatial holdout: {distance} km separation keeps held-out blocks out of count-model training.',
    '空间留出：以 {distance} 公里间隔将留出街区排除在计数模型训练之外。',
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
  'areaIntelligence.unavailableTitle': ['Forecast and model count unavailable', '预测和模型计数不可用'],
  'areaIntelligence.noPromotionReason': [
    'Why unavailable: no-promotion. The promotion gate did not pass; {failedPrimarySlices} primary 90% interval slices failed, so no forecast or model count is shown.',
    '不可用原因：未晋级。晋级门槛未通过；{failedPrimarySlices} 个主要 90% 区间切片失败，因此不展示预测或模型计数。',
  ],
  'areaIntelligence.localCandidateReason': [
    'Why unavailable: the local evaluation has no serving authority, so no forecast or model count is shown.',
    '不可用原因：本地评估不具备服务授权，因此不展示预测或模型计数。',
  ],
  'areaIntelligence.intervalLabel': ['90% interval', '90% 区间'],
  'areaIntelligence.intervalUnavailable': ['Unavailable—no interval is displayed', '不可用——不显示区间'],
  'areaIntelligence.failedGatesLabel': ['Failed primary interval slices', '未通过的主要区间切片'],
  'areaIntelligence.fitStateTitle': ['Fit-state outcome', '拟合状态结果'],
  'areaIntelligence.fitStateTotalLabel': ['Fit states total', '拟合状态总数'],
  'areaIntelligence.fitStatePassedLabel': ['Fit states passed', '通过的拟合状态'],
  'areaIntelligence.fitStateFailedLabel': ['Fit states failed', '未通过的拟合状态'],
  'areaIntelligence.fitStateBeforeLimitLabel': ['Converged before iteration limit', '在迭代上限前收敛'],
  'areaIntelligence.intervalMeaning': [
    'If admitted, a 90% prediction interval would describe uncertainty in a weekly reported-incident count under model assumptions. It would not establish a person-level probability or a comparative safety conclusion.',
    '若获准使用，90% 预测区间将在模型假设下描述每周报告事件计数的不确定性；它不能确定个人层面的概率或比较性的安全结论。',
  ],
  'areaIntelligence.historicalOnly': [
    'Use the complete-coverage ledger above. No zero forecast or hidden fallback—including a prediction, default value, or legacy v1—has been substituted.',
    '请使用上方完整覆盖台账。系统没有用零预测或隐藏回退替代不可用状态，包括预测值、默认值或旧版 v1。',
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
