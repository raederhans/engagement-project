import { clearMonthlyChart, renderMonthly } from './line_monthly.js';
import { clearTopNChart, renderTopN } from './bar_topn.js';
import { clearTemporalChart, render7x24 } from './heat_7x24.js';
import { clearCrimeChartData, syncCrimeChartData } from './accessible_data.js';
import { applyTranslations, t } from '../i18n/index.js';
import { renderResidentialStability } from '../ui/residential_stability.js';

function renderAreaIntelligenceLoadFailure(error) {
  console.error(error);
  const content = document.querySelector('#area-intelligence [data-area-intelligence-content]');
  if (!content) return false;
  content.closest('.area-intelligence').dataset.modelStatus = 'invalid';
  content.setAttribute('role', 'status');
  content.textContent = t('chart.unavailable', { message: error?.message || error });
  return true;
}

function getStatusElement() {
  const pane = document.getElementById('charts') || document.body;
  let status = document.getElementById('charts-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'charts-status';
    status.className = 'chart-status';
    pane.appendChild(status);
  }
  return status;
}

function writeInsight(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

let controlsBound = false;

function syncChartControls(preferences) {
  const charts = document.getElementById('charts');
  if (charts) charts.dataset.temporalView = preferences.temporalView;
  for (const button of document.querySelectorAll('[data-chart-setting][data-chart-value]')) {
    button.setAttribute('aria-pressed', String(preferences[button.dataset.chartSetting] === button.dataset.chartValue));
  }
  const classification = document.getElementById('chartClassificationSel');
  if (classification) classification.disabled = preferences.temporalView !== 'heat';
}

function bindChartControls({ readPreferences, updatePreference, refreshCached }) {
  if (typeof document === 'undefined') return;
  applyTranslations(document);
  if (controlsBound) return;
  controlsBound = true;
  for (const button of document.querySelectorAll('[data-chart-setting][data-chart-value]')) {
    button.addEventListener('click', () => {
      const next = updatePreference(button.dataset.chartSetting, button.dataset.chartValue);
      syncChartControls(next);
      refreshCached();
    });
  }
  for (const control of document.querySelectorAll('select[data-chart-setting], input[data-chart-setting]')) {
    control.addEventListener('change', () => {
      const value = control.type === 'checkbox' ? control.checked : control.value;
      const next = updatePreference(control.dataset.chartSetting, value);
      syncChartControls(next);
      refreshCached();
    });
  }
  syncChartControls(readPreferences());
}

export function createDefaultChartSinks({
  getCopy,
  readPreferences,
  updatePreference,
  refreshCached,
}) {
  bindChartControls({ readPreferences, updatePreference, refreshCached });
  return {
    status(message) {
      getStatusElement().textContent = message;
    },
    clear() {
      clearMonthlyChart();
      clearTopNChart();
      clearTemporalChart();
      clearCrimeChartData();
      for (const id of ['chart-monthly-insight', 'chart-topn-insight', 'chart-7x24-insight']) {
        writeInsight(id, '');
      }
      renderResidentialStability(null);
      void import('../area_intelligence/view.js')
        .then(({ clearAreaIntelligence }) => clearAreaIntelligence())
        .catch(renderAreaIntelligenceLoadFailure);
    },
    monthly(cityRows, areaRows, copy = getCopy(), preferences = readPreferences()) {
      const canvas = document.getElementById('chart-monthly');
      const context = canvas?.getContext?.('2d');
      if (!context) throw new Error('chart canvas missing: #chart-monthly');
      const model = renderMonthly(context, cityRows, areaRows, copy, { valueMode: preferences.monthlyView, palette: preferences.palette, showLabels: preferences.showLabels });
      syncCrimeChartData('monthly', model, copy);
      writeInsight('chart-monthly-insight', copy.monthlyInsight(model.insight));
    },
    residential(model) {
      renderResidentialStability(model);
    },
    top(rows, copy = getCopy(), preferences = readPreferences()) {
      const canvas = document.getElementById('chart-topn');
      const context = canvas?.getContext?.('2d');
      if (!context) throw new Error('chart canvas missing: #chart-topn');
      const model = renderTopN(context, rows, copy, { valueMode: preferences.topView, categoryLimit: preferences.categoryLimit, palette: preferences.palette, showLabels: preferences.showLabels });
      syncCrimeChartData('top', model, copy);
      writeInsight('chart-topn-insight', copy.topInsight(model.insight));
    },
    heat(matrix, copy = getCopy(), preferences = readPreferences()) {
      const canvas = document.getElementById('chart-7x24');
      const context = canvas?.getContext?.('2d');
      if (!context) throw new Error('chart canvas missing: #chart-7x24');
      const model = render7x24(context, matrix, copy, { view: preferences.temporalView, classification: preferences.classification, palette: preferences.palette, showLabels: preferences.showLabels });
      syncCrimeChartData('heat', model, copy);
      writeInsight('chart-7x24-insight', copy.temporalInsight(model.insight));
    },
    error(error, {
      chart,
      report = true,
      message = t('chart.unavailable', { message: error?.message || error }),
    } = {}) {
      if (report) console.error(error);
      const insightIds = {
        monthly: 'chart-monthly-insight',
        top: 'chart-topn-insight',
        heat: 'chart-7x24-insight',
      };
      const insight = chart ? document.getElementById(insightIds[chart]) : null;
      if (insight) {
        insight.setAttribute('role', 'status');
        insight.setAttribute('aria-live', 'polite');
        insight.textContent = message;
        return;
      }
      getStatusElement().innerText = message;
    },
  };
}
