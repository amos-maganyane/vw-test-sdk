import { describe, it, expect, vi } from 'vitest';
import { VWTestClient } from '../src/client.js';
import { WindowNotFoundError } from '../src/errors.js';
import { makeStubBridge } from './_stub.js';

function treeFetchCount(bridge: ReturnType<typeof makeStubBridge>): number {
  return vi
    .mocked(bridge.getJson)
    .mock.calls.filter(([p]) => typeof p === 'string' && p.startsWith('/windows/tree')).length;
}

describe('WindowScope — tree cache', () => {
  it('caches the widget tree within the TTL (single fetch)', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({ windowTreeCacheTTLMs: 500 }, bridge);
    const scope = vw.window('My Window');
    await scope.tree();
    await scope.tree();
    expect(treeFetchCount(bridge)).toBe(1);
  });

  it('refetches after invalidate()', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({ windowTreeCacheTTLMs: 500 }, bridge);
    const scope = vw.window('My Window');
    await scope.tree();
    scope.invalidate();
    await scope.tree();
    expect(treeFetchCount(bridge)).toBe(2);
  });

  it('refetches every call when TTL is 0', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({ windowTreeCacheTTLMs: 0 }, bridge);
    const scope = vw.window('My Window');
    await scope.tree();
    await scope.tree();
    expect(treeFetchCount(bridge)).toBe(2);
  });

  it('a mutating handle action invalidates the cache', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({ windowTreeCacheTTLMs: 500 }, bridge);
    const scope = vw.window('My Window');
    await scope.tree(); // fetch 1
    await scope.field('amt').click(); // invalidates
    await scope.tree(); // fetch 2
    expect(treeFetchCount(bridge)).toBe(2);
  });
});

describe('WindowScope — title resolution', () => {
  it('resolves a regex title to the first matching window', async () => {
    const bridge = makeStubBridge({ windows: [{ title: 'Customer Search View' }] });
    const vw = new VWTestClient({}, bridge);
    expect(await vw.window(/Customer/).resolveTitle()).toBe('Customer Search View');
  });

  it('throws WindowNotFoundError when no window matches the regex', async () => {
    const bridge = makeStubBridge({ windows: [{ title: 'Other' }] });
    const vw = new VWTestClient({}, bridge);
    await expect(vw.window(/Nope/).resolveTitle()).rejects.toBeInstanceOf(WindowNotFoundError);
  });

  it('returns a string title verbatim without listing windows', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({}, bridge);
    expect(await vw.window('Exact Title').resolveTitle()).toBe('Exact Title');
    const windowList = vi.mocked(bridge.getJson).mock.calls.filter(([p]) => p === '/windows');
    expect(windowList).toHaveLength(0);
  });
});
