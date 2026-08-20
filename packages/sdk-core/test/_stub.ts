/**
 * _stub.ts — a configurable in-memory BridgeClientLike stub for unit tests.
 * (Not a *.test.ts file, so vitest does not collect it as a suite.)
 */

import { vi } from 'vitest';
import type { BridgeClientLike, BridgeEvalResult } from '@enviro365/vw-bridge-client';
import type { BridgeCapabilities, WidgetNode, WindowSummary } from '../src/types.js';

export const DEFAULT_CAPS: BridgeCapabilities = {
  waitPredicates: [
    'windowExists',
    'aspectEquals',
    'aspectNotEmpty',
    'dialogExists',
    'dialogGone',
    'aspectMatches',
    'widgetEnabled',
    'listHasRow',
  ],
  screenshotScopes: ['screen', 'window', 'appClass'],
  evalGuards: ['destructive-image-op', 'relocate-object', 'bug-5-substring', 'vwb-compile'],
  maxEvalBodySize: 204800,
};

export interface StubConfig {
  version?: string;
  caps?: BridgeCapabilities;
  windows?: WindowSummary[];
  tree?: WidgetNode;
  value?: unknown;
  waitOk?: boolean;
  evalResult?: (source: string) => BridgeEvalResult;
  jsonResult?: (path: string, body: unknown) => unknown;
}

export function makeStubBridge(cfg: StubConfig = {}): BridgeClientLike {
  const version = cfg.version ?? '0.11.0';
  const caps = cfg.caps ?? DEFAULT_CAPS;
  const windows = cfg.windows ?? [];
  const tree: WidgetNode = cfg.tree ?? { type: 'Window', name: 'root', children: [] };
  const waitOk = cfg.waitOk ?? true;
  const evalResult = cfg.evalResult ?? ((): BridgeEvalResult => ({ ok: true, result: 'nil' }));

  const stub = {
    health: vi.fn(async () => ({ status: 'ok', version })),
    version: vi.fn(async () => ({
      version,
      buildCommitSha: 'sha',
      buildTimestamp: 'ts',
      parcelMode: 'FileIn',
    })),
    getJson: vi.fn(async (path: string) => {
      if (path === '/capabilities') return caps;
      if (path === '/windows') return windows;
      if (path.startsWith('/windows/tree')) return tree;
      if (path.startsWith('/value')) return { ok: true, aspect: 'x', value: cfg.value ?? null };
      return {};
    }),
    postJson: vi.fn(async (path: string, body: unknown) => {
      if (cfg.jsonResult !== undefined) return cfg.jsonResult(path, body);
      if (path === '/wait') return { ok: waitOk };
      return { ok: true };
    }),
    postEval: vi.fn(async (source: string) => evalResult(source)),
    postEvalRaw: vi.fn(async () => '{}'),
    getBinary: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' })),
    postBinary: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' })),
  };

  return stub as unknown as BridgeClientLike;
}
