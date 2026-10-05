/**
 * fixture.ts — the Playwright `test` fixture providing a per-test VWTestClient
 * plus an auto `evidence` fixture that captures a failure bundle on non-pass.
 *
 * With VW_VIDEO=1 the auto fixture also runs a low-fps frame recorder for the
 * lifetime of the test (started when the fixture is set up — before `use()` —
 * and stopped deterministically in `finally`). On failure the recording is
 * attached alongside the still evidence; on pass it is discarded.
 */

import { test as base } from '@playwright/test';
import type { VWTestClient } from '@enviro365/vw-test-sdk-core';
import { createClientFromEnv } from './clientFromEnv.js';
import { captureFailureBundle } from './evidence.js';
import { resolveVideoRetainPolicy, shouldRetainVideo, startVideoRecording } from './video.js';

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
      const recorder = startVideoRecording(vw);
      try {
        await use();
      } finally {
        const recording = await recorder?.stop();
        const failed = testInfo.status !== testInfo.expectedStatus;
        if (shouldRetainVideo(testInfo.status, testInfo.expectedStatus, resolveVideoRetainPolicy())) {
          if (failed) {
            await captureFailureBundle(vw, testInfo, recording);
          } else {
            await recording?.attach(testInfo);
          }
        } else {
          await recording?.discard();
        }
      }
    },
    { auto: true },
  ],
});
