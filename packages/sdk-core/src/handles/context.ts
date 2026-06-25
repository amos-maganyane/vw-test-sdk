/**
 * context.ts — the minimal surface a widget handle needs from its window scope.
 *
 * Defined as an interface (not the WindowScope class) so handles depend only on
 * a type — keeping the client ↔ window ↔ handles import graph free of runtime
 * cycles.
 */

import type { VWTestClient } from '../client.js';
import type { WidgetNode } from '../types.js';

export interface WidgetContext {
  /** The owning client, for HTTP operations. */
  readonly client: VWTestClient;
  /** Resolve the scope's window title (regex → concrete title). */
  resolveTitle(): Promise<string>;
  /** The (cached) widget tree for the scoped window. */
  tree(): Promise<WidgetNode>;
  /** Drop the cached widget tree (called after any mutating action). */
  invalidate(): void;
}
