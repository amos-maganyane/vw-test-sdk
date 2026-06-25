/**
 * client.ts — VWTestClient: the high-level test client (L1).
 *
 * Wraps a BridgeClient with: bridge-compat verification, audited eval escape
 * hatches (destructive-op guards in parity with vw-mcp), window scoping, widget
 * ops, capability-gated waits, screenshots, idempotent cleanup, per-call timeout
 * elevation, and exclusive-bridge enforcement.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BridgeClient,
  formatBridgeError,
  type BridgeClientLike,
  type BridgeEvalResult,
  type BridgeHealth,
  type BridgeVersion,
} from '@enviro365/vw-bridge-client';

import { ActionLog, type ActionEvent } from './actionLog.js';
import { checkEvalSafety } from './evalGuards.js';
import {
  BridgeCompatibilityError,
  EvalGuardError,
  ExclusiveBridgeViolationError,
  IncompleteCleanupError,
  NoGBSSessionError,
  TimeoutError,
  VWTestSDKError,
} from './errors.js';
import { REQUIRES_BRIDGE_MIN, REQUIRES_BRIDGE_MAX_MAJOR } from './version.js';
import { parseSemver, semverLt } from './semver.js';
import { quoteSmalltalkString, sanitizeTestName } from './smalltalk.js';
import {
  DEFAULT_ACTION_LOG_CAPACITY,
  DEFAULT_BRIDGE_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WINDOW_TREE_CACHE_TTL_MS,
  resolveTokenFile,
  type VWClientOptions,
} from './options.js';
import type {
  BridgeCapabilities,
  CleanupOptions,
  CleanupReport,
  ForeignCaller,
  StateSnapshot,
  WidgetNode,
  WidgetValueResult,
  WindowSummary,
} from './types.js';
import { WindowScope } from './window.js';
import { buildWaitBody, type WaitOptions, type WaitPredicate } from './wait.js';
import { buildScreenshotSpec, type ScreenshotOptions } from './screenshot.js';

const CLASS_NAME_RE = /^[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*$/;
const SELECTOR_RE = /^[A-Za-z][A-Za-z0-9_]*:?$/;
const NO_GBS_SENTINEL = '__VW_TEST_SDK_NO_GBS__';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class VWTestClient {
  private bridge: BridgeClientLike;
  private readonly bridgeConfig: { bridgeUrl: string; tokenFile: string } | null;
  private readonly log: ActionLog;
  private readonly onAction: ((event: ActionEvent) => void) | null;
  private readonly bridgeMinVersion: string;
  private readonly defaultTimeoutMs: number;
  private readonly windowTreeCacheTTLMs: number;
  private readonly exclusiveBridge: boolean;
  private capsCache: BridgeCapabilities | null = null;

  /**
   * @param opts   public configuration
   * @param bridge optional injected transport (for tests / advanced use); when
   *               omitted a BridgeClient is built from `opts`.
   */
  constructor(opts: VWClientOptions = {}, bridge?: BridgeClientLike) {
    this.bridgeMinVersion = opts.bridgeMinVersion ?? REQUIRES_BRIDGE_MIN;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.windowTreeCacheTTLMs = opts.windowTreeCacheTTLMs ?? DEFAULT_WINDOW_TREE_CACHE_TTL_MS;
    this.exclusiveBridge = opts.exclusiveBridge ?? Boolean(process.env['CI']);
    this.onAction = opts.onAction ?? null;
    this.log = new ActionLog(opts.actionLogCapacity ?? DEFAULT_ACTION_LOG_CAPACITY);

    if (bridge !== undefined) {
      this.bridge = bridge;
      this.bridgeConfig = null;
    } else {
      const bridgeUrl = opts.bridgeUrl ?? DEFAULT_BRIDGE_URL;
      const tokenFile = this.resolveLiveTokenFile(opts);
      this.bridge = new BridgeClient({ bridgeUrl, tokenFile, timeoutMs: this.defaultTimeoutMs });
      this.bridgeConfig = { bridgeUrl, tokenFile };
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle + introspection
  // ---------------------------------------------------------------------------

  /** GET /health — auth-exempt liveness. */
  async health(): Promise<BridgeHealth> {
    return this.bridge.health();
  }

  /** GET /version — auth-exempt build metadata. */
  async version(): Promise<BridgeVersion> {
    return this.bridge.version();
  }

  /** GET /capabilities (cached). Bridge must be >= 0.11.0. */
  async capabilities(): Promise<BridgeCapabilities> {
    if (this.capsCache !== null) return this.capsCache;
    const caps = await this.bridge.getJson<BridgeCapabilities>('/capabilities');
    this.capsCache = caps;
    return caps;
  }

  /**
   * Verify the bridge version satisfies the SDK contract, fetch capabilities,
   * and (in exclusive mode) refuse if a foreign client is active.
   */
  async verifyBridge(): Promise<BridgeCapabilities> {
    const v = await this.bridge.version();
    if (semverLt(v.version, this.bridgeMinVersion)) {
      throw new BridgeCompatibilityError(
        `vw-test-sdk requires vw-runtime-api >= ${this.bridgeMinVersion}, got ${v.version}. ` +
          `Upgrade via Start-VWRuntimeApi.ps1 -KillExisting -Mode Parcel.`
      );
    }
    if (parseSemver(v.version).major !== REQUIRES_BRIDGE_MAX_MAJOR) {
      throw new BridgeCompatibilityError(
        `vw-test-sdk supports bridge major ${REQUIRES_BRIDGE_MAX_MAJOR}.x only; got ${v.version}.`
      );
    }
    const caps = await this.capabilities();
    if (this.exclusiveBridge) {
      const others = await this.isAnotherClientActive();
      if (others.length > 0) {
        throw new ExclusiveBridgeViolationError(
          `vw-test-sdk requires exclusive bridge access (exclusiveBridge/CI mode). Foreign clients ` +
            `detected: ${others.map((o) => `pid=${o.pid} lastAction=${o.lastAction}`).join('; ')}. ` +
            `Stop other consumers (vw-mcp, other suites) before running.`
        );
      }
    }
    return caps;
  }

  // ---------------------------------------------------------------------------
  // Window discovery + scoping
  // ---------------------------------------------------------------------------

  /** A title-scoped handle for one window. */
  window(titleOrRegex: string | RegExp): WindowScope {
    return new WindowScope(this, titleOrRegex, this.windowTreeCacheTTLMs);
  }

  /** GET /windows → list of open windows. */
  async listWindows(): Promise<WindowSummary[]> {
    const windows = await this.bridge.getJson<WindowSummary[]>('/windows');
    return Array.isArray(windows) ? windows : [];
  }

  /** GET /windows/tree → the widget tree for a window. */
  async getWindowTree(windowTitle: string): Promise<WidgetNode> {
    return this.bridge.getJson<WidgetNode>(
      `/windows/tree?windowTitle=${encodeURIComponent(windowTitle)}`
    );
  }

  /** Open an ApplicationModel subclass and return a scope for its window. */
  async openApplication(
    className: string,
    opts: { specSelector?: string; windowTitle?: string } = {}
  ): Promise<WindowScope> {
    if (!CLASS_NAME_RE.test(className)) {
      throw new VWTestSDKError(`openApplication: invalid className "${className}".`);
    }
    if (className === 'VWB' || className.startsWith('VWB.')) {
      throw new VWTestSDKError('openApplication refuses VWB.* classes (the bridge namespace).');
    }
    if (opts.specSelector !== undefined && !SELECTOR_RE.test(opts.specSelector)) {
      throw new VWTestSDKError(`openApplication: invalid specSelector "${opts.specSelector}".`);
    }
    const probe =
      opts.specSelector !== undefined
        ? `${className} new openInterface: #${opts.specSelector}`
        : `${className} open`;
    await this.evaluate(probe);
    this.record('open', { className, specSelector: opts.specSelector });
    return this.window(opts.windowTitle ?? className);
  }

  // ---------------------------------------------------------------------------
  // Widget operations (used by WindowScope handles)
  // ---------------------------------------------------------------------------

  /** POST /click. */
  async clickWidget(aspect: string, windowTitle?: string, opts?: { double?: boolean }): Promise<void> {
    const body: Record<string, unknown> = { aspect };
    if (windowTitle !== undefined) body['windowTitle'] = windowTitle;
    if (opts?.double === true) body['double'] = true;
    await this.bridge.postJson('/click', body);
    this.record('click', { aspect, windowTitle, double: opts?.double === true });
  }

  /** POST /type (direct value-set). */
  async setWidgetValue(aspect: string, value: string, windowTitle?: string): Promise<void> {
    const body: Record<string, unknown> = { aspect, value };
    if (windowTitle !== undefined) body['windowTitle'] = windowTitle;
    await this.bridge.postJson('/type', body);
    this.record('fill', { aspect, windowTitle });
  }

  /** GET /value → the widget's value. */
  async getWidgetValue(aspect: string, windowTitle?: string): Promise<unknown> {
    const params = new URLSearchParams({ aspect });
    if (windowTitle !== undefined) params.set('windowTitle', windowTitle);
    const result = await this.bridge.getJson<WidgetValueResult>(`/value?${params.toString()}`);
    this.record('getValue', { aspect, windowTitle });
    return result.value;
  }

  /** Close a window by title (best-effort via eval). */
  async closeWindow(title: string): Promise<void> {
    const snippet =
      `| w | w := ScheduledWindow allInstances ` +
      `detect: [:each | each label = ${quoteSmalltalkString(title)}] ifNone: [nil]. ` +
      `w isNil ifTrue: ['no-window'] ifFalse: [w controller close. 'closed']`;
    await this.evaluate(snippet);
    this.record('close', { title });
  }

  // ---------------------------------------------------------------------------
  // Synchronization
  // ---------------------------------------------------------------------------

  /** Block until a predicate is satisfied; refuse predicates the bridge does not advertise. */
  async wait(predicate: WaitPredicate, opts: WaitOptions = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const caps = await this.capabilities();
    if (!caps.waitPredicates.includes(predicate.kind)) {
      throw new VWTestSDKError(
        `Bridge does not advertise wait predicate '${predicate.kind}'. Available: ` +
          `${caps.waitPredicates.join(', ')}. Upgrade the bridge (>= ${this.bridgeMinVersion}).`
      );
    }

    if (predicate.kind === 'windowExists' && predicate.title instanceof RegExp) {
      await this.pollForWindow(predicate.title, timeoutMs);
      return;
    }

    const body = buildWaitBody(predicate, timeoutMs);
    let result: { ok?: boolean; error?: string };
    try {
      result = await this.bridge.postJson<{ ok?: boolean; error?: string }>('/wait', body);
    } catch (err) {
      this.record('wait', { predicate: predicate.kind }, false, formatBridgeError(err));
      throw err;
    }
    const ok = result.ok !== false;
    this.record('wait', { predicate: predicate.kind, timeoutMs }, ok, ok ? undefined : result.error ?? 'timed out');
    if (!ok) {
      throw new TimeoutError(
        `wait(${predicate.kind}) not satisfied within ${timeoutMs}ms${result.error ? `: ${result.error}` : ''}`
      );
    }
  }

  private async pollForWindow(regex: RegExp, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const windows = await this.listWindows();
      if (windows.some((w) => regex.test(w.title))) return;
      if (Date.now() >= deadline) {
        throw new TimeoutError(`No window matching ${String(regex)} within ${timeoutMs}ms`);
      }
      await delay(100);
    }
  }

  // ---------------------------------------------------------------------------
  // Evidence
  // ---------------------------------------------------------------------------

  /** POST /screenshot → PNG bytes. */
  async screenshot(opts: ScreenshotOptions = {}): Promise<Buffer> {
    const spec = buildScreenshotSpec(opts);
    const { bytes } = await this.bridge.postBinary('/screenshot', spec);
    this.record('screenshot', { window: opts.windowTitle, appClass: opts.appClass });
    return Buffer.from(bytes);
  }

  /** Windows + dialogs + recent action log, for failure evidence. */
  async snapshotState(): Promise<StateSnapshot> {
    const windows = await this.listWindows().catch(() => [] as WindowSummary[]);
    // The bridge surfaces dialogs within /windows; a dedicated /dialogs feed is
    // reserved for a future bridge version.
    return { windows, dialogs: [], recentLog: this.log.recent(20) };
  }

  /** A snapshot copy of the rolling action log. */
  getActionLog(): ActionEvent[] {
    return this.log.entries();
  }

  // ---------------------------------------------------------------------------
  // Eval escape hatches (audited)
  // ---------------------------------------------------------------------------

  /** Evaluate Smalltalk in the VW image. Throws on guard violation or eval failure. */
  async evaluate(source: string): Promise<string> {
    const result = await this.postEvalChecked(source);
    if (!result.ok) {
      throw new VWTestSDKError(`VW eval failed: ${result.error ?? '(no error message)'}`);
    }
    return result.result ?? '';
  }

  /** Evaluate Smalltalk in the embedded GBS session. Refuses if no session is live. */
  async evaluateInGBSSession(source: string): Promise<string> {
    const safety = checkEvalSafety(source);
    if (!safety.safe) {
      throw new EvalGuardError(safety.reason ?? 'evaluateInGBSSession refused by safety guard');
    }
    const wrapped =
      `GBSM currentSession isNil ` +
      `ifTrue: ['${NO_GBS_SENTINEL}'] ` +
      `ifFalse: [GBSM currentSession execute: ${quoteSmalltalkString(source)}]`;
    const result = await this.postEvalChecked(wrapped);
    if (!result.ok) {
      throw new VWTestSDKError(`GBS eval failed: ${result.error ?? '(no error message)'}`);
    }
    const out = result.result ?? '';
    if (out.includes(NO_GBS_SENTINEL)) {
      throw new NoGBSSessionError(
        'No live GBS session registered with GBSM — evaluateInGBSSession requires a GemStone session.'
      );
    }
    return out;
  }

  private async postEvalChecked(source: string): Promise<BridgeEvalResult> {
    const safety = checkEvalSafety(source);
    if (!safety.safe) {
      this.record('eval', { guard: safety.outcome }, false, safety.reason ?? 'guard');
      throw new EvalGuardError(safety.reason ?? 'eval refused by safety guard');
    }
    const result = await this.bridge.postEval(source);
    this.record('eval', { length: source.length }, result.ok, result.ok ? undefined : result.error ?? 'eval failed');
    return result;
  }

  // ---------------------------------------------------------------------------
  // Concurrency (architecture §11.4)
  // ---------------------------------------------------------------------------

  /**
   * Best-effort detection of foreign clients on the bridge. Probes the bridge
   * singleton's active-handler count (fail-open if the accessor is absent).
   *
   * NOTE: the exact accessor name is pending confirmation against VWBridge.st
   * (deferred with the other live-bridge gates); the probe is written to be
   * Bug-#5-safe (no 'dispatch' substring) and never throws.
   */
  async isAnotherClientActive(): Promise<ForeignCaller[]> {
    const probe =
      `| ns cls | ns := Smalltalk at: #VWB ifAbsent: [nil]. ` +
      `cls := ns isNil ifTrue: [nil] ifFalse: [ns at: #VWBridge ifAbsent: [nil]]. ` +
      `(cls notNil and: [cls respondsTo: #activeHandlerCount]) ` +
      `ifTrue: [((cls singleton activeHandlerCount) - 1) max: 0] ifFalse: [0]`;
    const result = await this.postEvalChecked(probe);
    if (!result.ok) return [];
    const n = Number.parseInt(result.result ?? '0', 10);
    if (!Number.isFinite(n) || n <= 0) return [];
    return Array.from({ length: n }, (_unused, i) => ({ pid: -1, lastAction: `foreign-handler-${i}` }));
  }

  // ---------------------------------------------------------------------------
  // Per-call timeout elevation
  // ---------------------------------------------------------------------------

  /**
   * Run `fn` with the client's bridge temporarily swapped for one with an
   * elevated HTTP timeout (for known-slow ops). Restores the original bridge
   * afterward. When the bridge was injected (tests), this just runs `fn`.
   */
  async withTimeout<T>(timeoutMs: number, fn: () => Promise<T>): Promise<T> {
    if (this.bridgeConfig === null) {
      return fn();
    }
    const original = this.bridge;
    this.bridge = new BridgeClient({
      bridgeUrl: this.bridgeConfig.bridgeUrl,
      tokenFile: this.bridgeConfig.tokenFile,
      timeoutMs,
    });
    try {
      return await fn();
    } finally {
      this.bridge = original;
    }
  }

  // ---------------------------------------------------------------------------
  // Idempotent cleanup (architecture §15)
  // ---------------------------------------------------------------------------

  /**
   * Close test-opened windows, remove `TestSDK_<TestName>_*` classes, abort GBS
   * transactions, then verify. Throws `IncompleteCleanupError` if anything
   * remains — broken cleanup is a real test bug.
   */
  async cleanupTestArtifacts(opts: CleanupOptions): Promise<CleanupReport> {
    const prefix = `TestSDK_${sanitizeTestName(opts.testName)}_`;
    const closedWindows: string[] = [];

    if (opts.baselineWindows !== undefined) {
      const baseline = new Set(opts.baselineWindows.map((w) => w.title));
      const current = await this.listWindows();
      for (const w of current) {
        if (!baseline.has(w.title)) {
          await this.closeWindow(w.title);
          closedWindows.push(w.title);
        }
      }
    }

    const removalSnippet =
      `| removed | removed := OrderedCollection new. ` +
      `(Smalltalk allClasses select: [:c | c name beginsWith: '${prefix}']) ` +
      `do: [:c | removed add: c name. c removeFromSystem]. removed asArray printString`;
    const removedClasses = parseSmalltalkStringArray(await this.evaluate(removalSnippet));

    if (opts.abortGBSTransaction !== false) {
      try {
        await this.evaluateInGBSSession('System abortTransaction');
      } catch {
        // No live GBS session → nothing to abort. Idempotent.
      }
    }

    const verifySnippet =
      `(Smalltalk allClasses select: [:c | c name beginsWith: '${prefix}']) ` +
      `collect: [:c | c name]`;
    const remainingArtifacts = parseSmalltalkStringArray(await this.evaluate(`(${verifySnippet}) asArray printString`));

    const report: CleanupReport = { closedWindows, removedClasses, remainingArtifacts };
    if (remainingArtifacts.length > 0) {
      throw new IncompleteCleanupError(
        `cleanupTestArtifacts left ${remainingArtifacts.length} artifact(s) for "${opts.testName}": ` +
          `${remainingArtifacts.join(', ')}`,
        remainingArtifacts
      );
    }
    this.record('cleanup', { testName: opts.testName, removed: removedClasses.length });
    return report;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private record(kind: string, detail: Record<string, unknown>, ok = true, error?: string): void {
    const event: ActionEvent =
      error !== undefined
        ? { ts: Date.now(), kind, detail, ok, error }
        : { ts: Date.now(), kind, detail, ok };
    this.log.record(event);
    this.onAction?.(event);
  }

  private resolveLiveTokenFile(opts: VWClientOptions): string {
    const literal = process.env['VW_BRIDGE_TOKEN'];
    if (literal !== undefined && literal.length > 0) {
      const tmp = join(tmpdir(), `vw-bridge-token-${process.pid}.txt`);
      writeFileSync(tmp, literal, 'utf-8');
      return tmp;
    }
    return resolveTokenFile(opts);
  }
}

/** Parse a Smalltalk array printString of strings — `('Foo' 'Bar')` → ['Foo','Bar']. */
function parseSmalltalkStringArray(printString: string): string[] {
  const matches = printString.match(/'((?:[^']|'')*)'/g);
  if (matches === null) return [];
  return matches.map((m) => m.slice(1, -1).replace(/''/g, "'"));
}
