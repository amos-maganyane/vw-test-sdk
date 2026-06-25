# @enviro365/vw-test-sdk-core

L1 framework-agnostic core for the VisualWorks test SDK. Wraps
[`@enviro365/vw-bridge-client`](../bridge-client) with high-level test
operations — no Playwright dependency, usable from any runner or CI script.

## What's here

- **`VWTestClient`** — `verifyBridge`, `openApplication`, `window()`, `wait`,
  `screenshot`, `evaluate` / `evaluateInGBSSession` (audited), `getActionLog`,
  `cleanupTestArtifacts`, `withTimeout`, `isAnotherClientActive`.
- **`WindowScope`** — title-scoped widget access with a TTL + invalidate-on-mutation
  tree cache.
- **Widget handles** — `WidgetHandle`, `CheckboxHandle`, `TableHandle`,
  `ListHandle`, `DialogScope`.
- **`VWPage`** — Page Object base class for the consuming (L3) repo.
- **Typed errors**, **wait predicates** (8 kinds, capability-gated), and
  **eval safety guards** in parity with `vw-mcp` (destructive-op deny-list).

## Usage

```ts
import { VWTestClient } from '@enviro365/vw-test-sdk-core';

const vw = new VWTestClient({ bridgeUrl: 'http://127.0.0.1:9876' });
await vw.verifyBridge();                       // refuses bridge < 0.11.0
const search = await vw.openApplication('CustomerSearchView');
await search.field('searchText').fill('Test Customer');
await search.button('Search').click();
await vw.wait({ kind: 'listHasRow', aspect: 'results', match: { col: 'Name', value: 'Test Customer' } });
```

Requires a bridge at **v0.11.0+** for live use. Unit tests stub
`BridgeClientLike` and run on any platform.

See the [architecture doc §3 (L1)](../../../tm-context/plan/SDK-ARCHITECTURE-2026-06-25.md).
