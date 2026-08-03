import { getLanguage } from './index.js';

export function getDateLocale() {
  return getLanguage() === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export function formatLocalizedDate(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(getDateLocale(), options).format(date);
}

export function formatCalendarDate(value, { includeYear = true } = {}) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return formatLocalizedDate(date, {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}
