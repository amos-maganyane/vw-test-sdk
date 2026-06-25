import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@enviro365/vw-test-sdk-core': r('../sdk-core/src/index.ts'),
      '@enviro365/vw-bridge-client': r('../bridge-client/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10_000,
  },
});
