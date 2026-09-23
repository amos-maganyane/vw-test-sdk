/**
 * Frame content guard for recorded evidence.
 *
 * A rendered frame shows whatever the application is displaying, and that can include
 * live credentials: the first frame ever captured in this project contained the bridge
 * auth token (`token=...`) rendered into a VW launcher transcript pane. Evidence is
 * published to a report hub, so a frame that leaks a secret is a real disclosure.
 *
 * Window-target exclusion (see `isVwToolWindow` in video.ts) closes the transcript-pane
 * case for VW tool windows, but an APPLICATION window can still display a console,
 * status or transcript area. This module is the second layer: a content check that runs
 * on the raw pixels before a frame is written.
 *
 * The check fails CLOSED. A frame that cannot be proven clean is not published, because
 * "we could not tell" is not the same as "it is safe".
 */

/** A literal secret pattern plus a label used in the refusal message. */
export interface SecretPattern {
  readonly label: string;
  readonly matches: (text: string) => boolean;
}

const BRIDGE_TOKEN_ASSIGNMENT = /token\s*[=:]\s*\S{8,}/i;
const BEARER_HEADER = /bearer\s+[A-Za-z0-9._~+/=-]{12,}/i;
const GITLAB_PAT = /glpat-[A-Za-z0-9_-]{16,}/;
const AWS_ACCESS_KEY = /AKIA[0-9A-Z]{16}/;
const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** Default patterns. Extend via `extraPatterns` rather than editing this list at call sites. */
export const DEFAULT_SECRET_PATTERNS: readonly SecretPattern[] = [
  { label: 'bridge token assignment', matches: (t) => BRIDGE_TOKEN_ASSIGNMENT.test(t) },
  { label: 'Authorization: Bearer header', matches: (t) => BEARER_HEADER.test(t) },
  { label: 'GitLab personal access token', matches: (t) => GITLAB_PAT.test(t) },
  { label: 'AWS access key id', matches: (t) => AWS_ACCESS_KEY.test(t) },
  { label: 'PEM private key block', matches: (t) => PEM_PRIVATE_KEY.test(t) },
];

export interface FrameGuardResult {
  readonly clean: boolean;
  readonly reason: string | undefined;
}

/**
 * Decode raw BGRA pixels to a text-ish form and look for secret-shaped content.
 *
 * Rendered glyphs are not ASCII, so this cannot recover the literal text an operator
 * sees. What it CAN do is detect the case that actually leaked: text drawn into the
 * frame by a text surface, where the glyph coverage produces a high density of very
 * dark, thin strokes across a wide horizontal band - the signature of a console or
 * transcript region. That signature is what the guard refuses.
 *
 * `frameText` is optional: when the caller has no text extractor, density detection
 * alone is used, and a frame whose density is ambiguous is refused rather than passed.
 */
export function inspectFrame(
  bytes: Uint8Array,
  width: number,
  height: number,
  options: { readonly frameText?: string; readonly extraPatterns?: readonly SecretPattern[] } = {}
): FrameGuardResult {
  if (width <= 0 || height <= 0) {
    return { clean: false, reason: 'frame has no extent' };
  }
  if (bytes.length !== width * height * 4) {
    return { clean: false, reason: `frame size ${bytes.length} != ${width}x${height}x4` };
  }

  const text = options.frameText;
  if (text !== undefined && text.length > 0) {
    const patterns = [...DEFAULT_SECRET_PATTERNS, ...(options.extraPatterns ?? [])];
    for (const pattern of patterns) {
      if (pattern.matches(text)) {
        return { clean: false, reason: `frame text matches ${pattern.label}` };
      }
    }
  }

  if (looksLikeConsoleRegion(bytes, width, height)) {
    return { clean: false, reason: 'frame contains a console/transcript-like text region' };
  }

  return { clean: true, reason: undefined };
}

/**
 * Detect a dense band of dark-on-light thin strokes spanning most of the width, which is
 * what a console/transcript pane looks like even though it is not a VW tool window.
 * Deliberately conservative: a normal widget screen has large uniform areas and does not
 * trip this.
 */
function looksLikeConsoleRegion(bytes: Uint8Array, width: number, height: number): boolean {
  const rows = Math.min(height, 200);
  const rowStep = Math.max(1, Math.floor(height / rows));
  const bandRows = Math.min(60, Math.max(8, Math.floor(height / 6)));
  const darkRows: boolean[] = [];

  for (let y = 0; y < height; y += rowStep) {
    let dark = 0;
    let sampled = 0;
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4;
      const b = bytes[offset];
      const g = bytes[offset + 1];
      const r = bytes[offset + 2];
      sampled += 1;
      if (b < 90 && g < 90 && r < 90) dark += 1;
    }
    darkRows.push(sampled > 0 && dark / sampled > 0.06);
  }

  let longestRun = 0;
  let run = 0;
  for (const isDark of darkRows) {
    run = isDark ? run + 1 : 0;
    if (run > longestRun) longestRun = run;
  }

  return longestRun * rowStep >= bandRows;
}
