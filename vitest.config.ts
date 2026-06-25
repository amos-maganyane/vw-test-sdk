import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const fromRoot = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Root vitest config — runs the entire workspace suite via `pnpm test`.
 *
 * Cross-package imports resolve to each package's `src/index.ts` (not the built
 * `dist/`) so the full suite runs build-independently. Per-package
 * `vitest.config.ts` files scope `pnpm --filter <pkg> test` to a single package.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@enviro365/vw-bridge-client': fromRoot('./packages/bridge-client/src/index.ts'),
      '@enviro365/vw-test-sdk-core': fromRoot('./packages/sdk-core/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'examples/*/test/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node',
    globals: false,
    testTimeout: 10_000,
    reporters: ['default'],
  },
});
