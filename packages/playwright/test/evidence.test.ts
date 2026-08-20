import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureFailureBundle, selectEvidenceWindow, type AttachableTestInfo } from '../src/evidence.js';
import type { VWTestClient } from '@enviro365/vw-test-sdk-core';

function makeVw(overrides: Partial<Record<string, unknown>> = {}): VWTestClient {
  return {
    listWindows: vi.fn(async () => [{ title: 'storeTst64 (C:\\visualworks931\\image)', appClass: 'VisualLauncher' }]),
    screenshot: vi.fn(async (_opts?: unknown) => Buffer.from([1, 2, 3])),
    snapshotState: vi.fn(async () => ({ windows: [], dialogs: [], recentLog: [] })),
    getActionLog: vi.fn(() => [{ ts: 1, kind: 'click' }]),
    ...overrides,
  } as unknown as VWTestClient;
}

describe('captureFailureBundle', () => {
  it('attaches screenshot, state, and actions', async () => {
    const attach = vi.fn(async (_name: string, _options?: unknown) => {});
    const testInfo = { attach } as unknown as AttachableTestInfo;

    await captureFailureBundle(makeVw(), testInfo);

    const names = attach.mock.calls.map((c) => c[0]);
    expect(names).toContain('screenshot-vw-window.png');
    expect(names).toContain('state.json');
    expect(names).toContain('actions.json');
  });

  it('does not let one failing artifact block the others (allSettled)', async () => {
    const attach = vi.fn(async (_name: string, _options?: unknown) => {});
    const testInfo = { attach } as unknown as AttachableTestInfo;
    const vw = makeVw({ snapshotState: vi.fn(async () => { throw new Error('boom'); }) });

    await expect(captureFailureBundle(vw, testInfo)).resolves.toBeUndefined();
    const names = attach.mock.calls.map((c) => c[0]);
    expect(names).toContain('screenshot-vw-window.png');
    expect(names).toContain('actions.json');
    expect(names).not.toContain('state.json');
  });

  it('prefers the active business window over launchers and desktop-like windows', () => {
    expect(
      selectEvidenceWindow([
        { title: 'Workspace' },
        { title: 'storeTst64 (C:\\visualworks931\\image)', appClass: 'VisualLauncher' },
        { title: 'Section 42 Transfer - Execution', appClass: 'Section42ExecutionView' },
      ])?.title
    ).toBe('Section 42 Transfer - Execution');
  });

  it('falls back to the VisualWorks image launcher when the test window was cleaned up', () => {
    expect(
      selectEvidenceWindow([
        { title: 'GemStone Launcher' },
        { title: 'storeTst64 (C:\\visualworks931\\image)', appClass: 'VisualLauncher' },
      ])?.title
    ).toContain('storeTst64');
  });

  it('attaches the bridge log tail when VW_BRIDGE_LOG is set', async () => {
    const logPath = join(tmpdir(), `vw-bridge-${Date.now()}.log`);
    await fs.writeFile(logPath, 'line1\nline2\nline3\n', 'utf-8');
    vi.stubEnv('VW_BRIDGE_LOG', logPath);
    const attach = vi.fn(async (_name: string, _options?: unknown) => {});
    const testInfo = { attach } as unknown as AttachableTestInfo;

    try {
      await captureFailureBundle(makeVw(), testInfo);
      expect(attach.mock.calls.map((c) => c[0])).toContain('bridge.log');
    } finally {
      vi.unstubAllEnvs();
      await fs.unlink(logPath).catch(() => {});
    }
  });
});
