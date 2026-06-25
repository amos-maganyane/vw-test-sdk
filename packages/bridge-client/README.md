# @enviro365/vw-bridge-client

L0 HTTP client for the [`vw-runtime-api`](https://github.com/ENVIRO365/vw-runtime-api)
VisualWorks bridge. Handles token rotation (mtime-cached read), 401 retry-with-rotation,
auth-exempt `/health` + `/version`, per-call timeout, and typed response shapes.

Framework-agnostic — no test or SDK logic. Consumed by `vw-mcp` and
`@enviro365/vw-test-sdk-core`.

## Usage

```ts
import { BridgeClient } from '@enviro365/vw-bridge-client';

const bridge = new BridgeClient({
  bridgeUrl: 'http://127.0.0.1:9876',
  tokenFile: process.env.VW_RUNTIME_API_TOKEN_FILE!,
});

const health = await bridge.health();        // { status: 'ok', version: '0.11.0' }
const result = await bridge.postEval('1 + 2'); // { ok: true, result: '3' }
```

See the [architecture doc §3 (L0)](../../../tm-context/plan/SDK-ARCHITECTURE-2026-06-25.md)
for the layering rationale.
