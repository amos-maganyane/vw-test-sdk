/**
 * errors.ts — typed error hierarchy for the SDK.
 *
 * Every SDK-thrown error extends VWTestSDKError so consumers can `instanceof`
 * the base for blanket handling, or narrow to a specific subclass.
 */

/** Base class for every error this SDK throws. */
export class VWTestSDKError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Bridge version is below `REQUIRES_BRIDGE_MIN` or a different major. */
export class BridgeCompatibilityError extends VWTestSDKError {}

/** An `evaluate` / `evaluateInGBSSession` body tripped a safety guard. */
export class EvalGuardError extends VWTestSDKError {}

/** `evaluateInGBSSession` was called but no live GBS session is registered. */
export class NoGBSSessionError extends VWTestSDKError {}

/** A widget aspect was not found in the scoped window's widget tree. */
export class WidgetNotFoundError extends VWTestSDKError {}

/** A window matching the given title/regex was not found. */
export class WindowNotFoundError extends VWTestSDKError {}

/** An operation (wait / poll) exceeded its timeout. */
export class TimeoutError extends VWTestSDKError {}

/** Exclusive-bridge mode detected a foreign client on the bridge. */
export class ExclusiveBridgeViolationError extends VWTestSDKError {}

/** Foreign bridge activity arrived during a test run. */
export class ConcurrentBridgeActivityError extends VWTestSDKError {}

/** `cleanupTestArtifacts` could not remove every artifact — a real test bug. */
export class IncompleteCleanupError extends VWTestSDKError {
  readonly remainingArtifacts: readonly string[];
  constructor(message: string, remainingArtifacts: readonly string[]) {
    super(message);
    this.remainingArtifacts = remainingArtifacts;
  }
}
