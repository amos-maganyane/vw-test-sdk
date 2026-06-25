import { describe, it, expect, vi } from 'vitest';
import { VWTestClient } from '../src/client.js';
import {
  BridgeCompatibilityError,
  EvalGuardError,
  ExclusiveBridgeViolationError,
  NoGBSSessionError,
  VWTestSDKError,
} from '../src/errors.js';
import { makeStubBridge } from './_stub.js';

const NO_GBS = '__VW_TEST_SDK_NO_GBS__';

describe('VWTestClient.verifyBridge', () => {
  it('rejects a bridge below the minimum version', async () => {
    const vw = new VWTestClient({}, makeStubBridge({ version: '0.10.0' }));
    await expect(vw.verifyBridge()).rejects.toBeInstanceOf(BridgeCompatibilityError);
  });

  it('rejects a different major version', async () => {
    const vw = new VWTestClient({}, makeStubBridge({ version: '1.0.0' }));
    await expect(vw.verifyBridge()).rejects.toBeInstanceOf(BridgeCompatibilityError);
  });

  it('accepts 0.11.0 and returns capabilities', async () => {
    const vw = new VWTestClient({}, makeStubBridge({ version: '0.11.0' }));
    const caps = await vw.verifyBridge();
    expect(caps.waitPredicates).toContain('listHasRow');
  });

  it('throws ExclusiveBridgeViolationError in exclusive mode when a foreign client is active', async () => {
    const bridge = makeStubBridge({
      evalResult: (src) =>
        src.includes('activeHandlerCount') ? { ok: true, result: '2' } : { ok: true, result: 'nil' },
    });
    const vw = new VWTestClient({ exclusiveBridge: true }, bridge);
    await expect(vw.verifyBridge()).rejects.toBeInstanceOf(ExclusiveBridgeViolationError);
  });

  it('passes exclusive mode when no foreign client is active', async () => {
    const bridge = makeStubBridge({
      evalResult: (src) =>
        src.includes('activeHandlerCount') ? { ok: true, result: '0' } : { ok: true, result: 'nil' },
    });
    const vw = new VWTestClient({ exclusiveBridge: true }, bridge);
    await expect(vw.verifyBridge()).resolves.toBeDefined();
  });
});

describe('VWTestClient.evaluate — guards (parity with vw-mcp)', () => {
  it('refuses a destructive image op before round-tripping', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({}, bridge);
    await expect(vw.evaluate('ObjectMemory snapshot')).rejects.toBeInstanceOf(EvalGuardError);
    expect(vi.mocked(bridge.postEval)).not.toHaveBeenCalled();
  });

  it('refuses a relocateObject:from: send', async () => {
    const vw = new VWTestClient({}, makeStubBridge());
    await expect(vw.evaluate('dest relocateObject: c from: s')).rejects.toBeInstanceOf(EvalGuardError);
  });

  it('passes safe code through and returns the printString', async () => {
    const bridge = makeStubBridge({ evalResult: () => ({ ok: true, result: '3' }) });
    const vw = new VWTestClient({}, bridge);
    await expect(vw.evaluate('1 + 2')).resolves.toBe('3');
    expect(vi.mocked(bridge.postEval)).toHaveBeenCalledWith('1 + 2');
  });

  it('throws when the bridge reports an eval failure', async () => {
    const bridge = makeStubBridge({ evalResult: () => ({ ok: false, error: 'MNU #foo' }) });
    const vw = new VWTestClient({}, bridge);
    await expect(vw.evaluate('foo bar')).rejects.toBeInstanceOf(VWTestSDKError);
  });
});

describe('VWTestClient.evaluateInGBSSession', () => {
  it('wraps the source in GBSM currentSession execute:', async () => {
    const bridge = makeStubBridge({ evalResult: () => ({ ok: true, result: '42' }) });
    const vw = new VWTestClient({}, bridge);
    const out = await vw.evaluateInGBSSession("Customer new rsaId: '8001015009087'");
    expect(out).toBe('42');
    const sentSource = vi.mocked(bridge.postEval).mock.calls[0]?.[0] ?? '';
    expect(sentSource).toContain('GBSM currentSession execute:');
    expect(sentSource).toContain("Customer new rsaId: ''8001015009087''");
  });

  it('throws NoGBSSessionError when no session is live', async () => {
    const bridge = makeStubBridge({ evalResult: () => ({ ok: true, result: NO_GBS }) });
    const vw = new VWTestClient({}, bridge);
    await expect(vw.evaluateInGBSSession('1 + 1')).rejects.toBeInstanceOf(NoGBSSessionError);
  });

  it('still applies destructive-op guards', async () => {
    const vw = new VWTestClient({}, makeStubBridge());
    await expect(vw.evaluateInGBSSession('ObjectMemory snapshot')).rejects.toBeInstanceOf(EvalGuardError);
  });
});

describe('VWTestClient — widget operations', () => {
  it('clickWidget posts /click with aspect + windowTitle', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({}, bridge);
    await vw.clickWidget('searchButton', 'Search Window');
    expect(vi.mocked(bridge.postJson)).toHaveBeenCalledWith('/click', {
      aspect: 'searchButton',
      windowTitle: 'Search Window',
    });
  });

  it('setWidgetValue posts /type', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({}, bridge);
    await vw.setWidgetValue('amount', '100', 'Buy');
    expect(vi.mocked(bridge.postJson)).toHaveBeenCalledWith('/type', {
      aspect: 'amount',
      value: '100',
      windowTitle: 'Buy',
    });
  });

  it('getWidgetValue gets /value and returns the value field', async () => {
    const bridge = makeStubBridge({ value: 'hello' });
    const vw = new VWTestClient({}, bridge);
    await expect(vw.getWidgetValue('field1', 'Win')).resolves.toBe('hello');
  });
});

describe('VWTestClient.openApplication', () => {
  it('emits "<Class> open" and returns a scope', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({}, bridge);
    const scope = await vw.openApplication('CustomerSearchView');
    expect(vi.mocked(bridge.postEval)).toHaveBeenCalledWith('CustomerSearchView open');
    expect(scope).toBeDefined();
  });

  it('rejects an invalid class name', async () => {
    const vw = new VWTestClient({}, makeStubBridge());
    await expect(vw.openApplication('lowercase bad')).rejects.toBeInstanceOf(VWTestSDKError);
  });

  it('refuses VWB.* classes', async () => {
    const vw = new VWTestClient({}, makeStubBridge());
    await expect(vw.openApplication('VWB.VWBridge')).rejects.toBeInstanceOf(VWTestSDKError);
  });
});

describe('VWTestClient — isAnotherClientActive', () => {
  it('returns [] when the probe reports 0', async () => {
    const bridge = makeStubBridge({ evalResult: () => ({ ok: true, result: '0' }) });
    const vw = new VWTestClient({}, bridge);
    await expect(vw.isAnotherClientActive()).resolves.toEqual([]);
  });

  it('returns one entry per foreign handler', async () => {
    const bridge = makeStubBridge({ evalResult: () => ({ ok: true, result: '3' }) });
    const vw = new VWTestClient({}, bridge);
    const others = await vw.isAnotherClientActive();
    expect(others).toHaveLength(3);
  });

  it('fails open (returns []) when the probe errors', async () => {
    const bridge = makeStubBridge({ evalResult: () => ({ ok: false, error: 'MNU' }) });
    const vw = new VWTestClient({}, bridge);
    await expect(vw.isAnotherClientActive()).resolves.toEqual([]);
  });
});

describe('VWTestClient — evidence + utilities', () => {
  it('screenshot returns a Buffer of the PNG bytes', async () => {
    const vw = new VWTestClient({}, makeStubBridge());
    const buf = await vw.screenshot();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf).toHaveLength(3);
  });

  it('records actions to the action log', async () => {
    const vw = new VWTestClient({}, makeStubBridge());
    await vw.clickWidget('b', 'W');
    expect(vw.getActionLog().some((e) => e.kind === 'click')).toBe(true);
  });

  it('invokes the onAction observer', async () => {
    const seen: string[] = [];
    const vw = new VWTestClient({ onAction: (e) => seen.push(e.kind) }, makeStubBridge());
    await vw.clickWidget('b', 'W');
    expect(seen).toContain('click');
  });

  it('withTimeout runs the closure (injected bridge path)', async () => {
    const vw = new VWTestClient({}, makeStubBridge());
    await expect(vw.withTimeout(60_000, async () => 'done')).resolves.toBe('done');
  });
});
