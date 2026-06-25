import { describe, it, expect } from 'vitest';
import { parseSemver, compareSemver, semverLt, semverGte } from '../src/semver.js';

describe('parseSemver', () => {
  it('parses a plain release version', () => {
    expect(parseSemver('0.11.0')).toEqual({ major: 0, minor: 11, patch: 0, prerelease: null });
  });

  it('parses a prerelease version', () => {
    expect(parseSemver('0.1.0-rc.0')).toEqual({ major: 0, minor: 1, patch: 0, prerelease: 'rc.0' });
  });

  it('throws on malformed input', () => {
    expect(() => parseSemver('not-a-version')).toThrow(/valid semver/);
    expect(() => parseSemver('1.2')).toThrow(/valid semver/);
  });
});

describe('compareSemver', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareSemver('0.10.0', '0.11.0')).toBe(-1);
    expect(compareSemver('0.11.0', '0.10.0')).toBe(1);
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1);
    expect(compareSemver('0.11.0', '0.11.0')).toBe(0);
  });

  it('ranks a release above a prerelease of the same core', () => {
    expect(compareSemver('0.1.0', '0.1.0-rc.0')).toBe(1);
    expect(compareSemver('0.1.0-rc.0', '0.1.0')).toBe(-1);
  });

  it('orders prereleases lexically', () => {
    expect(compareSemver('0.1.0-rc.0', '0.1.0-rc.1')).toBe(-1);
  });
});

describe('semverLt / semverGte', () => {
  it('gates the bridge-min check (0.10.0 < 0.11.0)', () => {
    expect(semverLt('0.10.0', '0.11.0')).toBe(true);
    expect(semverGte('0.11.0', '0.11.0')).toBe(true);
    expect(semverGte('0.12.0', '0.11.0')).toBe(true);
    expect(semverLt('0.11.0', '0.11.0')).toBe(false);
  });
});
