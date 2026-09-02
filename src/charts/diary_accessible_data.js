import { t } from '../i18n/index.js';
import { replaceAccessibleTables } from './accessible_data.js';

export function renderDiaryAccessibleData({ mount, trend, trendLabels, tags, heatmap }, documentRef) {
  replaceAccessibleTables(mount, [
    {
      key: 'diary-trend',
      caption: t('diary.trend'),
      headers: [t('chart.data.period'), t('chart.data.score')],
      rows: trend.map((score, index) => [trendLabels[index], Number(score).toFixed(1)]),
    },
    {
      key: 'diary-tags',
      caption: t('diary.topTags'),
      headers: [t('chart.data.tag'), t('chart.data.count')],
      rows: tags.map(({ label, value }) => [label, value]),
    },
    {
      key: 'diary-heatmap',
      caption: t('diary.weekdayTime'),
      headers: [t('chart.data.day'), ...['morning', 'midday', 'afternoon', 'evening', 'lateNight'].map((key) => t(`diary.time.${key}`))],
      rows: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
        .map((dayKey, index) => [t(`diary.day.${dayKey}`), ...heatmap[index]]),
    },
  ], documentRef);
}
