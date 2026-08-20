/**
 * table.ts — TableHandle: WidgetHandle + row helpers for DataSet / TableView.
 *
 * Row-level assertions use the bridge `listHasRow` wait predicate (0.11.0).
 * Deep per-cell access is best-effort via the model value until the bridge
 * exposes a richer table-introspection endpoint.
 */

import { WidgetHandle } from './widget.js';
import type { WaitOptions } from '../wait.js';

export interface RowMatch {
  col: string;
  value: string;
}

export class TableHandle extends WidgetHandle {
  /** Edit one DataSet cell through the same column-model setter a user edit invokes. */
  async setCell(rowIndex: number, column: string, value: string): Promise<void> {
    const title = await this.ctx.resolveTitle();
    await this.ctx.client.setDatasetCell(this.aspect, rowIndex, column, value, title);
    this.ctx.invalidate();
  }

  /** Best-effort row count from the model value (array length / numeric size). */
  async getRowCount(): Promise<number> {
    const v = await this.getValue();
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'number') return v;
    return 0;
  }

  /** Block until the table contains a row matching `{ col, value }`. */
  async waitForRow(match: RowMatch, opts: WaitOptions = {}): Promise<void> {
    const title = await this.ctx.resolveTitle();
    await this.ctx.client.wait(
      { kind: 'listHasRow', aspect: this.aspect, match, windowTitle: title },
      opts
    );
  }
}
