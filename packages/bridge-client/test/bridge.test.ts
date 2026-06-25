import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeClient } from '../src/bridge.js';

// Track tmp files created per test for cleanup.
const tmpFiles: string[] = [];
async function makeTokenFile(value: string): Promise<string> {
  const path = join(tmpdir(), `vw-bridge-test-token-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await fs.writeFile(path, value, 'utf-8');
  tmpFiles.push(path);
  return path;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const f of tmpFiles.splice(0)) {
    try {
      await fs.unlink(f);
    } catch {
      /* ignore */
    }
  }
});

describe('BridgeClient — basic GET / POST', () => {
  it('health() hits /health with no auth header', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ status: 'ok', version: '0.11.0' }));
    const tokenFile = await makeTokenFile('tok-1');
    const client = new BridgeClient({ bridgeUrl: 'http://127.0.0.1:9876', tokenFile });

    const result = await client.health();

    expect(result).toEqual({ status: 'ok', version: '0.11.0' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call?.[0]).toBe('http://127.0.0.1:9876/health');
    const headers = (call?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('version() hits /version with no auth header', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        version: '0.11.0',
        buildCommitSha: 'abc123',
        buildTimestamp: '2026-06-21T17:07:23Z',
        parcelMode: 'Parcel',
      })
    );
    const tokenFile = await makeTokenFile('tok-1');
    const client = new BridgeClient({ bridgeUrl: 'http://127.0.0.1:9876', tokenFile });

    const result = await client.version();

    expect(result.version).toBe('0.11.0');
    expect(result.parcelMode).toBe('Parcel');
    const headers = (vi.mocked(fetch).mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('getJson() sends Bearer auth + returns parsed JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ count: 1908 }));
    const tokenFile = await makeTokenFile('tok-1');
    const client = new BridgeClient({ bridgeUrl: 'http://127.0.0.1:9876', tokenFile });

    const result = await client.getJson('/windows');

    expect(result).toEqual({ count: 1908 });
    const headers = (vi.mocked(fetch).mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-1');
  });

  it('postJson() sends Bearer auth + JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));
    const tokenFile = await makeTokenFile('tok-1');
    const client = new BridgeClient({ bridgeUrl: 'http://127.0.0.1:9876', tokenFile });

    await client.postJson('/click', { aspect: 'searchButton' });

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ aspect: 'searchButton' }));
  });

  it('postEval() sends text/plain body + Bearer auth', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, result: '3' }));
    const tokenFile = await makeTokenFile('tok-1');
    const client = new BridgeClient({ bridgeUrl: 'http://127.0.0.1:9876', tokenFile });

    const result = await client.postEval('1 + 2');

    expect(result).toEqual({ ok: true, result: '3' });
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBe('text/plain');
    expect(headers['Authorization']).toBe('Bearer tok-1');
    expect(init?.body).toBe('1 + 2');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://127.0.0.1:9876/eval');
  });

  it('strips trailing slash on bridgeUrl', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ status: 'ok', version: '0.11.0' }));
    const tokenFile = await makeTokenFile('tok-1');
    const client = new BridgeClient({ bridgeUrl: 'http://127.0.0.1:9876/', tokenFile });

    await client.health();

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://127.0.0.1:9876/health');
  });
});

describe('BridgeClient — token caching', () => {
  it('caches token across calls (single fs.readFile)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ x: 1 }))
      .mockResolvedValueOnce(jsonResponse({ x: 2 }));
    const tokenFile = await makeTokenFile('tok-cached');
    const readFileSpy = vi.spyOn(fs, 'readFile');
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    await client.getJson('/a');
    await client.getJson('/b');

    // readFile called exactly once across two requests — second hit used cache.
    expect(readFileSpy).toHaveBeenCalledTimes(1);
  });

  it('re-reads token when file mtime changes', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ x: 1 }))
      .mockResolvedValueOnce(jsonResponse({ x: 2 }));
    const tokenFile = await makeTokenFile('tok-original');
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    await client.getJson('/a');
    // Mutate file with a forced future mtime (avoid sub-ms filesystem resolution issues).
    await fs.writeFile(tokenFile, 'tok-rotated', 'utf-8');
    const futureTime = new Date(Date.now() + 60_000);
    await fs.utimes(tokenFile, futureTime, futureTime);
    await client.getJson('/b');

    const headers0 = (vi.mocked(fetch).mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    const headers1 = (vi.mocked(fetch).mock.calls[1]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers0['Authorization']).toBe('Bearer tok-original');
    expect(headers1['Authorization']).toBe('Bearer tok-rotated');
  });

  it('strips whitespace/newlines from token file content', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ x: 1 }));
    const tokenFile = await makeTokenFile('  tok-with-ws  \n');
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    await client.getJson('/a');

    const headers = (vi.mocked(fetch).mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-with-ws');
  });
});

describe('BridgeClient — 401 retry-with-rotation', () => {
  it('on 401, clears cache + retries once with re-read token', async () => {
    const tokenFile = await makeTokenFile('tok-stale');
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Rotate token before the retry happens
        await fs.writeFile(tokenFile, 'tok-fresh', 'utf-8');
        return new Response('unauthorized', { status: 401 });
      }
      return jsonResponse({ result: 'ok' });
    });
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    const result = await client.getJson('/foo');

    expect(result).toEqual({ result: 'ok' });
    expect(callCount).toBe(2);
    const headers1 = (vi.mocked(fetch).mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    const headers2 = (vi.mocked(fetch).mock.calls[1]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers1['Authorization']).toBe('Bearer tok-stale');
    expect(headers2['Authorization']).toBe('Bearer tok-fresh');
  });

  it('throws BridgeError(401) when retry also returns 401', async () => {
    const tokenFile = await makeTokenFile('tok-bad');
    // mockResolvedValue (not Once) so both initial + retry get a response.
    vi.mocked(fetch).mockResolvedValue(textResponse('unauthorized', 401));
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    await expect(client.getJson('/foo')).rejects.toMatchObject({
      status: 401,
      bodyText: 'unauthorized',
    });
    // 2 fetches = initial + 1 retry (no infinite retry loop)
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx other than 401', async () => {
    const tokenFile = await makeTokenFile('tok-1');
    vi.mocked(fetch).mockResolvedValueOnce(textResponse('not found', 404));
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    await expect(client.getJson('/foo')).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry auth-exempt endpoints (health, version)', async () => {
    const tokenFile = await makeTokenFile('tok-1');
    vi.mocked(fetch).mockResolvedValueOnce(textResponse('unauthorized', 401));
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    // /health is auth-exempt by design; if bridge returns 401 something is wrong but
    // there's no token rotation to retry — must surface the error immediately.
    await expect(client.health()).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('BridgeClient — error mapping', () => {
  it('throws BridgeError(503) on 5xx', async () => {
    const tokenFile = await makeTokenFile('tok-1');
    vi.mocked(fetch).mockResolvedValueOnce(textResponse('Service Unavailable', 503));
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    await expect(client.getJson('/foo')).rejects.toMatchObject({
      status: 503,
      bodyText: 'Service Unavailable',
    });
  });

  it('throws BridgeError(0) on network failure (ECONNREFUSED)', async () => {
    const tokenFile = await makeTokenFile('tok-1');
    const networkErr = new TypeError('fetch failed');
    (networkErr as TypeError & { cause: { code: string } }).cause = { code: 'ECONNREFUSED' };
    vi.mocked(fetch).mockRejectedValueOnce(networkErr);
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    await expect(client.getJson('/foo')).rejects.toMatchObject({ status: 0 });
  });

  it('propagates AbortError on timeout', async () => {
    const tokenFile = await makeTokenFile('tok-1');
    vi.mocked(fetch).mockImplementation((_url, init) => {
      // Wait for the signal to abort; reject as Node's fetch does.
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const client = new BridgeClient({
      bridgeUrl: 'http://test',
      tokenFile,
      timeoutMs: 50,
    });

    await expect(client.getJson('/foo')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('handles invalid JSON response gracefully (throws BridgeError)', async () => {
    const tokenFile = await makeTokenFile('tok-1');
    vi.mocked(fetch).mockResolvedValueOnce(textResponse('not json at all', 200));
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    await expect(client.getJson('/foo')).rejects.toThrow(/JSON/i);
  });
});

describe('BridgeClient — postRaw (string responses)', () => {
  it('postEvalRaw() returns raw response text', async () => {
    const tokenFile = await makeTokenFile('tok-1');
    vi.mocked(fetch).mockResolvedValueOnce(textResponse('{"ok":true,"result":"42"}'));
    const client = new BridgeClient({ bridgeUrl: 'http://test', tokenFile });

    const raw = await client.postEvalRaw('21 * 2');

    expect(raw).toBe('{"ok":true,"result":"42"}');
  });
});
