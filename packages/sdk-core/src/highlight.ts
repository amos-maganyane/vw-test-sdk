/**
 * highlight.ts — client-side interaction highlighting for captured evidence.
 *
 * Evidence frames are produced by `POST /render`, which paints a live window into
 * a fresh offscreen `Pixmap`. The bridge's own highlight feature draws onto the
 * live window's screen graphics context — a disjoint surface — so it can never
 * appear in a rendered frame. `GET /windows/tree` also carries no widget geometry
 * to composite from (its rows are aspect/label/model/enabled/value only).
 *
 * This module closes that gap WITHOUT any bridge change:
 *
 *   1. Resolve a widget's window-local rectangle from the live image over the
 *      existing `/eval` surface (same coordinate space the render frame uses —
 *      both are relative to the window content origin).
 *   2. Paint a high-contrast border into the raw BGRA frame the SDK already
 *      holds, before PNG encoding.
 *
 * Because it runs on the frame buffer, the highlight appears in stills AND in
 * every recorded video frame. Colours are deliberately vivid (magenta focus,
 * blue type, …) so they read on the bright-yellow VisualWorks UI.
 */

import type { ActionEvent } from './actionLog.js';
import { quoteSmalltalkString } from './smalltalk.js';

/** Semantic purpose → border colour. Mirrors the bridge legend, tuned for contrast. */
export type HighlightPurpose = 'focus' | 'type' | 'select' | 'dialog' | 'success' | 'failure';

/** A widget rectangle in WINDOW-LOCAL coordinates (origin top-left, y down). */
export interface WidgetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An RGB colour (the compositor writes it as BGRA into the frame). */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Explicit highlight request; every field defaults from the latest interaction. */
export interface HighlightRenderOptions {
  /** Aspect (widget) to highlight. Defaults to the most recent interactive action. */
  aspect?: string;
  /** Window title to resolve the aspect in. Defaults to the action's window, then the render target. */
  windowTitle?: string;
  /** Semantic purpose → colour. Defaults to the action's kind. */
  purpose?: HighlightPurpose;
  /** Border thickness in pixels. Defaults to {@link DEFAULT_HIGHLIGHT_THICKNESS}. */
  thickness?: number;
}

/** The interaction a highlight should point at. */
export interface InteractionTarget {
  aspect: string;
  windowTitle?: string;
  purpose: HighlightPurpose;
}

export const DEFAULT_HIGHLIGHT_THICKNESS = 3;

/**
 * Purpose → colour. `focus` is magenta rather than the bridge's yellow: the VW
 * windows are bright yellow, so a yellow border would be invisible in evidence.
 */
const PURPOSE_COLORS: Readonly<Record<HighlightPurpose, RgbColor>> = {
  focus: { r: 255, g: 0, b: 255 },
  type: { r: 0, g: 102, b: 255 },
  select: { r: 0, g: 170, b: 60 },
  dialog: { r: 255, g: 122, b: 0 },
  success: { r: 0, g: 170, b: 60 },
  failure: { r: 230, g: 0, b: 0 },
};

export function highlightColorForPurpose(purpose: HighlightPurpose = 'focus'): RgbColor {
  return PURPOSE_COLORS[purpose] ?? PURPOSE_COLORS.focus;
}

/**
 * Build the Smalltalk expression that resolves a widget's window-local rectangle.
 *
 * Mirrors the bridge's `resolveAspect:inWindowMatching:` lookup tiers: named
 * component key first, then a fallback scan matching the spec model or label.
 * The expression is defensive (every step guarded) and answers `'x,y,w,h'` or
 * `'NOTFOUND'`. It deliberately contains neither `VWBridge` nor `dispatch`, so
 * it cannot trip the bridge's recursive-dispatch guard.
 */
export function buildWidgetRectSource(aspect: string, windowTitle?: string): string {
  const windowMatch =
    windowTitle === undefined || windowTitle.length === 0
      ? 'true'
      : `(c view label asString indexOfSubCollection: ${quoteSmalltalkString(windowTitle)} startingAt: 1) > 0`;
  return [
    '| mgr found want matchBlock |',
    'mgr := Smalltalk at: #ScheduledControllers.',
    'found := nil.',
    `want := ${quoteSmalltalkString(aspect)}.`,
    'matchBlock := [:each | (([each spec model asString = want] on: Core.Error do: [:e | false]) or: [[each spec label asString = want] on: Core.Error do: [:e | false]])].',
    'mgr scheduledControllers do: [:c |',
    `  (found isNil and: [c view notNil and: [${windowMatch}]]) ifTrue: [`,
    '    | app builder comps w |',
    '    app := c model.',
    '    (app isNil or: [(app respondsTo: #builder) not]) ifTrue: [',
    '      app := [c view application] on: Core.Error do: [:e | nil]].',
    '    (app notNil and: [app respondsTo: #builder]) ifTrue: [',
    '      builder := app builder.',
    '      comps := builder namedComponents.',
    '      w := [comps at: want asSymbol ifAbsent: [nil]] on: Core.Error do: [:e | nil].',
    '      w isNil ifTrue: [w := [comps at: want ifAbsent: [nil]] on: Core.Error do: [:e | nil]].',
    '      w isNil ifTrue: [',
    '        (comps respondsTo: #valuesDo:)',
    '          ifTrue: [comps valuesDo: [:each | (w isNil and: [matchBlock value: each]) ifTrue: [w := each]]]',
    '          ifFalse: [(comps respondsTo: #do:) ifTrue: [comps do: [:each | (w isNil and: [matchBlock value: each]) ifTrue: [w := each]]]]].',
    '      w notNil ifTrue: [found := w]]]].',
    'found isNil',
    "  ifTrue: ['NOTFOUND']",
    '  ifFalse: [',
    '    | widget gc tr bnds |',
    '    widget := found widget.',
    '    gc := widget graphicsContext.',
    '    tr := gc translation.',
    '    bnds := widget bounds.',
    "    (tr x) printString , ',' , (tr y) printString , ',' , (bnds extent x) printString , ',' , (bnds extent y) printString]",
  ].join('\n');
}

/**
 * Parse the `/eval` result of {@link buildWidgetRectSource}. The bridge returns
 * the expression's `printString`, so a String answer arrives wrapped in outer
 * single quotes (e.g. `'680,41,120,15'`). Returns null for `NOTFOUND`, a blank
 * answer, or anything not shaped like `x,y,w,h`.
 */
export function parseWidgetRect(raw: string): WidgetRect | null {
  let value = raw.trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length === 0 || value === 'NOTFOUND') return null;
  const match = /^(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(value);
  if (match === null) return null;
  const rect: WidgetRect = {
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4]),
  };
  if (rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

/** Action kinds that represent the framework driving a widget (not evidence capture). */
const INTERACTIVE_KINDS: ReadonlySet<string> = new Set([
  'click',
  'fill',
  'type',
  'setDatasetCell',
  'selectRow',
  'selectListByIndex',
  'selectCombo',
]);

/**
 * The most recent successful widget interaction in an action log, or null. The
 * recorder and `render({ highlight: true })` use this to point the highlight at
 * whatever the framework just did, without the test wiring an aspect explicitly.
 */
export function findLatestInteraction(events: readonly ActionEvent[]): InteractionTarget | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event === undefined || event.ok === false) continue;
    if (!INTERACTIVE_KINDS.has(event.kind)) continue;
    const detail = event.detail;
    if (detail === undefined) continue;
    const aspect = detail['aspect'];
    if (typeof aspect !== 'string' || aspect.length === 0) continue;
    const target: InteractionTarget = {
      aspect,
      purpose: event.kind === 'fill' || event.kind === 'type' ? 'type' : 'focus',
    };
    const windowTitle = detail['windowTitle'];
    if (typeof windowTitle === 'string' && windowTitle.length > 0) target.windowTitle = windowTitle;
    return target;
  }
  return null;
}

export interface ComposeHighlightOptions {
  color?: RgbColor;
  thickness?: number;
}

/**
 * Paint a rectangular border into a raw BGRA frame IN PLACE. Coordinates are
 * window-local (matching `POST /render`); anything outside the frame is clamped.
 * Answers the number of pixel writes (corners are written by two edges, so the
 * count is an upper bound on distinct pixels).
 */
export function composeHighlightBorder(
  bytes: Uint8Array,
  width: number,
  height: number,
  rect: WidgetRect,
  options: ComposeHighlightOptions = {}
): number {
  const color = options.color ?? highlightColorForPurpose('focus');
  const thickness = Math.max(1, Math.floor(options.thickness ?? DEFAULT_HIGHLIGHT_THICKNESS));
  const x0 = Math.max(0, Math.min(width, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(height, Math.round(rect.y)));
  const x1 = Math.max(0, Math.min(width, Math.round(rect.x + rect.width)));
  const y1 = Math.max(0, Math.min(height, Math.round(rect.y + rect.height)));
  if (x1 <= x0 || y1 <= y0) return 0;

  let painted = 0;
  const paint = (px: number, py: number): void => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const idx = (py * width + px) * 4;
    bytes[idx] = color.b;
    bytes[idx + 1] = color.g;
    bytes[idx + 2] = color.r;
    bytes[idx + 3] = 255;
    painted += 1;
  };

  for (let t = 0; t < thickness; t += 1) {
    const top = y0 + t;
    const bottom = y1 - 1 - t;
    for (let px = x0; px < x1; px += 1) {
      paint(px, top);
      paint(px, bottom);
    }
    const left = x0 + t;
    const right = x1 - 1 - t;
    for (let py = y0; py < y1; py += 1) {
      paint(left, py);
      paint(right, py);
    }
  }
  return painted;
}
