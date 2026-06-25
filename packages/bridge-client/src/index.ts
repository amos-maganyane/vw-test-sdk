/**
 * @enviro365/vw-bridge-client — public surface.
 *
 * L0 HTTP transport for the vw-runtime-api VisualWorks bridge. Consumed by
 * vw-mcp (MCP server) and @enviro365/vw-test-sdk-core (test SDK). No
 * test/SDK-specific logic lives here.
 */

export { BridgeClient } from './bridge.js';
export type {
  BridgeClientLike,
  BridgeHealth,
  BridgeVersion,
  BridgeEvalResult,
} from './bridge.js';
export { BridgeError, formatBridgeError } from './util.js';
