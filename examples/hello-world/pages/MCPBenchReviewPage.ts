import { VWPage, type VWTestClient, type TableHandle } from '@enviro365/vw-test-sdk-playwright';

/**
 * Page Object for the s23 benchmark's `MCPBenchReviewWindow` (title contains
 * "Sub-instructions Review"). Exposes the 6-column `subInstructions` DataSet.
 *
 * NOTE: the window title pattern + `subInstructions` aspect are the s23 target;
 * confirm them against the live image during the Wave E1b.4.4 10× gate.
 */
export class MCPBenchReviewPage extends VWPage {
  constructor(vw: VWTestClient) {
    super(vw, /Sub-instructions Review/);
  }

  /** The sub-instructions DataSet (6 columns per the s23 benchmark). */
  dataset(): TableHandle {
    return this.window().table('subInstructions');
  }
}
