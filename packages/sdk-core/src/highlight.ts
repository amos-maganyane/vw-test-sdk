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

/** A point in WINDOW-LOCAL coordinates (origin top-left, y down). */
export interface Point {
  x: number;
  y: number;
}

/** An RGB colour (the compositor writes it as BGRA into the frame). */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** An RGBA colour; `a` is the opacity in 0..1. */
export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Geometry captured at action time and attached to a recorded action's detail.
 * The video recorder replays it per frame, so the overlay marks where the
 * framework interacted rather than where the widget happens to be at capture.
 */
export interface ActionGeometry {
  rect?: WidgetRect;
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

/** Reference look for the computer-use overlay baked into evidence frames. */
const DEFAULT_TARGET_BOX_THICKNESS = 2;
const DEFAULT_TARGET_BOX_STROKE: RgbColor = { r: 51, g: 51, b: 51 };
const DEFAULT_TARGET_BOX_HALO: RgbColor = { r: 255, g: 255, b: 255 };
const DEFAULT_TARGET_BOX_FILL: RgbaColor = { r: 0, g: 128, b: 255, a: 0.15 };
const DEFAULT_CLICK_DOT_RADIUS = 11;
const DEFAULT_CLICK_DOT_RING_WIDTH = 2;
const DEFAULT_CLICK_DOT_COLOR: RgbColor = { r: 255, g: 0, b: 0 };
const DEFAULT_CLICK_DOT_ALPHA = 0.7;
const DEFAULT_CLICK_DOT_RING_COLOR: RgbColor = { r: 255, g: 255, b: 255 };
const DEFAULT_CURSOR_SCALE = 1.5;
const DEFAULT_CURSOR_OUTLINE_WIDTH = 2;
const DEFAULT_CURSOR_FILL: RgbColor = { r: 255, g: 255, b: 255 };
const DEFAULT_CURSOR_OUTLINE: RgbColor = { r: 0, g: 0, b: 0 };
const HIGHLIGHT_TRUTHY_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'yes', 'on']);

/**
 * True when evidence highlighting is enabled (`VW_HIGHLIGHT` truthy). Widget
 * handles check this BEFORE resolving action geometry, so ordinary runs never
 * pay for the extra `/eval` round-trip.
 */
export function isHighlightEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return HIGHLIGHT_TRUTHY_VALUES.has((env['VW_HIGHLIGHT'] ?? '').toLowerCase());
}

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

/** The semantic purpose an interactive action maps to. */
function purposeForKind(kind: string): HighlightPurpose {
  return kind === 'fill' || kind === 'type' ? 'type' : 'focus';
}

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
      purpose: purposeForKind(event.kind),
    };
    const windowTitle = detail['windowTitle'];
    if (typeof windowTitle === 'string' && windowTitle.length > 0) target.windowTitle = windowTitle;
    return target;
  }
  return null;
}

/** Recorded interaction geometry + purpose, replayed by the frame overlay. */
export interface RecordedInteraction {
  rect: WidgetRect;
  purpose: HighlightPurpose;
}

/**
 * The most recent successful interactive action AT OR BEFORE `at` that carries
 * recorded geometry. `at` is a wall-clock timestamp (the frame's sampledAt), so
 * a frame is overlaid with the interaction that had already happened when it
 * was captured. Answers null when no geometry is available.
 */
export function findRecordedInteractionAt(
  events: readonly ActionEvent[],
  at: number
): RecordedInteraction | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event === undefined || event.ok === false || event.ts > at) continue;
    if (!INTERACTIVE_KINDS.has(event.kind)) continue;
    const rect = parseDetailRect(event.detail);
    if (rect === null) return null;
    return { rect, purpose: purposeForKind(event.kind) };
  }
  return null;
}

/** Parse `detail.rect` defensively; anything not a positive rectangle is null. */
function parseDetailRect(detail: Record<string, unknown> | undefined): WidgetRect | null {
  if (detail === undefined) return null;
  const raw = detail['rect'];
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const x = candidate['x'];
  const y = candidate['y'];
  const width = candidate['width'];
  const height = candidate['height'];
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export interface ComposeHighlightOptions {
  color?: RgbColor;
  thickness?: number;
}

/** The reference target-box look: 2 px #333 stroke, 1 px white halo, blue tint. */
export interface ComposeTargetBoxOptions {
  stroke?: RgbColor;
  thickness?: number;
  halo?: RgbColor | null;
  fill?: RgbaColor | null;
}

/** Click-dot look: a translucent red disc ringed in white. */
export interface ComposeClickDotOptions {
  radius?: number;
  ringWidth?: number;
  color?: RgbColor;
  alpha?: number;
  ringColor?: RgbColor;
}

/** Cursor-glyph look: a white pointer with a black outline. */
export interface ComposeCursorGlyphOptions {
  scale?: number;
  fill?: RgbColor;
  outline?: RgbColor;
  outlineWidth?: number;
}

/** The interaction geometry a frame overlay is baked from. */
export interface InteractionOverlay {
  rect?: WidgetRect;
  point?: Point;
  purpose?: HighlightPurpose;
}

/** Per-layer overrides for {@link composeInteractionOverlay}. */
export interface ComposeInteractionOverlayOptions {
  box?: ComposeTargetBoxOptions;
  dot?: ComposeClickDotOptions;
  cursor?: ComposeCursorGlyphOptions;
}

function frameUsable(bytes: Uint8Array, width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    bytes.length >= width * height * 4
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Write an opaque pixel IN PLACE; answers false when out of frame. */
function writeOpaque(
  bytes: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: RgbColor
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const index = (y * width + x) * 4;
  bytes[index] = clampByte(color.b);
  bytes[index + 1] = clampByte(color.g);
  bytes[index + 2] = clampByte(color.r);
  bytes[index + 3] = 255;
  return true;
}

/** Source-over blend of a straight (non-premultiplied) RGBA pixel IN PLACE. */
function blendRgba(
  bytes: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: RgbaColor
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const index = (y * width + x) * 4;
  const alpha = clampUnit(color.a);
  const inverse = 1 - alpha;
  bytes[index] = clampByte(clampByte(color.b) * alpha + bytes[index] * inverse);
  bytes[index + 1] = clampByte(clampByte(color.g) * alpha + bytes[index + 1] * inverse);
  bytes[index + 2] = clampByte(clampByte(color.r) * alpha + bytes[index + 2] * inverse);
  bytes[index + 3] = 255;
  return true;
}

function pointInPolygon(polygon: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i];
    const previous = polygon[j];
    if (current === undefined || previous === undefined) continue;
    if ((current.y > y) !== (previous.y > y)) {
      const intersectX =
        ((previous.x - current.x) * (y - current.y)) / (previous.y - current.y) + current.x;
      if (x <= intersectX) inside = !inside;
    }
  }
  return inside;
}

function rectCenter(rect: WidgetRect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
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
  return composeTargetBox(bytes, width, height, rect, { stroke: color, thickness, halo: null });
}

/**
 * Paint the target box: a 2 px `#333` stroke on the exact bbox, a 1 px
 * contrasting halo immediately outside it, and an optional translucent fill.
 * Coordinates are window-local and clamped; never throws.
 */
export function composeTargetBox(
  bytes: Uint8Array,
  width: number,
  height: number,
  rect: WidgetRect,
  options: ComposeTargetBoxOptions = {}
): number {
  if (!frameUsable(bytes, width, height)) return 0;
  const x0 = clamp(Math.round(rect.x), 0, width);
  const y0 = clamp(Math.round(rect.y), 0, height);
  const x1 = clamp(Math.round(rect.x + rect.width), 0, width);
  const y1 = clamp(Math.round(rect.y + rect.height), 0, height);
  if (x1 <= x0 || y1 <= y0) return 0;

  const fill = options.fill === undefined ? null : options.fill;
  const halo = options.halo === undefined ? DEFAULT_TARGET_BOX_HALO : options.halo;
  const stroke = options.stroke ?? DEFAULT_TARGET_BOX_STROKE;
  const thickness = Math.max(1, Math.floor(options.thickness ?? DEFAULT_TARGET_BOX_THICKNESS));

  let painted = 0;
  if (fill !== null) {
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        if (blendRgba(bytes, width, height, px, py, fill)) painted += 1;
      }
    }
  }
  if (halo !== null) {
    for (let px = x0 - 1; px <= x1; px += 1) {
      if (writeOpaque(bytes, width, height, px, y0 - 1, halo)) painted += 1;
      if (writeOpaque(bytes, width, height, px, y1, halo)) painted += 1;
    }
    for (let py = y0; py < y1; py += 1) {
      if (writeOpaque(bytes, width, height, x0 - 1, py, halo)) painted += 1;
      if (writeOpaque(bytes, width, height, x1, py, halo)) painted += 1;
    }
  }
  for (let t = 0; t < thickness; t += 1) {
    const top = y0 + t;
    const bottom = y1 - 1 - t;
    for (let px = x0; px < x1; px += 1) {
      if (writeOpaque(bytes, width, height, px, top, stroke)) painted += 1;
      if (writeOpaque(bytes, width, height, px, bottom, stroke)) painted += 1;
    }
    const left = x0 + t;
    const right = x1 - 1 - t;
    for (let py = y0; py < y1; py += 1) {
      if (writeOpaque(bytes, width, height, left, py, stroke)) painted += 1;
      if (writeOpaque(bytes, width, height, right, py, stroke)) painted += 1;
    }
  }
  return painted;
}

/**
 * Paint an antialiased click dot centred on `point`: a translucent red disc
 * with an opaque white ring. Coordinates are window-local and clamped; never
 * throws.
 */
export function composeClickDot(
  bytes: Uint8Array,
  width: number,
  height: number,
  point: Point,
  options: ComposeClickDotOptions = {}
): number {
  if (!frameUsable(bytes, width, height)) return 0;
  const radius = Math.max(1, options.radius ?? DEFAULT_CLICK_DOT_RADIUS);
  const ringWidth = clamp(options.ringWidth ?? DEFAULT_CLICK_DOT_RING_WIDTH, 0, radius);
  const color = options.color ?? DEFAULT_CLICK_DOT_COLOR;
  const alpha = clampUnit(options.alpha ?? DEFAULT_CLICK_DOT_ALPHA);
  const ringColor = options.ringColor ?? DEFAULT_CLICK_DOT_RING_COLOR;
  const centerX = Math.round(point.x);
  const centerY = Math.round(point.y);
  const inner = radius - ringWidth;
  const reach = Math.ceil(radius + 1);

  let painted = 0;
  for (let py = centerY - reach; py <= centerY + reach; py += 1) {
    for (let px = centerX - reach; px <= centerX + reach; px += 1) {
      const distance = Math.hypot(px - centerX, py - centerY);
      const discCoverage = clampUnit(radius + 0.5 - distance);
      if (discCoverage <= 0) continue;
      let wrote = blendRgba(bytes, width, height, px, py, {
        r: color.r,
        g: color.g,
        b: color.b,
        a: alpha * discCoverage,
      });
      if (ringWidth > 0) {
        const ringCoverage =
          clampUnit(distance - (inner - 0.5)) * clampUnit(radius + 0.5 - distance);
        if (ringCoverage > 0) {
          wrote =
            blendRgba(bytes, width, height, px, py, {
              r: ringColor.r,
              g: ringColor.g,
              b: ringColor.b,
              a: ringCoverage,
            }) || wrote;
        }
      }
      if (wrote) painted += 1;
    }
  }
  return painted;
}

/** The bridge's pointer sprite: tip at (0,0), outline traced clockwise. */
const CURSOR_POLYGON: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 0, y: 16 },
  { x: 4, y: 12 },
  { x: 7, y: 18 },
  { x: 9, y: 17 },
  { x: 6, y: 11 },
  { x: 11, y: 11 },
];

/**
 * Paint a classic arrow pointer whose tip sits at `point`: a filled polygon
 * (the bridge's sprite shape, scaled) in `fill` with an `outline`-coloured rim,
 * so it reads on light and dark backgrounds. Rasterised deterministically by
 * point-in-polygon fill + mask dilation; coordinates are clamped; never throws.
 */
export function composeCursorGlyph(
  bytes: Uint8Array,
  width: number,
  height: number,
  point: Point,
  options: ComposeCursorGlyphOptions = {}
): number {
  if (!frameUsable(bytes, width, height)) return 0;
  const scale = Math.max(0.1, options.scale ?? DEFAULT_CURSOR_SCALE);
  const outlineWidth = Math.max(0, options.outlineWidth ?? DEFAULT_CURSOR_OUTLINE_WIDTH);
  const fill = options.fill ?? DEFAULT_CURSOR_FILL;
  const outline = options.outline ?? DEFAULT_CURSOR_OUTLINE;

  const vertices = CURSOR_POLYGON.map((vertex) => ({ x: vertex.x * scale, y: vertex.y * scale }));
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  const margin = Math.ceil(outlineWidth);
  const localMinX = Math.floor(minX) - margin;
  const localMinY = Math.floor(minY) - margin;
  const localMaxX = Math.ceil(maxX) + margin;
  const localMaxY = Math.ceil(maxY) + margin;
  const cols = localMaxX - localMinX + 1;
  const rows = localMaxY - localMinY + 1;
  const inside = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const localX = localMinX + col;
      const localY = localMinY + row;
      if (pointInPolygon(vertices, localX + 0.5, localY + 0.5)) inside[row * cols + col] = 1;
    }
  }

  const nearInside = (col: number, row: number): boolean => {
    const range = Math.ceil(outlineWidth);
    for (let dy = -range; dy <= range; dy += 1) {
      for (let dx = -range; dx <= range; dx += 1) {
        if (dx * dx + dy * dy > outlineWidth * outlineWidth) continue;
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        if (inside[r * cols + c] === 1) return true;
      }
    }
    return false;
  };

  const originX = Math.round(point.x);
  const originY = Math.round(point.y);
  let painted = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const isInside = inside[row * cols + col] === 1;
      let color: RgbColor | null = null;
      if (isInside) color = fill;
      else if (outlineWidth > 0 && nearInside(col, row)) color = outline;
      if (color === null) continue;
      const px = originX + localMinX + col;
      const py = originY + localMinY + row;
      if (writeOpaque(bytes, width, height, px, py, color)) painted += 1;
    }
  }
  return painted;
}

/** Layer order: target box, then click dot, then cursor on top. */
const DEFAULT_OVERLAY_BOX: ComposeTargetBoxOptions = {
  stroke: DEFAULT_TARGET_BOX_STROKE,
  thickness: DEFAULT_TARGET_BOX_THICKNESS,
  halo: DEFAULT_TARGET_BOX_HALO,
  fill: DEFAULT_TARGET_BOX_FILL,
};

/**
 * Bake one computer-use-style interaction overlay into a raw BGRA frame IN
 * PLACE: target box, click dot, then cursor. The click point defaults to the
 * rectangle centre. A missing rect or point simply skips that layer; no
 * geometry at all paints nothing. Coordinates are clamped; never throws.
 */
export function composeInteractionOverlay(
  bytes: Uint8Array,
  width: number,
  height: number,
  interaction: InteractionOverlay,
  options: ComposeInteractionOverlayOptions = {}
): number {
  const rect = interaction.rect;
  const point = interaction.point ?? (rect === undefined ? undefined : rectCenter(rect));
  let painted = 0;
  if (rect !== undefined) {
    painted += composeTargetBox(bytes, width, height, rect, {
      ...DEFAULT_OVERLAY_BOX,
      ...(options.box ?? {}),
    });
  }
  if (point !== undefined) {
    painted += composeClickDot(bytes, width, height, point, options.dot ?? {});
    painted += composeCursorGlyph(bytes, width, height, point, options.cursor ?? {});
  }
  return painted;
}
