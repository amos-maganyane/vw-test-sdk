import { describe, it, expect, afterEach, vi } from 'vitest';
import { clientOptionsFromEnv } from '../src/clientFromEnv.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('clientOptionsFromEnv', () => {
  it('reads bridgeUrl + tokenFile from env', () => {
    vi.stubEnv('VW_BRIDGE_URL', 'http://10.0.0.5:9876');
    vi.stubEnv('VW_BRIDGE_TOKEN_FILE', 'C:/tokens/t.txt');
    expect(clientOptionsFromEnv()).toEqual({
      bridgeUrl: 'http://10.0.0.5:9876',
      tokenFile: 'C:/tokens/t.txt',
    });
  });

  it('lets explicit overrides win over env', () => {
    vi.stubEnv('VW_BRIDGE_URL', 'http://env:9876');
    expect(clientOptionsFromEnv({ bridgeUrl: 'http://explicit:9876' }).bridgeUrl).toBe(
      'http://explicit:9876'
    );
  });

  it('returns just the overrides when env is unset', () => {
    vi.stubEnv('VW_BRIDGE_URL', '');
    vi.stubEnv('VW_BRIDGE_TOKEN_FILE', '');
    // empty string is treated as set; clear instead:
    vi.unstubAllEnvs();
    expect(clientOptionsFromEnv({ defaultTimeoutMs: 5000 })).toEqual({ defaultTimeoutMs: 5000 });
  });
});
