import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeBgraToPng } from '../src/png.js';
import { resolveFfmpegPath } from '../src/video.js';

interface PngChunk {
  type: string;
  data: Buffer;
  crc: number;
}

function bgraBytes(width: number, height: number, pixel: readonly [number, number, number, number]): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = pixel[0];
    bytes[i + 1] = pixel[1];
    bytes[i + 2] = pixel[2];
    bytes[i + 3] = pixel[3];
  }
  return bytes;
}

function readChunks(png: Buffer): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    chunks.push({ type, data, crc });
    offset += 12 + length;
  }
  return chunks;
}

// Independent CRC-32 (bit-shift, no shared table) so the encoder's table is verified, not reused.
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const FFMPEG_PATH = await resolveFfmpegPath();

describe('encodeBgraToPng', () => {
  it('writes the PNG signature and IHDR dimensions', () => {
    const png = encodeBgraToPng(bgraBytes(3, 2, [1, 2, 3, 255]), 3, 2);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = readChunks(png).find((chunk) => chunk.type === 'IHDR');
    if (ihdr === undefined) throw new Error('IHDR chunk missing');
    expect(ihdr.data.readUInt32BE(0)).toBe(3);
    expect(ihdr.data.readUInt32BE(4)).toBe(2);
    expect(ihdr.data[8]).toBe(8);
    expect(ihdr.data[9]).toBe(2);
  });

  it('swizzles BGRA to RGB scanlines in the IDAT payload', () => {
    const png = encodeBgraToPng(new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]), 2, 1);
    const idat = readChunks(png).find((chunk) => chunk.type === 'IDAT');
    if (idat === undefined) throw new Error('IDAT chunk missing');
    expect([...inflateSync(idat.data)]).toEqual([0, 30, 20, 10, 60, 50, 40]);
  });

  it('writes valid CRCs on every chunk', () => {
    const png = encodeBgraToPng(bgraBytes(2, 2, [1, 2, 3, 255]), 2, 2);
    for (const chunk of readChunks(png)) {
      const body = Buffer.concat([Buffer.from(chunk.type, 'ascii'), chunk.data]);
      expect(chunk.crc).toBe(crc32(body));
    }
  });

  it('rejects a byte array shorter than width * height * 4', () => {
    expect(() => encodeBgraToPng(new Uint8Array(3), 2, 2)).toThrow(/expected 16 bytes/);
  });

  it.skipIf(FFMPEG_PATH === undefined)('produces a PNG ffmpeg decodes with the original colours', () => {
    const ffmpegPath = FFMPEG_PATH;
    if (ffmpegPath === undefined) return;
    const dir = mkdtempSync(join(tmpdir(), 'vw-png-test-'));
    try {
      const pngPath = join(dir, 'frame.png');
      const rawPath = join(dir, 'frame.rgb');
      writeFileSync(pngPath, encodeBgraToPng(bgraBytes(2, 2, [7, 8, 9, 255]), 2, 2));

      const result = spawnSync(
        ffmpegPath,
        ['-y', '-hide_banner', '-loglevel', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath],
        { windowsHide: true }
      );

      expect(result.status).toBe(0);
      // BGRA (7,8,9) → RGB (9,8,7) for all four pixels.
      expect([...readFileSync(rawPath)]).toEqual([9, 8, 7, 9, 8, 7, 9, 8, 7, 9, 8, 7]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
