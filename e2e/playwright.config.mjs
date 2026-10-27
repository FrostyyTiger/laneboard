// The cockpit's acceptance harness (cockpit spec slices.md §2, D88, D113):
// Playwright Test, Chromium only, headless, one worker, no retries, a trace on
// the first failure. `npm run test:cockpit` (all), `-- -g 'S-C1-04|S-C1-05'`
// (some), `-- e2e/cockpit/c1-pane.spec.mjs` (one file). Not in `npm test`.
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');

export default defineConfig({
  testDir: path.join(ROOT, 'e2e', 'cockpit'),
  testMatch: /.*\.spec\.mjs$/,
  outputDir: path.join(ROOT, 'test-results'),
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1368, height: 912 },
    deviceScaleFactor: 2,
    hasTouch: true,
    timezoneId: 'Europe/Zurich', // the spec's +01:00 times
    locale: 'en-GB',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream'] },
    trace: 'retain-on-first-failure',
  },
});
