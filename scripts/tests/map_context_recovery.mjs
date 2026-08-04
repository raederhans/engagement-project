#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { installMapContextRecovery } from '../../src/map/initMap.js';

function createElement() {
  const listeners = new Map();
  return {
    dataset: {},
    hidden: true,
    textContent: '',
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    setAttribute(name, value) { this[name] = value; },
    click() { listeners.get('click')?.(); },
  };
}

function createMapHarness() {
  const listeners = new Map();
  return {
    map: {
      on(type, callback) { listeners.set(type, callback); },
      off(type, callback) {
        if (listeners.get(type) === callback) listeners.delete(type);
      },
    },
    emit(type, originalEvent = {}) {
      listeners.get(type)?.({ type, originalEvent });
    },
    has(type) { return listeners.has(type); },
  };
}

test('WebGL loss exposes a bilingual reload path and restoration clears it without rebuilding the map', () => {
  const harness = createMapHarness();
  const root = createElement();
  const message = createElement();
  const reload = createElement();
  const scheduled = [];
  let reloads = 0;
  const recovery = installMapContextRecovery(harness.map, {
    documentRef: {
      querySelector(selector) {
        return {
          '[data-map-recovery]': root,
          '[data-map-recovery-message]': message,
          '[data-map-recovery-reload]': reload,
        }[selector] || null;
      },
    },
    windowRef: { location: { reload() { reloads += 1; } } },
    scheduler: {
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
      clearTimeout() {},
    },
  });

  harness.emit('webglcontextlost');
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.phase, 'lost');
  assert.equal(message.textContent, 'Map rendering paused. Your analysis is still available.');
  assert.equal(reload.hidden, false);
  assert.equal(reload.textContent, 'Reload map');
  reload.click();
  assert.equal(reloads, 1);

  harness.emit('webglcontextrestored');
  assert.equal(root.dataset.phase, 'restored');
  assert.equal(message.textContent, 'Map rendering restored.');
  assert.equal(reload.hidden, true);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 4_000);
  scheduled[0].callback();
  assert.equal(root.hidden, true);

  recovery.remove();
  assert.equal(harness.has('webglcontextlost'), false);
  assert.equal(harness.has('webglcontextrestored'), false);
});

test('removing WebGL recovery releases listeners, timers, and visible status', () => {
  const harness = createMapHarness();
  const root = createElement();
  const message = createElement();
  const reload = createElement();
  const cleared = [];
  const recovery = installMapContextRecovery(harness.map, {
    documentRef: {
      querySelector(selector) {
        return {
          '[data-map-recovery]': root,
          '[data-map-recovery-message]': message,
          '[data-map-recovery-reload]': reload,
        }[selector] || null;
      },
    },
    scheduler: {
      setTimeout() { return 7; },
      clearTimeout(id) { cleared.push(id); },
    },
  });

  harness.emit('webglcontextlost');
  harness.emit('webglcontextrestored');
  recovery.remove();

  assert.deepEqual(cleared, [7]);
  assert.equal(root.hidden, true);
  assert.equal(root.dataset.phase, 'idle');
  harness.emit('webglcontextlost');
  assert.equal(root.hidden, true);
});
