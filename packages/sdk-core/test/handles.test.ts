import { describe, it, expect, vi } from 'vitest';
import { VWTestClient } from '../src/client.js';
import { makeStubBridge } from './_stub.js';
import type { WidgetNode } from '../src/types.js';

const TREE: WidgetNode = {
  type: 'Window',
  name: 'root',
  children: [
    { type: 'InputField', name: 'amt', enabled: true },
    { type: 'ActionButton', name: 'disabledBtn', enabled: false },
  ],
};

describe('WidgetHandle — interactions', () => {
  it('fill posts /type with the value', async () => {
    const bridge = makeStubBridge({ tree: TREE });
    const vw = new VWTestClient({}, bridge);
    await vw.window('Win').field('amt').fill('100');
    expect(vi.mocked(bridge.postJson)).toHaveBeenCalledWith('/type', {
      aspect: 'amt',
      value: '100',
      windowTitle: 'Win',
    });
  });

  it('click posts /click', async () => {
    const bridge = makeStubBridge({ tree: TREE });
    const vw = new VWTestClient({}, bridge);
    await vw.window('Win').field('amt').click();
    expect(vi.mocked(bridge.postJson)).toHaveBeenCalledWith('/click', { aspect: 'amt', windowTitle: 'Win' });
  });

  it('getValue reads /value', async () => {
    const bridge = makeStubBridge({ tree: TREE, value: 'current' });
    const vw = new VWTestClient({}, bridge);
    expect(await vw.window('Win').field('amt').getValue()).toBe('current');
  });
});

describe('WidgetHandle — visibility + enabled (from tree)', () => {
  it('isVisible reflects presence in the widget tree', async () => {
    const vw = new VWTestClient({}, makeStubBridge({ tree: TREE }));
    const scope = vw.window('Win');
    expect(await scope.field('amt').isVisible()).toBe(true);
    expect(await scope.field('ghost').isVisible()).toBe(false);
  });

  it('isEnabled reflects the node enabled flag', async () => {
    const vw = new VWTestClient({}, makeStubBridge({ tree: TREE }));
    const scope = vw.window('Win');
    expect(await scope.field('amt').isEnabled()).toBe(true);
    expect(await scope.field('disabledBtn').isEnabled()).toBe(false);
    expect(await scope.field('ghost').isEnabled()).toBe(false);
  });
});

describe('CheckboxHandle', () => {
  it('isChecked reads the boolean value', async () => {
    const vw = new VWTestClient({}, makeStubBridge({ value: true }));
    expect(await vw.window('Win').checkbox('agree').isChecked()).toBe(true);
  });

  it('uncheck clicks when currently checked', async () => {
    const bridge = makeStubBridge({ value: true });
    const vw = new VWTestClient({}, bridge);
    await vw.window('Win').checkbox('agree').uncheck();
    expect(vi.mocked(bridge.postJson)).toHaveBeenCalledWith('/click', { aspect: 'agree', windowTitle: 'Win' });
  });

  it('check does NOT click when already checked', async () => {
    const bridge = makeStubBridge({ value: true });
    const vw = new VWTestClient({}, bridge);
    await vw.window('Win').checkbox('agree').check();
    const clicks = vi.mocked(bridge.postJson).mock.calls.filter(([p]) => p === '/click');
    expect(clicks).toHaveLength(0);
  });
});

describe('TableHandle + DialogScope', () => {
  it('waitForRow waits on the listHasRow predicate', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({}, bridge);
    await vw.window('Win').table('subs').waitForRow({ col: 'Id', value: 'SUB-001' }, { timeoutMs: 2000 });
    expect(vi.mocked(bridge.postJson)).toHaveBeenCalledWith('/wait', {
      predicate: 'listHasRow',
      timeoutMs: 2000,
      aspect: 'subs',
      match: { col: 'Id', value: 'SUB-001' },
      windowTitle: 'Win',
    });
  });

  it('dialog().respond clicks the labeled button', async () => {
    const bridge = makeStubBridge();
    const vw = new VWTestClient({}, bridge);
    await vw.window('Win').dialog().respond('OK');
    expect(vi.mocked(bridge.postJson)).toHaveBeenCalledWith('/click', { aspect: 'OK', windowTitle: 'Win' });
  });
});
