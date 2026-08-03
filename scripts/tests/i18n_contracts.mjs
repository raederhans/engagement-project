import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const projectRoot = new URL('../../', import.meta.url);
const runtimeUrl = new URL('src/i18n/index.js', projectRoot);
const switchUrl = new URL('src/ui/language_switch.js', projectRoot);
const html = readFileSync(new URL('index.html', projectRoot), 'utf8');
const diaryDemoHtml = readFileSync(new URL('diary-demo.html', projectRoot), 'utf8');
const mainSource = readFileSync(new URL('src/main.js', projectRoot), 'utf8');
const diaryDemoSource = readFileSync(new URL('src/diary_demo_main.js', projectRoot), 'utf8');

function requireFile(url, label) {
  assert.equal(existsSync(url), true, `${label} must exist`);
}

test('application exposes an accessible language-switch mount and localized static bindings', () => {
  assert.match(html, /data-language-switch-mount/);
  assert.match(html, /data-i18n="app\.title"/);
  assert.match(html, /data-i18n-placeholder="crime\.address\.primaryPlaceholder"/);
  assert.match(html, /data-i18n-aria-label="app\.label"/);
  assert.ok((html.match(/data-i18n(?:-[a-z-]+)?=/g) || []).length >= 55);
  assert.match(diaryDemoHtml, /data-language-switch-mount/);
  assert.match(diaryDemoHtml, /data-i18n="diary\.demoDocumentTitle"/);
});

test('localization runtime normalizes, persists, translates, and notifies', async () => {
  requireFile(runtimeUrl, 'localization runtime');
  const {
    LANGUAGE_STORAGE_KEY,
    createI18nController,
    messages,
    normalizeLanguage,
  } = await import(runtimeUrl);

  assert.equal(normalizeLanguage('zh'), 'zh-CN');
  assert.equal(normalizeLanguage('zh-SG'), 'zh-CN');
  assert.equal(normalizeLanguage('en-GB'), 'en');
  assert.equal(normalizeLanguage('fr'), 'en');
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages['zh-CN']).sort());

  const values = new Map([[LANGUAGE_STORAGE_KEY, 'zh-CN']]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const controller = createI18nController({ storage, navigatorLanguages: ['en-US'] });
  assert.equal(controller.getLanguage(), 'zh-CN');
  assert.equal(controller.t('language.switch'), 'English');
  assert.equal(controller.t('crime.findingPoint', { target: 'A' }), '正在查找 A 点…');

  const observed = [];
  const unsubscribe = controller.subscribe((language) => observed.push(language));
  assert.equal(controller.setLanguage('en'), 'en');
  unsubscribe();
  assert.equal(values.get(LANGUAGE_STORAGE_KEY), 'en');
  assert.deepEqual(observed, ['en']);
});

test('language switch is a focused component initialized before the rest of the UI', () => {
  requireFile(switchUrl, 'language switch component');
  const source = readFileSync(switchUrl, 'utf8');
  assert.match(source, /export function initLanguageSwitch/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /language\.switch/);
  assert.match(mainSource, /initializeTranslations/);
  assert.match(mainSource, /initLanguageSwitch/);
  assert.match(diaryDemoSource, /initializeTranslations/);
  assert.match(diaryDemoSource, /initLanguageSwitch/);
});

test('all declared translation keys exist in both catalogs', async () => {
  requireFile(runtimeUrl, 'localization runtime');
  await import(new URL('src/i18n/history.js', projectRoot));
  const { messages } = await import(runtimeUrl);
  const candidateFiles = [
    'index.html',
    'src/main.js',
    'src/mode_coordinator.js',
    'src/ui/about.js',
    'src/ui/panel.js',
    'src/ui/mode_surfaces.js',
    'src/ui/analysis_history_panel.js',
    'src/analysis/analysis_history_controller.js',
    'src/ui/sheet_controller.js',
    'src/compare/card.js',
    'src/routes_crime/index.js',
    'src/routes_diary/index.js',
    'src/routes_diary/form_submit.js',
    'src/routes_diary/ui_live_panel.js',
    'src/routes_diary/ui_my_routes_panel.js',
    'src/routes_diary/ui_insights_panel.js',
    'src/routes_diary/ui_community_panel.js',
    'src/charts/diary_insights.js',
    'src/charts/index.js',
    'src/map/initMap.js',
    'src/map/legend.js',
    'src/map/points.js',
    'src/map/segments_layer.js',
    'src/map/ui_tooltip.js',
    'src/map/ui_popup_district.js',
    'src/map/wire_points.js',
    'src/map/render_choropleth.js',
    'src/map/render_choropleth_tracts.js',
  ];
  const keys = new Set();
  const patterns = [
    /data-i18n(?:-[a-z-]+)?="([a-z][a-zA-Z0-9_.-]+)"/g,
    /\b(?:t|translateHtml)\(\s*['"]([a-z][a-zA-Z0-9_.-]+)['"]/g,
    /\bsetTranslated(?:Text|Attribute)\([^,]+,\s*['"]([a-z][a-zA-Z0-9_.-]+)['"]/g,
  ];
  for (const relative of candidateFiles) {
    const source = readFileSync(new URL(relative, projectRoot), 'utf8');
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) keys.add(match[1]);
    }
  }
  assert.ok(keys.size >= 120, `expected broad UI coverage, found ${keys.size} translation keys`);
  for (const key of keys) {
    assert.ok(Object.hasOwn(messages.en, key), `missing English translation: ${key}`);
    assert.ok(Object.hasOwn(messages['zh-CN'], key), `missing Chinese translation: ${key}`);
  }
});

test('every reader-visible UI surface participates in localization', () => {
  const localizedSurfaces = [
    'src/mode_coordinator.js',
    'src/ui/about.js',
    'src/ui/panel.js',
    'src/ui/mode_surfaces.js',
    'src/ui/analysis_history_panel.js',
    'src/analysis/analysis_history_controller.js',
    'src/ui/sheet_controller.js',
    'src/compare/card.js',
    'src/routes_crime/index.js',
    'src/routes_diary/index.js',
    'src/routes_diary/form_submit.js',
    'src/routes_diary/ui_live_panel.js',
    'src/routes_diary/ui_my_routes_panel.js',
    'src/routes_diary/ui_insights_panel.js',
    'src/routes_diary/ui_community_panel.js',
    'src/charts/diary_insights.js',
    'src/charts/index.js',
    'src/map/initMap.js',
    'src/map/legend.js',
    'src/map/points.js',
    'src/map/segments_layer.js',
    'src/map/ui_tooltip.js',
    'src/map/ui_popup_district.js',
    'src/map/wire_points.js',
    'src/map/render_choropleth.js',
    'src/map/render_choropleth_tracts.js',
  ];
  for (const relative of localizedSurfaces) {
    const source = readFileSync(new URL(relative, projectRoot), 'utf8');
    assert.match(source, /\/i18n\/(?:index|history)\.js|\.\.\/i18n\/(?:index|history)\.js/, `${relative} is not wired to i18n`);
  }
});
