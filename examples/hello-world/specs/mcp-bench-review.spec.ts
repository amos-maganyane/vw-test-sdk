import { test, expect } from '../vw.fixture.js';
import { MCPBenchReviewPage } from '../pages/MCPBenchReviewPage.js';

/**
 * Hello-world — reproduces the s23 benchmark stretch state end-to-end:
 * `MCPBenchReviewWindow` with a `SubInstructionRow` 6-column DataSet rendering
 * one populated row.
 *
 * This is the Wave E1b acceptance test (E1b.4.3 / E1b.4.4). It runs against a
 * live bridge >= 0.11.0; the exact GBS seeder selector + column/aspect names
 * are the s23 target and must be confirmed against the live image when the
 * bridge ships (the 10× gate is deferred until then).
 */
test.describe('s23 hello-world — MCPBenchReviewWindow', () => {
  test('renders the sub-instructions DataSet with one populated row', async ({ vw }) => {
    // 1. Ensure the SubInstructionRow benchmark fixture exists in the GBS session.
    //    (Replace with the real factory selector once confirmed live.)
    await vw.evaluateInGBSSession('SubInstructionRow ensureBenchmarkFixture');

    // 2. Open the review window.
    await vw.openApplication('MCPBenchReviewWindow');
    const page = new MCPBenchReviewPage(vw);
    await page.waitForOpen();

    // 3. Assert the DataSet contains the expected row (uses the listHasRow
    //    wait predicate added in bridge 0.11.0).
    await page.dataset().waitForRow({ col: 'Identifier', value: 'SUB-001' });
    expect(await page.dataset().getRowCount()).toBe(1);

    // 4. Close the window.
    await page.close();
  });

  // Mandatory per-test cleanup (architecture §15.2) — removes any TestSDK_*
  // artifacts and aborts GBS transactions; fails the test if anything leaks.
  test.afterEach(async ({ vw }, testInfo) => {
    await vw.cleanupTestArtifacts({ testName: testInfo.title });
  });
});
