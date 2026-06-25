/**
 * evalGuards.ts — client-side eval safety guards (parity with vw-mcp's
 * src/tools/eval.ts, carry-forwards #49 / #51 + Bug #5 + compile-on-VWB.*).
 *
 * These are the SAME regexes vw-mcp uses to fail-fast BEFORE round-tripping a
 * destructive `/eval` body to the bridge. The SDK's `evaluate` /
 * `evaluateInGBSSession` run them so a test can never (e.g.) snapshot the image
 * and brick it — the failure that destroyed a MAS image on 2026-06-24.
 */

/** `VWB.SomeClass [class] compile:` — the bridge-namespace wedge pattern. */
const VWB_COMPILE_RE = /(?:^|[^.\w])VWB\.\w+(?:\s+class)?\s+compile:/;

/**
 * Destructive ObjectMemory / SmalltalkImage snapshot+save+quit family. Matches
 * the FIRST keyword token of each selector with a negative lookahead so both
 * unary (`snapshot`) and keyword (`snapshotAs: 'x'`) sends are refused while
 * read-only sends (`imageName`, `compactingGC`) are accepted.
 */
const DESTRUCTIVE_IMAGE_OP_RE =
  /(?:^|[^.\w])(?:ObjectMemory|SmalltalkImage(?:\s+current)?)\s+(snapshotAs:|snapshotThenQuit|snapshot|saveHeadless:|saveAs:|quitWithError:|quitPrimitiveWithError:|quit|warnThenQuit)(?![A-Za-z0-9_:])/;

/** Indirect lookup form: `(Smalltalk at: #ObjectMemory) snapshot`. */
const DESTRUCTIVE_INDIRECT_RE =
  /\(\s*Smalltalk\s+at:\s*#ObjectMemory[^)]*\)\s+(snapshotAs:|snapshotThenQuit|snapshot|saveHeadless:|saveAs:|quitWithError:|quitPrimitiveWithError:|quit|warnThenQuit)(?![A-Za-z0-9_:])/;

/** `relocateObject:from:` / `relocateClass:from:to:` — breaks compiled-method bindings. */
const RELOCATE_OBJECT_RE = /(?:^|[^#\w.])relocate(?:Object|Class):/;

export interface EvalGuardResult {
  safe: boolean;
  /** Outcome tag matching vw-mcp's audit outcomes; present only when unsafe. */
  outcome?: 'refused-snapshot' | 'refused-relocate' | 'refused-bug5' | 'refused-vwb-compile';
  reason?: string;
}

/**
 * Run every safety guard against a Smalltalk source body. Returns the first
 * violation (if any). Mirrors vw-mcp eval.ts guard order.
 */
export function checkEvalSafety(source: string): EvalGuardResult {
  const destructiveMatch =
    DESTRUCTIVE_IMAGE_OP_RE.exec(source) ?? DESTRUCTIVE_INDIRECT_RE.exec(source);
  if (destructiveMatch) {
    const matched = destructiveMatch[1] ?? destructiveMatch[0].trim();
    return {
      safe: false,
      outcome: 'refused-snapshot',
      reason:
        `Refused: source attempts a destructive image operation ("${matched}"). This would capture ` +
        `the live VWB.VWBridge listener + the /eval handler process into the saved image and brick the ` +
        `bridge on reload (carry-forward #49). Use the vw_save_image typed tool instead, never bare snapshot.`,
    };
  }

  if (RELOCATE_OBJECT_RE.test(source)) {
    return {
      safe: false,
      outcome: 'refused-relocate',
      reason:
        `Refused: source uses relocateObject:from: / relocateClass:from:to:, which is empirically unsafe ` +
        `in this MAS image — relocated classes MNU on #new (carry-forward #50/#51). Create classes in the ` +
        `target namespace directly.`,
    };
  }

  if (source.includes('VWBridge') && source.includes('dispatch')) {
    return {
      safe: false,
      outcome: 'refused-bug5',
      reason:
        `Refused: source contains both "VWBridge" AND "dispatch" substrings, which trips the bridge listener ` +
        `recursion guard (Bug #5). Call a handler method directly, or rephrase comments to avoid the substrings.`,
    };
  }

  const compileMatch = VWB_COMPILE_RE.exec(source);
  if (compileMatch) {
    return {
      safe: false,
      outcome: 'refused-vwb-compile',
      reason:
        `Refused: source contains "${compileMatch[0].trim()}" which compiles on a VWB.* class. This wedges ` +
        `the bridge via UI-announcement fan-out (carry-forward #41). Compile on a MAS class instead.`,
    };
  }

  return { safe: true };
}
