import { registerMessagePairs } from './messages.js';

registerMessagePairs({
  'areaIntelligence.eyebrow': ['Area Intelligence baseline', '区域洞察基线'],
  'areaIntelligence.title': ['Historical evidence and forecast status', '历史证据与预测状态'],
  'areaIntelligence.subtitle': [
    'Historical reported-incident trends remain available even when the forecast gate does not pass.',
    '即使预测未通过门槛，历史报告事件趋势仍可查看。',
  ],
  'areaIntelligence.historicalAvailable': [
    'Historical charts show admitted reported-incident evidence with source limitations.',
    '历史图表展示经接纳的报告事件证据，并保留来源限制。',
  ],
  'areaIntelligence.loading': ['Checking the model serving contract…', '正在核验模型服务契约…'],
  'areaIntelligence.invalid': [
    'Prediction unavailable because the model artifact failed validation. Historical charts remain available.',
    '模型产物未通过验证，预测不可用；历史图表仍可查看。',
  ],
  'areaIntelligence.notPromoted': [
    'The model did not exceed the pre-defined seasonal baseline. Prediction unavailable.',
    '模型未超过预定义季节性基线，预测不可用。',
  ],
  'areaIntelligence.historicalOnly': [
    'Use the historical evidence above; no zero forecast or hidden fallback has been substituted.',
    '请使用上方历史证据；系统没有用零预测或隐藏式降级替代失败状态。',
  ],
  'areaIntelligence.selectTract': [
    'A promoted forecast is available only for an admitted census-tract selection.',
    '已通过门槛的预测仅适用于经接纳的人口普查区选择。',
  ],
  'areaIntelligence.modeledCount': ['Modeled reported-incident count', '报告事件建模数量'],
  'areaIntelligence.interval': ['90% prediction interval', '90% 预测区间'],
  'areaIntelligence.targetWeek': ['Target week', '目标周'],
  'areaIntelligence.trainedThrough': ['Model trained through {date}', '模型训练数据截至 {date}'],
  'areaIntelligence.uncertainty': [
    'This is a modeled count with uncertainty, not individual risk, absolute safety, or a route recommendation.',
    '这是带不确定性的建模数量，不代表个人风险、绝对安全或路线建议。',
  ],
});
