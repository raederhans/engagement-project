import { formatCalendarDate } from '../i18n/date.js';
import { t } from '../i18n/index.js';

const diaryHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23',
});

export function filterLocalDiaryEntries(entries = [], {
  period = '30d',
  mode = 'all',
  timeOfDay = 'all',
  query = '',
  now = Date.now(),
} = {}) {
  const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : null;
  const cutoff = days == null ? null : now - days * 24 * 60 * 60 * 1000;
  return entries
    .filter((entry) => mode === 'all' || entry.mode === mode)
    .filter((entry) => cutoff == null || Date.parse(entry.occurredAt || entry.createdAt) >= cutoff)
    .filter((entry) => {
      if (timeOfDay === 'all') return true;
      const date = new Date(entry.occurredAt || entry.createdAt);
      if (!Number.isFinite(date.getTime())) return false;
      const hour = Number(diaryHour.format(date));
      return timeOfDay === 'day' ? hour >= 6 && hour < 18
        : timeOfDay === 'evening' ? hour >= 18 && hour < 22 : hour < 6 || hour >= 22;
    })
    .filter((entry) => !query.trim() || [entry.label, entry.notes, ...(entry.tags || [])]
      .join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Date.parse(b.occurredAt || b.createdAt) - Date.parse(a.occurredAt || a.createdAt))
    .map((entry) => ({
      ...entry,
      date: formatCalendarDate(entry.occurredAt || entry.createdAt, { includeYear: true }),
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
