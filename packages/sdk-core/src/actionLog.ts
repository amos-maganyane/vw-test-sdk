/**
 * actionLog.ts — rolling buffer of bridge actions, for failure evidence.
 *
 * Capped FIFO (default capacity 100). The L2 evidence auto-fixture attaches
 * `recent(20)` to the Playwright report on failure, and custom matchers append
 * `recent(10)` to their diagnostic message (architecture §7.3 + §8.1).
 */

export interface ActionEvent {
  /** `Date.now()` at the moment the action started. */
  ts: number;
  /** Short verb: 'click', 'fill', 'type', 'getValue', 'wait', 'eval', 'open', … */
  kind: string;
  /** Action-specific detail (aspect, windowTitle, path, predicate, …). */
  detail?: Record<string, unknown>;
  /** True if the action succeeded; false/omitted on failure. */
  ok?: boolean;
  /** Error message when the action failed. */
  error?: string;
}

export class ActionLog {
  private readonly buf: ActionEvent[] = [];

  constructor(private readonly capacity: number = 100) {
    if (capacity < 1) {
      throw new Error(`ActionLog capacity must be >= 1, got ${capacity}`);
    }
  }

  /** Append an event, evicting the oldest when over capacity. */
  record(event: ActionEvent): void {
    this.buf.push(event);
    while (this.buf.length > this.capacity) {
      this.buf.shift();
    }
  }

  /** A snapshot copy of every retained event (oldest first). */
  entries(): ActionEvent[] {
    return [...this.buf];
  }

  /** The most recent `n` events (oldest first within the slice). */
  recent(n: number): ActionEvent[] {
    return this.buf.slice(-n);
  }

  clear(): void {
    this.buf.length = 0;
  }
}
