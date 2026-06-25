/**
 * SDK ↔ bridge compatibility contract (architecture §10.1).
 */

/** This SDK package version. */
export const SDK_VERSION = '0.1.0-rc.0';

/**
 * Minimum bridge version this SDK requires. The 3 new wait predicates
 * (aspectMatches, widgetEnabled, listHasRow) + GET /capabilities ship in
 * vw-runtime-api 0.11.0 (Wave E1a).
 */
export const REQUIRES_BRIDGE_MIN = '0.11.0';

/**
 * Accept any bridge within major 0 (`0.x`). Until the bridge reaches 1.0,
 * every MINOR bump is treated as potentially breaking, but the SDK refuses a
 * DIFFERENT major outright. `verifyBridge()` enforces `>= MIN` and `major === 0`.
 */
export const REQUIRES_BRIDGE_MAX_MAJOR = 0;
