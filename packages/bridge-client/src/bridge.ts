/**
 * bridge.ts — HTTP client for the VW Runtime API.
 *
 * Responsibilities:
 *
 *   1. **Auth + token rotation** — Reads $VW_RUNTIME_API_TOKEN_FILE on every call,
 *      using `fs.stat` mtime as a cheap cache check (~0.1ms on Windows).
 *      When the file's mtime changes, the cached token is invalidated and re-read.
 *
 *   2. **401 retry-with-rotation** — On 401 the cache is forcibly cleared and
 *      ONE retry is issued. This handles the common case where the bridge
 *      rotated its token (cold start) since the AI last cached it.
 *
 *   3. **Auth-exempt endpoints** — `/health` and `/version` skip auth entirely.
 *      No retry on 401 either (no token rotation can fix it).
 *
 *   4. **Error normalization** — Every failure exits via `BridgeError`. The
 *      `safeHandler` wrapper in util.ts maps these to recovery-action messages.
 *
 *   5. **Timeout** — `AbortSignal.timeout(timeoutMs)` per call. Default 30s,
 *      configurable per-client. AbortError propagates upward unchanged so the
 *      formatter can recognize it.
 *
 * Per architecture.md §7.1 + §7.2.
 */

import { promises as fs } from 'node:fs';
import { BridgeError } from './util.js';

// Bridge response shape for /version.
export interface BridgeVersion {
  version: string;
  buildCommitSha: string;
  buildTimestamp: string;
  parcelMode: string;
}

// Bridge response shape for /health.
export interface BridgeHealth {
  status: string;
  version: string;
}

// Bridge response shape for /eval.
export interface BridgeEvalResult {
  ok: boolean;
  result?: string;
  error?: string;
}

interface BridgeClientOptions {
  bridgeUrl: string;
  tokenFile: string;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
}

interface TokenCache {
  value: string;
  mtimeMs: number;
}

/**
 * Public surface of BridgeClient as an interface — so tool factories can
 * be tested with stub objects (no need to instantiate a full BridgeClient
 * or mock `fetch`/`fs` from inside tool tests).
 */
export interface BridgeClientLike {
  health(): Promise<BridgeHealth>;
  version(): Promise<BridgeVersion>;
  getJson<T = unknown>(path: string): Promise<T>;
  postJson<T = unknown>(path: string, body: unknown): Promise<T>;
  postEval(source: string): Promise<BridgeEvalResult>;
  postEvalRaw(source: string): Promise<string>;
  getBinary(path: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  postBinary(path: string, jsonBody: unknown): Promise<{ bytes: Uint8Array; contentType: string }>;
}

export class BridgeClient implements BridgeClientLike {
  private readonly bridgeUrl: string;
  private readonly tokenFile: string;
  private readonly timeoutMs: number;
  private tokenCache: TokenCache | null = null;

  constructor(opts: BridgeClientOptions) {
    // Normalize: strip trailing slash so we can compose `${bridgeUrl}${path}`.
    this.bridgeUrl = opts.bridgeUrl.replace(/\/+$/, '');
    this.tokenFile = opts.tokenFile;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  // -------------------------------------------------------------------------
  // Public HTTP API
  // -------------------------------------------------------------------------

  /** GET /health — auth-exempt liveness check. */
  async health(): Promise<BridgeHealth> {
    return this.fetchNoAuth<BridgeHealth>('/health', { method: 'GET' });
  }

  /** GET /version — auth-exempt build metadata. */
  async version(): Promise<BridgeVersion> {
    return this.fetchNoAuth<BridgeVersion>('/version', { method: 'GET' });
  }

  /** GET <path> with Bearer auth + JSON response. */
  async getJson<T = unknown>(path: string): Promise<T> {
    return this.fetchAuthedJson<T>(path, { method: 'GET' });
  }

  /** POST <path> with JSON body + Bearer auth + JSON response. */
  async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.fetchAuthedJson<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /**
   * POST /eval with a Smalltalk source string. Returns parsed JSON.
   * input safety guards live in the eval tool layer (src/tools/eval.ts),
   * not here — this method assumes the caller pre-validated.
   */
  async postEval(source: string): Promise<BridgeEvalResult> {
    return this.fetchAuthedJson<BridgeEvalResult>('/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: source,
    });
  }

  /** POST /eval and return the raw response text (no JSON parse). For tools that need pre-parse access. */
  async postEvalRaw(source: string): Promise<string> {
    return this.fetchAuthedText('/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: source,
    });
  }

  /**
   * Auth'd GET that returns binary response bytes + content-type.
   * Used by vw_screenshot for raw PNG retrieval.
   */
  async getBinary(path: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.readToken();
      const res = await this.doFetch(path, this.withAuth({ method: 'GET' }, token));
      if (res.status === 401 && attempt === 0) {
        this.tokenCache = null;
        continue;
      }
      if (!res.ok) {
        const body = await this.safeReadText(res);
        throw new BridgeError(res.status, body);
      }
      const buf = await res.arrayBuffer();
      return {
        bytes: new Uint8Array(buf),
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      };
    }
    throw new BridgeError(500, 'BridgeClient.getBinary retry loop fell through');
  }

  /**
   * Auth'd POST with a JSON body that returns binary response bytes + content-type.
   * Used by vw_screenshot — the bridge's /screenshot endpoint is POST-only and
   * expects a JSON spec body matching parseAndValidateScreenshotRequest:'s
   * contract (target.type, target.appClass?, target.titleContains?, format?,
   * maxBytes?, timeoutMs?). Response on success is a raw PNG byte stream
   * (s23 Bug 4 — vw_screenshot previously used getBinary, hitting 404 because
   * the dispatch route table only lists /screenshot under POST).
   */
  async postBinary(
    path: string,
    jsonBody: unknown
  ): Promise<{ bytes: Uint8Array; contentType: string }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.readToken();
      const res = await this.doFetch(
        path,
        this.withAuth(
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonBody),
          },
          token
        )
      );
      if (res.status === 401 && attempt === 0) {
        this.tokenCache = null;
        continue;
      }
      if (!res.ok) {
        const body = await this.safeReadText(res);
        throw new BridgeError(res.status, body);
      }
      const buf = await res.arrayBuffer();
      return {
        bytes: new Uint8Array(buf),
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      };
    }
    throw new BridgeError(500, 'BridgeClient.postBinary retry loop fell through');
  }

  // -------------------------------------------------------------------------
  // Internal HTTP execution
  // -------------------------------------------------------------------------

  /**
   * Auth-required fetch with 401 retry-and-rotate.
   * Returns parsed JSON; throws BridgeError on non-2xx OR parse failure.
   */
  private async fetchAuthedJson<T>(path: string, init: RequestInit): Promise<T> {
    const responseText = await this.fetchAuthedText(path, init);
    return this.parseJsonOrThrow<T>(responseText);
  }

  private async fetchAuthedText(path: string, init: RequestInit): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.readToken();
      const res = await this.doFetch(path, this.withAuth(init, token));
      if (res.status === 401 && attempt === 0) {
        // Bridge rotated the token (cold-start) — drop cache, re-read, retry once.
        this.tokenCache = null;
        continue;
      }
      if (!res.ok) {
        const body = await this.safeReadText(res);
        throw new BridgeError(res.status, body);
      }
      return res.text();
    }
    // Defensive: loop should always return or throw above.
    throw new BridgeError(500, 'BridgeClient retry loop fell through');
  }

  /** Auth-exempt fetch (no Authorization header, no 401 retry). */
  private async fetchNoAuth<T>(path: string, init: RequestInit): Promise<T> {
    const res = await this.doFetch(path, init);
    if (!res.ok) {
      const body = await this.safeReadText(res);
      throw new BridgeError(res.status, body);
    }
    const responseText = await res.text();
    return this.parseJsonOrThrow<T>(responseText);
  }

  private async doFetch(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.bridgeUrl}${path}`;
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // AbortError propagates unchanged so the formatter can recognize it.
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      // Other fetch failures (TypeError from undici) → BridgeError(0).
      if (err instanceof TypeError) {
        const causeCode = (err as TypeError & { cause?: { code?: string } }).cause?.code ?? 'fetch failed';
        throw new BridgeError(0, `Network: ${causeCode}`);
      }
      throw err;
    }
  }

  private withAuth(init: RequestInit, token: string): RequestInit {
    return {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Token cache (mtime-based)
  // -------------------------------------------------------------------------

  /**
   * Read the auth token from $VW_RUNTIME_API_TOKEN_FILE, caching on `mtimeMs`.
   * Cost: one `fs.stat` per call (~0.1ms on Windows). Worth it for transparent
   * rotation handling without polling.
   */
  private async readToken(): Promise<string> {
    const stats = await fs.stat(this.tokenFile);
    if (this.tokenCache && this.tokenCache.mtimeMs === stats.mtimeMs) {
      return this.tokenCache.value;
    }
    const raw = await fs.readFile(this.tokenFile, 'utf-8');
    const value = raw.trim();
    this.tokenCache = { value, mtimeMs: stats.mtimeMs };
    return value;
  }

  // -------------------------------------------------------------------------
  // Body parsing
  // -------------------------------------------------------------------------

  private parseJsonOrThrow<T>(responseText: string): T {
    try {
      return JSON.parse(responseText) as T;
    } catch (parseErr) {
      const snippet = responseText.slice(0, 200);
      throw new BridgeError(
        200,
        `Bridge returned non-JSON body (parse failed). Body starts: ${snippet}`
      );
    }
  }

  private async safeReadText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return '';
    }
  }
}
