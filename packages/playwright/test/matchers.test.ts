import { describe, it, expect, vi } from 'vitest';
import { toHaveValueImpl, toBeVisibleImpl, toBeEnabledImpl } from '../src/matchers.js';
import type { WidgetHandle } from '@enviro365/vw-test-sdk-core';

interface HandleStub {
  value?: unknown;
  visible?: boolean;
  enabled?: boolean;
  actions?: Array<{ ts: number; kind: string; detail?: Record<string, unknown>; ok?: boolean; error?: string }>;
}

function makeHandle(stub: HandleStub): WidgetHandle {
  return {
    aspect: 'field1',
    getValue: vi.fn(async () => stub.value),
    isVisible: vi.fn(async () => stub.visible ?? false),
    isEnabled: vi.fn(async () => stub.enabled ?? false),
    client: { getActionLog: () => stub.actions ?? [] },
  } as unknown as WidgetHandle;
}

const FAST = { timeout: 30, interval: 5 };

describe('toHaveValueImpl', () => {
  it('passes when the value matches', async () => {
    const r = await toHaveValueImpl(makeHandle({ value: 'hello' }), 'hello', FAST);
    expect(r.pass).toBe(true);
  });

  it('passes for a regex match', async () => {
    const r = await toHaveValueImpl(makeHandle({ value: 'SUB-001' }), /^SUB-\d+$/, FAST);
    expect(r.pass).toBe(true);
  });

  it('fails and reports the actual value + action log on mismatch', async () => {
    const r = await toHaveValueImpl(
      makeHandle({ value: 'wrong', actions: [{ ts: 1, kind: 'fill', detail: { aspect: 'field1' } }] }),
      'expected',
      FAST
    );
    expect(r.pass).toBe(false);
    const msg = r.message();
    expect(msg).toContain('Got: wrong');
    expect(msg).toContain('Recent actions');
    expect(msg).toContain('fill');
  });
});

describe('toBeVisibleImpl / toBeEnabledImpl', () => {
  it('toBeVisible passes when visible', async () => {
    expect((await toBeVisibleImpl(makeHandle({ visible: true }), FAST)).pass).toBe(true);
  });

  it('toBeVisible fails when not visible', async () => {
    expect((await toBeVisibleImpl(makeHandle({ visible: false }), FAST)).pass).toBe(false);
  });

  it('toBeEnabled passes when enabled', async () => {
    expect((await toBeEnabledImpl(makeHandle({ enabled: true }), FAST)).pass).toBe(true);
  });

  it('toBeEnabled fails when disabled', async () => {
    expect((await toBeEnabledImpl(makeHandle({ enabled: false }), FAST)).pass).toBe(false);
  });
});
