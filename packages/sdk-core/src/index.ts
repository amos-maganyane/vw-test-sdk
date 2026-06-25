/**
 * @enviro365/vw-test-sdk-core — public surface (L1).
 */

// Client + options
export { VWTestClient } from './client.js';
export type { VWClientOptions } from './options.js';
export {
  DEFAULT_BRIDGE_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_ACTION_LOG_CAPACITY,
  DEFAULT_WINDOW_TREE_CACHE_TTL_MS,
  defaultTokenFile,
  resolveTokenFile,
} from './options.js';

// Version contract
export { SDK_VERSION, REQUIRES_BRIDGE_MIN, REQUIRES_BRIDGE_MAX_MAJOR } from './version.js';

// Errors
export {
  VWTestSDKError,
  BridgeCompatibilityError,
  EvalGuardError,
  NoGBSSessionError,
  WidgetNotFoundError,
  WindowNotFoundError,
  TimeoutError,
  ExclusiveBridgeViolationError,
  ConcurrentBridgeActivityError,
  IncompleteCleanupError,
} from './errors.js';

// Window + handles
export { WindowScope } from './window.js';
export { WidgetHandle, findWidgetByAspect } from './handles/widget.js';
export { CheckboxHandle } from './handles/checkbox.js';
export { TableHandle } from './handles/table.js';
export type { RowMatch } from './handles/table.js';
export { ListHandle } from './handles/list.js';
export { DialogScope } from './handles/dialog.js';
export type { WidgetContext } from './handles/context.js';

// Page object base
export { VWPage } from './page.js';

// Wait
export { ALL_WAIT_PREDICATE_KINDS } from './wait.js';
export type { WaitPredicate, WaitOptions } from './wait.js';

// Screenshot
export type { ScreenshotOptions } from './screenshot.js';

// Action log
export { ActionLog } from './actionLog.js';
export type { ActionEvent } from './actionLog.js';

// Eval guards
export { checkEvalSafety } from './evalGuards.js';
export type { EvalGuardResult } from './evalGuards.js';

// Smalltalk helpers
export { quoteSmalltalkString, sanitizeTestName, testArtifactPrefix } from './smalltalk.js';

// Shared types
export type {
  WindowSummary,
  WidgetNode,
  WidgetValueResult,
  BridgeCapabilities,
  StateSnapshot,
  ForeignCaller,
  CleanupOptions,
  CleanupReport,
} from './types.js';

// Convenience re-exports of the bridge-client essentials
export { BridgeClient, BridgeError } from '@enviro365/vw-bridge-client';
export type {
  BridgeClientLike,
  BridgeHealth,
  BridgeVersion,
  BridgeEvalResult,
} from '@enviro365/vw-bridge-client';
