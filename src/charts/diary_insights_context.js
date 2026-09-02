import { t } from '../i18n/index.js';

const CONTEXT_COPY = {
  live: {
    title: 'diary.insights.live.title',
    hint: 'diary.insights.live.hint',
    intro: 'diary.insights.live.intro',
    emptyTrend: 'diary.insights.live.emptyTrend',
    emptyTags: 'diary.insights.live.emptyTags',
  },
  history: {
    title: 'diary.insights.history.title',
    hint: 'diary.insights.history.hint',
    intro: 'diary.insights.history.intro',
    emptyTrend: 'diary.insights.history.emptyTrend',
    emptyTags: 'diary.insights.history.emptyTags',
  },
  community: {
    title: 'diary.insights.community.title',
    hint: 'diary.insights.community.hint',
    intro: 'diary.insights.community.intro',
    emptyTrend: 'diary.insights.community.emptyTrend',
    emptyTags: 'diary.insights.community.emptyTags',
  },
};

export function normalizeDiaryInsightsContext(value) {
  const candidate = typeof value === 'string' ? { mode: value } : (value || {});
  const mode = candidate.mode === 'history'
    ? 'history'
    : candidate.mode === 'community'
      ? 'community'
      : 'live';
  const routeId = mode === 'live' && candidate.routeId != null && String(candidate.routeId).trim()
    ? String(candidate.routeId)
    : null;
  return { mode, routeId };
}

export function describeDiaryInsightsContext(value) {
  const { mode } = normalizeDiaryInsightsContext(value);
  return Object.fromEntries(Object.entries(CONTEXT_COPY[mode]).map(([name, key]) => [name, t(key)]));
}

export function diaryInsightsContextCopy(value) {
  return CONTEXT_COPY[normalizeDiaryInsightsContext(value).mode];
}
