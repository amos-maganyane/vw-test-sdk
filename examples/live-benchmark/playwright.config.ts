import { defineConfig } from '@playwright/test';

/**
 * Live benchmark config — serial, single worker against the one shared VW image.
 *
 * Intentionally has NO global-setup calling `verifyBridge()`: this benchmark
 * targets a bridge >= 0.10.0 and deliberately avoids the 0.11.0-gated
 * `wait()` / `/capabilities` surface, so it runs against the current image.
 * Tests drive the SDK over the bridge with no browser involved.
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['@enviro365/vw-test-sdk-playwright/reporter']],
  use: {
    trace: { mode: 'retain-on-failure', attachments: true },
  },
});
