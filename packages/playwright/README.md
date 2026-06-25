# @enviro365/vw-test-sdk-playwright

L2 Playwright integration for the VisualWorks test SDK — a thin layer over
[`@enviro365/vw-test-sdk-core`](../sdk-core):

- **`test`** — `test.extend` fixture providing a per-test `vw` (`VWTestClient`)
  plus an auto `evidence` fixture that captures a failure bundle on non-pass.
- **`expect`** — Playwright `expect` extended with polling matchers
  (`toHaveValue`, `toBeVisible`, `toBeEnabled`) that attach the recent action
  log to the diagnostic on failure.
- **`VWReporter`** — run summary reporter.

## Usage

```ts
import { test, expect } from '@enviro365/vw-test-sdk-playwright';

test('customer search', async ({ vw }) => {
  const search = await vw.openApplication('CustomerSearchView');
  await search.field('searchText').fill('Test Customer');
  await search.button('Search').click();
  await expect(search.field('status')).toHaveValue('1 result');
});
```

```ts
// playwright.config.ts
export default defineConfig({
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['@enviro365/vw-test-sdk-playwright/reporter']],
});
```

Env: `VW_BRIDGE_URL`, `VW_BRIDGE_TOKEN_FILE`, `VW_BRIDGE_TOKEN`, `VW_BRIDGE_LOG`.

This SDK drives VisualWorks over the bridge — **no browser binaries** are
required (`@playwright/test` is used purely as the runner + assertion engine).

See the [architecture doc §3 (L2)](../../../tm-context/plan/SDK-ARCHITECTURE-2026-06-25.md).
