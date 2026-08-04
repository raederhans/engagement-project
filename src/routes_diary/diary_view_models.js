import { formatCalendarDate } from '../i18n/date.js';
import { t } from '../i18n/index.js';

export function filterLocalDiaryEntries(entries = [], {
  period = '30d',
  mode = 'all',
  now = Date.now(),
} = {}) {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : null;
  const cutoff = days == null ? null : now - days * 24 * 60 * 60 * 1000;
  return entries
    .filter((entry) => mode === 'all' || entry.mode === mode)
    .filter((entry) => cutoff == null || new Date(entry.createdAt).getTime() >= cutoff)
    .map((entry) => ({
      ...entry,
      date: formatCalendarDate(entry.createdAt, { includeYear: false }),
    }));
}

export function createRouteSummaryModel(route) {
  const props = route?.properties || {};
  const length = Number(props.length_m) || 0;
  const mode = String(props.mode || 'walk').toLowerCase();
  return Object.freeze({
    from: String(props.from || t('diary.start')),
    to: String(props.to || t('diary.destination')),
    mode: t(mode === 'bike' ? 'diary.bike' : 'diary.walk'),
    distance: length >= 1000
      ? `${(length / 1000).toFixed(1).replace(/\.0$/, '')} km`
      : `${Math.round(length)} m`,
    duration: t('diary.minutes', { count: Number(props.duration_min) || 0 }),
  });
}
