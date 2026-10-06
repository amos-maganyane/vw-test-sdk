import { describe, it, expect } from 'vitest';
import {
  FONT_ADVANCE,
  FONT_GLYPH_HEIGHT,
  FONT_GLYPH_WIDTH,
  drawText,
  measureText,
} from '../src/font.js';

const WIDTH = 64;
const HEIGHT = 16;

function pixel(bytes: Uint8Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
}

describe('measureText', () => {
  it('measures one 5x7 cell plus the 1 px advance', () => {
    expect(FONT_GLYPH_WIDTH).toBe(5);
    expect(FONT_GLYPH_HEIGHT).toBe(7);
    expect(FONT_ADVANCE).toBe(6);
    expect(measureText('A')).toEqual({ width: 5, height: 7 });
    expect(measureText('AB')).toEqual({ width: 11, height: 7 });
  });

  it('multiplies both dimensions by the scale', () => {
    expect(measureText('Click', 2)).toEqual({ width: 58, height: 14 });
  });

  it('measures empty text as zero width', () => {
    expect(measureText('')).toEqual({ width: 0, height: 7 });
  });

  it('falls back to scale 1 for a non-positive or non-finite scale', () => {
    expect(measureText('A', 0)).toEqual({ width: 5, height: 7 });
    expect(measureText('A', Number.NaN)).toEqual({ width: 5, height: 7 });
  });
});

describe('drawText', () => {
  it("lights the pixels of the 'A' glyph at the given origin", () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const painted = drawText(bytes, WIDTH, HEIGHT, 2, 2, 'A', { r: 255, g: 255, b: 255 });
    expect(painted).toBeGreaterThan(0);
    // 'A' row 0 = 01110 -> columns (origin+1..origin+3) lit
    expect(pixel(bytes, WIDTH, 3, 2)).toEqual([255, 255, 255, 255]);
    expect(pixel(bytes, WIDTH, 4, 2)).toEqual([255, 255, 255, 255]);
    expect(pixel(bytes, WIDTH, 5, 2)).toEqual([255, 255, 255, 255]);
    // glyph bounds are respected: nothing left/right of the cell
    expect(pixel(bytes, WIDTH, 2, 2)).toEqual([0, 0, 0, 0]);
    expect(pixel(bytes, WIDTH, 6, 2)).toEqual([0, 0, 0, 0]);
    // 'A' row 3 = 11111 -> the full cell width is lit
    expect(pixel(bytes, WIDTH, 2, 5)).toEqual([255, 255, 255, 255]);
    expect(pixel(bytes, WIDTH, 6, 5)).toEqual([255, 255, 255, 255]);
  });

  it('paints nothing for a space but still advances the pen', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    expect(drawText(bytes, WIDTH, HEIGHT, 0, 0, ' ', { r: 255, g: 255, b: 255 })).toBe(0);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    // a leading space shifts 'A' one 6 px advance right: row 0 column 1 lands at x = 7
    drawText(bytes, WIDTH, HEIGHT, 0, 0, ' A', { r: 255, g: 255, b: 255 });
    expect(pixel(bytes, WIDTH, 7, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(bytes, WIDTH, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('renders unsupported characters as a blank advance without throwing', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    expect(() =>
      drawText(bytes, WIDTH, HEIGHT, 0, 0, '\u0001\u00e9', { r: 255, g: 255, b: 255 })
    ).not.toThrow();
    expect(drawText(bytes, WIDTH, HEIGHT, 0, 0, '\u0001', { r: 255, g: 255, b: 255 })).toBe(0);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it('scales glyphs by block replication', () => {
    const bytes = new Uint8Array(8 * 8 * 4);
    drawText(bytes, 8, 8, 0, 0, 'A', { r: 255, g: 255, b: 255 }, 2);
    // scale 2: row 0 -> y 0..1, columns 1..3 -> x 2..7
    expect(pixel(bytes, 8, 2, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(bytes, 8, 7, 1)).toEqual([255, 255, 255, 255]);
    expect(pixel(bytes, 8, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('clamps at the frame edges and never throws for an off-frame origin', () => {
    const bytes = new Uint8Array(8 * 8 * 4);
    expect(drawText(bytes, 8, 8, -100, -100, 'A', { r: 255, g: 255, b: 255 })).toBe(0);
    expect(() => drawText(bytes, 8, 8, -100, -100, 'A', { r: 255, g: 255, b: 255 })).not.toThrow();
    // a glyph straddling the right edge paints only the in-frame pixels
    const clipped = new Uint8Array(8 * 8 * 4);
    const painted = drawText(clipped, 8, 8, 6, 0, 'A', { r: 255, g: 255, b: 255 });
    expect(painted).toBeGreaterThan(0);
    expect(pixel(clipped, 8, 7, 0)).toEqual([255, 255, 255, 255]);
  });

  it('paints nothing for a frame with no usable pixels or an empty string', () => {
    const bytes = new Uint8Array(4);
    expect(drawText(bytes, 8, 8, 0, 0, 'A', { r: 255, g: 255, b: 255 })).toBe(0);
    const frame = new Uint8Array(WIDTH * HEIGHT * 4);
    expect(drawText(frame, WIDTH, HEIGHT, 0, 0, '', { r: 255, g: 255, b: 255 })).toBe(0);
    expect(frame.every((byte) => byte === 0)).toBe(true);
  });
});
