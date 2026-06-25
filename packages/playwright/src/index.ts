/**
 * @enviro365/vw-test-sdk-playwright — public surface (L2).
 *
 * Consumers typically:
 *   import { test, expect } from '@enviro365/vw-test-sdk-playwright';
 */

export { test } from './fixture.js';
export type { VWFixtures } from './fixture.js';

export { expect, toHaveValueImpl, toBeVisibleImpl, toBeEnabledImpl } from './matchers.js';
export type { MatcherOptions, MatcherResult } from './matchers.js';

export { captureFailureBundle } from './evidence.js';
export type { AttachableTestInfo } from './evidence.js';

export { createClientFromEnv, clientOptionsFromEnv } from './clientFromEnv.js';

export { VWReporter } from './reporter.js';
export type { RunSummary } from './reporter.js';

// Convenience: re-export the L1 core surface so consumers can import everything
// (VWPage, VWTestClient, error types, handles, …) from this one package.
export * from '@enviro365/vw-test-sdk-core';
