# vw-test-sdk — Playwright test SDK for VisualWorks 9.3.1

## Identity

A pnpm workspace publishing three packages under `@enviro365/` to GitHub
Packages. It provides a Playwright-based UI test framework for VisualWorks
9.3.1 thick-client apps (MAS / Momentum Wealth WEALTH) driven through the
[vw-runtime-api](../vw-runtime-api/) HTTP bridge at `http://127.0.0.1:9876`.

This is a **code repo** — the cross-cutting operating discipline lives in the
workspace-root [`AGENTS.md`](../AGENTS.md) and the meta workspace
[`tm-context/AGENTS.md`](../tm-context/AGENTS.md). The **design source of truth**
is [`tm-context/plan/SDK-ARCHITECTURE-2026-06-25.md`](../tm-context/plan/SDK-ARCHITECTURE-2026-06-25.md)
(v1.2) and the **execution plan** is
[`tm-context/plan/SDK-EXECUTION-PLAN-WAVE-E1.md`](../tm-context/plan/SDK-EXECUTION-PLAN-WAVE-E1.md).

## Packages (layered — see architecture §3)

| Layer | Package | Purpose |
|---|---|---|
| L0 | `@enviro365/vw-bridge-client` | HTTP transport for the bridge (token rotation, 401 retry, typed responses). Extracted from `vw-mcp/src/bridge.ts`. No test/SDK logic. |
| L1 | `@enviro365/vw-test-sdk-core` | `VWTestClient`, `WindowScope`, widget handles, `wait`, screenshot, eval guards, action log, `cleanupTestArtifacts`. No Playwright dependency. |
| L2 | `@enviro365/vw-test-sdk-playwright` | `test.extend` fixture, evidence auto-fixture, custom matchers, reporter. |

`examples/hello-world` is a consumer project reproducing the s23 benchmark
stretch state (NOT shipped).

## Stack

- **pnpm workspace** (pnpm 11.9+), **TypeScript** (ESM, NodeNext, strict), **vitest** unit tests.
- **Node 20+** target (`.nvmrc` pins 20; CI uses 20). Builds via `tsc` per package (emits `.d.ts`).
- esbuild (vitest's transform engine) is approved via `allowBuilds: { esbuild: true }` in
  [`pnpm-workspace.yaml`](pnpm-workspace.yaml) — pnpm 11 blocks build scripts by default
  (`ERR_PNPM_IGNORED_BUILDS`); this approval clears it.

## Build + test

```powershell
pnpm install            # installs deps + links workspace packages
pnpm -r build           # tsc per package → dist/ (+ .d.ts), topological order
pnpm -r typecheck       # tsc --noEmit per package
pnpm test               # vitest run, whole workspace (bridge stubbed; no live VW needed)
pnpm --filter @enviro365/vw-test-sdk-core test   # scope to one package
```

Unit tests stub `BridgeClientLike` and run on any platform. The **live** gates
(hello-world 10×, e2e-smoke) require a running bridge at v0.11.0 and a Windows
VW image — see the execution plan.

## Repo-specific rules

### Test idempotency + artifact naming (architecture §15 — NON-NEGOTIABLE)

Tests run serially against ONE shared `vwnt.exe` image. Every test-created
Smalltalk artifact MUST be prefixed:

```
TestSDK_<TestName>_<WorkerIndex>_<UnixTimestamp>
```

- `TestName` = sanitized Playwright title (alphanumeric + `_`, max 40 chars)
- `WorkerIndex` = `testInfo.parallelIndex` (0 in serial mode)
- `UnixTimestamp` = `Math.floor(Date.now() / 1000)` at test start

Every spec MUST call `vw.cleanupTestArtifacts({ testName })` in `afterEach`. It
closes opened windows, removes `TestSDK_<TestName>_*` classes, aborts GBS
transactions, then **verifies** and fails the test with `IncompleteCleanupError`
if anything remains. Broken cleanup is a real bug — running a spec twice in a
row MUST produce the same result.

### Universal rules (inherited from workspace-root AGENTS.md)

1. **ASK + WAIT before any commit, push, tag, or publish.**
2. **Image state is precious** — never restart `vwnt.exe` casually; it loses in-image fixtures.
3. **No destructive image ops via eval** — `evaluate` / `evaluateInGBSSession` inherit the
   same deny-list as `vw-mcp`'s `vw_eval` (`ObjectMemory snapshot` family, `relocateObject:from:`).
4. **Bridge Bug #5** — never send an eval body containing both `'VWBridge'` and `'dispatch'` substrings.

### Publishing

Packages publish to GitHub Packages (`@enviro365` scope) via the tag-triggered
[`release.yml`](.github/workflows/release.yml) workflow — **never** `pnpm publish`
by hand. The auth token (`write:packages` PAT) lives in the user-global
`~/.npmrc` or CI `NODE_AUTH_TOKEN`; it is NEVER committed (`.npmrc` here holds
only the scoped registry mapping).

## Cross-references

| Topic | Where |
|---|---|
| SDK architecture (v1.2) | [`../tm-context/plan/SDK-ARCHITECTURE-2026-06-25.md`](../tm-context/plan/SDK-ARCHITECTURE-2026-06-25.md) |
| Wave E1 execution plan | [`../tm-context/plan/SDK-EXECUTION-PLAN-WAVE-E1.md`](../tm-context/plan/SDK-EXECUTION-PLAN-WAVE-E1.md) |
| Workspace overview | [`../AGENTS.md`](../AGENTS.md) |
| Bridge repo (vw-runtime-api) | [`../vw-runtime-api/AGENTS.md`](../vw-runtime-api/AGENTS.md) |
| MCP server repo (vw-mcp) | [`../vw-mcp/AGENTS.md`](../vw-mcp/AGENTS.md) |
| VW image API contract | [`../tm-context/knowledge/vw-image-api-contract.md`](../tm-context/knowledge/vw-image-api-contract.md) |
