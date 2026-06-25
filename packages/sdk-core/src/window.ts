/**
 * window.ts — WindowScope: a title-scoped view over one VW window.
 *
 * Lazily fetches `/windows/tree` on first widget access and caches it for
 * `ttlMs` (architecture §6.2). Any mutating handle action calls `invalidate()`.
 * Regex titles are resolved to a concrete title via `listWindows()` on demand.
 */

import type { VWTestClient } from './client.js';
import type { WidgetNode } from './types.js';
import type { WidgetContext } from './handles/context.js';
import { WidgetHandle } from './handles/widget.js';
import { CheckboxHandle } from './handles/checkbox.js';
import { TableHandle } from './handles/table.js';
import { ListHandle } from './handles/list.js';
import { DialogScope } from './handles/dialog.js';
import { WindowNotFoundError } from './errors.js';

export class WindowScope implements WidgetContext {
  private treeCache: { tree: WidgetNode; at: number } | null = null;
  private resolvedTitle: string | null = null;

  constructor(
    readonly client: VWTestClient,
    private readonly titleOrRegex: string | RegExp,
    private readonly ttlMs: number
  ) {
    if (typeof titleOrRegex === 'string') {
      this.resolvedTitle = titleOrRegex;
    }
  }

  /** Resolve the scoped window's concrete title (regex → first matching title). */
  async resolveTitle(): Promise<string> {
    if (this.resolvedTitle !== null) return this.resolvedTitle;
    const regex = this.titleOrRegex as RegExp;
    const windows = await this.client.listWindows();
    const match = windows.find((w) => regex.test(w.title));
    if (match === undefined) {
      throw new WindowNotFoundError(
        `No window matching ${String(regex)}. Open windows: [${windows.map((w) => w.title).join(', ')}]`
      );
    }
    this.resolvedTitle = match.title;
    return match.title;
  }

  /** The window's widget tree, cached for `ttlMs`. */
  async tree(): Promise<WidgetNode> {
    const now = Date.now();
    if (this.treeCache !== null && now - this.treeCache.at < this.ttlMs) {
      return this.treeCache.tree;
    }
    const title = await this.resolveTitle();
    const tree = await this.client.getWindowTree(title);
    this.treeCache = { tree, at: now };
    return tree;
  }

  /** Drop the cached widget tree (called after every mutating action). */
  invalidate(): void {
    this.treeCache = null;
  }

  field(aspect: string): WidgetHandle {
    return new WidgetHandle(this, aspect);
  }

  button(label: string | { aspect: string }): WidgetHandle {
    return new WidgetHandle(this, typeof label === 'string' ? label : label.aspect);
  }

  checkbox(aspect: string): CheckboxHandle {
    return new CheckboxHandle(this, aspect);
  }

  table(aspect: string): TableHandle {
    return new TableHandle(this, aspect);
  }

  list(aspect: string): ListHandle {
    return new ListHandle(this, aspect);
  }

  dialog(): DialogScope {
    return new DialogScope(this);
  }

  /** Close this window. */
  async close(): Promise<void> {
    await this.client.closeWindow(await this.resolveTitle());
    this.invalidate();
  }

  /** Block until this window is open. */
  async waitForOpen(timeoutMs?: number): Promise<void> {
    await this.client.wait(
      { kind: 'windowExists', title: this.titleOrRegex },
      timeoutMs !== undefined ? { timeoutMs } : {}
    );
  }
}
