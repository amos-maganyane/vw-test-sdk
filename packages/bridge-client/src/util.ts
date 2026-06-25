/**
 * util.ts — error types + recovery-action formatting for the VW Runtime API.
 *
 * Extracted from vw-mcp/src/util.ts. The MCP-shaped helpers (text(),
 * errorResult(), safeHandler(), ToolResult/McpContent) stay in vw-mcp; only the
 * framework-agnostic bridge error surface lives here:
 *
 *   - BridgeError — domain error for HTTP/network failures (status 0 = network-level).
 *   - formatBridgeError() — turns any thrown value into a recovery-action message
 *     ("re-read $VW_RUNTIME_API_TOKEN_FILE", "restart via Start-VWRuntimeApi.bat", …).
 *
 * Carry-forward constraints surfaced in error messages:
 *   - #41 compile-on-VWB.* wedge
 *   - bridge listener recursion limit (Bug #5)
 */

/**
 * Domain error for HTTP failures against the VW Runtime API.
 *
 * - `status` = HTTP status code (or 0 for network-level failures).
 * - `bodyText` = response body (truncated in `.message`, full in `.bodyText`).
 */
export class BridgeError extends Error {
  public readonly status: number;
  public readonly bodyText: string;

  constructor(status: number, bodyText: string = '') {
    const messageBody = bodyText ? `: ${bodyText.slice(0, 200)}` : '';
    super(`Bridge HTTP ${status}${messageBody}`);
    this.name = 'BridgeError';
    this.status = status;
    this.bodyText = bodyText;
  }
}

/**
 * Format any thrown value into a recovery-action message.
 *
 * Strategy:
 *   1. BridgeError → status-specific message with VW-context recovery action.
 *   2. AbortError → "request timed out; bridge may be wedged".
 *   3. Network TypeError (Node undici fetch) → ECONNREFUSED / ETIMEDOUT explanation.
 *   4. Generic Error → preserve `.message`.
 *   5. Non-Error throws → `String()` coercion with null/undefined handled.
 */
export function formatBridgeError(err: unknown): string {
  if (err instanceof BridgeError) {
    return formatHttpStatus(err);
  }

  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return (
        `Request to VW Runtime API timed out. The bridge may be wedged (compile-on-VWB.*) ` +
        `or the /eval body may be long-running. Consider increasing the timeout, breaking work into smaller probes, ` +
        `or restarting the bridge (Start-VWRuntimeApi.bat -KillExisting).`
      );
    }

    if (err instanceof TypeError && 'cause' in err) {
      const cause = (err as TypeError & { cause?: { code?: string; message?: string } }).cause;
      const code = cause?.code;
      if (code === 'ECONNREFUSED') {
        return (
          `VW Runtime API is not responding (ECONNREFUSED). Check that the VisualWorks image is running ` +
          `and the bridge is started. Run Start-VWRuntimeApi.bat (or Start-VWRuntimeApi.ps1) to launch it. ` +
          `Ensure VW_RUNTIME_API_HOME is set in your User env vars.`
        );
      }
      if (code === 'ETIMEDOUT' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
        return (
          `VW Runtime API is unreachable (${code}). Check the bridge URL configuration and that ` +
          `the VisualWorks image is healthy. /health should respond within seconds when up.`
        );
      }
      if (code === 'ENOTFOUND') {
        return (
          `VW Runtime API hostname could not be resolved (ENOTFOUND). Bridge URL is misconfigured — ` +
          `expected http://127.0.0.1:9876.`
        );
      }
      return (
        `VW Runtime API is down or unreachable (${code ?? 'fetch failed'}). Check /health and restart ` +
        `via Start-VWRuntimeApi.bat if needed.`
      );
    }

    return err.message;
  }

  if (typeof err === 'string') {
    return err;
  }
  if (err === null || err === undefined) {
    return 'Unknown error (no message available).';
  }
  return String(err);
}

/** Subroutine: VW-flavored recovery messages per HTTP status. */
function formatHttpStatus(err: BridgeError): string {
  const { status, bodyText } = err;

  if (status === 0) {
    return (
      `VW Runtime API is not responding at the configured URL. Check that the VisualWorks image ` +
      `is running and the bridge is started (Start-VWRuntimeApi.bat).`
    );
  }
  if (status === 401) {
    return (
      `VW Runtime API rejected the auth token (HTTP 401). The bridge rotates this on every cold start — ` +
      `re-read $VW_RUNTIME_API_TOKEN_FILE (default %LOCALAPPDATA%\\Enviro365\\vw-runtime-api\\token) and retry. ` +
      `If the file is stale, restart the bridge (Start-VWRuntimeApi.bat).`
    );
  }
  if (status === 403) {
    return (
      `VW Runtime API refused the request (HTTP 403). Verify the token in $VW_RUNTIME_API_TOKEN_FILE matches ` +
      `the running bridge instance, and check the bridge log for the rejection reason.`
    );
  }
  if (status === 404) {
    return (
      `VW Runtime API endpoint not found (HTTP 404). The bridge may be an older version without this endpoint. ` +
      `Check /version (auth-exempt) and update if needed.`
    );
  }
  if (status === 408 || status === 504) {
    return (
      `VW Runtime API timed out (HTTP ${status}). The /eval body may be hung in a wedge — ` +
      `the bridge may be wedged via compile-on-VWB.* (UI announcement fan-out) ` +
      `or by the internal recursion limit. Restart via Start-VWRuntimeApi.bat -KillExisting.`
    );
  }
  if (status === 429) {
    return (
      `VW Runtime API rate-limited the request (HTTP 429). Back off and retry. ` +
      `If this is a tight loop, batch the work into a single /eval probe instead.`
    );
  }
  if (status >= 500) {
    return (
      `VW Runtime API server error (HTTP ${status}): ${bodyText.slice(0, 300)}. ` +
      `The bridge may have crashed mid-request — check /health, then restart via Start-VWRuntimeApi.bat -KillExisting if needed.`
    );
  }
  if (status >= 400) {
    const bodyHint = bodyText ? `: ${bodyText.slice(0, 300)}` : '';
    return `VW Runtime API rejected the request (HTTP ${status})${bodyHint}.`;
  }
  return err.message;
}
