/**
 * fixture.ts — the Playwright `test` fixture providing a per-test VWTestClient
 * plus an auto `evidence` fixture that captures a failure bundle on non-pass.
 */

import { test as base } from '@playwright/test';
import type { VWTestClient } from '@enviro365/vw-test-sdk-core';
import { createClientFromEnv } from './clientFromEnv.js';
import { captureFailureBundle } from './evidence.js';

export interface VWFixtures {
  /** A per-test VWTestClient built from env configuration. */
  vw: VWTestClient;
  /** Auto fixture — captures the failure-evidence bundle on a non-pass result. */
  evidence: void;
}

export const test = base.extend<VWFixtures>({
  vw: async ({}, use) => {
    const vw = createClientFromEnv();
    await use(vw);
  },

  evidence: [
    async ({ vw }, use, testInfo) => {
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        await captureFailureBundle(vw, testInfo);
      }
    },
    { auto: true },
  ],
});
