/**
 * evidence.ts — failure-evidence bundle (architecture §8.1).
 *
 * On test failure the L2 `evidence` auto-fixture calls `captureFailureBundle`,
 * which attaches up to 4 artifacts in parallel via `Promise.allSettled` (so one
 * artifact failing never blocks the others), each behind a per-artifact timeout:
 *
 *   1. full-screen screenshot   (bridge /screenshot)
 *   2. windows + dialogs + log   (vw.snapshotState)
 *   3. action log (last N)       (vw.getActionLog — in-process)
 *   4. bridge log tail           (VW_BRIDGE_LOG file, if configured)
 */

import { promises as fs } from 'node:fs';
import type { VWTestClient, WindowSummary } from '@enviro365/vw-test-sdk-core';

/** Subset of Playwright's TestInfo this module needs (keeps it unit-testable). */
export interface AttachableTestInfo {
  status?: string;
  expectedStatus?: string;
  attach(
    name: string,
    options: { body?: Buffer | string; contentType?: string; path?: string }
  ): Promise<void>;
}

const SCREENSHOT_TIMEOUT_MS = 5000;
const STATE_TIMEOUT_MS = 3000;
const BRIDGE_LOG_TIMEOUT_MS = 2000;
const capturedTestInfos = new WeakSet<object>();

/** Race a promise against a timeout; rejects if it doesn't settle in time. */
async function withTimeout<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`artifact capture timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readLogTail(path: string, lines: number): Promise<string> {
  const content = await fs.readFile(path, 'utf-8');
  return content.split(/\r?\n/).slice(-lines).join('\n');
}

const SECTION42_WINDOW_PATTERN = /Section 42|Multimanager|QA Review/i;
const BUSINESS_LAUNCHER_PATTERN = /MOMENTUM WEALTH/i;
const VW_LAUNCHER_PATTERN = /storeTst64|storedev64|VisualWorks/i;

/** Pick a native VW window so failure evidence never captures the foreground desktop app. */
export function selectEvidenceWindow(windows: WindowSummary[]): WindowSummary | undefined {
  return (
    windows.find((window) => SECTION42_WINDOW_PATTERN.test(window.title)) ??
    windows.find((window) => BUSINESS_LAUNCHER_PATTERN.test(window.title)) ??
    windows.find((window) => VW_LAUNCHER_PATTERN.test(window.title)) ??
    windows.find((window) => window.title !== 'Workspace' && window.title !== 'GemStone Launcher')
  );
}

async function captureVisualWorksWindow(vw: VWTestClient): Promise<Buffer> {
  const windows = await vw.listWindows();
  const target = selectEvidenceWindow(windows);
  if (target === undefined) throw new Error('no VisualWorks window available for failure screenshot');
  const appClass = typeof target['appClass'] === 'string' ? target['appClass'] : undefined;
  return vw.screenshot(appClass === undefined ? { windowTitle: target.title } : { windowTitle: target.title, appClass });
}

/** Capture + attach the failure-evidence bundle. Never throws. */
export async function captureFailureBundle(vw: VWTestClient, testInfo: AttachableTestInfo): Promise<void> {
  if (capturedTestInfos.has(testInfo)) return;
  capturedTestInfos.add(testInfo);
  const bridgeLogPath = process.env['VW_BRIDGE_LOG'];

  const tasks: Array<Promise<unknown>> = [
    withTimeout(SCREENSHOT_TIMEOUT_MS, captureVisualWorksWindow(vw)).then((buf) =>
      testInfo.attach('screenshot-vw-window.png', { body: buf, contentType: 'image/png' })
    ),
    withTimeout(STATE_TIMEOUT_MS, vw.snapshotState()).then((snap) =>
      testInfo.attach('state.json', { body: JSON.stringify(snap, null, 2), contentType: 'application/json' })
    ),
    Promise.resolve(vw.getActionLog()).then((log) =>
      testInfo.attach('actions.json', { body: JSON.stringify(log, null, 2), contentType: 'application/json' })
    ),
  ];

  if (bridgeLogPath !== undefined) {
    tasks.push(
      withTimeout(BRIDGE_LOG_TIMEOUT_MS, readLogTail(bridgeLogPath, 100)).then((tail) =>
        testInfo.attach('bridge.log', { body: tail, contentType: 'text/plain' })
      )
    );
  }

  await Promise.allSettled(tasks);
}
