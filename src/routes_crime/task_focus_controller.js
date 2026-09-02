import {
  applyTranslations,
  onLanguageChange,
  setTranslatedText,
  t,
} from '../i18n/index.js';
import { registerMessagePairs } from '../i18n/messages.js';

registerMessagePairs({
  'focus.eyebrow': ['This session', '本次查看'],
  'focus.change': ['Change focus', '切换关注点'],
  'focus.dialogTitle': ['Choose what to review first', '选择优先查看的内容'],
  'focus.dialogDescription': ['This only changes information order. Your query and results stay the same.', '这只会调整信息顺序；查询条件和结果不会改变。'],
  'focus.general': ['General overview', '通用概览'],
  'focus.generalDescription': ['Start with the overall reported-incident summary.', '先查看已记录事件的整体概览。'],
  'focus.longTerm': ['Long-term context', '长期背景'],
  'focus.longTermDescription': ['Information order changes to show trends and comparison first; the query time window stays the same.', '调整信息顺序，优先显示趋势与对比；查询时间范围保持不变。'],
  'focus.dailyLiving': ['Daily nearby review', '日常周边回顾'],
  'focus.dailyLivingDescription': ['Information order changes to show the incident log and overview first. This is historical, not a live alert.', '调整信息顺序，优先显示事件记录与概览；这是历史信息，不是实时警报。'],
  'focus.suggestedWindows': ['Suggested time windows', '建议时间范围'],
  'focus.suggestedWindowsDescription': ['Review suggested time settings. Nothing changes until you confirm.', '先查看建议的时间设置；只有确认后才会更改查询。'],
  'focus.reviewLatest6': ['Review latest 6 months', '查看最近 6 个月设置'],
  'focus.reviewLatest24': ['Review latest 24 months', '查看最近 24 个月设置'],
  'focus.cancel': ['Cancel', '取消'],
  'focus.apply': ['Use this focus', '按此重点查看'],
  'route.entryTitle': ['Known route history', '已知路线历史记录'],
  'route.entryShort': ['Known route', '已知路线'],
  'route.entryDescription': ['Review historical reported records near a route you explicitly provide.', '查看你明确提供的路线附近的历史已记录事件。'],
  'route.entryOpen': ['View records near a known route', '查看已知路线附近的记录'],
  'route.entryRetry': ['Retry route review', '重试路线查看'],
  'route.loader.loading': ['Preparing route review…', '正在准备路线信息…'],
  'route.loader.unavailable': ['Route review could not load. Retry when ready.', '路线查看暂时无法加载；准备好后可重试。'],
  'preset.eyebrow': ['Suggested query change', '建议的查询更改'],
  'preset.title': ['Review time settings', '查看时间设置'],
  'preset.description': ['Check every change before applying it. Your location, radius, categories, and display settings stay the same.', '应用前请核对每项更改；地点、半径、类别和显示设置都会保持不变。'],
  'preset.cancel': ['Cancel', '取消'],
  'preset.confirm': ['Apply and refresh once', '应用并刷新一次'],
  'preset.undo': ['Undo this change', '撤销本次更改'],
  'preset.previewReady': ['Review the changes below. Nothing has been applied yet.', '请查看下方更改；目前尚未应用。'],
  'preset.unchanged': ['These time settings already match the current query. Nothing needs to change.', '当前查询已使用这些时间设置，无需更改。'],
  'preset.unavailable': ['A verified data range covering this window is required. Your current query is unchanged.', '需要已验证且覆盖该时间范围的数据；当前查询未改变。'],
  'preset.pending': ['Applying the query and refreshing results once…', '正在应用查询并刷新一次结果…'],
  'preset.applied': ['The query was applied and the refreshed historical results are ready.', '查询已应用，刷新后的历史结果已就绪。'],
  'preset.appliedIncomplete': ['The query changed, but refreshed results are not fully available. The query remains editable.', '查询已更改，但刷新结果尚未完全可用；你仍可编辑查询。'],
  'preset.stale': ['The preview expired because the query or data range changed. Review it again before applying.', '查询或数据范围已变化，此预览已过期；请重新查看后再应用。'],
  'preset.undone': ['The prior query was restored and refreshed once.', '先前的查询已恢复，并已刷新一次。'],
  'preset.undoStale': ['Undo expired because the query changed again. Your newer edits were kept.', '查询后来又被修改，撤销已失效；较新的编辑已保留。'],
  'preset.change.startMonth': ['Start month: {before} → {after}', '开始月份：{before} → {after}'],
  'preset.change.durationMonths': ['Duration: {before} months → {after} months', '时长：{before} 个月 → {after} 个月'],
  'preset.unknown': ['Not set', '未设置'],
});

const config = {
  general: {
    focusMode: 'general',
    labelKey: 'focus.general',
    descriptionKey: 'focus.generalDescription',
    preferredInitialPane: 'summary',
  },
  long_term: {
    focusMode: 'long_term',
    labelKey: 'focus.longTerm',
    descriptionKey: 'focus.longTermDescription',
    preferredInitialPane: 'charts',
  },
  daily_living: {
    focusMode: 'daily_living',
    labelKey: 'focus.dailyLiving',
    descriptionKey: 'focus.dailyLivingDescription',
    preferredInitialPane: 'incidents',
  },
};

export const TASK_FOCUS_CONFIG = Object.freeze(config);

export function deriveTaskFocusPresentation(focusMode = 'general') {
  return TASK_FOCUS_CONFIG[focusMode] || TASK_FOCUS_CONFIG.general;
}

export function createTaskFocusController({
  mount,
  presentation,
  presetPorts = {},
  loadQueryPresetModule = () => import('./query_preset_controller.js'),
} = {}) {
  for (const element of mount?.querySelectorAll?.('[data-focus-i18n]') || []) {
    element.dataset.i18n = element.dataset.focusI18n;
  }
  let focusMode = 'general';
  const openButton = mount?.querySelector?.('[data-task-focus-open]');
  const dialog = mount?.querySelector?.('[data-task-focus-dialog]');
  const applyButton = mount?.querySelector?.('[data-task-focus-apply]');
  const current = mount?.querySelector?.('[data-task-focus-current]');
  const description = mount?.querySelector?.('[data-task-focus-description]');
  const options = [...(mount?.querySelectorAll?.('[data-task-focus-option]') || [])];
  const queryPresetMount = mount?.querySelector?.('[data-query-preset-mount]');
  const queryPresetButtons = [...(queryPresetMount?.querySelectorAll?.('[data-query-preset]') || [])];
  const queryPresetListeners = [];
  let queryPresetControllerPromise = null;

  const render = () => {
    const config = deriveTaskFocusPresentation(focusMode);
    if (mount?.dataset) mount.dataset.taskFocus = focusMode;
    setTranslatedText(current, config.labelKey);
    setTranslatedText(description, config.descriptionKey);
    for (const option of options) option.checked = option.value === focusMode;
    applyTranslations(mount);
  };

  const setFocusMode = (nextFocusMode) => {
    const next = deriveTaskFocusPresentation(nextFocusMode);
    focusMode = next.focusMode;
    presentation?.applyTaskFocusPresentation?.(next);
    render();
    return next;
  };

  openButton?.addEventListener?.('click', () => {
    render();
    dialog?.showModal?.();
  });
  applyButton?.addEventListener?.('click', () => {
    const selected = options.find((option) => option.checked);
    setFocusMode(selected?.value);
    dialog?.close?.();
  });
  const openQueryPreset = (presetId) => {
    if (!queryPresetControllerPromise) {
      queryPresetControllerPromise = loadQueryPresetModule()
        .then(({ initCrimeQueryPreset }) => initCrimeQueryPreset({
          mount: queryPresetMount,
          translate: t,
          subscribeLanguageChange: onLanguageChange,
          ...presetPorts,
        }))
        .catch((error) => {
          queryPresetControllerPromise = null;
          console.warn('Query preset is unavailable:', error);
          return null;
        });
    }
    return queryPresetControllerPromise.then((controller) => controller?.openPreset?.(presetId));
  };
  for (const button of queryPresetButtons) {
    const listener = () => void openQueryPreset(button.dataset.queryPreset);
    queryPresetListeners.push([button, listener]);
    button.addEventListener?.('click', listener);
  }
  const releaseLanguage = onLanguageChange(render);
  if (mount) {
    mount.hidden = false;
    setFocusMode('general');
  }

  return {
    getFocusMode: () => focusMode,
    setFocusMode,
    reset: () => setFocusMode('general'),
    dispose() {
      releaseLanguage();
      for (const [button, listener] of queryPresetListeners) {
        button.removeEventListener?.('click', listener);
      }
    },
  };
}

export default function initTaskFocus(presentation, presetPorts) {
  return createTaskFocusController({
    mount: presentation?.mount,
    presentation,
    presetPorts,
  });
}
