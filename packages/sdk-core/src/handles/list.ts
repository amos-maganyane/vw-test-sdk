/**
 * list.ts — ListHandle: WidgetHandle + selection helpers for SequenceView lists.
 */

import { WidgetHandle } from './widget.js';

export class ListHandle extends WidgetHandle {
  /** Select a row by matching its displayed content through /select-row. */
  async selectByText(match: string): Promise<string> {
    const result = await this.ctx.client.selectRow(this.aspect, match, await this.ctx.resolveTitle());
    this.ctx.invalidate();
    return result.row;
  }

  /** Set the list selection by value (MVP: direct value-set via /type). */
  async select(item: string): Promise<void> {
    await this.fill(item);
  }

  /** Read the current selection via GET /value. */
  async getSelection(): Promise<unknown> {
    return this.getValue();
  }
}
