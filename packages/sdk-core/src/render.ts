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

import type { RenderFrame, RenderSource, RenderTarget } from '@enviro365/vw-bridge-client';
import type { HighlightRenderOptions, WidgetRect } from './highlight.js';

export interface RenderOptions {
  /** Case-insensitive window-title substring. */
  windowTitle?: string;
  /** VW application class to disambiguate the window target. */
  appClass?: string;
  /**
   * Capture source for the frame: `os` (bridge default) uses the colour-correct
   * OS capture cropped to the client area; `in-image` uses the offscreen Pixmap
   * render. Omitted => the bridge default (`os`).
   */
  source?: RenderSource;
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
  /**
   * Composite a high-contrast border onto the rendered frame at a widget
   * interaction's rectangle, so the highlight is present in the evidence
   * pixels (stills AND video). `true` points at the most recent interactive
   * action in the client's action log; an object pins aspect/window/purpose.
   * No-op when no rectangle can be resolved.
   */
  highlight?: boolean | HighlightRenderOptions;
}

/**
 * A rendered frame that may carry a composited highlight. `highlight` is the
 * window-local rectangle painted, when one was resolved.
 */
export interface HighlightedRenderFrame extends RenderFrame {
  highlight?: WidgetRect;
  highlightAspect?: string;
}

export interface RenderSpec {
  target: RenderTarget;
  maxBytes?: number;
  source?: RenderSource;
}

export function buildRenderSpec(opts: RenderOptions): RenderSpec {
  const target: RenderTarget = {};
  if (opts.appClass !== undefined) target.appClass = opts.appClass;
  if (opts.windowTitle !== undefined) target.titleContains = opts.windowTitle;

  const spec: RenderSpec = { target };
  if (opts.maxBytes !== undefined) spec.maxBytes = opts.maxBytes;
  if (opts.source !== undefined) spec.source = opts.source;
  return spec;
}
