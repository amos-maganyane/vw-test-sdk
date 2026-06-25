/**
 * wait.ts — the WaitPredicate discriminated union + bridge-body builder.
 *
 * Each `kind` matches the bridge `/wait` predicate name exactly, so the
 * capabilities-driven refusal in `VWTestClient.wait()` can check
 * `caps.waitPredicates.includes(predicate.kind)` directly.
 *
 * 5 predicates ship in bridge <= 0.10.0; aspectMatches / widgetEnabled /
 * listHasRow ship in 0.11.0 (Wave E1a).
 */

export type WaitPredicate =
  | { kind: 'windowExists'; title: string | RegExp }
  | { kind: 'aspectEquals'; aspect: string; value: string; windowTitle?: string }
  | { kind: 'aspectNotEmpty'; aspect: string; windowTitle?: string }
  | { kind: 'aspectMatches'; aspect: string; regex: string; windowTitle?: string }
  | { kind: 'widgetEnabled'; aspect: string; windowTitle?: string }
  | { kind: 'listHasRow'; aspect: string; match: { col: string; value: string }; windowTitle?: string }
  | { kind: 'dialogExists'; title?: string }
  | { kind: 'dialogGone'; title?: string };

export interface WaitOptions {
  timeoutMs?: number;
}

/** Every predicate kind the SDK knows about (for capability cross-checks). */
export const ALL_WAIT_PREDICATE_KINDS: readonly WaitPredicate['kind'][] = [
  'windowExists',
  'aspectEquals',
  'aspectNotEmpty',
  'aspectMatches',
  'widgetEnabled',
  'listHasRow',
  'dialogExists',
  'dialogGone',
];

/**
 * Build the POST /wait JSON body for a predicate + timeout.
 *
 * `windowExists` with a RegExp title is handled by the client via self-polling
 * (the bridge takes a string title), so this builder asserts a string there.
 */
export function buildWaitBody(predicate: WaitPredicate, timeoutMs: number): Record<string, unknown> {
  const body: Record<string, unknown> = { predicate: predicate.kind, timeoutMs };

  switch (predicate.kind) {
    case 'windowExists':
      if (predicate.title instanceof RegExp) {
        throw new Error('buildWaitBody: regex windowExists must be resolved by the client, not sent to the bridge.');
      }
      body['windowTitle'] = predicate.title;
      break;
    case 'aspectEquals':
      body['aspect'] = predicate.aspect;
      body['value'] = predicate.value;
      if (predicate.windowTitle !== undefined) body['windowTitle'] = predicate.windowTitle;
      break;
    case 'aspectNotEmpty':
    case 'widgetEnabled':
      body['aspect'] = predicate.aspect;
      if (predicate.windowTitle !== undefined) body['windowTitle'] = predicate.windowTitle;
      break;
    case 'aspectMatches':
      body['aspect'] = predicate.aspect;
      body['regex'] = predicate.regex;
      if (predicate.windowTitle !== undefined) body['windowTitle'] = predicate.windowTitle;
      break;
    case 'listHasRow':
      body['aspect'] = predicate.aspect;
      body['match'] = predicate.match;
      if (predicate.windowTitle !== undefined) body['windowTitle'] = predicate.windowTitle;
      break;
    case 'dialogExists':
    case 'dialogGone':
      if (predicate.title !== undefined) body['windowTitle'] = predicate.title;
      break;
  }

  return body;
}
