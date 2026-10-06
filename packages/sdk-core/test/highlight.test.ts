import { describe, it, expect, vi } from 'vitest';
import {
  buildWidgetRectSource,
  composeClickDot,
  composeCursorGlyph,
  composeHighlightBorder,
  composeInteractionOverlay,
  composeInteractionTimeline,
  composeLabel,
  composeRipple,
  composeTargetBox,
  findLatestInteraction,
  findRecordedInteractionAt,
  findRecordedTimelineAt,
  highlightColorForPurpose,
  isHighlightEnabled,
  LABEL_FADE_MS,
  LABEL_HOLD_MS,
  parseWidgetRect,
  semanticActionLabel,
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

describe('composeRipple', () => {
  const WIDTH = 100;
  const HEIGHT = 100;
  const point = { x: 50, y: 50 };

  function pixel(bytes: Uint8Array, width: number, x: number, y: number): number[] {
    const i = (y * width + x) * 4;
    return [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
  }

  it('paints an antialiased ring whose radius follows the ease-out curve', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const painted = composeRipple(bytes, WIDTH, HEIGHT, point, 0.5);
    expect(painted).toBeGreaterThan(0);
    // progress 0.5 -> e = 1-(1-0.5)^3 = 0.875 -> r = 6 + 38*0.875 = 39.25.
    // A pixel at distance 39 sits fully inside the stroke band, so its coverage
    // is 1 and its alpha is 0.9*(1-0.5) = 0.45 of {r:71,g:133,b:255}:
    // b = 255*0.45 = 115, g = 133*0.45 = 60, r = 71*0.45 = 32.
    expect(pixel(bytes, WIDTH, 89, 50)).toEqual([115, 60, 32, 255]);
    // the hole inside the ring and the centre stay untouched
    expect(pixel(bytes, WIDTH, 50, 50)).toEqual([0, 0, 0, 0]);
    expect(pixel(bytes, WIDTH, 61, 50)).toEqual([0, 0, 0, 0]);
  });

  it('fades the ring as progress approaches 1', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    composeRipple(bytes, WIDTH, HEIGHT, point, 0.9);
    // r = 6 + 38*(1-(1-0.9)^3) = 43.962, so a pixel at distance 44 is in-band;
    // alpha = 0.9*(1-0.9) = 0.09 -> b=23, g=12, r=6.
    expect(pixel(bytes, WIDTH, 94, 50)).toEqual([23, 12, 6, 255]);
  });

  it('paints nothing for progress at or beyond the 0..1 range', () => {
    for (const progress of [0, -0.2, 1, 1.5, Number.NaN]) {
      const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
      expect(composeRipple(bytes, WIDTH, HEIGHT, point, progress)).toBe(0);
      expect(bytes.every((byte) => byte === 0)).toBe(true);
    }
  });

  it('scales both radii with the scale option', () => {
    const width = 200;
    const height = 200;
    const bytes = new Uint8Array(width * height * 4);
    const painted = composeRipple(bytes, width, height, { x: 100, y: 100 }, 0.5, { scale: 2 });
    expect(painted).toBeGreaterThan(0);
    // scaled: r = 12 + 76*0.875 = 78.5 -> distance 78 is in-band, distance 11 is the hole
    expect(pixel(bytes, width, 178, 100)).toEqual([115, 60, 32, 255]);
    expect(pixel(bytes, width, 111, 100)).toEqual([0, 0, 0, 0]);
  });

  it('never throws and paints nothing for points fully outside the frame', () => {
    const bytes = new Uint8Array(4 * 4 * 4);
    expect(composeRipple(bytes, 4, 4, { x: -100, y: -100 }, 0.5)).toBe(0);
    expect(composeRipple(bytes, 4, 4, { x: 1_000, y: 1_000 }, 0.5)).toBe(0);
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
      point: { x: 7.5, y: 7.5 },
      purpose: 'type',
      ts: 200,
    });
    expect(findRecordedInteractionAt(events, 150)).toEqual({
      rect,
      point: { x: 2.5, y: 4 },
      purpose: 'focus',
      ts: 100,
    });
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

describe('findRecordedTimelineAt', () => {
  const rectA = { x: 0, y: 0, width: 20, height: 20 };
  const rectB = { x: 20, y: 0, width: 20, height: 20 };

  it('answers the current and previous geometry-bearing interactive actions', () => {
    const events: ActionEvent[] = [
      { ts: 1_000, kind: 'click', ok: true, detail: { aspect: 'a', rect: rectA } },
      { ts: 1_600, kind: 'fill', ok: true, detail: { aspect: 'b', rect: rectB } },
      { ts: 2_000, kind: 'render', ok: true, detail: { rect: rectA } },
      { ts: 2_500, kind: 'click', ok: true, detail: { aspect: 'c' } },
    ];
    expect(findRecordedTimelineAt(events, 2_600)).toEqual({
      current: { rect: rectB, point: { x: 30, y: 10 }, purpose: 'type', ts: 1_600 },
      previous: { rect: rectA, point: { x: 10, y: 10 }, purpose: 'focus', ts: 1_000 },
    });
    expect(findRecordedTimelineAt(events, 1_500)).toEqual({
      current: { rect: rectA, point: { x: 10, y: 10 }, purpose: 'focus', ts: 1_000 },
      previous: null,
    });
  });

  it('answers nulls before the first geometry-bearing interaction', () => {
    const events: ActionEvent[] = [{ ts: 1_000, kind: 'click', ok: true, detail: { rect: rectA } }];
    expect(findRecordedTimelineAt(events, 500)).toEqual({ current: null, previous: null });
    expect(findRecordedTimelineAt([], 1_000)).toEqual({ current: null, previous: null });
  });
});

describe('composeInteractionTimeline', () => {
  const WIDTH = 64;
  const HEIGHT = 64;

  function pixel(bytes: Uint8Array, width: number, x: number, y: number): number[] {
    const i = (y * width + x) * 4;
    return [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
  }

  /** Click at (10,32). */
  const previousClick = (ts: number): ActionEvent => ({
    ts,
    kind: 'click',
    ok: true,
    detail: { rect: { x: 0, y: 22, width: 20, height: 20 } },
  });
  /** Click at (30,32). */
  const currentClick = (ts: number): ActionEvent => ({
    ts,
    kind: 'click',
    ok: true,
    detail: { rect: { x: 20, y: 22, width: 20, height: 20 } },
  });

  it('travels the cursor between the previous and current click points', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    // gap 400ms -> T = clamp(400, 1000, 1500) = 1000ms, travel starts at 600ms.
    // At 1100ms: u = (1100-1000+400)/1000 = 0.5 -> e = 0.5 -> x = 10 + 20*0.5 = 20.
    const painted = composeInteractionTimeline(
      bytes,
      WIDTH,
      HEIGHT,
      [previousClick(600), currentClick(1_000)],
      1_100
    );
    expect(painted).toBeGreaterThan(0);
    expect(pixel(bytes, WIDTH, 20, 32)).toEqual([255, 255, 255, 255]);
    // the destination still shows the click dot, i.e. the cursor has not arrived yet
    expect(pixel(bytes, WIDTH, 30, 32)).toEqual([11, 6, 179, 255]);
  });

  it('snaps the cursor to the current point when the gap exceeds 1.2 s', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    // gap 2000ms > 1200ms -> no travel: the tip sits on the current point
    composeInteractionTimeline(bytes, WIDTH, HEIGHT, [previousClick(1_000), currentClick(3_000)], 3_500);
    expect(pixel(bytes, WIDTH, 30, 32)).toEqual([255, 255, 255, 255]);
    expect(pixel(bytes, WIDTH, 10, 32)).toEqual([0, 0, 0, 0]);
    // (18,32) is one px left of the box: a cursor still near the previous point
    // would leave its opaque black outline here, a snapped cursor leaves it clear
    expect(pixel(bytes, WIDTH, 18, 32)).toEqual([0, 0, 0, 0]);
  });

  it('holds the cursor at the current point once travel has finished', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    // u clamps to 1 long before 2500ms -> the cursor parks at (30,32)
    composeInteractionTimeline(bytes, WIDTH, HEIGHT, [previousClick(600), currentClick(1_000)], 2_500);
    expect(pixel(bytes, WIDTH, 30, 32)).toEqual([255, 255, 255, 255]);
    expect(pixel(bytes, WIDTH, 18, 32)).toEqual([0, 0, 0, 0]);
    expect(pixel(bytes, WIDTH, 10, 32)).toEqual([0, 0, 0, 0]);
  });

  it('draws an expanding ripple at age 500 ms and nothing at age 2 s', () => {
    const width = 100;
    const height = 100;
    const click: ActionEvent = {
      ts: 1_000,
      kind: 'click',
      ok: true,
      detail: { rect: { x: 40, y: 40, width: 20, height: 20 } },
    };
    const bytes = new Uint8Array(width * height * 4);
    composeInteractionTimeline(bytes, width, height, [click], 1_500);
    // age 500/1800 -> r = 29.685; distance 29 is in-band and
    // alpha = 0.9*(1-500/1800) = 0.65 -> b=166, g=86, r=46.
    expect(pixel(bytes, width, 79, 50)).toEqual([166, 86, 46, 255]);

    const expired = new Uint8Array(width * height * 4);
    composeInteractionTimeline(expired, width, height, [click], 3_000);
    // age 2000 >= 1800 -> no ripple; box/dot/cursor never reach (79,50)
    expect(pixel(expired, width, 79, 50)).toEqual([0, 0, 0, 0]);
  });

  it('caps active ripples at the six newest clicks', () => {
    const width = 100;
    const height = 100;
    const points = [8, 22, 36, 50, 64, 78, 92];
    const clicks: ActionEvent[] = points.map((x, index) => ({
      ts: 1_000 + index,
      kind: 'click',
      ok: true,
      detail: { rect: { x: x - 5, y: 45, width: 10, height: 10 } },
    }));

    const bytes = new Uint8Array(width * height * 4);
    const paintedSeven = composeInteractionTimeline(bytes, width, height, clicks, 1_007);
    // the oldest click (x=8, age 7) is beyond the cap of six newest -> no ring
    expect(pixel(bytes, width, 8, 56)).toEqual([0, 0, 0, 0]);
    // the second-oldest (x=22, age 6) is inside the cap: alpha 0.897 -> b=229,g=119,r=64
    expect(pixel(bytes, width, 22, 56)).toEqual([229, 119, 64, 255]);

    const bytesSix = new Uint8Array(width * height * 4);
    const paintedSix = composeInteractionTimeline(bytesSix, width, height, clicks.slice(1), 1_007);
    expect(paintedSeven).toBe(paintedSix);
  });

  it('paints nothing (and never throws) when no geometry is available', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    expect(composeInteractionTimeline(bytes, WIDTH, HEIGHT, [], 1_000)).toBe(0);
    expect(
      composeInteractionTimeline(
        bytes,
        WIDTH,
        HEIGHT,
        [
          { ts: 1_000, kind: 'click', ok: true, detail: { aspect: 'no-geometry' } },
          { ts: 2_000, kind: 'render', ok: true, detail: { rect: { x: 1, y: 1, width: 2, height: 2 } } },
        ],
        3_000
      )
    ).toBe(0);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
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

describe('composeLabel', () => {
  const WIDTH = 400;
  const HEIGHT = 200;

  function pixel(bytes: Uint8Array, x: number, y: number): number[] {
    const i = (y * WIDTH + x) * 4;
    return [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
  }

  /** True when any pixel in the band is opaque white (a text pixel). */
  function hasWhitePixel(bytes: Uint8Array, x0: number, y0: number, x1: number, y1: number): boolean {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const p = pixel(bytes, x, y);
        if (p[0] === 255 && p[1] === 255 && p[2] === 255 && p[3] === 255) return true;
      }
    }
    return false;
  }

  it('paints the rounded background, border and white text', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const painted = composeLabel(bytes, WIDTH, HEIGHT, 'Click Search');
    expect(painted).toBeGreaterThan(0);
    // "Click Search" = 12 chars -> 142 px text at scale 2; chip = 154x26, inset 8
    const x0 = WIDTH - 8 - 154;
    const y0 = 8;
    // interior: rgba(0,0,0,0.65) over transparent black -> opaque black
    expect(pixel(bytes, x0 + 3, y0 + 13)).toEqual([0, 0, 0, 255]);
    // left border: rgba(255,255,255,0.18) -> round(255*0.18) = 46
    expect(pixel(bytes, x0, y0 + 13)).toEqual([46, 46, 46, 255]);
    // text band carries at least one opaque white glyph pixel
    expect(hasWhitePixel(bytes, x0 + 6, y0 + 6, x0 + 148, y0 + 20)).toBe(true);
  });

  it('truncates text past the max width and keeps the chip inside it', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    composeLabel(bytes, WIDTH, HEIGHT, 'This action label is far too long to fit inside the chip', {
      maxWidth: 120,
    });
    // longest prefix that fits with "..." is "This a..." (106 px text) -> chip 118x26
    const x0 = WIDTH - 8 - 118;
    expect(pixel(bytes, x0, 21)).toEqual([46, 46, 46, 255]);
    expect(pixel(bytes, x0 - 1, 21)).toEqual([0, 0, 0, 0]);
    expect(hasWhitePixel(bytes, x0 + 6, 14, x0 + 112, 28)).toBe(true);
  });

  it('clamps the chip fully inside the frame', () => {
    const width = 60;
    const height = 30;
    const bytes = new Uint8Array(width * height * 4);
    // "OK" -> 22 px text; chip 34x26; top-right x = 60-8-34 = 18, y clamps 8 -> 4
    expect(composeLabel(bytes, width, height, 'OK')).toBeGreaterThan(0);
    const at = (x: number, y: number): number[] => {
      const i = (y * width + x) * 4;
      return [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
    };
    expect(at(18, 4 + 13)).toEqual([46, 46, 46, 255]);
    expect(at(18, 3)).toEqual([0, 0, 0, 0]);
    // the chip's bottom edge is inside the frame at the straight mid-section
    // (x = 18 + 34/2 = 35); the rounded corner at (18, 29) is correctly cut out
    expect(at(35, 29)).toEqual([46, 46, 46, 255]);
    expect(at(18, 29)).toEqual([0, 0, 0, 0]);
  });

  it('anchors to each corner of the frame', () => {
    const cases = [
      ['top-left', 8, 8],
      ['top-right', WIDTH - 8 - 34, 8],
      ['bottom-left', 8, HEIGHT - 8 - 26],
      ['bottom-right', WIDTH - 8 - 34, HEIGHT - 8 - 26],
    ] as const;
    for (const [anchor, x0, y0] of cases) {
      const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
      composeLabel(bytes, WIDTH, HEIGHT, 'OK', { anchor });
      expect(pixel(bytes, x0, y0 + 13)).toEqual([46, 46, 46, 255]);
    }
  });

  it('paints nothing for empty text', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    expect(composeLabel(bytes, WIDTH, HEIGHT, '')).toBe(0);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it('scales every layer by the alpha option', () => {
    const transparent = new Uint8Array(WIDTH * HEIGHT * 4);
    expect(composeLabel(transparent, WIDTH, HEIGHT, 'OK', { alpha: 0 })).toBe(0);
    expect(transparent.every((byte) => byte === 0)).toBe(true);

    const half = new Uint8Array(WIDTH * HEIGHT * 4);
    composeLabel(half, WIDTH, HEIGHT, 'OK', { alpha: 0.5 });
    const x0 = WIDTH - 8 - 34;
    // border: round(255 * 0.18 * 0.5) = 23
    expect(pixel(half, x0, 8 + 13)).toEqual([23, 23, 23, 255]);
  });
});

describe('semanticActionLabel', () => {
  it('maps a click to its verb plus the aspect', () => {
    expect(
      semanticActionLabel({ ts: 1, kind: 'click', ok: true, detail: { aspect: 'Search' } })
    ).toBe('Click Search');
  });

  it('never includes a raw entered value', () => {
    const label = semanticActionLabel({
      ts: 1,
      kind: 'fill',
      ok: true,
      detail: { aspect: 'txtSearch', value: 'PROJ-123' },
    });
    expect(label).toBe('Fill txtSearch');
    expect(label).not.toContain('PROJ-123');
  });

  it('maps the framework action kinds to safe verbs', () => {
    expect(semanticActionLabel({ ts: 1, kind: 'type', detail: { aspect: 'a' } })).toBe('Fill a');
    expect(semanticActionLabel({ ts: 1, kind: 'selectRow', detail: { aspect: 'grid' } })).toBe(
      'Select grid'
    );
    expect(semanticActionLabel({ ts: 1, kind: 'selectListByIndex', detail: { aspect: 'list' } })).toBe(
      'Select list'
    );
    expect(semanticActionLabel({ ts: 1, kind: 'setDatasetCell', detail: { aspect: 'table' } })).toBe(
      'Set cell table'
    );
    expect(semanticActionLabel({ ts: 1, kind: 'selectCombo', detail: { aspect: 'fund' } })).toBe(
      'Select fund'
    );
    expect(
      semanticActionLabel({ ts: 1, kind: 'menuClick', detail: { path: 'Party & Contract' } })
    ).toBe('Click menu');
  });

  it('falls back to the capitalised kind when there is no aspect', () => {
    expect(semanticActionLabel({ ts: 1, kind: 'dblclick' })).toBe('Dblclick');
    expect(semanticActionLabel({ ts: 1, kind: 'click' })).toBe('Click');
  });

  it('ignores a non-string or blank aspect', () => {
    expect(semanticActionLabel({ ts: 1, kind: 'click', detail: { aspect: 42 } })).toBe('Click');
    expect(semanticActionLabel({ ts: 1, kind: 'click', detail: { aspect: '   ' } })).toBe('Click');
  });

  it('answers null when there is nothing safe to show', () => {
    expect(semanticActionLabel({ ts: 1, kind: '' })).toBeNull();
  });
});

describe('composeInteractionTimeline action label', () => {
  const WIDTH = 400;
  const HEIGHT = 200;

  function pixel(bytes: Uint8Array, x: number, y: number): number[] {
    const i = (y * WIDTH + x) * 4;
    return [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
  }

  const clickEvent = (ts: number): ActionEvent => ({
    ts,
    kind: 'click',
    ok: true,
    detail: {
      aspect: 'Search',
      value: 'PROJ-123',
      rect: { x: 20, y: 80, width: 60, height: 24 },
    },
  });

  it('draws the semantic label for the current action after a click', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const painted = composeInteractionTimeline(bytes, WIDTH, HEIGHT, [clickEvent(1_000)], 1_100);
    expect(painted).toBeGreaterThan(0);
    // "Click Search" -> chip 154x26 anchored top-right, inset 8
    const x0 = WIDTH - 8 - 154;
    expect(pixel(bytes, x0, 8 + 13)).toEqual([46, 46, 46, 255]);
    expect(pixel(bytes, x0 + 3, 8 + 13)).toEqual([0, 0, 0, 255]);
    let sawWhite = false;
    for (let y = 14; y < 28 && !sawWhite; y += 1) {
      for (let x = x0 + 6; x < x0 + 148; x += 1) {
        const p = pixel(bytes, x, y);
        if (p[0] === 255 && p[1] === 255 && p[2] === 255 && p[3] === 255) {
          sawWhite = true;
          break;
        }
      }
    }
    expect(sawWhite).toBe(true);
  });

  it('fades the label over the last 400 ms of its life and then drops it', () => {
    const faded = new Uint8Array(WIDTH * HEIGHT * 4);
    composeInteractionTimeline(
      faded,
      WIDTH,
      HEIGHT,
      [clickEvent(1_000)],
      1_000 + LABEL_HOLD_MS + LABEL_FADE_MS / 2
    );
    // border at half alpha: round(255 * 0.18 * 0.5) = 23
    expect(pixel(faded, WIDTH - 8 - 154, 21)).toEqual([23, 23, 23, 255]);

    const expired = new Uint8Array(WIDTH * HEIGHT * 4);
    composeInteractionTimeline(
      expired,
      WIDTH,
      HEIGHT,
      [clickEvent(1_000)],
      1_000 + LABEL_HOLD_MS + LABEL_FADE_MS
    );
    expect(pixel(expired, WIDTH - 8 - 154, 21)).toEqual([0, 0, 0, 0]);
  });

  it('skips the label when even a truncated label cannot fit the frame', () => {
    const bytes = new Uint8Array(64 * 64 * 4);
    const event: ActionEvent = {
      ts: 1_000,
      kind: 'click',
      ok: true,
      detail: { aspect: 'Search', rect: { x: 10, y: 20, width: 20, height: 20 } },
    };
    expect(composeInteractionTimeline(bytes, 64, 64, [event], 1_100)).toBeGreaterThan(0);
    // (55,10) is the top-right chip area; nothing else reaches it
    const i = (10 * 64 + 55) * 4;
    expect([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]).toEqual([0, 0, 0, 0]);
  });

  it('exposes the label lifetime constants', () => {
    expect(LABEL_HOLD_MS).toBe(1_600);
    expect(LABEL_FADE_MS).toBe(400);
  });
});
