import { test, expect } from '@enviro365/vw-test-sdk-playwright';

/**
 * vw-test-sdk LIVE benchmark — drives the real VW image over the bridge.
 *
 * Exercises the SDK end-to-end without the 0.11.0-only `wait()`/`/capabilities`
 * surface, so it passes on the current 0.10.0 bridge:
 *   - bridge liveness (/health, /version)
 *   - window enumeration (/windows)
 *   - a widget value round-trip (/type then /value) on a live window
 *   - server-side Smalltalk evaluation (/eval)
 *   - the eval-safety guard refusing a destructive image op (client-side)
 *   - screenshot capture (/screenshot)
 *   - the rolling action log
 *
 * The widget round-trip targets the "Wave A Demo - Doubler" demo window if it is
 * open; otherwise that one check is skipped (the rest are image-agnostic).
 */

const DEMO_WINDOW = 'Wave A Demo - Doubler';

test.describe('vw-test-sdk live benchmark', () => {
  test('bridge is reachable and reports a semver version', async ({ vw }) => {
    const health = await vw.health();
    expect(health.status).toBe('ok');
    const version = await vw.version();
    expect(version.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('enumerates live windows', async ({ vw }) => {
    const windows = await vw.listWindows();
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((w) => typeof w.title === 'string')).toBe(true);
  });

  test('round-trips a widget value through /type then /value', async ({ vw }) => {
    const windows = await vw.listWindows();
    test.skip(!windows.some((w) => w.title === DEMO_WINDOW), `${DEMO_WINDOW} not open`);

    const input = vw.window(DEMO_WINDOW).field('inputValue');
    await input.fill('21');
    expect(String(await input.getValue())).toBe('21');
  });

  test('evaluates Smalltalk server-side', async ({ vw }) => {
    expect(await vw.evaluate('21 * 2')).toBe('42');
  });

  test('refuses a destructive image op via the eval guard', async ({ vw }) => {
    await expect(vw.evaluate('ObjectMemory snapshot')).rejects.toThrow(/destructive image operation/i);
  });

  test('captures a PNG screenshot', async ({ vw }) => {
    const png = await vw.screenshot();
    expect(png.length).toBeGreaterThan(100);
    expect(png[0]).toBe(0x89); // PNG magic byte
  });

  test('records bridge actions in the rolling log', async ({ vw }) => {
    await vw.evaluate('1 + 1');
    expect(vw.getActionLog().some((e) => e.kind === 'eval')).toBe(true);
  });
});
