import { defineConfig } from '@playwright/test';

/**
 * Serial-only configuration (architecture §4.4) — one worker against the single
 * shared VisualWorks image. Trace attachments are retained on failure so the
 * SDK's evidence bundle (screenshot + state + action log) shows up in the
 * trace viewer's Attachments tab. We use the bridge `/screenshot`, not
 * Playwright's browser screenshot.
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['@enviro365/vw-test-sdk-playwright/reporter'],
  ],
  use: {
    trace: { mode: 'retain-on-failure', attachments: true },
    screenshot: 'off',
  },
  globalSetup: './global-setup.ts',
});
