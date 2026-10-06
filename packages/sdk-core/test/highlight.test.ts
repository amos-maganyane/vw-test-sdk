import { describe, it, expect, vi } from 'vitest';
import {
  buildWidgetRectSource,
  composeClickDot,
  composeCursorGlyph,
  composeHighlightBorder,
  composeInteractionOverlay,
  composeTargetBox,
  findLatestInteraction,
  findRecordedInteractionAt,
  highlightColorForPurpose,
  isHighlightEnabled,
  parseWidgetRect,
} from '../src/highlight.js';
import type { ActionEvent } from '../src/actionLog.js';
import { VWTestClient } from '../src/client.js';
import { makeStubBridge } from './_stub.js';

describe('parseWidgetRect', () => {
  it('parses the bridge printString (outer quotes) into a rectangle', () => {
    expect(parseWidgetRect("'680,41,120,15'")).toEqual({ x: 680, y: 41, width: 120, height: 15 });
  });

  it('parses an unquoted rectangle', () => {
    expect(parseWidgetRect('10,20,30,40')).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('answers null for NOTFOUND, blank and malformed answers', () => {
    expect(parseWidgetRect('NOTFOUND')).toBeNull();
    expect(parseWidgetRect('')).toBeNull();
    expect(parseWidgetRect("'nonsense'")).toBeNull();
    expect(parseWidgetRect('1,2,3')).toBeNull();
  });

  it('answers null for a non-positive extent', () => {
    expect(parseWidgetRect('1,2,0,5')).toBeNull();
    expect(parseWidgetRect('1,2,5,0')).toBeNull();
  });
});

describe('buildWidgetRectSource', () => {
  it('quotes the aspect and targets the requested window', () => {
    const source = buildWidgetRectSource("it's", 'My Window');
    expect(source).toContain("want := 'it''s'.");
    expect(source).toContain("indexOfSubCollection: 'My Window'");
  });

  it('matches any window when no title is given', () => {
    const source = buildWidgetRectSource('btn', undefined);
    expect(source).toContain('c view notNil and: [true]');
  });

  it('never contains both recursion-guard substrings', () => {
    const source = buildWidgetRectSource('btn', 'W');
    expect(source.includes('VWBridge') && source.includes('dispatch')).toBe(false);
  });
});

describe('highlightColorForPurpose', () => {
  it('maps purposes to distinct vivid colours', () => {
    expect(highlightColorForPurpose('focus')).toEqual({ r: 255, g: 0, b: 255 });
    expect(highlightColorForPurpose('type')).toEqual({ r: 0, g: 102, b: 255 });
    expect(highlightColorForPurpose('failure')).toEqual({ r: 230, g: 0, b: 0 });
  });

  it('defaults to the focus colour', () => {
    expect(highlightColorForPurpose()).toEqual(highlightColorForPurpose('focus'));
  });
});

describe('composeHighlightBorder', () => {
  const WIDTH = 40;
  const HEIGHT = 40;

  it('paints the border colour and leaves the interior untouched', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const painted = composeHighlightBorder(bytes, WIDTH, HEIGHT, { x: 5, y: 5, width: 20, height: 20 });
    expect(painted).toBeGreaterThan(0);
    const corner = (5 * WIDTH + 5) * 4;
    expect([bytes[corner], bytes[corner + 1], bytes[corner + 2]]).toEqual([255, 0, 255]);
    const interior = (15 * WIDTH + 15) * 4;
    expect(bytes[interior]).toBe(0);
  });

  it('clamps a rectangle that extends past the frame', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const painted = composeHighlightBorder(bytes, WIDTH, HEIGHT, {
      x: 30,
      y: 30,
      width: 100,
      height: 100,
    });
    expect(painted).toBeGreaterThan(0);
    const edge = ((HEIGHT - 1) * WIDTH + (WIDTH - 1)) * 4;
    expect([bytes[edge], bytes[edge + 1], bytes[edge + 2]]).toEqual([255, 0, 255]);
  });

  it('paints nothing for a rectangle fully outside the frame', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    expect(composeHighlightBorder(bytes, WIDTH, HEIGHT, { x: 100, y: 100, width: 5, height: 5 })).toBe(0);
  });
});

describe('findLatestInteraction', () => {
  const click = (aspect: string, windowTitle: string): ActionEvent => ({
    ts: 1,
    kind: 'click',
    ok: true,
    detail: { aspect, windowTitle },
  });

  it('answers the most recent interactive action', () => {
    const events: ActionEvent[] = [click('first', 'W'), click('second', 'W')];
    expect(findLatestInteraction(events)).toEqual({
      aspect: 'second',
      windowTitle: 'W',
      purpose: 'focus',
    });
  });

  it('classifies fill/type as the type purpose', () => {
    const events: ActionEvent[] = [{ ts: 1, kind: 'fill', ok: true, detail: { aspect: 'f', windowTitle: 'W' } }];
    expect(findLatestInteraction(events)?.purpose).toBe('type');
  });

  it('skips failed, non-interactive and aspect-less events', () => {
    const events: ActionEvent[] = [
      click('good', 'W'),
      { ts: 2, kind: 'click', ok: false, detail: { aspect: 'failed', windowTitle: 'W' } },
      { ts: 3, kind: 'render', ok: true, detail: {} },
      { ts: 4, kind: 'click', ok: true, detail: {} },
    ];
    expect(findLatestInteraction(events)?.aspect).toBe('good');
  });

  it('answers null when no interaction is present', () => {
    expect(findLatestInteraction([])).toBeNull();
  });
});

describe('VWTestClient.render with highlight', () => {
  function frameStub(): ReturnType<typeof makeStubBridge> {
    const bridge = makeStubBridge({
      evalResult: (source) =>
        source.includes('ScheduledControllers')
          ? { ok: true, result: "'10,10,20,20'" }
          : { ok: true, result: 'nil' },
    });
    vi.mocked(bridge.render).mockResolvedValue({
      bytes: new Uint8Array(40 * 40 * 4),
      width: 40,
      height: 40,
      pixelFormat: 'bgra',
    });
    return bridge;
  }

  it('composites the resolved rectangle into the frame pixels', async () => {
    const vw = new VWTestClient({}, frameStub());
    const frame = await vw.render({ windowTitle: 'W', highlight: { aspect: 'btnReset', windowTitle: 'W' } });
    expect(frame.highlight).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    expect(frame.highlightAspect).toBe('btnReset');
    const corner = (10 * 40 + 10) * 4;
    expect([frame.bytes[corner], frame.bytes[corner + 1], frame.bytes[corner + 2]]).toEqual([255, 0, 255]);
  });

  it('leaves the frame unhighlighted when highlight is omitted', async () => {
    const vw = new VWTestClient({}, frameStub());
    const frame = await vw.render({ windowTitle: 'W' });
    expect(frame.highlight).toBeUndefined();
    expect(frame.bytes.every((byte) => byte === 0)).toBe(true);
  });

  it('resolves the rectangle for a widget aspect', async () => {
    const vw = new VWTestClient({}, frameStub());
    await expect(vw.resolveWidgetRect('btnReset', 'W')).resolves.toEqual({
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    });
  });
});

describe('composeTargetBox', () => {
  const WIDTH = 40;
  const HEIGHT = 40;
  const rect = { x: 5, y: 5, width: 20, height: 20 };

  function pixel(bytes: Uint8Array, x: number, y: number, frameWidth: number): number[] {
    const i = (y * frameWidth + x) * 4;
    return [bytes[i], bytes[i + 1], bytes[i + 2]];
  }

  it('paints the exact bbox edges in the stroke colour with a 1 px halo outside', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const painted = composeTargetBox(bytes, WIDTH, HEIGHT, rect);
    expect(painted).toBeGreaterThan(0);
    // 2 px #333 stroke drawn INSIDE the exact bbox
    expect(pixel(bytes, 5, 5, WIDTH)).toEqual([51, 51, 51]);
    expect(pixel(bytes, 6, 5, WIDTH)).toEqual([51, 51, 51]);
    expect(pixel(bytes, 5, 6, WIDTH)).toEqual([51, 51, 51]);
    expect(pixel(bytes, 24, 24, WIDTH)).toEqual([51, 51, 51]);
    // 1 px contrasting halo immediately OUTSIDE the stroke
    expect(pixel(bytes, 4, 4, WIDTH)).toEqual([255, 255, 255]);
    expect(pixel(bytes, 25, 25, WIDTH)).toEqual([255, 255, 255]);
    expect(pixel(bytes, 15, 15, WIDTH)).toEqual([0, 0, 0]);
  });

  it('optionally fills the interior with a translucent colour', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    composeTargetBox(bytes, WIDTH, HEIGHT, rect, { fill: { r: 0, g: 128, b: 255, a: 0.15 } });
    // BGRA: b=round(255*0.15)=38, g=round(128*0.15)=19, r=0
    expect(pixel(bytes, 15, 15, WIDTH)).toEqual([38, 19, 0]);
  });

  it('can disable the halo', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    composeTargetBox(bytes, WIDTH, HEIGHT, rect, { halo: null });
    expect(pixel(bytes, 4, 4, WIDTH)).toEqual([0, 0, 0]);
  });

  it('clamps an oversized rectangle and paints nothing when fully outside', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    expect(
      composeTargetBox(bytes, WIDTH, HEIGHT, { x: 30, y: 30, width: 100, height: 100 })
    ).toBeGreaterThan(0);
    expect(pixel(bytes, WIDTH - 1, HEIGHT - 1, WIDTH)).toEqual([51, 51, 51]);
    expect(composeTargetBox(bytes, WIDTH, HEIGHT, { x: 100, y: 100, width: 5, height: 5 })).toBe(0);
  });
});

describe('composeClickDot', () => {
  const WIDTH = 48;
  const HEIGHT = 48;

  function pixel(bytes: Uint8Array, x: number, y: number): number[] {
    const i = (y * WIDTH + x) * 4;
    return [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
  }

  it('paints a translucent red disc with an opaque white 2 px ring', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const painted = composeClickDot(bytes, WIDTH, HEIGHT, { x: 24, y: 24 });
    expect(painted).toBeGreaterThan(0);
    // centre: rgba(255,0,0,0.7) over transparent black -> 179/0/0
    expect(pixel(bytes, 24, 24)).toEqual([0, 0, 179, 255]);
    // ring band at distance 10 is opaque white
    expect(pixel(bytes, 34, 24)).toEqual([255, 255, 255, 255]);
    expect(pixel(bytes, 38, 24)).toEqual([0, 0, 0, 0]);
    // the antialiased outer edge is written (never a hard cut to background)
    const edge = pixel(bytes, 35, 24);
    expect(edge[3]).toBe(255);
    expect(edge[0]).toBeGreaterThan(0);
  });

  it('never throws and paints nothing for a dot fully outside the frame', () => {
    const bytes = new Uint8Array(4 * 4 * 4);
    expect(composeClickDot(bytes, 4, 4, { x: -100, y: -100 })).toBe(0);
    expect(composeClickDot(bytes, 4, 4, { x: 1_000, y: 1_000 })).toBe(0);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it('leaves only the disc when the ring width is zero', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    composeClickDot(bytes, WIDTH, HEIGHT, { x: 24, y: 24 }, { ringWidth: 0 });
    expect(pixel(bytes, 34, 24)).toEqual([0, 0, 179, 255]);
  });
});

describe('composeCursorGlyph', () => {
  const WIDTH = 64;
  const HEIGHT = 64;
  const point = { x: 16, y: 16 };

  function pixel(bytes: Uint8Array, x: number, y: number): number[] {
    const i = (y * WIDTH + x) * 4;
    return [bytes[i], bytes[i + 1], bytes[i + 2]];
  }

  it('fills the pointer white with a black outline whose tip is at the point', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const painted = composeCursorGlyph(bytes, WIDTH, HEIGHT, point);
    expect(painted).toBeGreaterThan(0);
    expect(pixel(bytes, point.x, point.y)).toEqual([255, 255, 255]);
    expect(pixel(bytes, point.x + 1, point.y + 3)).toEqual([255, 255, 255]);
    expect(pixel(bytes, point.x + 1, point.y - 1)).toEqual([0, 0, 0]);
    expect(pixel(bytes, point.x + 30, point.y + 30)).toEqual([0, 0, 0]);
  });

  it('never throws and paints nothing for a glyph fully outside the frame', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    expect(() => composeCursorGlyph(bytes, WIDTH, HEIGHT, { x: -500, y: -500 })).not.toThrow();
    expect(composeCursorGlyph(bytes, WIDTH, HEIGHT, { x: 1_000, y: 1_000 })).toBe(0);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
});

describe('composeInteractionOverlay', () => {
  const WIDTH = 64;
  const HEIGHT = 64;

  function pixel(bytes: Uint8Array, x: number, y: number): number[] {
    const i = (y * WIDTH + x) * 4;
    return [bytes[i], bytes[i + 1], bytes[i + 2]];
  }

  it('composes box -> dot -> cursor in z-order', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const painted = composeInteractionOverlay(bytes, WIDTH, HEIGHT, {
      rect: { x: 8, y: 8, width: 20, height: 20 },
      point: { x: 40, y: 40 },
      purpose: 'focus',
    });
    expect(painted).toBeGreaterThan(0);
    // box stroke on the exact bbox
    expect(pixel(bytes, 8, 8)).toEqual([51, 51, 51]);
    // translucent blue box fill (box layer)
    expect(pixel(bytes, 12, 12)).toEqual([38, 19, 0]);
    // cursor tip covers the dot centre last (cursor layer on top)
    expect(pixel(bytes, 40, 40)).toEqual([255, 255, 255]);
    expect(pixel(bytes, 48, 40)).toEqual([0, 0, 179]);
  });

  it('derives the click point from the rect centre when only a rect is given', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    composeInteractionOverlay(bytes, WIDTH, HEIGHT, { rect: { x: 10, y: 10, width: 20, height: 20 } });
    // centre (20,20) carries the cursor tip
    expect(pixel(bytes, 20, 20)).toEqual([255, 255, 255]);
    // dot over the translucent fill: red 0.7 over (0,19,38) = (11,6,179)
    expect(pixel(bytes, 12, 20)).toEqual([11, 6, 179]);
  });

  it('paints nothing (and never throws) when no geometry is available', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    expect(composeInteractionOverlay(bytes, WIDTH, HEIGHT, {})).toBe(0);
    expect(composeInteractionOverlay(bytes, WIDTH, HEIGHT, { purpose: 'failure' })).toBe(0);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
});

describe('findRecordedInteractionAt', () => {
  const rect = { x: 1, y: 2, width: 3, height: 4 };

  it('selects the most recent interactive action at or before the timestamp', () => {
    const events: ActionEvent[] = [
      { ts: 100, kind: 'click', ok: true, detail: { aspect: 'a', rect } },
      { ts: 200, kind: 'fill', ok: true, detail: { aspect: 'b', rect: { x: 5, y: 5, width: 5, height: 5 } } },
    ];
    expect(findRecordedInteractionAt(events, 250)).toEqual({
      rect: { x: 5, y: 5, width: 5, height: 5 },
      purpose: 'type',
    });
    expect(findRecordedInteractionAt(events, 150)).toEqual({ rect, purpose: 'focus' });
    expect(findRecordedInteractionAt(events, 50)).toBeNull();
  });

  it('ignores failed, non-interactive and future actions', () => {
    const events: ActionEvent[] = [
      { ts: 10, kind: 'click', ok: false, detail: { rect } },
      { ts: 20, kind: 'render', ok: true, detail: { rect } },
      { ts: 40, kind: 'click', ok: true, detail: { rect } },
    ];
    expect(findRecordedInteractionAt(events, 30)).toBeNull();
    expect(findRecordedInteractionAt(events, 50)?.rect).toEqual(rect);
  });

  it('answers null when the latest interaction carries no rectangle', () => {
    const events: ActionEvent[] = [
      { ts: 10, kind: 'click', ok: true, detail: { rect } },
      { ts: 20, kind: 'click', ok: true, detail: { aspect: 'x' } },
    ];
    expect(findRecordedInteractionAt(events, 30)).toBeNull();
  });

  it('answers null for an empty log', () => {
    expect(findRecordedInteractionAt([], 1_000)).toBeNull();
  });
});

describe('isHighlightEnabled', () => {
  it('is true only for truthy VW_HIGHLIGHT values', () => {
    expect(isHighlightEnabled({ VW_HIGHLIGHT: '1' })).toBe(true);
    expect(isHighlightEnabled({ VW_HIGHLIGHT: 'TRUE' })).toBe(true);
    expect(isHighlightEnabled({ VW_HIGHLIGHT: 'yes' })).toBe(true);
    expect(isHighlightEnabled({ VW_HIGHLIGHT: 'on' })).toBe(true);
    expect(isHighlightEnabled({ VW_HIGHLIGHT: '0' })).toBe(false);
    expect(isHighlightEnabled({ VW_HIGHLIGHT: 'banana' })).toBe(false);
    expect(isHighlightEnabled({})).toBe(false);
  });
});
