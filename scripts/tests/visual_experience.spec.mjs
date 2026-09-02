import {
  assertCtaInsideViewport,
  assertFocusNotObscured,
  assertNoHorizontalOverflow,
  auditSeriousAccessibility,
  captureExperienceScreenshot,
  createRuntimeScriptCollector,
  crimeRequests,
  expect,
  gotoMode,
  RUNTIME_SCRIPT_BUDGETS,
  test,
} from './support/deterministic_browser_fixture.mjs';

function desktopOnly(testInfo) {
  test.skip(testInfo.project.name !== 'desktop', 'Detailed state coverage runs once; responsive routes run in every viewport.');
}

function portraitOnly(testInfo) {
  test.skip(testInfo.project.name !== 'portrait', 'Mobile Sheet state coverage runs in the portrait touch project.');
}

const INCIDENT_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-75.166154, 39.95218] },
      properties: {
        cartodb_id: 101,
        dispatch_date_time: '2026-07-30T18:30:00Z',
        text_general_code: '<img src=x onerror=alert(1)>',
        location_block: '1500 MARKET ST & <script>alert(2)</script>',
        dc_dist: '09',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-75.1668, 39.9527] },
      properties: {
        cartodb_id: 102,
        dispatch_date_time: '2026-07-29T09:15:00Z',
        text_general_code: 'Thefts',
        location_block: '1400 MARKET ST',
        dc_dist: '09',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-75.168, 39.9515] },
      properties: {
        cartodb_id: 103,
        dispatch_date_time: '2026-07-28T14:05:00Z',
        text_general_code: 'Vandalism/Criminal Mischief',
        location_block: '1600 MARKET ST',
        dc_dist: '09',
      },
    },
  ],
};

async function installIncidentPointFixture(page) {
  await page.route('https://phl.carto.com/**', async (route) => {
    const request = route.request();
    const parameters = new URLSearchParams(request.postData() || '');
    const sql = parameters.get('q') || '';
    if (parameters.get('format') === 'GeoJSON'
      && /SELECT\s+cartodb_id/i.test(sql)
      && /ST_Intersects\(the_geom,\s*ST_SetSRID\(ST_GeomFromGeoJSON/i.test(sql)) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(INCIDENT_FIXTURE),
      });
      return;
    }
    await route.fallback();
  });
}

async function expectMinimumTouchTarget(locator, minimum = 44) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, 'touch target must have a layout box').not.toBeNull();
  expect(box.width, 'touch target width').toBeGreaterThanOrEqual(minimum);
  expect(box.height, 'touch target height').toBeGreaterThanOrEqual(minimum);
}

async function expectInsideContainer(inner, outer) {
  const [innerBox, outerBox] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
  expect(innerBox, 'inner element must have a layout box').not.toBeNull();
  expect(outerBox, 'container must have a layout box').not.toBeNull();
  expect(innerBox.x).toBeGreaterThanOrEqual(outerBox.x - 1);
  expect(innerBox.y).toBeGreaterThanOrEqual(outerBox.y - 1);
  expect(innerBox.x + innerBox.width).toBeLessThanOrEqual(outerBox.x + outerBox.width + 1);
  expect(innerBox.y + innerBox.height).toBeLessThanOrEqual(outerBox.y + outerBox.height + 1);
}

async function expectNoOverlap(first, second) {
  const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(firstBox, 'first element must have a layout box').not.toBeNull();
  expect(secondBox, 'second element must have a layout box').not.toBeNull();
  const overlapWidth = Math.max(0, Math.min(firstBox.x + firstBox.width, secondBox.x + secondBox.width) - Math.max(firstBox.x, secondBox.x));
  const overlapHeight = Math.max(0, Math.min(firstBox.y + firstBox.height, secondBox.y + secondBox.height) - Math.max(firstBox.y, secondBox.y));
  expect(overlapWidth * overlapHeight, 'interactive CTA must not cover nearby content').toBe(0);
}

function contrastRatio(rgb, background = [255, 255, 255]) {
  const luminance = (channels) => channels
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const foregroundLuminance = luminance(rgb);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

async function tabTo(page, locator, { maxTabs = 100 } = {}) {
  await expect(locator).toBeVisible();
  for (let index = 0; index < maxTabs; index += 1) {
    if (await locator.evaluate((element) => element === element.ownerDocument.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab order did not reach ${await locator.evaluate((element) => element.outerHTML)}`);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      return;
    }
    await Promise.all(['engagement-analysis', 'engagement-diary'].map((databaseName) => new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = resolve;
      request.onerror = resolve;
      request.onblocked = resolve;
    })));
  });
});

test('Crime direct public route restores URL state and keeps its primary action usable', async ({ page }, testInfo) => {
  await gotoMode(page, 'crime', { analysis: 'district', district: '06', months: 12, utm_source: 'visual-ci' });
  await expect(page.locator('#durationSel')).toHaveValue('12');
  await expect(page.locator('[data-crime-setup]')).toBeHidden();
  await expect(page.locator('[data-analysis-context]')).toBeVisible();
  await expect(page.locator('#compare-card')).toContainText('12 reported incidents');
  await assertNoHorizontalOverflow(page);
  const edit = page.locator('[data-analysis-context-edit]');
  await assertCtaInsideViewport(edit);
  await assertFocusNotObscured(edit);
  expect(new URL(page.url()).searchParams.get('utm_source')).toBe('visual-ci');
  for (const privateKey of ['a', 'b', 'labelA', 'labelB']) {
    expect(new URL(page.url()).searchParams.has(privateKey)).toBe(false);
  }
  if (testInfo.project.name !== 'desktop') {
    await expectMinimumTouchTarget(page.locator('.maplibregl-ctrl-attrib-button'));
  }
  await captureExperienceScreenshot(page, testInfo, 'crime-analysis');
});

test('Crime district analysis keeps the unsupported incident log unavailable', async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await gotoMode(page, 'crime', { analysis: 'district', district: '06' });
  await expect(page.locator('[data-analysis-context]')).toBeVisible();
  await expect(page.locator('[data-crime-canvas-data]')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('[data-diary-visualization-data]')).toHaveAttribute('hidden', '');
  await expect(page.locator('[data-result-pane="summary"]')).toBeVisible();
  const incidentLog = page.getByRole('button', { name: 'Incident log', exact: true });
  await expect(incidentLog).toBeDisabled();
  await expect(incidentLog).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-result-pane="incidents"]')).toBeHidden();
});

test('Crime List reserves the active mobile Sheet height in every state', async ({ page }, testInfo) => {
  portraitOnly(testInfo);
  const viewport = { width: 390, height: 844 };
  await gotoMode(page, 'crime', { analysis: 'district', district: '06' });
  await page.getByRole('radio', { name: 'List', exact: true }).check();
  const panel = page.locator('#sidepanel');
  const workspace = page.locator('[data-crime-list-workspace]');
  const handle = page.locator('#sidepanel > .sheet-handle');
  await expect(workspace).toBeVisible();
  expect(await workspace.evaluate((element) => element.parentElement?.matches('main[data-app-shell]'))).toBe(true);

  const expectReservedSpace = async (state) => {
    await expect(panel).toHaveAttribute('data-sheet-state', state);
    const values = await Promise.all([
      panel.boundingBox(),
      workspace.evaluate((element) => Number.parseFloat(getComputedStyle(element).bottom)),
    ]);
    const [panelBox, listBottom] = values;
    expect(panelBox, `${state} sheet must have a layout box`).not.toBeNull();
    const reservedHeight = viewport.height - panelBox.y;
    expect(
      Math.abs(listBottom - (reservedHeight + 12)),
      `${state} list bottom ${listBottom}px must reserve sheet height ${reservedHeight}px plus 12px`,
    ).toBeLessThanOrEqual(1);
  };

  await expectReservedSpace('half');
  await handle.click();
  await expectReservedSpace('full');
  await handle.click();
  await expectReservedSpace('collapsed');
});

test('Crime editing preserves the query and result navigation exposes one pane at a time', async ({ page }, testInfo) => {
  await gotoMode(page, 'crime', { analysis: 'tract', tract: '42101000403' });
  await expect(page.locator('[data-analysis-context]')).toBeVisible();
  await expect(page.locator('[data-result-pane="summary"]')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('tract')).toBe('42101000403');
  const analyzedUrl = page.url();

  const edit = page.locator('[data-analysis-context-edit]');
  await edit.click();
  await expect(page.locator('[data-crime-setup]')).toBeVisible();
  await expect(page.locator('#queryModeSel')).toBeFocused();
  await expect(page.locator('[data-result-pane="summary"]')).toBeHidden();
  expect(page.url()).toBe(analyzedUrl);

  await edit.click();
  await expect(page.locator('[data-result-pane="summary"]')).toBeVisible();
  await page.getByRole('button', { name: 'Incident log', exact: true }).click();
  await expect(page.locator('#results-drawer')).toBeVisible();
  await expect(page.locator('[data-result-pane="incidents"]')).toBeVisible();
  await expect(page.locator('[data-result-pane="charts"]')).toBeHidden();
  await expect(page.locator('[data-result-pane="summary"]')).toBeHidden();

  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page.locator('[data-result-pane="charts"]')).toBeVisible();
  await expect(page.locator('[data-result-pane="incidents"]')).toBeHidden();
  await assertNoHorizontalOverflow(page);

  if (testInfo.project.name !== 'desktop') {
    const scrollOwners = await page.locator('#sidepanel *').evaluateAll((elements) => elements
      .filter((element) => {
        if (element.offsetParent === null) return false;
        const overflowY = getComputedStyle(element).overflowY;
        return overflowY === 'auto' || overflowY === 'scroll';
      })
      .map((element) => (element.classList.contains('sheet-content') ? 'sheet-content' : element.id || element.className)));
    expect(scrollOwners).toEqual(['sheet-content']);
  }
});

test('Crime workbench has no horizontal overflow at 360, 390, 768, and 1440 pixels', async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await gotoMode(page, 'crime', { analysis: 'district', district: '06' });
  await expect(page.locator('[data-analysis-context]')).toBeVisible();

  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    await assertNoHorizontalOverflow(page);
    const resultNav = page.locator('[data-crime-result-nav]');
    await resultNav.scrollIntoViewIfNeeded();
    const bounds = await resultNav.boundingBox();
    expect(bounds, viewport.width + 'px result navigation must have a layout box').not.toBeNull();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  }
});

test('Crime incident results stay synchronized, escaped, and keyboard reachable', async ({ page }, testInfo) => {
  await installIncidentPointFixture(page);
  await gotoMode(page, 'crime', { analysis: 'tract', tract: '42101000403' });

  const rows = page.locator('.incident-results__item > button');
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: 'Incident log', exact: true }).click();
  const firstRow = rows.first();
  await tabTo(page, firstRow);
  await page.keyboard.press('Enter');

  await expect(firstRow).toBeFocused();
  await expect(firstRow).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.incident-results__item > button[aria-current="true"]')).toHaveCount(1);
  const selected = page.locator('[data-selected-incident]');
  await expect(selected).toBeVisible();
  await expect(selected).toContainText('<img src=x onerror=alert(1)>');
  await expect(selected).toContainText('1500 MARKET ST & <script>alert(2)</script>');
  await expect(selected.locator('img, script')).toHaveCount(0);
  await expect(page.locator('.maplibregl-popup')).toBeVisible();
  await expect(firstRow).toBeInViewport();
  await expectMinimumTouchTarget(firstRow);
  await assertFocusNotObscured(firstRow);
  await assertNoHorizontalOverflow(page);
  expect(
    await auditSeriousAccessibility(page),
    'crime incident-result accessibility issues',
  ).toEqual([]);
  await expect(page.locator('[data-incident-results-status]')).toHaveText('3 incidents · newest first');
  await expect(page.locator('.maplibregl-popup')).toBeVisible();
  await page.locator('#incident-results').evaluate((element) => {
    element.scrollIntoView({ block: 'start', inline: 'nearest' });
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await captureExperienceScreenshot(page, testInfo, 'crime-incident-results', {
    maxDiffPixelRatio: 0.008,
    threshold: 0.5,
  });
});

test('Diary direct route avoids Crime APIs and keeps its rating CTA usable', async ({ page, experience }, testInfo) => {
  await gotoMode(page, 'diary');
  await expect(page.getByRole('heading', { name: 'Route Experience Diary (demo)' })).toBeVisible();
  await expect(page.locator('[data-crime-canvas-data]')).toHaveAttribute('hidden', '');
  await expect(page.locator('[data-diary-visualization-data]')).not.toHaveAttribute('hidden', '');
  expect(crimeRequests(experience.requests)).toEqual([]);
  await assertNoHorizontalOverflow(page);
  const rateAction = page.locator('.diary-rate-action');
  const rateButton = page.getByRole('button', { name: 'Rate your experience on this route' });
  if (testInfo.project.name !== 'desktop') {
    await rateAction.scrollIntoViewIfNeeded();
    await expect(rateAction).toHaveCSS('position', 'static');
    await expect(page.locator('#sidepanel > .sheet-content')).toHaveCSS('overflow-y', 'auto');
    await expectInsideContainer(rateAction, page.locator('#sidepanel'));
    await expectNoOverlap(rateAction, page.locator('.diary-alt-summary'));
  }
  await expect(page.locator('.diary-road-grid-hint')).toHaveCount(0);
  await assertCtaInsideViewport(rateButton);
  await assertFocusNotObscured(rateButton);
  await captureExperienceScreenshot(page, testInfo, 'diary-live');
  const insights = page.getByRole('button', { name: /Insights/ });
  await insights.click();
  await expect(insights).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#diary-insights-root-content')).toBeVisible();
  if (testInfo.project.name !== 'desktop') {
    await expect(page.locator('#sidepanel')).toHaveAttribute('data-sheet-state', 'full');
    await expect(page.locator('.diary-insights__heading--primary')).toBeInViewport();
  }
  await expect(page.getByText('No ratings saved for this route in this period.').first()).toBeVisible();
  await expect(page.locator('.diary-insights__heatmap')).toHaveCount(0);
  if (testInfo.project.name === 'desktop') {
    const insightsBox = await page.locator('.diary-insights-root').boundingBox();
    expect(insightsBox.width).toBeGreaterThanOrEqual(400);
  }
  await assertNoHorizontalOverflow(page);
  await captureExperienceScreenshot(page, testInfo, 'diary-insights-expanded');
});

test('runtime mode boundaries keep initial and analyzed script work deterministic', async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  let collector = createRuntimeScriptCollector(page);
  const scriptMetrics = () => collector.snapshot();
  const assertScriptBudget = async (budget, label) => {
    const resources = await scriptMetrics();
    expect(
      resources.every(({ status }) => status >= 200 && status < 300),
      `${label} script responses: ${resources.map(({ name, status }) => `${status} ${name}`).join(', ')}`,
    ).toBe(true);
    const bytes = resources.reduce((total, entry) => total + entry.bytes, 0);
    expect(bytes, `${label} script bytes: ${resources.map(({ name }) => name).join(', ')}`).toBeLessThanOrEqual(budget);
    return resources.map(({ name }) => name);
  };
  const beginFreshScriptPhase = async () => {
    collector.dispose();
    await page.goto('about:blank');
    collector = createRuntimeScriptCollector(page);
  };

  try {
    await gotoMode(page, 'diary');
    const diaryAssets = await assertScriptBudget(RUNTIME_SCRIPT_BUDGETS.diaryInitial, 'Diary initial');
    expect(
      diaryAssets.some((name) => /routes_diary-[^/]+\.js$/.test(name)),
      `Diary route chunk must load: ${diaryAssets.join(', ')}`,
    ).toBe(true);
    expect(
      diaryAssets.some((name) => /diary_storage-[^/]+\.js$/.test(name)),
      `Diary storage chunk must load: ${diaryAssets.join(', ')}`,
    ).toBe(true);
    expect(diaryAssets.some((name) => /routes_crime-|charts-|incident_results_controller-/.test(name))).toBe(false);

    await beginFreshScriptPhase();
    await gotoMode(page, 'crime');
    const crimeAssets = await assertScriptBudget(RUNTIME_SCRIPT_BUDGETS.crimeInitial, 'Crime initial');
    expect(
      crimeAssets.some((name) => /routes_crime-[^/]+\.js$/.test(name)),
      `Crime route chunk must load: ${crimeAssets.join(', ')}`,
    ).toBe(true);
    expect(crimeAssets.some((name) => /routes_diary-|diary_storage-|charts-|incident_results_controller-/.test(name))).toBe(false);

    await beginFreshScriptPhase();
    await gotoMode(page, 'crime', { analysis: 'tract', tract: '42101000403' });
    await expect(page.locator('#compare-card')).not.toContainText('Choose a location');
    await expect.poll(async () => (await scriptMetrics())
      .filter(({ name }) => /charts-|incident_results_controller-/.test(name)).length).toBe(2);
    const analyzedAssets = await assertScriptBudget(RUNTIME_SCRIPT_BUDGETS.crimeAnalyzed, 'Crime analyzed');
    expect(analyzedAssets.some((name) => /charts-[^/]+\.js$/.test(name))).toBe(true);
    expect(analyzedAssets.some((name) => /incident_results_controller-[^/]+\.js$/.test(name))).toBe(true);
    expect(analyzedAssets.some((name) => /public_area_summary-[^/]+\.js$/.test(name))).toBe(true);
  } finally {
    collector.dispose();
  }
});

test('Crime Help and Data details disclose guidance and fallback provenance', async ({ page }, testInfo) => {
  await gotoMode(page, 'crime', { analysis: 'district', district: '06' });
  await page.locator('[data-analysis-context-edit]').click();
  await expect(page.locator('[data-crime-setup]')).toBeVisible();
  const moreFilters = page.locator('#advancedFilters');
  await moreFilters.locator(':scope > summary').click();
  const dataDetails = moreFilters.locator('section.data-details');
  await expect(dataDetails).toBeVisible();
  await expect(page.locator('#dataStatus')).not.toHaveText('Connecting to live data…');
  await expect(page.locator('[data-app-data-status]')).toHaveAttribute('data-scope-kind', 'fallback');
  await captureExperienceScreenshot(page, testInfo, 'crime-help-data-details', { locator: page.locator('#sidepanel') });
  if (testInfo.project.name !== 'desktop') {
    const areaSelector = page.locator('#queryModeSel');
    const lastHelpItem = dataDetails.locator('[data-app-source-details]');
    await expect(areaSelector).toBeVisible();
    await expect(areaSelector).toHaveCSS('position', 'static');
    await lastHelpItem.scrollIntoViewIfNeeded();
    await expect(lastHelpItem).toBeInViewport();
    await expectNoOverlap(areaSelector, lastHelpItem);
  }

  const globalHelp = page.locator('#about-toggle');
  const globalHelpPanel = page.locator('#about-panel');
  await globalHelp.click();
  await expect(globalHelp).toHaveAttribute('aria-expanded', 'true');
  const sourceLink = globalHelpPanel.locator('a[href*="github.com/raederhans/engagement-project"]');
  const closeHelp = globalHelpPanel.locator('.about-close');
  await expect(globalHelpPanel).toHaveAttribute('role', 'dialog');
  await expect(closeHelp).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(globalHelpPanel.locator('a[href="#help-overview"]')).toBeFocused();
  await expect(sourceLink).toBeVisible();
  await sourceLink.scrollIntoViewIfNeeded();
  await expect(sourceLink).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(globalHelp).toHaveAttribute('aria-expanded', 'false');
  await expect(globalHelpPanel).toHaveAttribute('aria-hidden', 'true');
  await expect(globalHelp).toBeFocused();
});

test('My routes shows a truthful empty state before any local rating', async ({ page }, testInfo) => {
  await gotoMode(page, 'diary');
  await page.getByRole('button', { name: 'My routes', exact: true }).click();
  await expect(page.getByText('No local route ratings yet. Rate a demo route to add it here.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export private backup' })).toBeDisabled();
  await captureExperienceScreenshot(page, testInfo, 'diary-my-routes-empty');
});

test('Sample community stays visibly read-only and illustrative', async ({ page }, testInfo) => {
  await gotoMode(page, 'diary');
  await page.getByRole('button', { name: 'Sample community', exact: true }).click();
  const scopeDisclosure = 'Static, invented, read-only examples; not real-time, not user-submitted, not representative of any population, with no official endorsement, and not a safety or risk rating.';
  await expect(page.getByText('Static examples — not real-time or user-submitted, not representative, no official endorsement, and not safety/risk ratings', { exact: true })).toBeVisible();
  const dataStatus = page.locator('[data-app-data-status]');
  await expect(dataStatus).toHaveText('Static samples');
  await expect(dataStatus).toHaveAttribute('aria-label', scopeDisclosure);
  await expect(dataStatus).toHaveAttribute('title', scopeDisclosure);
  await expect(dataStatus).toHaveAttribute('data-scope-disclosure', scopeDisclosure);
  await expect(page.locator('.diary-community-item')).toHaveCount(3);
  await expect(page.locator('.diary-community-item button')).toHaveCount(0);
  await expect(page.locator('[data-panel-view="diary"] input[type="range"]')).toHaveCount(0);
  await captureExperienceScreenshot(page, testInfo, 'diary-sample-community');
});

test('Rating flow exposes both steps and records the result in My routes', async ({ page }, testInfo) => {
  await gotoMode(page, 'diary');
  await page.getByRole('button', { name: 'Rate your experience on this route' }).click();
  await expect(page.locator('.diary-step-label')).toContainText('Step 1');
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  const unselectedStarColor = await page.getByRole('radio', { name: '1 star' }).evaluate((element) => {
    const channels = getComputedStyle(element).color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3) || [];
    return channels.map(Number);
  });
  expect(contrastRatio(unselectedStarColor), 'unselected rating controls need 3:1 contrast').toBeGreaterThanOrEqual(3);
  await captureExperienceScreenshot(page, testInfo, 'diary-rating-step-1');
  await page.getByRole('radio', { name: '5 stars' }).click();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.locator('.diary-step-label')).toContainText('Step 2');
  if (testInfo.project.name !== 'desktop') {
    await expectMinimumTouchTarget(page.getByRole('button', { name: 'poor lighting' }));
  }
  await captureExperienceScreenshot(page, testInfo, 'diary-rating-step-2');
  await page.getByRole('button', { name: 'poor lighting' }).click();
  await page.getByRole('button', { name: 'Save rating' }).click();
  await expect(page.getByText('Saved locally on this device.')).toBeVisible();
  await page.getByRole('button', { name: 'My routes', exact: true }).click();
  await expect(page.locator('.diary-score-pill').filter({ hasText: '5.0' })).toBeVisible();
  await captureExperienceScreenshot(page, testInfo, 'diary-my-routes-recorded');
});

test('English and Simplified Chinese preserve the active Diary state', async ({ page }, testInfo) => {
  await gotoMode(page, 'diary');
  await page.getByRole('button', { name: 'Sample community', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to Simplified Chinese' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('button', { name: '社区示例', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const zhScopeDisclosure = '静态、虚构、只读示例；非实时、非用户提交、不代表任何总体、无官方背书，也不是安全或风险评级。';
  await expect(page.locator('[data-app-data-status]')).toHaveText('静态示例');
  await expect(page.locator('[data-app-data-status]')).toHaveAttribute('data-scope-disclosure', zhScopeDisclosure);
  await captureExperienceScreenshot(
    page,
    testInfo,
    'diary-sample-community-zh',
    { maxDiffPixelRatio: 0.01 },
  );
  await page.getByRole('button', { name: '切换到英文' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Sample community', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Crime public results and Diary rating complete their primary keyboard flows', async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await gotoMode(page, 'crime', { view: 'list', analysis: 'tract', tract: '42101000403' });
  const listView = page.getByRole('radio', { name: 'List', exact: true });
  await tabTo(page, listView);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'Map', exact: true })).toBeChecked();
  await expect(page.locator('[data-primary-canvas]')).toBeVisible();
  const charts = page.getByRole('button', { name: 'Charts', exact: true });
  await tabTo(page, charts);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-result-pane="charts"]')).toBeVisible();
  const incidentLog = page.getByRole('button', { name: 'Incident log', exact: true });
  await tabTo(page, incidentLog);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-result-pane="incidents"]')).toBeVisible();

  await gotoMode(page, 'diary');
  const rate = page.getByRole('button', { name: 'Rate your experience on this route' });
  await tabTo(page, rate);
  await page.keyboard.press('Enter');
  const firstStar = page.getByRole('radio', { name: '1 star' });
  await tabTo(page, firstStar);
  await page.keyboard.press('End');
  const fiveStars = page.getByRole('radio', { name: '5 stars' });
  await expect(fiveStars).toHaveAttribute('aria-checked', 'true');
  await expect(fiveStars).toBeFocused();
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await tabTo(page, continueButton);
  await page.keyboard.press('Enter');
  await expect(page.locator('.diary-step-label')).toContainText('Step 2');
  const poorLighting = page.getByRole('button', { name: 'poor lighting' });
  await tabTo(page, poorLighting);
  await page.keyboard.press('Enter');
  const save = page.getByRole('button', { name: 'Save rating' });
  await tabTo(page, save);
  await assertFocusNotObscured(save);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved locally on this device.')).toBeVisible();
  await expect(page.locator('.diary-modal-backdrop')).toHaveCount(0);
  const myRoutes = page.getByRole('button', { name: 'My routes', exact: true });
  await tabTo(page, myRoutes);
  await page.keyboard.press('Enter');
  await expect(page.locator('.diary-score-pill').filter({ hasText: '5.0' })).toBeVisible();
});

test('automated accessibility scan reports no critical or serious issues', async ({ page }, testInfo) => {
  await gotoMode(page, 'crime');
  expect(
    await auditSeriousAccessibility(page),
    'crime accessibility issues',
  ).toEqual([]);

  const moreFilters = page.locator('#advancedFilters');
  await moreFilters.locator(':scope > summary').click();
  await expect(moreFilters.locator('section.data-details')).toBeVisible();
  expect(
    await auditSeriousAccessibility(page),
    'crime Data accessibility issues',
  ).toEqual([]);

  await page.locator('#about-toggle').click();
  await expect(page.locator('#about-panel')).toHaveAttribute('aria-hidden', 'false');
  expect(
    await auditSeriousAccessibility(page),
    'crime Help accessibility issues',
  ).toEqual([]);
  await page.keyboard.press('Escape');

  await gotoMode(page, 'diary');
  expect(
    await auditSeriousAccessibility(page),
    'diary accessibility issues',
  ).toEqual([]);
  await page.getByRole('button', { name: 'My routes', exact: true }).click();
  expect(
    await auditSeriousAccessibility(page),
    'diary empty-history accessibility issues',
  ).toEqual([]);

  await page.getByRole('button', { name: 'Live route', exact: true }).click();
  await page.getByRole('button', { name: 'Rate your experience on this route' }).click();
  expect(
    await auditSeriousAccessibility(page),
    'diary rating modal accessibility issues',
  ).toEqual([]);
});

test('two-hundred-percent layout scaling keeps controls reflowed and focus visible', async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 450,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await gotoMode(page, 'crime');
  await assertNoHorizontalOverflow(page);
  await assertFocusNotObscured(page.locator('#addrA'));
  await gotoMode(page, 'diary');
  await assertNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Rate your experience on this route' }).click();
  await page.getByRole('radio', { name: '5 stars' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await assertNoHorizontalOverflow(page);
  await assertFocusNotObscured(page.getByRole('button', { name: 'Save rating' }));
  await session.detach();
});
