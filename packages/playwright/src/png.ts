/**
 * png.ts — minimal PNG encoder for raw BGRA frames returned by POST /render.
 *
 * The bridge returns `application/octet-stream` raw pixels (BGRA, exactly
 * width*height*4 bytes), not an encoded image. Failure-video frames are buffered
 * on disk as PNGs, so each render frame is re-encoded here: BGRA → RGB scanlines
 * → zlib deflate → PNG. This needs no image dependency, so frame capture still
 * works when ffmpeg is absent (ffmpeg remains only the mp4 assembler).
 */

import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_TYPE_RGB = 2;
const BIT_DEPTH_8 = 8;
const BYTES_PER_PIXEL = 4;

/** Encode raw BGRA pixels (POST /render output) as an 8-bit truecolour PNG. */
export function encodeBgraToPng(bytes: Uint8Array, width: number, height: number): Buffer {
  if (width <= 0 || height <= 0) {
    throw new Error(`encodeBgraToPng: invalid dimensions ${width}x${height}`);
  }
  if (bytes.length < width * height * BYTES_PER_PIXEL) {
    throw new Error(
      `encodeBgraToPng: expected ${width * height * BYTES_PER_PIXEL} bytes, got ${bytes.length}`
    );
  }

  const sourceStride = width * BYTES_PER_PIXEL;
  const scanlineLength = width * 3 + 1; // +1 PNG filter byte per scanline
  const raw = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * sourceStride;
    const targetRow = y * scanlineLength;
    raw[targetRow] = 0; // PNG filter type 0 (none)
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * BYTES_PER_PIXEL;
      const target = targetRow + 1 + x * 3;
      raw[target] = bytes[source + 2]; // R (BGRA → RGB)
      raw[target + 1] = bytes[source + 1]; // G
      raw[target + 2] = bytes[source]; // B
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = BIT_DEPTH_8;
  ihdr[9] = COLOR_TYPE_RGB;
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}
