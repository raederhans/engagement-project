import { defineConfig } from '@playwright/test';

const host = '127.0.0.1';
const port = Number(process.env.PLAYWRIGHT_PORT || 4178);
const externalBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || '').trim();
const baseURL = externalBaseUrl || `http://${host}:${port}/`;

export default defineConfig({
  testDir: './scripts/tests',
  testMatch: 'visual_experience.spec.mjs',
  outputDir: 'test-results/visual-experience',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{platform}/{projectName}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 35_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: externalBaseUrl ? undefined : {
    command: `npm run preview -- --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'portrait',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'landscape',
      use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
    },
  ],
});
