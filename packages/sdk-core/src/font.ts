/**
 * font.ts — embedded 5x7 bitmap font plus a deterministic BGRA rasterizer.
 *
 * Self-contained by design: the evidence overlay draws an action label with no
 * browser, DOM, canvas or font dependency — only the public-domain-style bitmap
 * table below. `drawText` writes straight into the raw BGRA frame the SDK
 * already holds, so labels appear in stills and in every recorded video frame.
 */

/** Glyph cell width in pixels, before scaling. */
export const FONT_GLYPH_WIDTH = 5;
/** Glyph cell height in pixels, before scaling. */
export const FONT_GLYPH_HEIGHT = 7;
/** Horizontal pen advance per character: the 5 px cell plus a 1 px gap. */
export const FONT_ADVANCE = FONT_GLYPH_WIDTH + 1;
/** Covered code points: printable ASCII 0x20–0x7E. */
export const FONT_FIRST_CHAR = 0x20;
export const FONT_LAST_CHAR = 0x7e;

/** One glyph: seven row masks, top row first; bit 4 is the leftmost pixel. */
export type FontGlyph = readonly number[];

/**
 * Row-major 5x7 bitmaps for printable ASCII (0x20..0x7E, 95 glyphs), indexed by
 * `codePoint - FONT_FIRST_CHAR`.
 */
export const FONT_GLYPHS: readonly FontGlyph[] = [
  [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000], //  0x20 space
  [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100], //  0x21 !
  [0b01010, 0b01010, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000], //  0x22 "
  [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010], //  0x23 #
  [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100], //  0x24 $
  [0b11000, 0b11001, 0b00010, 0b00100, 0b01000, 0b10011, 0b00011], //  0x25 %
  [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101], //  0x26 &
  [0b00100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000], //  0x27 '
  [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010], //  0x28 (
  [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000], //  0x29 )
  [0b00000, 0b00100, 0b10101, 0b01110, 0b10101, 0b00100, 0b00000], //  0x2A *
  [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000], //  0x2B +
  [0b00000, 0b00000, 0b00000, 0b00000, 0b00110, 0b00100, 0b01000], //  0x2C ,
  [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000], //  0x2D -
  [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00110, 0b00110], //  0x2E .
  [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000], //  0x2F /
  [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110], //  0x30 0
  [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110], //  0x31 1
  [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111], //  0x32 2
  [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110], //  0x33 3
  [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010], //  0x34 4
  [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110], //  0x35 5
  [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110], //  0x36 6
  [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000], //  0x37 7
  [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110], //  0x38 8
  [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100], //  0x39 9
  [0b00000, 0b00110, 0b00110, 0b00000, 0b00110, 0b00110, 0b00000], //  0x3A :
  [0b00000, 0b00110, 0b00110, 0b00000, 0b00110, 0b00100, 0b01000], //  0x3B ;
  [0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010], //  0x3C <
  [0b00000, 0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000], //  0x3D =
  [0b01000, 0b00100, 0b00010, 0b00001, 0b00010, 0b00100, 0b01000], //  0x3E >
  [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b00000, 0b00100], //  0x3F ?
  [0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110], //  0x40 @
  [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001], //  0x41 A
  [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110], //  0x42 B
  [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110], //  0x43 C
  [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110], //  0x44 D
  [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111], //  0x45 E
  [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000], //  0x46 F
  [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111], //  0x47 G
  [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001], //  0x48 H
  [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110], //  0x49 I
  [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100], //  0x4A J
  [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001], //  0x4B K
  [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111], //  0x4C L
  [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001], //  0x4D M
  [0b10001, 0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001], //  0x4E N
  [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110], //  0x4F O
  [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000], //  0x50 P
  [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101], //  0x51 Q
  [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001], //  0x52 R
  [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110], //  0x53 S
  [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100], //  0x54 T
  [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110], //  0x55 U
  [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100], //  0x56 V
  [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010], //  0x57 W
  [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001], //  0x58 X
  [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100], //  0x59 Y
  [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111], //  0x5A Z
  [0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110], //  0x5B [
  [0b10000, 0b01000, 0b01000, 0b00100, 0b00010, 0b00010, 0b00001], //  0x5C backslash
  [0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110], //  0x5D ]
  [0b00100, 0b01010, 0b10001, 0b00000, 0b00000, 0b00000, 0b00000], //  0x5E ^
  [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111], //  0x5F _
  [0b01000, 0b00100, 0b00010, 0b00000, 0b00000, 0b00000, 0b00000], //  0x60 `
  [0b00000, 0b00000, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111], //  0x61 a
  [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110], //  0x62 b
  [0b00000, 0b00000, 0b01111, 0b10000, 0b10000, 0b10000, 0b01111], //  0x63 c
  [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111], //  0x64 d
  [0b00000, 0b00000, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110], //  0x65 e
  [0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000], //  0x66 f
  [0b00000, 0b00000, 0b01111, 0b10001, 0b01111, 0b00001, 0b01110], //  0x67 g
  [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001], //  0x68 h
  [0b00100, 0b00000, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110], //  0x69 i
  [0b00010, 0b00000, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100], //  0x6A j
  [0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010], //  0x6B k
  [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110], //  0x6C l
  [0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10101, 0b10101], //  0x6D m
  [0b00000, 0b00000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001], //  0x6E n
  [0b00000, 0b00000, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110], //  0x6F o
  [0b00000, 0b00000, 0b11110, 0b10001, 0b11110, 0b10000, 0b10000], //  0x70 p
  [0b00000, 0b00000, 0b01111, 0b10001, 0b01111, 0b00001, 0b00001], //  0x71 q
  [0b00000, 0b00000, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000], //  0x72 r
  [0b00000, 0b00000, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110], //  0x73 s
  [0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110], //  0x74 t
  [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101], //  0x75 u
  [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100], //  0x76 v
  [0b00000, 0b00000, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010], //  0x77 w
  [0b00000, 0b00000, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001], //  0x78 x
  [0b00000, 0b00000, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110], //  0x79 y
  [0b00000, 0b00000, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111], //  0x7A z
  [0b00110, 0b01000, 0b01000, 0b10000, 0b01000, 0b01000, 0b00110], //  0x7B {
  [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100], //  0x7C |
  [0b01100, 0b00010, 0b00010, 0b00001, 0b00010, 0b00010, 0b01100], //  0x7D }
  [0b00000, 0b00000, 0b01001, 0b10110, 0b00000, 0b00000, 0b00000], //  0x7E ~
];

/** A straight RGBA colour for {@link drawText}; `a` defaults to opaque (1). */
export interface TextColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/** The pixel box a string occupies at a given scale. */
export interface TextMeasurement {
  width: number;
  height: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** A scale is a whole number of pixels per font pixel; anything odd becomes 1. */
function resolveScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? Math.max(1, Math.round(scale)) : 1;
}

/** Write one BGRA pixel IN PLACE; answers false when the pixel is off-frame. */
function writePixel(
  bytes: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: TextColor,
  alpha: number
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const index = (y * width + x) * 4;
  const b = clampByte(color.b);
  const g = clampByte(color.g);
  const r = clampByte(color.r);
  const a = clampUnit(alpha);
  if (a >= 1) {
    bytes[index] = b;
    bytes[index + 1] = g;
    bytes[index + 2] = r;
    bytes[index + 3] = 255;
    return true;
  }
  const inverse = 1 - a;
  bytes[index] = clampByte(b * a + bytes[index] * inverse);
  bytes[index + 1] = clampByte(g * a + bytes[index + 1] * inverse);
  bytes[index + 2] = clampByte(r * a + bytes[index + 2] * inverse);
  bytes[index + 3] = 255;
  return true;
}

/**
 * The pixel box `text` occupies: every character advances 6 px (5 px cell + 1 px
 * gap), so a run of N characters is `(N * 6 - 1) * scale` wide and 7 * scale
 * tall. Empty text is zero-wide. A non-finite or non-positive scale is treated
 * as 1; fractional scales round to the nearest whole pixel.
 */
export function measureText(text: string, scale = 1): TextMeasurement {
  const effective = resolveScale(scale);
  const count = typeof text === 'string' ? text.length : 0;
  if (count === 0) return { width: 0, height: FONT_GLYPH_HEIGHT * effective };
  return {
    width: (count * FONT_ADVANCE - 1) * effective,
    height: FONT_GLYPH_HEIGHT * effective,
  };
}

/**
 * Rasterise `text` into a raw BGRA frame IN PLACE at `(x, y)` (the text's
 * top-left corner). Returns the number of pixels written. Characters outside
 * printable ASCII advance the pen without painting. Coordinates are clamped to
 * the frame; the frame is never overrun; never throws.
 */
export function drawText(
  bytes: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  text: string,
  color: TextColor,
  scale = 1
): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  if (bytes.length < width * height * 4) return 0;
  if (typeof text !== 'string' || text.length === 0) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const alpha = color.a === undefined ? 1 : clampUnit(color.a);
  if (alpha <= 0) return 0;
  const effective = resolveScale(scale);
  const originX = Math.round(x);
  const originY = Math.round(y);
  let painted = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < FONT_FIRST_CHAR || code > FONT_LAST_CHAR) continue;
    const glyph = FONT_GLYPHS[code - FONT_FIRST_CHAR];
    if (glyph === undefined) continue;
    const glyphX = originX + index * FONT_ADVANCE * effective;
    for (let row = 0; row < FONT_GLYPH_HEIGHT; row += 1) {
      const mask = glyph[row] ?? 0;
      if (mask === 0) continue;
      for (let col = 0; col < FONT_GLYPH_WIDTH; col += 1) {
        if ((mask & (1 << (FONT_GLYPH_WIDTH - 1 - col))) === 0) continue;
        for (let dy = 0; dy < effective; dy += 1) {
          for (let dx = 0; dx < effective; dx += 1) {
            if (
              writePixel(
                bytes,
                width,
                height,
                glyphX + col * effective + dx,
                originY + row * effective + dy,
                color,
                alpha
              )
            ) {
              painted += 1;
            }
          }
        }
      }
    }
  }
  return painted;
}
