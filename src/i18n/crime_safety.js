import { registerMessagePairs } from './messages.js';

registerMessagePairs({
  'chart.view.rolling': ['3-month average', '三个月均值'],
  'residential.eyebrow': ['Homebuyer view', '购房参考'],
  'residential.title': ['Long-term crime stability', '长期犯罪稳定性'],
  'residential.subtitle': [
    'A compact reading of direction, month-to-month variation, and evidence strength.',
    '用少量指标概括变化方向、月度波动和证据强度。',
  ],
  'residential.empty': [
    'Choose an area and at least six months to review stability.',
    '请选择区域，并使用至少六个月的数据查看稳定性。',
  ],
  'residential.trend': ['Recent direction', '近期方向'],
  'residential.trend.rising': ['Rising', '上升'],
  'residential.trend.falling': ['Falling', '下降'],
  'residential.trend.steady': ['Broadly steady', '总体平稳'],
  'residential.trend.insufficient': ['Not enough history', '历史数据不足'],
  'residential.change': ['{value}% vs previous 3 months', '较此前三个月 {value}%'],
  'residential.volatility': ['Monthly variation', '月度波动'],
  'residential.volatility.low': ['Low', '较低'],
  'residential.volatility.moderate': ['Moderate', '中等'],
  'residential.volatility.high': ['High', '较高'],
  'residential.volatility.insufficient': ['Not enough history', '历史数据不足'],
  'residential.evidence': ['Evidence strength', '证据强度'],
  'residential.confidence.high': ['High', '较高'],
  'residential.confidence.medium': ['Medium', '中等'],
  'residential.confidence.low': ['Low', '较低'],
  'residential.months': ['{count} complete months · {records} reported records', '{count} 个完整月份 · {records} 条报告记录'],
  'residential.partialExcluded': ['The current partial month is excluded.', '当前未完整月份未计入。'],
  'residential.method': ['How this is calculated', '计算方法'],
  'residential.methodText': [
    'Direction compares the latest three complete months with the previous three. Variation uses all complete months. This is historical context, not a safety score or prediction.',
    '近期方向比较最近三个完整月份与此前三个完整月份；月度波动使用全部完整月份。这是历史背景，不是安全评分或预测。',
  ],
});
