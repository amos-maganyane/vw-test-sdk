/**
 * page.ts — VWPage: abstract Page Object base.
 *
 * App-specific Page Objects (in the consuming L3 repo) subclass this, scoped to
 * a window title/regex, and expose business-workflow methods built on
 * `this.window()`.
 */

import type { VWTestClient } from './client.js';
import type { WindowScope } from './window.js';

export abstract class VWPage {
  constructor(
    protected readonly vw: VWTestClient,
    protected readonly windowTitle: string | RegExp
  ) {}

  /** A scoped handle to this page's window. */
  protected window(): WindowScope {
    return this.vw.window(this.windowTitle);
  }

  /** Block until this page's window is open. */
  async waitForOpen(timeoutMs?: number): Promise<void> {
    await this.vw.wait(
      { kind: 'windowExists', title: this.windowTitle },
      timeoutMs !== undefined ? { timeoutMs } : {}
    );
  }

  /** Close this page's window. */
  async close(): Promise<void> {
    await this.window().close();
  }
}
