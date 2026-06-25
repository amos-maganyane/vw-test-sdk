# vw-test-sdk — Session Handoff (EOD)

**Session**: Wave E1b autonomous build (operator asleep; full-autonomy mandate, commits authorized for *this* repo only).
**Supersedes**: the prior "created" handoff. Rolling style — overwrite next session.

---

## TL;DR

Built the **entire `vw-test-sdk` workspace code** (Wave E1b) end-to-end:
3 published-shape packages (L0/L1/L2) + hello-world example + CI helpers.
**116 unit tests green**, full `pnpm -r build` + `pnpm typecheck` + `pnpm test`
clean, and the **built `dist` artifact verified consumable** by a real-importer
smoke. All committed locally on `main` (12 commits, **NOT pushed**).

**Nothing touched the live VW image** — every SDK path is offline/bridge-stubbed.

---

## ⚠️ CRITICAL FINDING — P1 prerequisite is NOT satisfied

The execution-plan prerequisite **P1 (vw-mcp@1.0.4 tagged + published) is FALSE**:

- vw-mcp is on local branch **`wave-a-eval-safety`** with the Wave A eval-safety
  commits (`015cf05` bump to 1.0.4, `c81cb30` tests, `5d3f980` guards) +
  `package.json` at `1.0.4`, **but**: not merged to `main`, **no `v1.0.4` tag**
  (local or remote), **not pushed**, **registry 404** (never published).
- Wave A code is therefore **code-complete but unreleased**.

**Impact**: This gates the *publish* steps (E1b Phase 2 onward) and the
architecture's "Wave A complete" gate. It does **NOT** gate E1a (bridge) or any
E1b **code** — which is exactly why this session's code work is complete.

**Operator decision needed** (was asked at session start, deferred to build):
- **A (recommended)**: complete the v1.0.4 release (merge `wave-a-eval-safety` →
  `main`, tag `v1.0.4`, push → CI publishes). ~15-30 min. Then publishes unblock.
- **B**: keep building non-publish work; release later.

---

## What shipped this session (all committed locally, `main`, NOT pushed)

| # | Commit | Phase |
|---|---|---|
| 087b142 | chore: pnpm workspace scaffold + TypeScript + vitest config | E1b.0.1-0.3 |
| 0b50d02 | docs: per-repo AGENTS.md + project README | E1b.0.4-0.5 |
| 1215835 | ci(actions): scaffold CI + release workflows | E1b.0.6 |
| bae940a | feat(bridge-client): package scaffold | E1b.1.1 |
| 84ecce7 | feat(bridge-client): extract bridge HTTP client + port tests from vw-mcp (L0) | E1b.1.2-1.3 |
| 4182fbd | feat(sdk-core): package scaffold + primitives | E1b.2.1 |
| b1bc6c8 | feat(sdk-core): VWTestClient, WindowScope, handles, wait, page (L1) | E1b.2.2-2.9 |
| 29ac09e | feat(sdk-core): expose WidgetHandle.client for L2 matcher diagnostics | (matcher prep) |
| 1a9ee31 | feat(sdk-playwright): fixture, evidence bundle, matchers, reporter (L2) | E1b.3.1-3.5 |
| 43b9a0c | feat(example): hello-world reproducing s23 benchmark stretch state | E1b.4.1-4.3 |
| eb21439 | feat(scripts): e2e-smoke + bridge-lifecycle CI helpers | E1b.5.1-5.2 |
| a206ae3 | docs(readme): env vars + troubleshooting | E1b.6.2 |

### Packages (all build to `dist/` with `.d.ts`)
- **`@enviro365/vw-bridge-client`** (L0, `1.0.0-rc.0`) — verbatim extraction of
  `vw-mcp/src/bridge.ts` + `BridgeError`/`formatBridgeError`. **18 ported tests** (parity).
- **`@enviro365/vw-test-sdk-core`** (L1, `0.1.0-rc.0`) — `VWTestClient`,
  `WindowScope` (TTL+invalidate cache), 5 widget handles, `VWPage`, 8-kind
  capability-gated `wait`, **eval-safety guards in parity with vw-mcp**,
  `cleanupTestArtifacts` (§15), `withTimeout`, `isAnotherClientActive`,
  exclusive-bridge enforcement. **83 tests**.
- **`@enviro365/vw-test-sdk-playwright`** (L2, `0.1.0-rc.0`) — `test.extend`
  fixture, 4-artifact failure-evidence auto-fixture, `toHaveValue`/`toBeVisible`/
  `toBeEnabled` polling matchers w/ action-log diagnostics, `VWReporter`. **15 tests**.
- **`examples/hello-world`** — serial Playwright project + `MCPBenchReviewPage`
  POM + s23 spec (compiles; live run deferred).

---

## Quality gates passed (evidence)

| Gate | Result |
|---|---|
| `pnpm install` | exit 0 (allowBuilds: `esbuild: true`, `playwright: false` — no browser dl) |
| `pnpm -r build` (3 pkgs, topological) | exit 0 |
| `pnpm typecheck` (pkgs + example + scripts) | exit 0 (strict + exactOptionalPropertyTypes) |
| `pnpm test` (whole workspace) | **116 passed / 14 files** |
| `pnpm install --frozen-lockfile` (CI mimic) | exit 0 |
| dist-level consumer smoke (real import of built artifact) | PASSED — guards active at runtime |

> LSP/tsserver is not installed (operator previously declined); `tsc` build +
> typecheck is the authoritative type-safety gate throughout.

---

## DEFERRED — resume queue (need operator auth and/or a live 0.11.0 bridge)

1. **Push vw-test-sdk** (one command, your call):
   `wsl --cd /mnt/c/Users/ammaganyane/tm/vw-test-sdk git push -u origin main`
   (12 commits ahead of `origin/main` `5eded64`; first push triggers `ci.yml` on
   GitHub — build+typecheck+test, all expected green. Tags are NOT pushed, so no publish fires.)
2. **Resolve P1** — the vw-mcp@1.0.4 release decision above.
3. **Wave E1a — bridge v0.11.0** (`vw-runtime-api`): 3 wait predicates
   (`aspectMatches`, `widgetEnabled`, `listHasRow`) + `GET /capabilities` +
   parcel rebuild + 5× cold-start gate + tag `v0.11.0`. **Not done this session**
   — it restarts the precious image 5× and is cross-repo tag/push, unsuitable for
   unsupervised work. The SDK already targets 0.11.0 (`REQUIRES_BRIDGE_MIN`).
4. **Publishes** (all gated, immutable — never done unattended): bridge-client
   `1.0.0-rc.0`→`1.0.0`, sdk-core, sdk-playwright; **vw-mcp refactor** to consume
   the extracted bridge-client (E1b.1.5/1.6) + regression (365 vitest + 27 smoke).
5. **Live gates**: `pnpm e2e:smoke` + hello-world `--repeat-each=10` (need the
   running 0.11.0 bridge). Confirm the s23 seeder selector + `subInstructions`
   column/aspect names against the live image (currently faithful placeholders).
6. **`isAnotherClientActive` probe**: confirm the exact `VWBridge.st` accessor for
   active-handler count (currently a Bug-#5-safe, fail-open best-effort probe).

---

## Deviations from the plan (deliberate, documented)

- **pnpm 11.9 build approval** uses `allowBuilds:` map in `pnpm-workspace.yaml`
  (the older `onlyBuiltDependencies` list is silently ignored in 11.9 — verified).
- **Inter-package deps** use `dependencies: workspace:*` (not `peerDependencies`)
  — cleaner monorepo linking; pnpm rewrites `workspace:*` to the real version on
  publish. (`@playwright/test` IS a peer + dev dep.)
- **`withTimeout` + `cleanupTestArtifacts`** are `VWTestClient` methods (not the
  plan's separate `withTimeout.ts`/`cleanup.ts` files) — smaller surface.
- **ESLint deferred**: `lint` resolves to typecheck for the MVP (avoids an
  unattended eslint-config failure mode). Note for a hardening pass.
- **`toHaveRow` matcher not built** (only the 3 in E1b.3.4); hello-world asserts
  via `dataset().waitForRow(...)` + `getRowCount()`.
- **`exactOptionalPropertyTypes: true`** enabled per the plan; all code complies.

---

## Environment / state

- **Bridge UNCHANGED** (never touched): `vwnt.exe` PID **5488**, version `0.10.0`,
  FileIn mode, token tail `…-884830`. (SDK work is entirely offline/stubbed.)
- **Toolchain**: node v26.3.0 + pnpm **11.9.0** (installed globally this session)
  on Windows; **git via WSL** (workspace convention). `@types/node`/tsc target ES2022.
- **Git identity** set locally on this repo: `amos-maganyane <amos.maganyane@enviro365.co.za>`
  (mirrored from vw-mcp; repo-scoped only).
- **vw-mcp / vw-runtime-api / tm-context**: untouched by this session.

---

## Next-session opening sequence

1. Read this handoff.
2. Decide **push** (item 1) + **P1** (item 2).
3. If proceeding to publishes: do P1 first, then E1b Phase 2 publish chain.
4. For live validation: stand up the 0.11.0 bridge (Wave E1a) — supervised.
5. Optionally update `tm-context/plan/PHASE-PROGRESS.md` (different repo; not
   touched this session per the "sdk repo only" commit authorization).

**Final acceptance gate (execution plan §4)**: F1-F9 + F5-F8 (bridge tag, /version,
/capabilities, publishes) remain open pending E1a + the publish chain; F10-F11
(hello-world 10× + 0 leftover classes) need the live bridge. F12 (clean
conventional commits) ✅. The **code** for the whole wave is in place + green.
