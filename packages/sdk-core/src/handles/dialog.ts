/**
 * dialog.ts — DialogScope: interact with a posted modal SimpleDialog.
 *
 * The bridge routes dialog-button clicks through the same /click endpoint
 * (vw_respond_dialog passes the button label as the click aspect), using its
 * forked-dispatch infrastructure so the modal can close.
 */

import type { WidgetContext } from './context.js';
import type { WaitOptions } from '../wait.js';

export class DialogScope {
  constructor(private readonly ctx: WidgetContext) {}

  /** Click a named button (e.g. "OK", "Cancel") on the posted modal. */
  async respond(buttonLabel: string): Promise<void> {
    const title = await this.ctx.resolveTitle();
    await this.ctx.client.clickWidget(buttonLabel, title);
    this.ctx.invalidate();
  }

  /** Block until a modal dialog is posted. */
  async waitForExists(opts: WaitOptions = {}): Promise<void> {
    await this.ctx.client.wait({ kind: 'dialogExists' }, opts);
  }

  /** Block until the posted modal is dismissed. */
  async waitForGone(opts: WaitOptions = {}): Promise<void> {
    await this.ctx.client.wait({ kind: 'dialogGone' }, opts);
  }
}
