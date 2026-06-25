/**
 * matchers.ts — polling custom matchers for WidgetHandle, with action-log
 * diagnostics on failure (architecture §7.3).
 *
 * The `*Impl` functions are framework-agnostic + unit-testable; `expect` is the
 * Playwright `expect` extended with the matchers under the ergonomic names.
 */

import { expect as baseExpect } from '@playwright/test';
import type { WidgetHandle } from '@enviro365/vw-test-sdk-core';

export interface MatcherOptions {
  timeout?: number;
  interval?: number;
}

export interface MatcherResult {
  pass: boolean;
  message: () => string;
}

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_INTERVAL = 100;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function pollFor<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  timeout: number,
  interval: number
): Promise<{ matched: boolean; last: T }> {
  const deadline = Date.now() + timeout;
  let last = await read();
  while (!ok(last)) {
    if (Date.now() >= deadline) return { matched: false, last };
    await delay(interval);
    last = await read();
  }
  return { matched: true, last };
}

function recentActions(handle: WidgetHandle): string {
  return handle.client
    .getActionLog()
    .slice(-10)
    .map(
      (e) =>
        `  ${e.kind} ${JSON.stringify(e.detail ?? {})}` +
        (e.ok === false ? ` [FAILED: ${e.error ?? ''}]` : '')
    )
    .join('\n');
}

export async function toHaveValueImpl(
  handle: WidgetHandle,
  expected: string | RegExp,
  options: MatcherOptions = {}
): Promise<MatcherResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? DEFAULT_INTERVAL;
  const ok = (value: unknown): boolean => {
    const s = String(value);
    return expected instanceof RegExp ? expected.test(s) : s === expected;
  };
  const { matched, last } = await pollFor(() => handle.getValue(), ok, timeout, interval);
  return {
    pass: matched,
    message: () =>
      matched
        ? `Expected widget '${handle.aspect}' NOT to have value ${String(expected)}`
        : `Expected widget '${handle.aspect}' to have value ${String(expected)}\n` +
          `Got: ${String(last)}\nRecent actions:\n${recentActions(handle)}`,
  };
}

export async function toBeVisibleImpl(
  handle: WidgetHandle,
  options: MatcherOptions = {}
): Promise<MatcherResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? DEFAULT_INTERVAL;
  const { matched } = await pollFor(() => handle.isVisible(), (v) => v === true, timeout, interval);
  return {
    pass: matched,
    message: () =>
      matched
        ? `Expected widget '${handle.aspect}' NOT to be visible`
        : `Expected widget '${handle.aspect}' to be visible\nRecent actions:\n${recentActions(handle)}`,
  };
}

export async function toBeEnabledImpl(
  handle: WidgetHandle,
  options: MatcherOptions = {}
): Promise<MatcherResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? DEFAULT_INTERVAL;
  const { matched } = await pollFor(() => handle.isEnabled(), (v) => v === true, timeout, interval);
  return {
    pass: matched,
    message: () =>
      matched
        ? `Expected widget '${handle.aspect}' NOT to be enabled`
        : `Expected widget '${handle.aspect}' to be enabled\nRecent actions:\n${recentActions(handle)}`,
  };
}

/** Playwright `expect`, extended with the WidgetHandle matchers. */
export const expect = baseExpect.extend({
  toHaveValue(received: WidgetHandle, expected: string | RegExp, options?: MatcherOptions) {
    return toHaveValueImpl(received, expected, options);
  },
  toBeVisible(received: WidgetHandle, options?: MatcherOptions) {
    return toBeVisibleImpl(received, options);
  },
  toBeEnabled(received: WidgetHandle, options?: MatcherOptions) {
    return toBeEnabledImpl(received, options);
  },
});
