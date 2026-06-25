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

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `VW_BRIDGE_URL` | client / fixture | Bridge base URL (default `http://127.0.0.1:9876`). |
| `VW_BRIDGE_TOKEN_FILE` | client | Path to the bridge token file (overrides the default `%LOCALAPPDATA%\Enviro365\vw-runtime-api\token`). |
| `VW_BRIDGE_TOKEN` | client | Literal bridge token (CI). Takes precedence over the file. |
| `VW_BRIDGE_LOG` | evidence fixture | Path to `vw-runtime-api.log`; when set, its tail is attached on failure. |
| `CI` | client | When truthy, `exclusiveBridge` defaults to `true` (refuses to run if another client is on the bridge). |

## Troubleshooting

- **`BridgeCompatibilityError: requires vw-runtime-api >= 0.11.0`** — the bridge is
  older than the 3 wait predicates + `/capabilities` this SDK needs. Cold-start the
  0.11.0 bridge (`Start-VWRuntimeApi.ps1 -KillExisting -Mode Parcel`).
- **`ECONNREFUSED` / health failures** — the VisualWorks image / bridge is not
  running. Start it, then re-run `scripts/bridge-lifecycle.ps1`.
- **`ERR_PNPM_IGNORED_BUILDS`** — a new dependency with a build script needs an entry
  in `pnpm-workspace.yaml` `allowBuilds` (`esbuild: true`; Playwright browser download
  is intentionally denied — this SDK drives VW, not a browser).
- **`ExclusiveBridgeViolationError`** — another client (e.g. `vw-mcp`) is using the
  bridge. Stop it, or set `exclusiveBridge: false` for intentional coexistence.

## Publishing

Tag-triggered via GitHub Actions ([`release.yml`](.github/workflows/release.yml)).
Publishing requires a `write:packages` PAT in `NODE_AUTH_TOKEN`; the committed
[`.npmrc`](.npmrc) holds only the scoped-registry mapping (never a token).

## License

UNLICENSED — © Enviro365 IT Solutions.
