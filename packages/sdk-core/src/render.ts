/**
 * render.ts — POST /render request-spec builder.
 *
 * Bridge contract (vw-runtime-api handleRenderBody:):
 *   { target: { titleContains?, appClass? }, maxBytes?: 1..16_777_216 }
 *
 * Unlike /screenshot there is no screen scope: the bridge renders one live
 * window's view into an offscreen Pixmap, so at least one of titleContains /
 * appClass MUST be supplied or the bridge answers HTTP 400.
 */

import type { RenderTarget } from '@enviro365/vw-bridge-client';

export interface RenderOptions {
  /** Case-insensitive window-title substring. */
  windowTitle?: string;
  /** VW application class to disambiguate the window target. */
  appClass?: string;
  /** Max raw bytes (bridge clamps 1..16_777_216). */
  maxBytes?: number;
  /** Per-call HTTP timeout for the render (ms). */
  timeoutMs?: number;
  /**
   * When false, the render is not appended to the rolling action log. Default
   * true (unchanged). High-frequency consumers (failure-video frame polling)
   * pass false so their captures cannot evict real test actions from the
   * last-N evidence log.
   */
  recordAction?: boolean;
}

export interface RenderSpec {
  target: RenderTarget;
  maxBytes?: number;
}

export function buildRenderSpec(opts: RenderOptions): RenderSpec {
  const target: RenderTarget = {};
  if (opts.appClass !== undefined) target.appClass = opts.appClass;
  if (opts.windowTitle !== undefined) target.titleContains = opts.windowTitle;

  const spec: RenderSpec = { target };
  if (opts.maxBytes !== undefined) spec.maxBytes = opts.maxBytes;
  return spec;
}
