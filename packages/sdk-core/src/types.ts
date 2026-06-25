/**
 * types.ts — bridge response shapes + shared SDK value types.
 *
 * The bridge returns loosely-typed JSON; these interfaces give callers useful
 * structure while tolerating extra fields via index signatures.
 */

import type { ActionEvent } from './actionLog.js';

/** One entry from `GET /windows`. */
export interface WindowSummary {
  title: string;
  id?: string | number;
  label?: string;
  [key: string]: unknown;
}

/** A node in the `GET /windows/tree` widget tree. */
export interface WidgetNode {
  type?: string;
  name?: string;
  label?: string;
  model?: string;
  enabled?: boolean;
  visible?: boolean;
  value?: unknown;
  layout?: unknown;
  children?: WidgetNode[];
  [key: string]: unknown;
}

/** Response from `GET /value?aspect=…`. */
export interface WidgetValueResult {
  ok: boolean;
  aspect: string;
  value: unknown;
}

/** Response from `GET /capabilities` (bridge >= 0.11.0). */
export interface BridgeCapabilities {
  waitPredicates: string[];
  screenshotScopes: string[];
  evalGuards: string[];
  maxEvalBodySize: number;
}

/** Composite UI state snapshot for failure evidence. */
export interface StateSnapshot {
  windows: WindowSummary[];
  dialogs: WindowSummary[];
  recentLog: ActionEvent[];
}

/** A foreign client detected on the bridge by `isAnotherClientActive()`. */
export interface ForeignCaller {
  /** OS process id of the foreign caller, or -1 when the bridge can't report it. */
  pid: number;
  /** Last action the foreign caller performed, for operator triage. */
  lastAction: string;
}

/** Options for `cleanupTestArtifacts` (architecture §15.3). */
export interface CleanupOptions {
  /** Test name used to build the `TestSDK_<TestName>_*` artifact prefix. */
  testName: string;
  /** Windows present at test start; any window NOT in this set is closed. */
  baselineWindows?: WindowSummary[];
  /** Abort any active GBS transaction. Default true. */
  abortGBSTransaction?: boolean;
}

/** Result of `cleanupTestArtifacts`. An empty `remainingArtifacts` means clean. */
export interface CleanupReport {
  closedWindows: string[];
  removedClasses: string[];
  remainingArtifacts: string[];
}
