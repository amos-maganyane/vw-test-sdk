/**
 * semver.ts — minimal semver parsing + comparison.
 *
 * The bridge reports plain `MAJOR.MINOR.PATCH` versions (e.g. "0.11.0"); SDK
 * packages may carry a prerelease tag (e.g. "0.1.0-rc.0"). This is just enough
 * to gate `verifyBridge()` without pulling in the full `semver` dependency.
 */

export interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease identifier (text after `-`), or null for a release version. */
  prerelease: string | null;
}

/** Parse `MAJOR.MINOR.PATCH[-prerelease]`. Throws on malformed input. */
export function parseSemver(version: string): SemverParts {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!match) {
    throw new Error(`Not a valid semver string: "${version}"`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/**
 * Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * A release outranks a prerelease of the same MAJOR.MINOR.PATCH; prereleases
 * compare lexically (sufficient for our `-rc.N` tags).
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] < pb[key]) return -1;
    if (pa[key] > pb[key]) return 1;
  }

  // Equal core version — release (null prerelease) outranks a prerelease.
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  if (pa.prerelease < pb.prerelease) return -1;
  if (pa.prerelease > pb.prerelease) return 1;
  return 0;
}

/** True if `a` is strictly less than `b`. */
export function semverLt(a: string, b: string): boolean {
  return compareSemver(a, b) < 0;
}

/** True if `a` is greater than or equal to `b`. */
export function semverGte(a: string, b: string): boolean {
  return compareSemver(a, b) >= 0;
}
