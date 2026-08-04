import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const projectRoot = new URL('../../', import.meta.url);

test('monthly chart model compares trend shape on an indexed baseline', async () => {
  const charts = await import(new URL('src/charts/line_monthly.js', projectRoot));
  assert.equal(typeof charts.buildMonthlyChartModel, 'function');

  const model = charts.buildMonthlyChartModel(
    [{ m: '2024-01', n: 1000 }, { m: '2024-02', n: 1100 }],
    [{ m: '2024-01', n: 10 }, { m: '2024-02', n: 15 }],
    { valueMode: 'indexed' },
    { citywide: 'Citywide', selectedArea: 'Selected area', indexedAxis: 'Index (first month = 100)' },
  );

  assert.deepEqual(model.data.datasets[0].data, [100, 110]);
  assert.deepEqual(model.data.datasets[1].data, [100, 150]);
  assert.deepEqual(model.data.datasets[1].rawValues, [10, 15]);
  assert.equal(model.options.scales.y.title.text, 'Index (first month = 100)');
});

test('monthly insight excludes the current partial month from its change conclusion', async () => {
  const charts = await import(new URL('src/charts/line_monthly.js', projectRoot));
  const model = charts.buildMonthlyChartModel(
    [
      { m: '2026-06', n: 100 },
      { m: '2026-07', n: 110 },
      { m: '2026-08', n: 2 },
    ],
    [],
    { valueMode: 'indexed', currentMonth: '2026-08' },
    {},
  );
  assert.equal(model.insight.cityChange, 10);
  assert.equal(model.insight.excludesPartialMonth, true);
});

test('offense chart model sorts rows and supports share and Pareto views', async () => {
  const charts = await import(new URL('src/charts/bar_topn.js', projectRoot));
  assert.equal(typeof charts.buildTopNChartModel, 'function');

  const rows = [
    { text_general_code: 'B', n: 20 },
    { text_general_code: 'A', n: 60 },
    { text_general_code: 'C', n: 20 },
  ];
  const share = charts.buildTopNChartModel(rows, { valueMode: 'share', categoryLimit: 2 }, { shareAxis: 'Share' });
  assert.deepEqual(share.data.labels, ['A', 'B']);
  assert.deepEqual(share.data.datasets[0].data, [60, 20]);
  assert.equal(share.data.datasets[0].valueKind, 'share');
  assert.equal(share.options.scales.x.max, 100);

  const pareto = charts.buildTopNChartModel(rows, { valueMode: 'pareto', categoryLimit: 3 }, { cumulativeShare: 'Cumulative share' });
  assert.deepEqual(pareto.data.datasets[1].data, [60, 80, 100]);
  assert.equal(pareto.data.datasets[1].type, 'line');
  assert.equal(pareto.data.datasets[1].xAxisID, 'cumulative');
  assert.equal(pareto.options.scales.cumulative.axis, 'x');
});

test('offense chart model wraps long category labels without changing their insight text', async () => {
  const charts = await import(new URL('src/charts/bar_topn.js', projectRoot));
  const model = charts.buildTopNChartModel(
    [{ text_general_code: 'Burglary Non-Residential', n: 30 }],
    { valueMode: 'count', categoryLimit: 5 },
    {},
  );
  assert.deepEqual(model.data.labels, [['Burglary', 'Non-Residential']]);
  assert.equal(model.insight.topLabel, 'Burglary Non-Residential');
});

test('temporal chart model offers heat, weekday, and hour views from one matrix', async () => {
  const charts = await import(new URL('src/charts/heat_7x24.js', projectRoot));
  assert.equal(typeof charts.buildTemporalChartModel, 'function');

  const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
  matrix[1][8] = 2;
  matrix[1][9] = 3;
  matrix[5][20] = 7;
  const copy = { weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };

  const heat = charts.buildTemporalChartModel(matrix, { view: 'heat', classification: 'quantile' }, copy);
  assert.equal(heat.data.datasets[0].data.length, 168);
  assert.equal(heat.insight.peakDay, 5);
  assert.equal(heat.insight.peakHour, 20);

  const weekday = charts.buildTemporalChartModel(matrix, { view: 'weekday' }, copy);
  assert.deepEqual(weekday.data.datasets[0].data, [0, 5, 0, 0, 0, 7, 0]);

  const hour = charts.buildTemporalChartModel(matrix, { view: 'hour' }, copy);
  assert.equal(hour.data.datasets[0].data[20], 7);
  assert.equal(hour.data.datasets[0].data[8], 2);
});

test('right drawer exposes accessible chart controls and insight regions', async () => {
  const html = await fs.readFile(new URL('index.html', projectRoot), 'utf8');
  assert.match(html, /id="chart-display-settings"/);
  assert.match(html, /id="chart-monthly-controls"/);
  assert.match(html, /id="chart-topn-controls"/);
  assert.match(html, /id="chart-7x24-controls"/);
  assert.match(html, /id="chart-monthly-insight"[^>]*aria-live="polite"/);
  assert.match(html, /id="chart-topn-insight"[^>]*aria-live="polite"/);
  assert.match(html, /id="chart-7x24-insight"[^>]*aria-live="polite"/);
});

test('chart preference store updates one setting without losing the other views', async () => {
  const charts = await import(new URL('src/charts/index.js', projectRoot));
  assert.equal(typeof charts.createChartPreferenceStore, 'function');
  const store = charts.createChartPreferenceStore();
  assert.deepEqual(store.read(), {
    palette: 'blue',
    showLabels: true,
    monthlyView: 'indexed',
    topView: 'count',
    categoryLimit: 8,
    temporalView: 'heat',
    classification: 'quantile',
  });
  store.update('topView', 'share');
  assert.equal(store.read().topView, 'share');
  assert.equal(store.read().monthlyView, 'indexed');
});

test('chart controls and insights are registered in both locales', async () => {
  const source = await fs.readFile(new URL('src/i18n/crime_charts.js', projectRoot), 'utf8');
  for (const key of [
    'chart.settings',
    'chart.palette',
    'chart.showLabels',
    'chart.view.indexed',
    'chart.view.count',
    'chart.view.share',
    'chart.view.pareto',
    'chart.view.heat',
    'chart.view.weekday',
    'chart.view.hour',
    'chart.classification.quantile',
    'chart.insight.peakPeriod',
  ]) {
    assert.match(source, new RegExp(`['\"]${key.replaceAll('.', '\\.') }['\"]\\s*:\\s*\\[[^\\]]+,[^\\]]+\\]`));
  }
});

test('lazy chart catalog reapplies translations when chart controls are bound', async () => {
  const source = await fs.readFile(new URL('src/charts/index.js', projectRoot), 'utf8');
  assert.match(source, /applyTranslations\(document\)/);
});
