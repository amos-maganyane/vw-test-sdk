import { describe, expect, it } from 'vitest';
import { inspectFrame } from '../src/frameGuard.js';

function lightFrame(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = 230;
    bytes[i + 1] = 230;
    bytes[i + 2] = 230;
    bytes[i + 3] = 255;
  }
  return bytes;
}

function withTextBand(width: number, height: number): Uint8Array {
  const bytes = lightFrame(width, height);
  const top = Math.floor(height / 4);
  const bottom = Math.floor((height * 3) / 4);
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < width; x += 2) {
      const o = (y * width + x) * 4;
      bytes[o] = 20;
      bytes[o + 1] = 20;
      bytes[o + 2] = 20;
    }
  }
  return bytes;
}

describe('inspectFrame', () => {
  it('passes an ordinary light UI frame', () => {
    const result = inspectFrame(lightFrame(200, 120), 200, 120);
    expect(result.clean).toBe(true);
  });

  it('refuses a frame containing a text-dense band', () => {
    const result = inspectFrame(withTextBand(200, 120), 200, 120);
    expect(result.clean).toBe(false);
    expect(result.reason).toContain('console');
  });

  it('refuses a bridge token visible in frame text', () => {
    const result = inspectFrame(lightFrame(20, 20), 20, 20, {
      frameText: 'Authorizing with token=TESTTOKENVALUE12345678 ok',
    });
    expect(result.clean).toBe(false);
    expect(result.reason).toContain('bridge token');
  });

  it('refuses an Authorization bearer header in frame text', () => {
    const result = inspectFrame(lightFrame(20, 20), 20, 20, {
      frameText: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    });
    expect(result.clean).toBe(false);
  });

  it('refuses a GitLab PAT in frame text', () => {
    const result = inspectFrame(lightFrame(20, 20), 20, 20, {
      frameText: 'glpat-ABCDEFGHIJKLMNOPQRST',
    });
    expect(result.clean).toBe(false);
  });

  it('honours extra patterns', () => {
    const result = inspectFrame(lightFrame(20, 20), 20, 20, {
      frameText: 'customer secret 42',
      extraPatterns: [{ label: 'custom', matches: (t) => t.includes('customer secret') }],
    });
    expect(result.clean).toBe(false);
    expect(result.reason).toContain('custom');
  });

  it('refuses a frame whose byte length does not match its extent', () => {
    const result = inspectFrame(new Uint8Array(16), 200, 120);
    expect(result.clean).toBe(false);
  });

  it('refuses a frame with no extent', () => {
    expect(inspectFrame(new Uint8Array(0), 0, 0).clean).toBe(false);
  });
});
