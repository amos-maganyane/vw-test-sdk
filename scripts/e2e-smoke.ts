/**
 * e2e-smoke.ts — numbered end-to-end smoke against a LIVE bridge (>= 0.11.0).
 *
 * Run: `pnpm e2e:smoke` (requires the bridge running + reachable). Each step is
 * self-contained and prints OK/FAIL; the process exits non-zero on any failure.
 *
 * Mirrors vw-mcp's scripts/smoke-test.ts discipline. NOT a unit test — this
 * needs the real VisualWorks image.
 */

import { VWTestClient, EvalGuardError } from '@enviro365/vw-test-sdk-core';

async function main(): Promise<void> {
  const vw = new VWTestClient();
  let step = 0;
  const ok = (msg: string): void => {
    console.log(`  [${++step}] OK   ${msg}`);
  };
  const fail = (msg: string, err: unknown): void => {
    console.error(`  [${step}] FAIL ${msg}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  };

  console.log('vw-test-sdk e2e smoke');

  // 1. Bridge compatibility + capabilities.
  const caps = await vw.verifyBridge();
  ok(`verifyBridge — ${caps.waitPredicates.length} wait predicates advertised`);

  // 2. Version metadata.
  const version = await vw.version();
  ok(`version ${version.version} (${version.parcelMode})`);

  // 3. Window enumeration.
  const windows = await vw.listWindows();
  ok(`listWindows — ${windows.length} window(s)`);

  // 4. Eval guard MUST refuse a destructive image op.
  step += 1;
  try {
    await vw.evaluate('ObjectMemory snapshot');
    fail('eval guard', new Error('destructive snapshot was NOT refused'));
  } catch (err) {
    if (err instanceof EvalGuardError) {
      console.log(`  [${step}] OK   eval guard refused a destructive snapshot`);
    } else {
      fail('eval guard', err);
    }
  }

  // 5. A safe eval round-trips.
  const sum = await vw.evaluate('3 + 4');
  ok(`eval 3 + 4 => ${sum}`);

  // 6. Screenshot capture returns PNG bytes.
  const png = await vw.screenshot();
  ok(`screenshot — ${png.length} bytes`);

  console.log(process.exitCode === 1 ? 'SMOKE FAILED' : 'SMOKE PASSED');
}

main().catch((err: unknown) => {
  console.error('SMOKE CRASHED:', err);
  process.exit(1);
});
