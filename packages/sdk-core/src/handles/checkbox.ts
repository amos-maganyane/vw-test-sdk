/**
 * checkbox.ts — CheckboxHandle: WidgetHandle + boolean state helpers.
 */

import { WidgetHandle } from './widget.js';

export class CheckboxHandle extends WidgetHandle {
  /** Read the checkbox's boolean state via GET /value. */
  async isChecked(): Promise<boolean> {
    const v = await this.getValue();
    return v === true || v === 'true' || v === 1;
  }

  /** Click only if currently unchecked. */
  async check(): Promise<void> {
    if (!(await this.isChecked())) await this.click();
  }

  /** Click only if currently checked. */
  async uncheck(): Promise<void> {
    if (await this.isChecked()) await this.click();
  }

  /** Drive the checkbox to a specific state. */
  async setChecked(value: boolean): Promise<void> {
    if ((await this.isChecked()) !== value) await this.click();
  }
}
