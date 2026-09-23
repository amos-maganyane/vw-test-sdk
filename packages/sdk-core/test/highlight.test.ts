import { describe, it, expect, vi } from 'vitest';
import {
  buildWidgetRectSource,
  composeHighlightBorder,
  findLatestInteraction,
  highlightColorForPurpose,
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
