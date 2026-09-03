#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CRIME_RADIUS_POLICY,
  normalizeCrimeRadius,
} from '../../src/state/crime_radius_policy.js';
import {
  configureRadiusControls,
  describeRadiusControlState,
} from '../../src/ui/panel_radius_controls.js';
import {
  decodeCrimeViewState,
  encodeCrimeViewState,
} from '../../src/state/crime_view_state.js';

class FakeOption {
  constructor() {
    this.dataset = {};
    this.value = '';
    this.textContent = '';
  }
}

test('Crime radius policy owns DOM constraints, presets, defaults, and URL validation', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const workbenchSource = await readFile(new URL('../../src/ui/crime_workbench.js', import.meta.url), 'utf8');
  const select = {
    ownerDocument: { createElement: () => new FakeOption() },
    replaceChildren(...children) { this.options = children; },
  };
  const input = {};

  configureRadiusControls({ select, input });

  assert.deepEqual(CRIME_RADIUS_POLICY, {
    min: 100,
    max: 10_000,
    defaultValue: 400,
    presets: [200, 400, 800, 1200, 1600, 2400],
  });
  assert.deepEqual(select.options.map((option) => option.value), [
    '200', '400', '800', '1200', '1600', '2400', 'custom',
  ]);
  assert.deepEqual(input, { min: '100', max: '10000', step: '1' });
  const radiusMarkup = html.match(/<select\b[^>]*id="radiusSel"[^>]*>([\s\S]*?)<\/select>/i)?.[1] || '';
  assert.equal(radiusMarkup.trim(), '');
  assert.doesNotMatch(html, /id="customRadiusInput"[^>]*(?:\bmin=|\bmax=)/i);
  assert.match(workbenchSource, /normalizeCrimeRadius/);
  assert.doesNotMatch(workbenchSource, /\|\|\s*400\b/);

  assert.equal(normalizeCrimeRadius(1375), 1375);
  assert.equal(normalizeCrimeRadius(99), CRIME_RADIUS_POLICY.defaultValue);
  assert.deepEqual(describeRadiusControlState(1375), {
    selectValue: 'custom',
    customValue: '1375',
    customVisible: true,
  });
  assert.equal(decodeCrimeViewState('radius=1375').radius, 1375);
  assert.equal(decodeCrimeViewState('radius=10001').radius, CRIME_RADIUS_POLICY.defaultValue);
  assert.equal(
    new URLSearchParams(encodeCrimeViewState({ radius: 2400 })).get('radius'),
    '2400',
  );

  const { createCrimeAnalysisContext } = await import('../../src/ui/crime_workbench.js');
  const context = createCrimeAnalysisContext({ queryMode: 'buffer', radius: 99 }, {
    translate: (key, params = {}) => key === 'crime.analysisContext.buffer'
      ? `radius:${params.radius}`
      : key,
  });
  assert.equal(context.area, `radius:${CRIME_RADIUS_POLICY.defaultValue}`);
});
