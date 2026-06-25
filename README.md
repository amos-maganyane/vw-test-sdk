# vw-test-sdk

Production-grade, Playwright-based UI test SDK for **VisualWorks 9.3.1**
thick-client applications, driven through the
[`vw-runtime-api`](https://github.com/ENVIRO365/vw-runtime-api) HTTP bridge.

VisualWorks renders native widgets — there is no DOM, no Chrome DevTools
Protocol. The bridge **is** the test surface: the SDK opens windows, fills
fields, clicks buttons, waits on widget state, and captures screenshots over
HTTP, while using Playwright as the test runner, assertion engine, and HTML
reporter.

> **Status:** Wave E1 (foundations) in progress. See the
> [execution plan](../tm-context/plan/SDK-EXECUTION-PLAN-WAVE-E1.md). The
> design source of truth is the
> [architecture doc (v1.2)](../tm-context/plan/SDK-ARCHITECTURE-2026-06-25.md).

## Packages

This is a pnpm workspace publishing three layered packages to GitHub Packages
under the `@enviro365` scope:

| Package | Layer | What it does |
|---|---|---|
| [`@enviro365/vw-bridge-client`](packages/bridge-client) | L0 | HTTP transport for the bridge: token rotation, 401-retry, typed response shapes. Framework-agnostic; also consumed by `vw-mcp`. |
| [`@enviro365/vw-test-sdk-core`](packages/sdk-core) | L1 | `VWTestClient` and friends — high-level ops (`openApplication`, `window().field().fill()`, `wait`, `screenshot`), typed errors, action log, audited eval escape hatches, idempotent cleanup. No Playwright dependency. |
| [`@enviro365/vw-test-sdk-playwright`](packages/playwright) | L2 | Thin Playwright surface — `test.extend` fixture, failure-evidence auto-fixture, custom matchers (`toHaveValue`, `toBeVisible`, `toBeEnabled`), reporter. |

Consumers (e.g. a `wealth-tests/` repo) live one layer up (L3) and depend on the
published packages.

## Requirements

- **Node.js 20+**
- **pnpm 11.9+**
- A running **vw-runtime-api bridge at v0.11.0+** (for live/e2e tests only — unit
  tests stub the bridge and need neither VW nor Windows).
- **Windows** for any live test run (`vwnt.exe` is win64).

## Quick start

```bash
pnpm install        # install + link workspace packages
pnpm -r build       # compile all packages to dist/
pnpm test           # run the unit suite (bridge stubbed — runs anywhere)
```

### Authoring a test (target API)

```ts
import { test, expect } from '@enviro365/vw-test-sdk-playwright';

test('customer search returns a row', async ({ vw }) => {
  const search = await vw.openApplication('CustomerSearchView');
  await search.field('searchText').fill('Test Customer');
  await search.button('Search').click();
  await expect(search.table('results')).toHaveRow({ col: 'Name', value: 'Test Customer' });
});
```

## Workspace layout

```
vw-test-sdk/
├── packages/
│   ├── bridge-client/   → @enviro365/vw-bridge-client       (L0)
│   ├── sdk-core/        → @enviro365/vw-test-sdk-core        (L1)
│   └── playwright/      → @enviro365/vw-test-sdk-playwright  (L2)
├── examples/
│   └── hello-world/     → reference Playwright project (reproduces s23 benchmark)
├── scripts/             → e2e-smoke + bridge-lifecycle (CI helpers)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── vitest.config.ts
```

## Test isolation

Tests run **serially** (`workers: 1, fullyParallel: false`) against one shared
VW image. Each test creates artifacts under a unique `TestSDK_<TestName>_<worker>_<ts>`
prefix and removes them in `afterEach` via `vw.cleanupTestArtifacts()`. See
[`AGENTS.md`](AGENTS.md) and architecture §15.

## Publishing

Tag-triggered via GitHub Actions ([`release.yml`](.github/workflows/release.yml)).
Publishing requires a `write:packages` PAT in `NODE_AUTH_TOKEN`; the committed
[`.npmrc`](.npmrc) holds only the scoped-registry mapping (never a token).

## License

UNLICENSED — © Enviro365 IT Solutions.
