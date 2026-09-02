#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectCrimeChartData,
  replaceAccessibleTables,
} from '../../src/charts/accessible_data.js';
import { buildMonthlyChartModel } from '../../src/charts/line_monthly.js';
import { buildTemporalChartModel } from '../../src/charts/heat_7x24.js';
import { setLanguage } from '../../src/i18n/index.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.scope = '';
    this.textContent = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

const documentRef = { createElement: (tagName) => new FakeElement(tagName) };

test('Crime chart projections preserve every displayed period and raw value', () => {
  setLanguage('en');
  const model = buildMonthlyChartModel(
    [{ m: '2026-01', n: 10 }, { m: '2026-02', n: 20 }],
    [{ m: '2026-01', n: 2 }, { m: '2026-02', n: 3 }],
    { valueMode: 'indexed', currentMonth: '2026-09' },
    { citywide: 'Citywide', selectedArea: 'Selected area' },
  );
  const table = projectCrimeChartData('monthly', model);
  assert.deepEqual(table.headers, ['Period', 'Citywide', 'Selected area']);
  assert.deepEqual(table.rows, [
    ['2026-01', 10, 2],
    ['2026-02', 20, 3],
  ]);
});

test('Crime temporal heat projection exposes the full synchronized 7 by 24 matrix', () => {
  const matrix = Array.from({ length: 7 }, (_, day) => (
    Array.from({ length: 24 }, (_, hour) => day * 24 + hour)
  ));
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const model = buildTemporalChartModel(matrix, { view: 'heat' }, { weekdays });
  const table = projectCrimeChartData('heat', model, {
    weekdays,
    hourLabel: (hour) => `${hour}:00`,
  });
  assert.equal(table.rows.length, 168);
  assert.deepEqual(table.rows[0], ['Mon', '0:00', 0]);
  assert.deepEqual(table.rows.at(-1), ['Sun', '23:00', 167]);
});

test('accessible table renderer emits semantic captions, column headers, and row headers', () => {
  const mount = new FakeElement('div');
  replaceAccessibleTables(mount, [{
    key: 'monthly',
    caption: 'Crime over time',
    headers: ['Period', 'Count'],
    rows: [['2026-01', 10]],
  }], documentRef);
  const [section] = mount.children;
  const [table] = section.children;
  const [caption, head, body] = table.children;
  assert.equal(section.dataset.accessibleChart, 'monthly');
  assert.equal(caption.textContent, 'Crime over time');
  assert.equal(head.children[0].children[0].scope, 'col');
  assert.equal(body.children[0].children[0].scope, 'row');
  assert.equal(body.children[0].children[1].textContent, '10');
});
