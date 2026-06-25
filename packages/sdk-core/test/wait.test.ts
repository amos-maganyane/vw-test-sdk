import { describe, it, expect, vi } from 'vitest';
import { VWTestClient } from '../src/client.js';
import { buildWaitBody } from '../src/wait.js';
import { TimeoutError, VWTestSDKError } from '../src/errors.js';
import { makeStubBridge, DEFAULT_CAPS } from './_stub.js';

describe('buildWaitBody', () => {
  it('builds aspectEquals body', () => {
    expect(buildWaitBody({ kind: 'aspectEquals', aspect: 'a', value: 'v', windowTitle: 'W' }, 5000)).toEqual({
      predicate: 'aspectEquals',
      timeoutMs: 5000,
      aspect: 'a',
      value: 'v',
      windowTitle: 'W',
    });
  });

  it('builds aspectMatches body with regex', () => {
    expect(buildWaitBody({ kind: 'aspectMatches', aspect: 'a', regex: '^x' }, 1000)).toEqual({
      predicate: 'aspectMatches',
      timeoutMs: 1000,
      aspect: 'a',
      regex: '^x',
    });
  });

  it('builds listHasRow body with match', () => {
    expect(
      buildWaitBody({ kind: 'listHasRow', aspect: 'tbl', match: { col: 'Name', value: 'X' } }, 1000)
    ).toEqual({ predicate: 'listHasRow', timeoutMs: 1000, aspect: 'tbl', match: { col: 'Name', value: 'X' } });
  });

  it('omits windowTitle when not provided', () => {
    expect(buildWaitBody({ kind: 'aspectNotEmpty', aspect: 'a' }, 1000)).toEqual({
      predicate: 'aspectNotEmpty',
      timeoutMs: 1000,
      aspect: 'a',
    });
  });

  it('throws when given a regex windowExists (client must resolve it)', () => {
    expect(() => buildWaitBody({ kind: 'windowExists', title: /Foo/ }, 1000)).toThrow();
  });
});

describe('VWTestClient.wait', () => {
  it('posts /wait for a string predicate and resolves on ok', async () => {
    const bridge = makeStubBridge({ waitOk: true });
    const vw = new VWTestClient({}, bridge);
    await vw.wait({ kind: 'aspectEquals', aspect: 'a', value: 'v', windowTitle: 'W' }, { timeoutMs: 3000 });
    expect(vi.mocked(bridge.postJson)).toHaveBeenCalledWith('/wait', {
      predicate: 'aspectEquals',
      timeoutMs: 3000,
      aspect: 'a',
      value: 'v',
      windowTitle: 'W',
    });
  });

  it('throws TimeoutError when the bridge reports ok:false', async () => {
    const vw = new VWTestClient({}, makeStubBridge({ waitOk: false }));
    await expect(vw.wait({ kind: 'aspectNotEmpty', aspect: 'a' }, { timeoutMs: 50 })).rejects.toBeInstanceOf(
      TimeoutError
    );
  });

  it('refuses a predicate the bridge does not advertise', async () => {
    const caps = { ...DEFAULT_CAPS, waitPredicates: ['windowExists', 'aspectEquals'] };
    const vw = new VWTestClient({}, makeStubBridge({ caps }));
    await expect(vw.wait({ kind: 'listHasRow', aspect: 't', match: { col: 'c', value: 'v' } })).rejects.toBeInstanceOf(
      VWTestSDKError
    );
  });

  it('self-polls listWindows for a regex windowExists (no /wait call)', async () => {
    const bridge = makeStubBridge({ windows: [{ title: 'Customer Search' }] });
    const vw = new VWTestClient({}, bridge);
    await vw.wait({ kind: 'windowExists', title: /Customer/ }, { timeoutMs: 1000 });
    const waitCalls = vi.mocked(bridge.postJson).mock.calls.filter(([p]) => p === '/wait');
    expect(waitCalls).toHaveLength(0);
    expect(vi.mocked(bridge.getJson)).toHaveBeenCalledWith('/windows');
  });

  it('times out a regex windowExists when no window matches', async () => {
    const bridge = makeStubBridge({ windows: [{ title: 'Other' }] });
    const vw = new VWTestClient({}, bridge);
    await expect(vw.wait({ kind: 'windowExists', title: /Nope/ }, { timeoutMs: 30 })).rejects.toBeInstanceOf(
      TimeoutError
    );
  });
});
