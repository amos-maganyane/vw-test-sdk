/**
 * widget.ts — WidgetHandle: the base interaction surface for a single widget,
 * bound to (window, aspect). All mutating ops invalidate the scope's tree cache
 * (architecture §6.2 cache-invalidation contract).
 */

import type { WidgetContext } from './context.js';
import type { WidgetNode } from '../types.js';
import type { VWTestClient } from '../client.js';
import { isHighlightEnabled, type ActionGeometry } from '../highlight.js';

/** Depth-first search for a widget node by its aspect (name or model). */
export function findWidgetByAspect(node: WidgetNode, aspect: string): WidgetNode | null {
  if (node.name === aspect || node.model === aspect) return node;
  for (const child of node.children ?? []) {
    const found = findWidgetByAspect(child, aspect);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Resolve this widget's window-local rectangle ONCE at action time, so the
 * evidence overlay replays recorded geometry instead of re-resolving it at
 * capture time (dialogs move/resize). Undefined when highlighting is disabled
 * (`VW_HIGHLIGHT` unset) or the widget cannot be located; never throws.
 */
export async function resolveActionGeometry(
  ctx: WidgetContext,
  aspect: string,
  windowTitle: string
): Promise<ActionGeometry | undefined> {
  if (!isHighlightEnabled()) return undefined;
  try {
    const rect = await ctx.client.resolveWidgetRect(aspect, windowTitle);
    return rect === null ? undefined : { rect };
  } catch {
    return undefined;
  }
}

export class WidgetHandle {
  constructor(
    protected readonly ctx: WidgetContext,
    readonly aspect: string
  ) {}

  /** The owning client — used by L2 matchers to attach action-log diagnostics. */
  get client(): VWTestClient {
    return this.ctx.client;
  }

  /** Single click. */
  async click(): Promise<void> {
    const title = await this.ctx.resolveTitle();
    const geometry = await resolveActionGeometry(this.ctx, this.aspect, title);
    await this.ctx.client.clickWidget(this.aspect, title, geometry);
    this.ctx.invalidate();
  }

  /** Double click (bridge `double` flag). */
  async doubleClick(): Promise<void> {
    const title = await this.ctx.resolveTitle();
    const geometry = await resolveActionGeometry(this.ctx, this.aspect, title);
    const opts: { double: boolean } & ActionGeometry =
      geometry === undefined ? { double: true } : { double: true, ...geometry };
    await this.ctx.client.clickWidget(this.aspect, title, opts);
    this.ctx.invalidate();
  }

  /** Direct value-set (the preferred, fast path). */
  async fill(value: string): Promise<void> {
    const title = await this.ctx.resolveTitle();
    const geometry = await resolveActionGeometry(this.ctx, this.aspect, title);
    await this.ctx.client.setWidgetValue(this.aspect, value, title, geometry);
    this.ctx.invalidate();
  }

  /**
   * Keystroke-style entry. The bridge currently exposes only direct value-set
   * (`/type`), so this is presently equivalent to `fill`; true per-keystroke
   * replay is a future bridge capability.
   */
  async type(value: string): Promise<void> {
    await this.fill(value);
  }

  /** Read the widget's current value via GET /value. */
  async getValue(): Promise<unknown> {
    const title = await this.ctx.resolveTitle();
    return this.ctx.client.getWidgetValue(this.aspect, title);
  }

  /** True if the widget is present in the rendered window tree. */
  async isVisible(): Promise<boolean> {
    return (await this.findNode()) !== null;
  }

  /** True if the widget is present and not explicitly disabled. */
  async isEnabled(): Promise<boolean> {
    const node = await this.findNode();
    if (node === null) return false;
    return node.enabled !== false;
  }

  protected async findNode(): Promise<WidgetNode | null> {
    return findWidgetByAspect(await this.ctx.tree(), this.aspect);
  }
}
