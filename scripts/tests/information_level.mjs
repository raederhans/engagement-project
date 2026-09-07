import assert from 'node:assert/strict';
import test from 'node:test';
import { initInformationLevel, INFORMATION_LEVEL_KEY } from '../../src/ui/information_level.js';
import { setLanguage } from '../../src/i18n/index.js';

function harness(storage) {
  const attrs = new Map();
  const handlers = new Map();
  const button = {
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: key => attrs.delete(key),
    addEventListener: (key, fn) => handlers.set(key, fn),
    removeEventListener: key => handlers.delete(key),
  };
  const root = { dataset: {} };
  const controller = initInformationLevel({ documentRef: { querySelector: () => button, documentElement: root }, storage });
  return { controller, root, button, attrs, click: () => handlers.get('click')() };
}

test('information preference defaults to compact and persists only its own key', () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const h = harness(storage);
  assert.equal(h.root.dataset.information, 'compact');
  h.click();
  assert.equal(h.root.dataset.information, 'detailed');
  assert.equal(h.attrs.get('aria-pressed'), 'true');
  assert.deepEqual([...saved], [[INFORMATION_LEVEL_KEY, 'detailed']]);
  h.controller.destroy();
  const restored = harness(storage);
  assert.equal(restored.controller.getLevel(), 'detailed');
  restored.click();
  assert.equal(restored.attrs.get('aria-pressed'), 'false');
  restored.controller.destroy();
});

test('information switch tolerates unavailable storage and follows language changes', () => {
  const h = harness({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
  h.click();
  assert.equal(h.controller.getLevel(), 'detailed');
  setLanguage('zh-CN');
  assert.equal(h.button.textContent, '信息：详细');
  setLanguage('en');
  assert.equal(h.button.textContent, 'Info: detailed');
  h.controller.destroy();
});
