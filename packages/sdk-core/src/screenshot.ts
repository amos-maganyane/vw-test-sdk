/**
 * screenshot.ts — POST /screenshot request-spec builder.
 *
 * Bridge contract (vw-runtime-api handleScreenshotBody:):
 *   { target: { type: 'screen' | 'window', appClass?, titleContains? },
 *     format?: 'png', maxBytes?: 1..16_777_216, timeoutMs?: 1..30_000 }
 *
 * `target` is REQUIRED. For window targets the bridge REQUIRES at least one of
 * appClass / titleContains (no implicit "any window" match).
 */

export interface ScreenshotOptions {
  /** Case-insensitive window-title substring. Omit (with appClass) for full-screen. */
  windowTitle?: string;
  /** VW application class to disambiguate the window target. */
  appClass?: string;
  /** Per-call timeout for the capture (ms). */
  timeoutMs?: number;
  /** Max PNG bytes (1..16 MiB). */
  maxBytes?: number;
}

export function buildScreenshotSpec(opts: ScreenshotOptions): Record<string, unknown> {
  const spec: Record<string, unknown> = { format: 'png' };
  if (opts.timeoutMs !== undefined) spec['timeoutMs'] = opts.timeoutMs;
  if (opts.maxBytes !== undefined) spec['maxBytes'] = opts.maxBytes;

  if (opts.windowTitle === undefined && opts.appClass === undefined) {
    spec['target'] = { type: 'screen' };
    return spec;
  }

  const target: Record<string, unknown> = { type: 'window' };
  if (opts.appClass !== undefined) target['appClass'] = opts.appClass;
  if (opts.windowTitle !== undefined) target['titleContains'] = opts.windowTitle;
  spec['target'] = target;
  return spec;
}
