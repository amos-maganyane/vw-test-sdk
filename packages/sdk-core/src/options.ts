/**
 * options.ts — VWTestClient construction options + defaults + token resolution.
 */

import { join } from 'node:path';
import type { ActionEvent } from './actionLog.js';

export interface VWClientOptions {
  /** Bridge base URL. Default http://127.0.0.1:9876. */
  bridgeUrl?: string;
  /** Path to the bridge token file. Default %LOCALAPPDATA%\\Enviro365\\vw-runtime-api\\token. */
  tokenFile?: string;
  /** Minimum bridge version to accept. Default REQUIRES_BRIDGE_MIN ('0.11.0'). */
  bridgeMinVersion?: string;
  /** Default per-operation timeout in ms. Default 10_000. */
  defaultTimeoutMs?: number;
  /** Rolling action-log capacity. Default 100. */
  actionLogCapacity?: number;
  /** Window-tree cache TTL in ms. Default 500. */
  windowTreeCacheTTLMs?: number;
  /**
   * Require exclusive bridge access. When true, `verifyBridge()` throws
   * `ExclusiveBridgeViolationError` if a foreign client is active. Defaults to
   * `true` when `process.env.CI` is truthy, else `false`.
   */
  exclusiveBridge?: boolean;
  /** Observer invoked on every recorded action (for custom reporters). */
  onAction?: (event: ActionEvent) => void;
}

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:9876';
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_ACTION_LOG_CAPACITY = 100;
export const DEFAULT_WINDOW_TREE_CACHE_TTL_MS = 500;

/** Default token-file path: %LOCALAPPDATA%\\Enviro365\\vw-runtime-api\\token. */
export function defaultTokenFile(): string {
  const base = process.env['LOCALAPPDATA'] ?? process.env['HOME'] ?? '.';
  return join(base, 'Enviro365', 'vw-runtime-api', 'token');
}

/**
 * Resolve the token-file path with env precedence (architecture §9.5):
 *   VW_BRIDGE_TOKEN_FILE  >  opts.tokenFile  >  default path.
 *
 * The `VW_BRIDGE_TOKEN` literal-token override is handled in the client
 * constructor (it writes the literal to a temp file so the file-based
 * BridgeClient can read it uniformly).
 */
export function resolveTokenFile(opts: VWClientOptions): string {
  return process.env['VW_BRIDGE_TOKEN_FILE'] ?? opts.tokenFile ?? defaultTokenFile();
}
