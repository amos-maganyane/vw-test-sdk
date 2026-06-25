import { describe, it, expect } from 'vitest';
import { VWTestClient } from '../src/client.js';
import { IncompleteCleanupError } from '../src/errors.js';
import { makeStubBridge } from './_stub.js';
import type { BridgeEvalResult } from '@enviro365/vw-bridge-client';

describe('VWTestClient.cleanupTestArtifacts', () => {
  it('removes prefixed classes and reports a clean run', async () => {
    const evalResult = (src: string): BridgeEvalResult => {
      if (src.includes('removeFromSystem')) return { ok: true, result: "('TestSDK_MyTest_0_1719' )" };
      if (src.includes('collect: [:c | c name]')) return { ok: true, result: '()' };
      return { ok: true, result: 'nil' };
    };
    const vw = new VWTestClient({}, makeStubBridge({ evalResult }));
    const report = await vw.cleanupTestArtifacts({ testName: 'MyTest' });
    expect(report.removedClasses).toEqual(['TestSDK_MyTest_0_1719']);
    expect(report.remainingArtifacts).toEqual([]);
  });

  it('throws IncompleteCleanupError when artifacts remain', async () => {
    const evalResult = (src: string): BridgeEvalResult => {
      if (src.includes('removeFromSystem')) return { ok: true, result: '()' };
      if (src.includes('collect: [:c | c name]')) return { ok: true, result: "('TestSDK_MyTest_0_9 ')" };
      return { ok: true, result: 'nil' };
    };
    const vw = new VWTestClient({}, makeStubBridge({ evalResult }));
    await expect(vw.cleanupTestArtifacts({ testName: 'MyTest' })).rejects.toBeInstanceOf(IncompleteCleanupError);
  });

  it('closes windows not present in the baseline', async () => {
    const evalResult = (src: string): BridgeEvalResult => {
      if (src.includes('removeFromSystem')) return { ok: true, result: '()' };
      if (src.includes('collect: [:c | c name]')) return { ok: true, result: '()' };
      return { ok: true, result: 'nil' };
    };
    const vw = new VWTestClient(
      {},
      makeStubBridge({ windows: [{ title: 'Base' }, { title: 'New' }], evalResult })
    );
    const report = await vw.cleanupTestArtifacts({
      testName: 'MyTest',
      baselineWindows: [{ title: 'Base' }],
    });
    expect(report.closedWindows).toEqual(['New']);
  });
});
